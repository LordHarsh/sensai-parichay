"""
Comprehensive exam evaluation system using OpenAI with advanced analysis
"""
import os
import json
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from openai import OpenAI
import re
from api.llm import evaluate_exam_with_openai

async def create_comprehensive_evaluation(exam_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create comprehensive evaluation using advanced OpenAI analysis
    """
    try:
        print(f"[DEBUG] Starting comprehensive evaluation for exam: {exam_data.get('exam_title', 'Unknown')}")
        print(f"[DEBUG] Input data keys: {list(exam_data.keys())}")
        
        # Get OpenAI API key
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("[DEBUG] No OpenAI API key found, using fallback")
            return create_fallback_evaluation(exam_data)
        
        print(f"[DEBUG] OpenAI API key found, length: {len(api_key)}")
        
        # Prepare exam context for the comprehensive evaluation
        exam_context = {
            "exam_title": exam_data.get("exam_title", "Unknown Exam"),
            "exam_description": exam_data.get("exam_description", ""),
            "duration": exam_data.get("duration", 0),
            "time_taken": exam_data.get("time_taken", 0),
            "score": exam_data.get("score", 0),
            "user_name": exam_data.get("user_name", "Student"),
            "session_id": exam_data.get("session_id", "unknown"),
            "questions": exam_data.get("questions", []),
            "questions_and_answers": exam_data.get("questions_and_answers", [])
        }
        
        print(f"[DEBUG] Prepared exam context for comprehensive analysis")
        
        # Use the comprehensive evaluation function from llm.py
        try:
            print("[DEBUG] Making comprehensive OpenAI evaluation call...")
            print(f"[DEBUG] API key length: {len(api_key) if api_key else 'None'}")
            print(f"[DEBUG] Exam context keys: {list(exam_context.keys())}")
            
            # We're already in an async context, so we can directly await
            print("[DEBUG] About to call evaluate_exam_with_openai...")
            try:
                comprehensive_result = await evaluate_exam_with_openai(
                    api_key=api_key,
                    exam_context=exam_context,
                    model="gpt-4o"  # Using valid OpenAI model name
                )
                print("[DEBUG] evaluate_exam_with_openai completed successfully")
            except Exception as inner_e:
                print(f"[ERROR] evaluate_exam_with_openai failed with: {str(inner_e)}")
                print(f"[ERROR] Exception type: {type(inner_e).__name__}")
                raise inner_e
            
            print("[DEBUG] Comprehensive evaluation successful")
            
            # Transform the result to match our expected format
            evaluation_result = {
                "success": True,
                "evaluation_type": "comprehensive_ai",
                "exam_summary": {
                    "exam_title": exam_context["exam_title"],
                    "student_name": exam_context["user_name"],
                    "score": exam_context["score"],
                    "total_questions": len(exam_context.get("questions_and_answers", [])),
                    "correct_answers": sum(1 for qa in exam_context.get("questions_and_answers", []) if qa.get("is_correct", False)),
                    "accuracy_rate": round((sum(1 for qa in exam_context.get("questions_and_answers", []) if qa.get("is_correct", False)) / len(exam_context.get("questions_and_answers", [])) * 100) if len(exam_context.get("questions_and_answers", [])) > 0 else 0, 1)
                },
                "comprehensive_analysis": comprehensive_result,
                "question_breakdown": [
                    {
                        "question_number": i + 1,
                        "question_text": qa.get("question_text", f"Question {i + 1}"),
                        "user_answer": qa.get("user_answer", "No answer"),
                        "correct_answer": qa.get("correct_answer", "N/A"),
                        "is_correct": qa.get("is_correct", False),
                        "status": "✅ Correct" if qa.get("is_correct", False) else "❌ Incorrect"
                    }
                    for i, qa in enumerate(exam_context.get("questions_and_answers", []))
                ],
                "generated_at": datetime.now().isoformat(),
                "model_used": "gpt-5-nano"
            }
            
            print("[DEBUG] Comprehensive evaluation completed successfully")
            return evaluation_result
            
        except Exception as api_error:
            print(f"[ERROR] Comprehensive evaluation failed: {str(api_error)}")
            print(f"[ERROR] API error type: {type(api_error).__name__}")
            return create_fallback_evaluation(exam_data)
            
    except Exception as e:
        print(f"[ERROR] Comprehensive evaluation setup failed: {str(e)}")
        print(f"[ERROR] Error type: {type(e).__name__}")
        import traceback
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        return create_fallback_evaluation(exam_data)


def create_fallback_evaluation(exam_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a basic evaluation when AI is unavailable
    """
    try:
        print("[DEBUG] Creating fallback evaluation")
        
        exam_title = exam_data.get("exam_title", "Unknown Exam")
        score = exam_data.get("score", 0)
        total_questions = len(exam_data.get("questions_and_answers", []))
        correct_answers = sum(1 for qa in exam_data.get("questions_and_answers", []) if qa.get("is_correct", False))
        
        print(f"[DEBUG] Fallback metrics - Title: {exam_title}, Score: {score}%, Questions: {total_questions}")
        
        # Generate basic feedback based on score
        if score >= 90:
            feedback = "Excellent work! You demonstrated strong understanding of the material. Keep up the great work and continue challenging yourself with advanced topics."
        elif score >= 80:
            feedback = "Good performance! You have a solid grasp of most concepts. Focus on reviewing the areas where you made mistakes to achieve even better results."
        elif score >= 70:
            feedback = "Fair performance. You understand the basics but need to strengthen your knowledge in several areas. Regular practice and review will help improve your scores."
        elif score >= 60:
            feedback = "Below average performance. Consider reviewing the course materials more thoroughly and seeking additional help if needed. Focus on understanding fundamental concepts."
        else:
            feedback = "Poor performance indicates significant gaps in understanding. It's recommended to revisit the course materials, seek help from instructors, and practice more frequently."
        
        evaluation_result = {
            "success": True,
            "evaluation_type": "basic_system",
            "exam_summary": {
                "exam_title": exam_title,
                "student_name": exam_data.get("user_name", "Student"),
                "score": score,
                "total_questions": total_questions,
                "correct_answers": correct_answers,
                "accuracy_rate": round((correct_answers / total_questions * 100) if total_questions > 0 else 0, 1)
            },
            "ai_feedback": feedback,
            "question_breakdown": [
                {
                    "question_number": i + 1,
                    "question_text": qa.get("question_text", f"Question {i + 1}"),
                    "user_answer": qa.get("user_answer", "No answer"),
                    "correct_answer": qa.get("correct_answer", "N/A"),
                    "is_correct": qa.get("is_correct", False),
                    "status": "✅ Correct" if qa.get("is_correct", False) else "❌ Incorrect"
                }
                for i, qa in enumerate(exam_data.get("questions_and_answers", []))
            ],
            "performance_metrics": {
                "performance_level": get_performance_level(score),
                "time_taken": f"{exam_data.get('time_taken', 0) / 60:.1f} minutes",
                "efficiency": get_efficiency_rating(exam_data.get('time_taken', 0), exam_data.get('duration', 0))
            },
            "recommendations": get_basic_recommendations(score),
            "generated_at": datetime.now().isoformat(),
            "model_used": "basic_system",
            "note": "Basic evaluation provided due to AI service unavailability"
        }
        
        print("[DEBUG] Fallback evaluation created successfully")
        return evaluation_result
        
    except Exception as e:
        print(f"[ERROR] Even fallback evaluation failed: {str(e)}")
        # Return absolute minimum evaluation
        return {
            "success": True,
            "evaluation_type": "minimal_fallback",
            "exam_summary": {
                "exam_title": exam_data.get("exam_title", "Unknown Exam"),
                "student_name": exam_data.get("user_name", "Student"),
                "score": exam_data.get("score", 0),
                "total_questions": len(exam_data.get("questions_and_answers", [])),
                "correct_answers": 0,
                "accuracy_rate": 0
            },
            "ai_feedback": "Evaluation completed. Please review your answers and consult your instructor for detailed feedback.",
            "question_breakdown": [],
            "performance_metrics": {
                "performance_level": "Unknown",
                "time_taken": "Unknown",
                "efficiency": "Unknown"
            },
            "recommendations": [
                "Review the exam questions and answers",
                "Consult with your instructor for detailed feedback",
                "Continue studying the course materials"
            ],
            "generated_at": datetime.now().isoformat(),
            "model_used": "emergency_fallback",
            "note": "Minimal evaluation due to system errors"
        }


def get_performance_level(score: float) -> str:
    """Get performance level based on score"""
    if score >= 90:
        return "Excellent"
    elif score >= 80:
        return "Good"
    elif score >= 70:
        return "Average"
    elif score >= 60:
        return "Below Average"
    else:
        return "Poor"


def get_efficiency_rating(time_taken_seconds: int, duration_minutes: int) -> str:
    """Get efficiency rating based on time usage"""
    if duration_minutes <= 0:
        return "N/A"
    
    time_taken_minutes = time_taken_seconds / 60
    time_ratio = time_taken_minutes / duration_minutes
    
    if time_ratio <= 0.5:
        return "Very Fast"
    elif time_ratio <= 0.7:
        return "Fast"
    elif time_ratio <= 0.9:
        return "Good"
    elif time_ratio <= 1.0:
        return "On Time"
    else:
        return "Slow"


def extract_recommendations_from_feedback(feedback: str) -> List[str]:
    """Extract key recommendations from AI feedback"""
    # Simple extraction - look for common recommendation patterns
    recommendations = []
    lines = feedback.split('\n')
    
    for line in lines:
        line = line.strip()
        if any(word in line.lower() for word in ['recommend', 'suggest', 'should', 'try', 'practice', 'review', 'study']):
            if len(line) > 20 and len(line) < 150:  # Reasonable length
                recommendations.append(line)
    
    # If no recommendations found, provide generic ones
    if not recommendations:
        recommendations = [
            "Review the questions you got wrong",
            "Practice similar problems to reinforce learning",
            "Seek help on topics you found challenging"
        ]
    
    return recommendations[:5]  # Limit to 5 recommendations


def get_basic_recommendations(score: float) -> List[str]:
    """Get basic recommendations based on score"""
    if score >= 90:
        return [
            "Continue your excellent study habits",
            "Challenge yourself with advanced topics",
            "Help other students who may be struggling"
        ]
    elif score >= 80:
        return [
            "Review the questions you missed",
            "Strengthen understanding of weak areas",
            "Practice similar problems for reinforcement"
        ]
    elif score >= 70:
        return [
            "Focus on fundamental concepts",
            "Increase study time and frequency",
            "Seek help from instructors or tutors",
            "Form study groups with classmates"
        ]
    else:
        return [
            "Schedule a meeting with your instructor",
            "Review all course materials thoroughly",
            "Consider getting a tutor for additional support",
            "Practice basic concepts daily",
            "Don't hesitate to ask questions in class"
        ]
