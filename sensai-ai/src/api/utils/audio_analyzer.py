"""
Audio Analysis Service

This module provides Whisper-based transcription and GPT analysis of exam audio/video
to detect potential background assistance or verbal communication indicating cheating.
"""

import os
import tempfile
import json
import subprocess
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import openai
from api.llm import run_llm_with_instructor
from api.utils.logging import logger
from pydantic import BaseModel, Field


class AudioAnalysisResult(BaseModel):
    """Structured result from audio analysis"""
    has_background_help: bool = Field(description="Whether background assistance was detected")
    confidence_score: float = Field(description="Confidence in the analysis (0.0 to 1.0)", ge=0.0, le=1.0)
    transcription: str = Field(description="Full transcription of audio content")
    suspicious_phrases: List[str] = Field(description="List of phrases indicating potential help")
    analysis_summary: str = Field(description="Brief summary of the audio analysis")
    speech_detected: bool = Field(description="Whether any speech was detected in the audio")
    multiple_speakers: bool = Field(description="Whether multiple distinct speakers were detected")


class AudioAnalyzer:
    """Service for analyzing exam audio using Whisper transcription and GPT analysis"""
    
    AUDIO_ANALYSIS_PROMPT = """
You are an expert in detecting academic dishonesty through audio analysis during exams.

Analyze the following transcription from an exam session to determine if there's evidence of background assistance or communication that could indicate cheating:

TRANSCRIPTION:
{transcription}

Look for indicators of potential cheating:
1. Multiple distinct voices/speakers
2. Phrases indicating assistance ("the answer is...", "write this down...", "it should be...")
3. Questions being answered by someone other than the test taker
4. Dictation of answers or solutions
5. Collaborative discussion about exam content
6. Instructions or prompts from another person
7. Reading of external materials or sources

Important guidelines:
- Self-talk, thinking aloud, or reading questions to oneself is normal
- Occasional background noise or distant conversations are not suspicious
- Focus on DIRECT assistance or collaboration related to exam content
- Consider the context - brief interruptions vs. sustained assistance
- Be conservative - false positives can harm students unfairly

Provide specific evidence and quotes from the transcription for any suspicious activity found.
"""

    def __init__(self, api_key: str = None):
        """Initialize analyzer with OpenAI API key"""
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not provided")

    async def analyze_exam_audio(self, video_file_path: str, exam_id: str) -> AudioAnalysisResult:
        """
        Analyze exam video/audio for background assistance
        
        Args:
            video_file_path: Path to the exam video file
            exam_id: Exam identifier for logging
            
        Returns:
            AudioAnalysisResult with analysis findings
        """
        try:
            # Check if video file exists
            if not os.path.exists(video_file_path):
                logger.warning(f"Video file not found: {video_file_path}")
                return self._create_no_audio_result("Video file not found")
            
            # Extract audio from video and transcribe
            transcription = await self._transcribe_video_audio(video_file_path, exam_id)
            
            if not transcription or len(transcription.strip()) < 10:
                logger.info(f"No significant speech detected in exam {exam_id}")
                return AudioAnalysisResult(
                    has_background_help=False,
                    confidence_score=0.0,
                    transcription=transcription or "",
                    suspicious_phrases=[],
                    analysis_summary="No significant speech detected during exam",
                    speech_detected=False,
                    multiple_speakers=False
                )
            
            # Analyze transcription with GPT
            analysis_result = await self._analyze_transcription_with_gpt(transcription)
            
            logger.info(f"Audio analysis completed for exam {exam_id}. "
                       f"Background help detected: {analysis_result.has_background_help} "
                       f"(confidence: {analysis_result.confidence_score})")
            
            return analysis_result
            
        except Exception as e:
            logger.error(f"Error in audio analysis for exam {exam_id}: {e}")
            return AudioAnalysisResult(
                has_background_help=False,
                confidence_score=0.0,
                transcription="",
                suspicious_phrases=[f"Analysis error: {str(e)}"],
                analysis_summary=f"Error occurred during audio analysis: {str(e)}",
                speech_detected=False,
                multiple_speakers=False
            )

    async def _transcribe_video_audio(self, video_file_path: str, exam_id: str) -> str:
        """Extract audio from video and transcribe using Whisper"""
        try:
            # Create temporary audio file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
                temp_audio_path = temp_audio.name
            
            try:
                # Extract audio using ffmpeg
                cmd = [
                    'ffmpeg',
                    '-i', video_file_path,
                    '-vn',  # No video
                    '-acodec', 'pcm_s16le',  # Audio codec
                    '-ar', '16000',  # Sample rate
                    '-ac', '1',  # Mono
                    '-y',  # Overwrite output file
                    temp_audio_path
                ]
                
                logger.info(f"Extracting audio from video: {video_file_path}")
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                
                if result.returncode != 0:
                    logger.error(f"FFmpeg error: {result.stderr}")
                    raise Exception(f"Audio extraction failed: {result.stderr}")
                
                # Check if audio file was created and has content
                if not os.path.exists(temp_audio_path) or os.path.getsize(temp_audio_path) < 1000:
                    logger.warning(f"No audio content extracted from {video_file_path}")
                    return ""
                
                # Transcribe using Whisper API
                client = openai.OpenAI(api_key=self.api_key)
                
                logger.info("Starting Whisper transcription...")
                with open(temp_audio_path, 'rb') as audio_file:
                    transcript = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file,
                        response_format="verbose_json",  # Get detailed output including speaker detection hints
                        language="en"  # Can be removed to auto-detect
                    )
                
                transcription_text = transcript.text
                logger.info(f"Transcription completed. Length: {len(transcription_text)} characters")
                
                return transcription_text
                
            finally:
                # Clean up temporary audio file
                if os.path.exists(temp_audio_path):
                    os.unlink(temp_audio_path)
                    
        except subprocess.TimeoutExpired:
            logger.error(f"Audio extraction timed out for {video_file_path}")
            raise Exception("Audio extraction timed out")
        except Exception as e:
            logger.error(f"Error in audio transcription: {e}")
            raise

    async def _analyze_transcription_with_gpt(self, transcription: str) -> AudioAnalysisResult:
        """Analyze transcription using GPT to detect background assistance"""
        try:
            # Create messages for GPT analysis
            messages = [
                {
                    "role": "system",
                    "content": "You are an expert academic integrity analyst specializing in detecting background assistance through audio analysis."
                },
                {
                    "role": "user",
                    "content": self.AUDIO_ANALYSIS_PROMPT.format(transcription=transcription)
                }
            ]
            
            # Call GPT with instructor for structured response
            result = await run_llm_with_instructor(
                api_key=self.api_key,
                model="gpt-4o-mini",  # Cost-effective model for transcription analysis
                messages=messages,
                response_model=AudioAnalysisResult,
                max_completion_tokens=1000
            )
            
            # Ensure transcription is included in result
            result.transcription = transcription
            result.speech_detected = len(transcription.strip()) > 10
            
            return result
            
        except Exception as e:
            logger.error(f"Error in GPT transcription analysis: {e}")
            raise

    def _create_no_audio_result(self, reason: str) -> AudioAnalysisResult:
        """Create a result for cases where no audio analysis is possible"""
        return AudioAnalysisResult(
            has_background_help=False,
            confidence_score=0.0,
            transcription="",
            suspicious_phrases=[],
            analysis_summary=reason,
            speech_detected=False,
            multiple_speakers=False
        )

    def generate_audio_assistance_event(self, 
                                      analysis_result: AudioAnalysisResult,
                                      exam_id: str,
                                      session_id: str) -> Optional[Dict[str, Any]]:
        """
        Generate an audio assistance event based on analysis results
        
        Args:
            analysis_result: Results from audio analysis
            exam_id: Exam identifier
            session_id: Session identifier
            
        Returns:
            Event dictionary if background help detected, None otherwise
        """
        if not analysis_result.has_background_help:
            return None
        
        # Create event data structure
        event_data = {
            "exam_id": exam_id,
            "session_id": session_id,
            "confidence_score": analysis_result.confidence_score,
            "suspicious_phrases": analysis_result.suspicious_phrases,
            "analysis_summary": analysis_result.analysis_summary,
            "speech_detected": analysis_result.speech_detected,
            "multiple_speakers": analysis_result.multiple_speakers,
            "transcription_length": len(analysis_result.transcription),
            "timestamp": int(datetime.now().timestamp() * 1000)
        }
        
        return {
            "event_type": "audio_assistance_detected",
            "event_data": event_data,
            "timestamp": int(datetime.now().timestamp() * 1000)
        }


# Convenience function for easy integration
async def analyze_exam_audio_for_help(video_file_path: str, 
                                    exam_id: str,
                                    api_key: str = None) -> AudioAnalysisResult:
    """
    Convenience function to analyze exam audio for background assistance
    
    Args:
        video_file_path: Path to exam video file
        exam_id: Exam identifier
        api_key: OpenAI API key (uses environment default if not provided)
        
    Returns:
        AudioAnalysisResult with analysis findings
    """
    analyzer = AudioAnalyzer(api_key=api_key)
    return await analyzer.analyze_exam_audio(video_file_path, exam_id)