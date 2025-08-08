"""
Event Priority and Confidence Scoring System

This module provides comprehensive scoring for exam events based on:
- Event type patterns
- Data characteristics 
- Risk assessment
- Confidence calculations

Priority Levels:
- 3 (High): clipboard_paste, rapid_paste_burst, sudden_burst_text, content_similarity
- 2 (Medium): wpm_changes, mouse_drifting, random_typing, multi_face, typing_pattern_anomaly
- 1 (Low): gaze_tracking, window_focus, minor_interactions
"""

import json
from typing import Dict, Any, Tuple
from datetime import datetime


class EventScorer:
    """Enhanced event scoring system for exam monitoring"""
    
    # High priority event types - things like clipboard copy paste, sudden burst of text
    HIGH_PRIORITY_EVENTS = {
        'clipboard_paste': {'base_confidence': 0.8, 'description': 'Copy-paste activity detected'},
        'rapid_paste_burst': {'base_confidence': 0.95, 'description': 'Multiple paste operations in short time'},
        'keystroke_mismatch': {'base_confidence': 0.9, 'description': 'Text appears without corresponding keystrokes'},
        'content_similarity': {'base_confidence': 0.85, 'description': 'Text similarity to external sources'},
        'tab_switch': {'base_confidence': 0.9, 'description': 'User navigated away from exam'},
        'sudden_text_burst': {'base_confidence': 0.88, 'description': 'Large amount of text appeared suddenly'},
        'audio_assistance_detected': {'base_confidence': 0.8, 'description': 'Background assistance detected in audio'}
    }
    
    # Medium priority events - WPM changes, mouse drifting, random typing, multi face
    MEDIUM_PRIORITY_EVENTS = {
        'typing_pattern_anomaly': {'base_confidence': 0.7, 'description': 'Unusual typing rhythm detected'},
        'wpm_tracking': {'base_confidence': 0.6, 'description': 'Significant WPM changes'},
        'writing_style_drift': {'base_confidence': 0.65, 'description': 'Writing style inconsistency'},
        'mouse_movement': {'base_confidence': 0.6, 'description': 'Suspicious mouse movement patterns'},
        'face_count_violation': {'base_confidence': 0.75, 'description': 'Multiple or no faces detected'},
        'face_detection': {'base_confidence': 0.7, 'description': 'Face detection anomalies'},
        'window_focus': {'base_confidence': 0.5, 'description': 'Window focus changes'},
        'keystroke_anomaly': {'base_confidence': 0.6, 'description': 'Unusual keystroke patterns'}
    }    # Low priority events - gaze tracking and minor interactions
    LOW_PRIORITY_EVENTS = {
        'gaze_tracking': {'base_confidence': 0.4, 'description': 'Gaze direction changes'},
        'video_start': {'base_confidence': 0.1, 'description': 'Video recording started'},
        'video_stop': {'base_confidence': 0.1, 'description': 'Video recording stopped'},
        'exam_started': {'base_confidence': 0.1, 'description': 'Exam session began'},
        'exam_submitted': {'base_confidence': 0.1, 'description': 'Exam was submitted'},
        'question_viewed': {'base_confidence': 0.1, 'description': 'Question navigation'},
        'answer_changed': {'base_confidence': 0.2, 'description': 'Answer modification'},
        'connection_established': {'base_confidence': 0.1, 'description': 'WebSocket connection'}
    }
    
    @classmethod
    def calculate_event_score(cls, event_type: str, event_data: Dict[str, Any]) -> Tuple[int, float, bool, str]:
        """
        Calculate priority, confidence score, flagged status, and description for an event
        
        Returns:
            tuple: (priority, confidence_score, is_flagged, description)
        """
        
        # Determine base priority and confidence
        if event_type in cls.HIGH_PRIORITY_EVENTS:
            priority = 3
            event_info = cls.HIGH_PRIORITY_EVENTS[event_type]
            base_confidence = event_info['base_confidence']
            description = event_info['description']
        elif event_type in cls.MEDIUM_PRIORITY_EVENTS:
            priority = 2
            event_info = cls.MEDIUM_PRIORITY_EVENTS[event_type]
            base_confidence = event_info['base_confidence']
            description = event_info['description']
        elif event_type in cls.LOW_PRIORITY_EVENTS:
            priority = 1
            event_info = cls.LOW_PRIORITY_EVENTS[event_type]
            base_confidence = event_info['base_confidence']
            description = event_info['description']
        else:
            # Unknown event type - assign medium priority
            priority = 2
            base_confidence = 0.5
            description = f"Unknown event type: {event_type}"
        
        # Calculate enhanced confidence score based on event data
        confidence_score = cls._calculate_enhanced_confidence(event_type, event_data, base_confidence)
        
        # Determine if event should be flagged
        is_flagged = cls._should_flag_event(priority, confidence_score, event_type, event_data)
        
        return priority, confidence_score, is_flagged, description
    
    @classmethod
    def _calculate_enhanced_confidence(cls, event_type: str, event_data: Dict[str, Any], base_confidence: float) -> float:
        """Calculate enhanced confidence score based on event-specific data"""
        
        confidence = base_confidence
        
        if event_type == 'clipboard_paste':
            # Higher confidence for larger paste operations
            length = event_data.get('length', 0)
            if length > 500:
                confidence = min(0.95, confidence + 0.1)
            elif length > 100:
                confidence = min(0.9, confidence + 0.05)
        
        elif event_type == 'rapid_paste_burst':
            # Confidence based on frequency and volume
            paste_count = event_data.get('paste_count', 1)
            time_window = event_data.get('time_window', 5000) / 1000  # Convert to seconds
            
            if paste_count >= 5:
                confidence = min(0.98, confidence + 0.03)
            elif paste_count >= 3:
                confidence = min(0.95, confidence + 0.02)
            
            # Higher confidence for shorter time windows
            if time_window <= 2:
                confidence = min(0.98, confidence + 0.03)
        
        elif event_type == 'typing_pattern_anomaly':
            # Use existing confidence from event data
            existing_confidence = event_data.get('confidence', 0)
            deviation_percentage = event_data.get('deviation_percentage', 0)
            
            if existing_confidence > 0:
                confidence = existing_confidence
            elif deviation_percentage > 50:
                confidence = min(0.9, confidence + 0.2)
            elif deviation_percentage > 30:
                confidence = min(0.8, confidence + 0.1)
        
        elif event_type == 'content_similarity':
            # Use similarity score as confidence
            similarity_score = event_data.get('similarity_score', 0)
            if similarity_score > 0:
                confidence = similarity_score
        
        elif event_type == 'writing_style_drift':
            # Lower similarity means higher suspicion
            similarity_score = event_data.get('similarity_score', 1.0)
            confidence = max(0.1, 1.0 - similarity_score)
        
        elif event_type == 'wpm_tracking':
            # Check for unusual WPM values
            wpm = event_data.get('wpm', 0)
            chars_typed = event_data.get('chars_typed', 0)
            
            if wpm > 120:  # Very fast typing
                confidence = min(0.8, confidence + 0.3)
            elif wpm < 5 and chars_typed > 100:  # Very slow for amount of text
                confidence = min(0.7, confidence + 0.2)
        
        elif event_type == 'face_count_violation':
            # Confidence based on face count and duration
            face_count = event_data.get('face_count', 1)
            violation_duration = event_data.get('violation_duration', 0) / 1000  # Convert to seconds
            
            if face_count == 0:  # No face detected
                confidence = min(0.9, confidence + 0.15)
            elif face_count > 1:  # Multiple faces
                confidence = min(0.85, confidence + 0.1)
            
            # Longer violations are more suspicious
            if violation_duration > 30:
                confidence = min(0.95, confidence + 0.1)
            elif violation_duration > 10:
                confidence = min(0.9, confidence + 0.05)
        
        elif event_type == 'mouse_movement':
            # Confidence based on movement pattern type
            pattern_type = event_data.get('pattern_type', 'normal')
            velocity = event_data.get('velocity', 0)
            
            if pattern_type == 'suspicious':
                confidence = min(0.8, confidence + 0.2)
            elif pattern_type == 'rapid':
                confidence = min(0.7, confidence + 0.1)
            
            if velocity > 100:  # Very fast movement
                confidence = min(0.8, confidence + 0.1)
        
        elif event_type == 'gaze_tracking':
            # Confidence based on looking away duration
            looking_away = event_data.get('looking_away', False)
            confidence_from_data = event_data.get('confidence', 0.5)
            duration_away = event_data.get('duration_away', 0)
            
            if looking_away:
                confidence = min(0.7, confidence + 0.3)
                
                # Higher confidence for longer periods looking away
                if duration_away > 10000:  # 10+ seconds
                    confidence = min(0.8, confidence + 0.1)
                elif duration_away > 5000:  # 5+ seconds
                    confidence = min(0.7, confidence + 0.05)
            
            # Use system confidence if available
            if confidence_from_data > 0:
                confidence = max(confidence, confidence_from_data)
        
        elif event_type == 'tab_switch':
            # Confidence based on away duration
            away_duration = event_data.get('away_duration', 0) / 1000  # Convert to seconds
            
            if away_duration > 30:  # 30+ seconds away
                confidence = min(0.98, confidence + 0.08)
            elif away_duration > 10:  # 10+ seconds away
                confidence = min(0.95, confidence + 0.05)
            elif away_duration > 5:  # 5+ seconds away
                confidence = min(0.92, confidence + 0.02)
        
        elif event_type == 'audio_assistance_detected':
            # Use confidence from audio analysis
            existing_confidence = event_data.get('confidence_score', 0)
            multiple_speakers = event_data.get('multiple_speakers', False)
            suspicious_phrase_count = len(event_data.get('suspicious_phrases', []))
            
            if existing_confidence > 0:
                confidence = existing_confidence
            
            # Boost confidence for multiple speakers
            if multiple_speakers:
                confidence = min(0.98, confidence + 0.05)
            
            # Boost confidence for multiple suspicious phrases
            if suspicious_phrase_count > 3:
                confidence = min(0.95, confidence + 0.08)
            elif suspicious_phrase_count > 1:
                confidence = min(0.92, confidence + 0.04)
        
        # Ensure confidence is within valid range
        return max(0.0, min(1.0, confidence))
    
    @classmethod
    def _should_flag_event(cls, priority: int, confidence_score: float, event_type: str, event_data: Dict[str, Any]) -> bool:
        """Determine if an event should be flagged based on priority and confidence"""
        
        # High priority events - flag if confidence > 0.6
        if priority == 3:
            return confidence_score > 0.6
        
        # Medium priority events - flag if confidence > 0.7
        elif priority == 2:
            return confidence_score > 0.7
        
        # Low priority events - special cases only
        elif priority == 1:
            # Only flag gaze events if looking away for extended period
            if event_type == 'gaze_tracking':
                looking_away = event_data.get('looking_away', False)
                duration_away = event_data.get('duration_away', 0)
                return looking_away and duration_away > 10000 and confidence_score > 0.6  # 10+ seconds
            
            # Don't flag other low priority events
            return False
        
        return False
    
    @classmethod
    def get_event_summary(cls, events: list) -> Dict[str, Any]:
        """Generate a summary of event analysis"""
        
        if not events:
            return {
                'total_events': 0,
                'flagged_events': 0,
                'high_priority_events': 0,
                'medium_priority_events': 0,
                'low_priority_events': 0,
                'average_confidence': 0.0,
                'risk_level': 'Low',
                'most_suspicious_events': []
            }
        
        total_events = len(events)
        flagged_events = sum(1 for event in events if event.get('is_flagged', False))
        high_priority_events = sum(1 for event in events if event.get('priority', 1) == 3)
        medium_priority_events = sum(1 for event in events if event.get('priority', 1) == 2)
        low_priority_events = sum(1 for event in events if event.get('priority', 1) == 1)
        
        confidence_scores = [event.get('confidence_score', 0.0) for event in events]
        average_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
        
        # Calculate risk level
        flagged_ratio = flagged_events / total_events if total_events > 0 else 0
        high_priority_ratio = high_priority_events / total_events if total_events > 0 else 0
        
        if flagged_ratio > 0.3 or high_priority_ratio > 0.2 or average_confidence > 0.8:
            risk_level = 'High'
        elif flagged_ratio > 0.15 or high_priority_ratio > 0.1 or average_confidence > 0.6:
            risk_level = 'Medium'
        else:
            risk_level = 'Low'
        
        # Get most suspicious events (flagged, high confidence)
        suspicious_events = [
            event for event in events 
            if event.get('is_flagged', False) and event.get('confidence_score', 0) > 0.7
        ]
        suspicious_events.sort(key=lambda x: x.get('confidence_score', 0), reverse=True)
        most_suspicious = suspicious_events[:5]  # Top 5 most suspicious
        
        return {
            'total_events': total_events,
            'flagged_events': flagged_events,
            'high_priority_events': high_priority_events,
            'medium_priority_events': medium_priority_events,
            'low_priority_events': low_priority_events,
            'average_confidence': round(average_confidence, 3),
            'risk_level': risk_level,
            'flagged_ratio': round(flagged_ratio, 3),
            'most_suspicious_events': [
                {
                    'type': event.get('event_type', 'unknown'),
                    'confidence': round(event.get('confidence_score', 0), 3),
                    'priority': event.get('priority', 1),
                    'timestamp': event.get('timestamp', 0),
                    'description': event.get('description', '')
                }
                for event in most_suspicious
            ]
        }
    
    @classmethod
    def analyze_event_patterns(cls, events: list) -> Dict[str, Any]:
        """Analyze patterns in events to identify potential cheating strategies"""
        
        if not events:
            return {'patterns': [], 'warnings': []}
        
        patterns = []
        warnings = []
        
        # Sort events by timestamp
        sorted_events = sorted(events, key=lambda x: x.get('timestamp', 0))
        
        # Pattern 1: Multiple paste operations in short time
        paste_events = [e for e in sorted_events if e.get('event_type') in ['clipboard_paste', 'rapid_paste_burst']]
        if len(paste_events) >= 3:
            time_span = (paste_events[-1]['timestamp'] - paste_events[0]['timestamp']) / 1000 / 60  # minutes
            if time_span < 10:  # Within 10 minutes
                patterns.append({
                    'type': 'frequent_paste_operations',
                    'description': f'{len(paste_events)} paste operations within {time_span:.1f} minutes',
                    'severity': 'High',
                    'events': len(paste_events)
                })
                warnings.append('Multiple paste operations detected in short time period')
        
        # Pattern 2: Tab switching followed by quick text input
        tab_switches = [e for e in sorted_events if e.get('event_type') == 'tab_switch']
        typing_events = [e for e in sorted_events if e.get('event_type') in ['typing_pattern_anomaly', 'wpm_tracking']]
        
        for tab_event in tab_switches:
            tab_time = tab_event['timestamp']
            # Look for typing events within 30 seconds after tab switch
            quick_typing = [
                e for e in typing_events 
                if abs(e['timestamp'] - tab_time) < 30000 and e['timestamp'] > tab_time
            ]
            if quick_typing:
                patterns.append({
                    'type': 'tab_switch_quick_typing',
                    'description': 'Fast typing detected after tab switch',
                    'severity': 'High',
                    'tab_time': tab_time,
                    'typing_events': len(quick_typing)
                })
                warnings.append('Suspicious typing pattern after navigating away')
        
        # Pattern 3: Face detection issues during specific times
        face_violations = [e for e in sorted_events if e.get('event_type') == 'face_count_violation']
        if len(face_violations) > 5:
            patterns.append({
                'type': 'frequent_face_violations',
                'description': f'{len(face_violations)} face detection violations',
                'severity': 'Medium',
                'events': len(face_violations)
            })
            warnings.append('Frequent face detection issues may indicate attempt to avoid monitoring')
        
        # Pattern 4: Unusual WPM variations
        wpm_events = [e for e in sorted_events if e.get('event_type') == 'wpm_tracking']
        if len(wpm_events) >= 5:
            wpm_values = [e.get('event_data', {}).get('wpm', 0) for e in wpm_events]
            avg_wpm = sum(wpm_values) / len(wpm_values)
            max_wpm = max(wmp_values)
            min_wpm = min(wmp_values)
            
            if max_wmp - min_wmp > 60 or max_wmp > 120:
                patterns.append({
                    'type': 'extreme_wpm_variation',
                    'description': f'WPM varies from {min_wmp} to {max_wmp} (avg: {avg_wmp:.1f})',
                    'severity': 'Medium',
                    'max_wmp': max_wpm,
                    'min_wpm': min_wpm,
                    'avg_wmp': avg_wpm
                })
                warnings.append('Extreme typing speed variations detected')
        
        return {
            'patterns': patterns,
            'warnings': warnings,
            'pattern_count': len(patterns),
            'warning_count': len(warnings)
        }


def score_exam_events(events_data: list) -> Dict[str, Any]:
    """
    Main function to score all events for an exam session
    
    Args:
        events_data: List of raw event dictionaries from database
        
    Returns:
        Dictionary with scored events and analysis
    """
    
    scorer = EventScorer()
    scored_events = []
    
    for event_row in events_data:
        event_type = event_row.get('event_type', 'unknown')
        event_data = event_row.get('event_data', {})
        timestamp = event_row.get('timestamp', 0)
        
        # Parse event_data if it's a string
        if isinstance(event_data, str):
            try:
                event_data = json.loads(event_data)
            except json.JSONDecodeError:
                event_data = {}
        
        # Calculate scores
        priority, confidence_score, is_flagged, description = scorer.calculate_event_score(
            event_type, event_data
        )
        
        scored_event = {
            'event_type': event_type,
            'event_data': event_data,
            'timestamp': timestamp,
            'priority': priority,
            'confidence_score': confidence_score,
            'is_flagged': is_flagged,
            'description': description
        }
        
        scored_events.append(scored_event)
    
    # Generate summary and pattern analysis
    summary = scorer.get_event_summary(scored_events)
    patterns = scorer.analyze_event_patterns(scored_events)
    
    return {
        'events': scored_events,
        'summary': summary,
        'patterns': patterns
    }
