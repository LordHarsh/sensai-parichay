"""
Writing Style Analysis Service

This module provides GPT-based analysis of English writing style consistency
across exam answers to detect potential academic integrity violations.
"""

import json
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
import openai
from api.llm import run_llm_with_instructor
from api.settings import settings
from api.utils.logging import logger
from pydantic import BaseModel, Field


class StyleAnalysisResult(BaseModel):
    """Structured result from GPT style analysis"""
    has_style_change: bool = Field(description="Whether significant style changes were detected")
    confidence_score: float = Field(description="Confidence in the analysis (0.0 to 1.0)", ge=0.0, le=1.0)
    style_inconsistencies: List[str] = Field(description="List of specific inconsistencies found")
    analysis_summary: str = Field(description="Brief summary of the analysis")
    samples_compared: int = Field(description="Number of text samples compared")


class StyleAnalyzer:
    """Service for analyzing writing style consistency using GPT"""
    
    STYLE_ANALYSIS_PROMPT = """
You are an expert in detecting English writing style inconsistencies that may indicate academic dishonesty. 

Analyze the following exam answers for significant changes in English writing style that could suggest different authors or external assistance:

EXAM ANSWERS:
{answers_text}

Look for inconsistencies in:
1. Vocabulary sophistication and word choice patterns
2. Sentence structure complexity and variation
3. Grammar patterns and common mistakes
4. Writing flow and coherence
5. Punctuation usage patterns
6. Overall linguistic fingerprint
7. Behavioral patterns 

Important guidelines:
- Minor variations are normal and expected
- Focus on SIGNIFICANT style shifts that suggest different authorship
- Consider the academic level and context
- Only flag substantial inconsistencies, not minor improvements or fatigue effects
- Be conservative - false positives harm students unfairly

Provide your analysis with specific evidence for any inconsistencies found.
"""

    def __init__(self, api_key: str = None):
        """Initialize analyzer with OpenAI API key"""
        import os
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not provided")

    async def analyze_writing_style(self, exam_answers: Dict[str, str]) -> StyleAnalysisResult:
        """
        Analyze writing style consistency across exam answers
        
        Args:
            exam_answers: Dictionary mapping question_id to answer text
            
        Returns:
            StyleAnalysisResult with analysis findings
        """
        try:
            # Filter out non-text answers and empty responses
            text_answers = self._extract_text_answers(exam_answers)
            
            if len(text_answers) < 2:
                # Not enough text samples to compare
                return StyleAnalysisResult(
                    has_style_change=False,
                    confidence_score=0.0,
                    style_inconsistencies=[],
                    analysis_summary="Insufficient text samples for style analysis",
                    samples_compared=len(text_answers)
                )
            
            # Prepare answers text for analysis
            answers_text = self._format_answers_for_analysis(text_answers)
            
            # Create messages for GPT
            messages = [
                {
                    "role": "system",
                    "content": "You are an expert academic integrity analyst specializing in detecting writing style inconsistencies."
                },
                {
                    "role": "user", 
                    "content": self.STYLE_ANALYSIS_PROMPT.format(answers_text=answers_text)
                }
            ]
            
            # Call GPT with instructor for structured response
            result = await run_llm_with_instructor(
                api_key=self.api_key,
                model="gpt-4o-mini",  # Cost-effective model for style analysis
                messages=messages,
                response_model=StyleAnalysisResult,
                temperature=0.1  # Low temperature for consistent analysis
            )
            
            logger.info(f"Style analysis completed for {len(text_answers)} answers. "
                       f"Style change detected: {result.has_style_change} "
                       f"(confidence: {result.confidence_score})")
            
            return result
            
        except Exception as e:
            logger.error(f"Error in style analysis: {e}")
            # Return safe default result on error
            return StyleAnalysisResult(
                has_style_change=False,
                confidence_score=0.0,
                style_inconsistencies=[f"Analysis error: {str(e)}"],
                analysis_summary="Error occurred during style analysis",
                samples_compared=0
            )

    def _extract_text_answers(self, exam_answers: Dict[str, str]) -> Dict[str, str]:
        """Extract answers that contain substantial text for analysis"""
        text_answers = {}
        
        for question_id, answer in exam_answers.items():
            if not answer or not isinstance(answer, str):
                continue
                
            # Remove whitespace and check length
            cleaned_answer = answer.strip()
            
            # Only include answers with substantial text (at least 50 characters)
            # and exclude obvious multiple choice answers
            if (len(cleaned_answer) >= 50 and 
                not self._looks_like_multiple_choice(cleaned_answer)):
                text_answers[question_id] = cleaned_answer
                
        return text_answers

    def _looks_like_multiple_choice(self, answer: str) -> bool:
        """Check if answer appears to be a multiple choice response"""
        answer_lower = answer.lower().strip()
        
        # Common multiple choice patterns
        mc_patterns = [
            len(answer_lower) <= 5,  # Very short answers
            answer_lower in ['a', 'b', 'c', 'd', 'e', 'true', 'false', 'yes', 'no'],
            answer_lower.startswith(('option ', 'choice ')),
        ]
        
        return any(mc_patterns)

    def _format_answers_for_analysis(self, text_answers: Dict[str, str]) -> str:
        """Format answers for GPT analysis"""
        formatted_sections = []
        
        for i, (question_id, answer) in enumerate(text_answers.items(), 1):
            section = f"ANSWER {i} (Question {question_id}):\n{answer}\n"
            formatted_sections.append(section)
            
        return "\n" + "="*50 + "\n".join(formatted_sections)

    def generate_writing_style_event(self, 
                                   analysis_result: StyleAnalysisResult, 
                                   exam_id: str,
                                   session_id: str) -> Optional[Dict[str, Any]]:
        """
        Generate a writing style drift event based on analysis results
        
        Args:
            analysis_result: Results from style analysis
            exam_id: Exam identifier
            session_id: Session identifier
            
        Returns:
            Event dictionary if style change detected, None otherwise
        """
        if not analysis_result.has_style_change:
            return None
            
        # Create event data structure
        event_data = {
            "exam_id": exam_id,
            "session_id": session_id,
            "drift_score": analysis_result.confidence_score,
            "style_inconsistencies": analysis_result.style_inconsistencies,
            "analysis_summary": analysis_result.analysis_summary,
            "samples_compared": analysis_result.samples_compared,
            "timestamp": int(datetime.now().timestamp() * 1000)
        }
        
        return {
            "event_type": "writing_style_drift",
            "event_data": event_data,
            "timestamp": int(datetime.now().timestamp() * 1000)
        }


# Convenience function for easy integration
async def analyze_exam_writing_style(exam_answers: Dict[str, str], 
                                   api_key: str = None) -> StyleAnalysisResult:
    """
    Convenience function to analyze writing style in exam answers
    
    Args:
        exam_answers: Dictionary of question_id -> answer_text
        api_key: OpenAI API key (uses settings default if not provided)
        
    Returns:
        StyleAnalysisResult with analysis findings
    """
    analyzer = StyleAnalyzer(api_key=api_key)
    return await analyzer.analyze_writing_style(exam_answers)