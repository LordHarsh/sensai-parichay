"use client";

import React, { useRef, useCallback, useEffect } from 'react';
import { ExamWebSocket } from '@/lib/exam-websocket';

interface TypingMetrics {
  keystrokes: Array<{ key: string; timestamp: number; interval?: number }>;
  words: string[];
  wpm: number;
  avgWordLength: number;
  sentenceCount: number;
  backspaceCount: number;
  pauses: number[];
  startTime: number;
  lastKeyTime: number;
}

interface PasteEvent {
  timestamp: number;
  length: number;
  content: string;
  contentHash: string;
}

interface WritingSample {
  text: string;
  timestamp: number;
  wpm: number;
  avgWordLength: number;
  sentenceStructure: number;
}

export default function AdvancedCheatingDetector({ 
  websocket, 
  examId, 
  questionId, 
  onTypingMetricsUpdate 
}: { 
  websocket: ExamWebSocket | null;
  examId: string;
  questionId: string;
  onTypingMetricsUpdate?: (metrics: TypingMetrics) => void;
}) {
  const typingMetrics = useRef<TypingMetrics>({
    keystrokes: [],
    words: [],
    wpm: 0,
    avgWordLength: 0,
    sentenceCount: 0,
    backspaceCount: 0,
    pauses: [],
    startTime: 0,
    lastKeyTime: 0
  });

  const pasteBursts = useRef<PasteEvent[]>([]);
  const writingSamples = useRef<WritingSample[]>([]);
  const suspiciousPatterns = useRef<string[]>([]);

  // Content similarity detection patterns
  const commonCheatingPhrases = [
    "according to the textbook",
    "as mentioned in class",
    "the professor stated",
    "wikipedia states",
    "google search results",
    "stack overflow",
    "copy from",
    "paste from"
  ];

  const hashString = useCallback((str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }, []);

  const calculateWPM = useCallback((keystrokes: Array<{ timestamp: number }>, text: string): number => {
    if (keystrokes.length < 2) return 0;
    
    const timeSpan = (keystrokes[keystrokes.length - 1].timestamp - keystrokes[0].timestamp) / 1000 / 60; // in minutes
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
    
    return timeSpan > 0 ? Math.round(wordCount / timeSpan) : 0;
  }, []);

  const analyzeWritingStyle = useCallback((text: string): WritingSample => {
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    const avgWordLength = words.length > 0 ? words.reduce((sum, word) => sum + word.length, 0) / words.length : 0;
    const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;
    
    return {
      text,
      timestamp: Date.now(),
      wpm: typingMetrics.current.wpm,
      avgWordLength,
      sentenceStructure: avgSentenceLength
    };
  }, []);

  const detectContentSimilarity = useCallback((text: string) => {
    const lowerText = text.toLowerCase();
    const matchedPhrases: string[] = [];
    
    // Check for common cheating phrases
    commonCheatingPhrases.forEach(phrase => {
      if (lowerText.includes(phrase.toLowerCase())) {
        matchedPhrases.push(phrase);
      }
    });

    // Check for suspiciously perfect grammar/structure
    const perfectGrammarScore = analyzePerfectGrammar(text);
    
    if (matchedPhrases.length > 0 || perfectGrammarScore > 0.8) {
      websocket?.sendEvent({
        type: 'content_similarity',
        timestamp: Date.now(),
        data: {
          question_id: questionId,
          similarity_score: matchedPhrases.length > 0 ? 0.9 : perfectGrammarScore,
          suspected_source: matchedPhrases.length > 0 ? 'common_phrases' : 'ai_generated',
          matched_phrases: matchedPhrases,
          comparison_text: text.substring(0, 200)
        }
      });
    }
  }, [websocket, questionId]);

  const analyzePerfectGrammar = useCallback((text: string): number => {
    // Simple heuristics for AI-generated or perfectly copied text
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return 0;

    let grammarScore = 0;
    
    // Check for consistent sentence length (AI tends to be consistent)
    const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / sentenceLengths.length;
    
    if (variance < 10 && avgLength > 15) grammarScore += 0.3; // Suspiciously consistent
    
    // Check for complex vocabulary in simple context
    const complexWords = text.match(/\b\w{8,}\b/g) || [];
    if (complexWords.length / text.split(/\s+/).length > 0.2) grammarScore += 0.3;
    
    // Check for perfect punctuation
    const punctuationRatio = (text.match(/[,.;:!?]/g) || []).length / text.length;
    if (punctuationRatio > 0.05 && punctuationRatio < 0.15) grammarScore += 0.2;
    
    return Math.min(grammarScore, 1);
  }, []);

  const detectWritingStyleDrift = useCallback((currentText: string) => {
    if (writingSamples.current.length < 2) return;
    
    const currentSample = analyzeWritingStyle(currentText);
    const previousSamples = writingSamples.current.slice(-3); // Last 3 samples
    
    const avgPreviousWordLength = previousSamples.reduce((sum, sample) => sum + sample.avgWordLength, 0) / previousSamples.length;
    const avgPreviousSentenceStructure = previousSamples.reduce((sum, sample) => sum + sample.sentenceStructure, 0) / previousSamples.length;
    
    const wordLengthChange = Math.abs(currentSample.avgWordLength - avgPreviousWordLength) / avgPreviousWordLength;
    const sentenceStructureChange = Math.abs(currentSample.sentenceStructure - avgPreviousSentenceStructure) / avgPreviousSentenceStructure;
    
    const driftScore = (wordLengthChange + sentenceStructureChange) / 2;
    
    if (driftScore > 0.4) { // 40% change in writing style
      websocket?.sendEvent({
        type: 'writing_style_drift',
        timestamp: Date.now(),
        data: {
          question_id: questionId,
          drift_score: driftScore,
          avg_word_length_change: wordLengthChange,
          sentence_structure_change: sentenceStructureChange,
          vocabulary_similarity: calculateVocabSimilarity(currentText, previousSamples.map(s => s.text).join(' ')),
          previous_samples: previousSamples.map(s => s.text.substring(0, 100)),
          current_sample: currentText.substring(0, 100)
        }
      });
    }
    
    writingSamples.current.push(currentSample);
  }, [websocket, questionId, analyzeWritingStyle]);

  const calculateVocabSimilarity = useCallback((text1: string, text2: string): number => {
    const words1 = new Set(text1.toLowerCase().match(/\b\w+\b/g) || []);
    const words2 = new Set(text2.toLowerCase().match(/\b\w+\b/g) || []);
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }, []);

  const detectRapidPasteBurst = useCallback(() => {
    const now = Date.now();
    const recentPastes = pasteBursts.current.filter(paste => now - paste.timestamp < 5000); // Last 5 seconds
    
    if (recentPastes.length >= 3) {
      const totalChars = recentPastes.reduce((sum, paste) => sum + paste.length, 0);
      
      websocket?.sendEvent({
        type: 'rapid_paste_burst',
        timestamp: now,
        data: {
          paste_count: recentPastes.length,
          total_chars: totalChars,
          time_window: 5000,
          paste_events: recentPastes.map(paste => ({
            timestamp: paste.timestamp,
            length: paste.length,
            content_hash: paste.contentHash
          }))
        }
      });
    }
  }, [websocket]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const now = Date.now();
    const interval = typingMetrics.current.lastKeyTime > 0 ? now - typingMetrics.current.lastKeyTime : 0;
    
    if (typingMetrics.current.startTime === 0) {
      typingMetrics.current.startTime = now;
    }
    
    // Track keystroke with timing
    typingMetrics.current.keystrokes.push({
      key: event.key,
      timestamp: now,
      interval
    });
    
    // Track backspaces
    if (event.key === 'Backspace') {
      typingMetrics.current.backspaceCount++;
    }
    
    // Detect long pauses (potential research/copying time)
    if (interval > 3000) { // 3+ second pause
      typingMetrics.current.pauses.push(interval);
    }
    
    typingMetrics.current.lastKeyTime = now;
    
    // Check for typing pattern anomalies
    if (typingMetrics.current.keystrokes.length > 10) {
      const recentIntervals = typingMetrics.current.keystrokes.slice(-10).map(k => k.interval || 0).filter(i => i > 0);
      const avgInterval = recentIntervals.reduce((sum, interval) => sum + interval, 0) / recentIntervals.length;
      const currentWPM = calculateWPM(typingMetrics.current.keystrokes.slice(-10), '');
      
      // Detect sudden WPM changes
      if (Math.abs(currentWPM - typingMetrics.current.wpm) > 30 && typingMetrics.current.wpm > 0) {
        websocket?.sendEvent({
          type: 'typing_pattern_anomaly',
          timestamp: now,
          data: {
            question_id: questionId,
            current_wpm: currentWPM,
            baseline_wpm: typingMetrics.current.wpm,
            deviation_percentage: Math.abs(currentWPM - typingMetrics.current.wpm) / typingMetrics.current.wpm * 100,
            keystroke_intervals: recentIntervals,
            typing_rhythm_score: calculateTypingRhythm(recentIntervals)
          }
        });
      }
    }
  }, [websocket, questionId, calculateWPM]);

  const calculateTypingRhythm = useCallback((intervals: number[]): number => {
    if (intervals.length < 3) return 1;
    
    const variance = intervals.reduce((sum, interval, i) => {
      const avg = intervals.reduce((s, int) => s + int, 0) / intervals.length;
      return sum + Math.pow(interval - avg, 2);
    }, 0) / intervals.length;
    
    const coefficient = Math.sqrt(variance) / (intervals.reduce((s, int) => s + int, 0) / intervals.length);
    return Math.max(0, 1 - coefficient); // Higher score = more consistent rhythm
  }, []);

  const handlePaste = useCallback((event: ClipboardEvent) => {
    const clipboardData = event.clipboardData?.getData('text') || '';
    const now = Date.now();
    
    const pasteEvent: PasteEvent = {
      timestamp: now,
      length: clipboardData.length,
      content: clipboardData,
      contentHash: hashString(clipboardData)
    };
    
    pasteBursts.current.push(pasteEvent);
    
    // Send paste event
    websocket?.sendEvent({
      type: 'clipboard_paste',
      timestamp: now,
      data: {
        content_hash: pasteEvent.contentHash,
        length: clipboardData.length,
        timestamp: now,
        question_id: questionId
      }
    });
    
    // Check for rapid paste bursts
    detectRapidPasteBurst();
    
    // Analyze pasted content for similarities
    if (clipboardData.length > 50) {
      detectContentSimilarity(clipboardData);
    }
  }, [websocket, questionId, hashString, detectRapidPasteBurst, detectContentSimilarity]);

  const handleTextInput = useCallback((text: string) => {
    if (!text || text.length < 10) return;
    
    // Update typing metrics
    typingMetrics.current.words = text.split(/\s+/).filter(word => word.length > 0);
    typingMetrics.current.wpm = calculateWPM(typingMetrics.current.keystrokes, text);
    typingMetrics.current.avgWordLength = typingMetrics.current.words.length > 0 
      ? typingMetrics.current.words.reduce((sum, word) => sum + word.length, 0) / typingMetrics.current.words.length 
      : 0;
    typingMetrics.current.sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    
    // Send WPM tracking event
    if (typingMetrics.current.wpm > 0) {
      websocket?.sendEvent({
        type: 'wpm_tracking',
        timestamp: Date.now(),
        data: {
          question_id: questionId,
          wpm: typingMetrics.current.wpm,
          chars_typed: text.length,
          time_duration: Date.now() - typingMetrics.current.startTime,
          keystroke_intervals: typingMetrics.current.keystrokes.slice(-20).map(k => k.interval || 0),
          pauses: typingMetrics.current.pauses,
          backspaces: typingMetrics.current.backspaceCount
        }
      });
    }
    
    // Detect writing style drift
    if (text.length > 100) {
      detectWritingStyleDrift(text);
    }
    
    // Detect content similarity
    if (text.length > 50) {
      detectContentSimilarity(text);
    }
    
    // Update callback if provided
    if (onTypingMetricsUpdate) {
      onTypingMetricsUpdate(typingMetrics.current);
    }
  }, [websocket, questionId, calculateWPM, detectWritingStyleDrift, detectContentSimilarity, onTypingMetricsUpdate]);

  // Add a useEffect to track text input changes
  useEffect(() => {
    const handleTextInputChange = (event: Event) => {
      const target = event.target as HTMLTextAreaElement;
      if (target && target.tagName === 'TEXTAREA') {
        const text = target.value;
        if (text.length > 0) {
          handleTextInput(text);
        }
      }
    };

    // Listen for input events on textareas
    document.addEventListener('input', handleTextInputChange);
    
    return () => {
      document.removeEventListener('input', handleTextInputChange);
    };
  }, [handleTextInput]);

  // Attach event listeners
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('paste', handlePaste);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('paste', handlePaste);
    };
  }, [handleKeyDown, handlePaste]);

  // Reset metrics when question changes
  useEffect(() => {
    typingMetrics.current = {
      keystrokes: [],
      words: [],
      wpm: 0,
      avgWordLength: 0,
      sentenceCount: 0,
      backspaceCount: 0,
      pauses: [],
      startTime: 0,
      lastKeyTime: 0
    };
    pasteBursts.current = [];
  }, [questionId]);

  return (
    <div style={{ display: 'none' }}>
      {/* Hidden component that handles advanced cheating detection */}
    </div>
  );
}
