#!/usr/bin/env python3
"""
Test script for the comprehensive exam evaluation system
"""

import asyncio
import json
from datetime import datetime
from api.llm import evaluate_exam_with_openai, create_simple_openai_evaluation

# Test data - sample exam session
sample_exam_context = {
    "session_id": "test_session_123",
    "exam_title": "JavaScript Programming Assessment",
    "exam_description": "A comprehensive assessment covering JavaScript fundamentals, ES6 features, and problem-solving skills.",
    "duration": 45,  # minutes
    "time_taken": 2400,  # seconds (40 minutes)
    "score": 78.5,
    "user_name": "Alice Johnson",
    "questions": [
        {
            "id": "q1",
            "type": "multiple_choice",
            "question": "Which of the following is the correct way to declare a constant in JavaScript?",
            "options": ["const myVar = 10;", "constant myVar = 10;", "let myVar = 10;", "var myVar = 10;"],
            "correct_answer": "const myVar = 10;",
            "points": 2
        },
        {
            "id": "q2",
            "type": "code",
            "question": "Write a function that takes an array of numbers and returns the sum of all even numbers.",
            "correct_answer": "function sumEvenNumbers(arr) { return arr.filter(n => n % 2 === 0).reduce((sum, n) => sum + n, 0); }",
            "points": 5
        },
        {
            "id": "q3",
            "type": "text",
            "question": "Explain the difference between == and === operators in JavaScript.",
            "points": 3
        }
    ],
    "questions_and_answers": [
        {
            "question_number": 1,
            "question_id": "q1",
            "question_type": "multiple_choice",
            "question_text": "Which of the following is the correct way to declare a constant in JavaScript?",
            "options": ["const myVar = 10;", "constant myVar = 10;", "let myVar = 10;", "var myVar = 10;"],
            "correct_answer": "const myVar = 10;",
            "user_answer": "const myVar = 10;",
            "is_correct": True,
            "points": 2
        },
        {
            "question_number": 2,
            "question_id": "q2",
            "question_type": "code",
            "question_text": "Write a function that takes an array of numbers and returns the sum of all even numbers.",
            "correct_answer": "function sumEvenNumbers(arr) { return arr.filter(n => n % 2 === 0).reduce((sum, n) => sum + n, 0); }",
            "user_answer": "function sumEvenNumbers(arr) { let sum = 0; for(let i = 0; i < arr.length; i++) { if(arr[i] % 2 === 0) { sum += arr[i]; } } return sum; }",
            "is_correct": True,
            "points": 5
        },
        {
            "question_number": 3,
            "question_id": "q3",
            "question_type": "text",
            "question_text": "Explain the difference between == and === operators in JavaScript.",
            "user_answer": "== checks for equality with type coercion, === checks for strict equality without type conversion",
            "is_correct": True,
            "points": 3
        }
    ]
}

async def test_comprehensive_evaluation():
    """Test the comprehensive evaluation function"""
    print("🧠 Testing Comprehensive Exam Evaluation System")
    print("=" * 60)
    
    # You would need to set your OpenAI API key here
    # api_key = "your-openai-api-key-here"
    api_key = "sk-test-key"  # Replace with actual key
    
    try:
        # Generate comprehensive evaluation
        print("📊 Generating comprehensive evaluation...")
        evaluation_result = await evaluate_exam_with_openai(
            api_key=api_key,
            exam_context=sample_exam_context,
            model="gpt-4o"
        )
        
        print("\n✅ Evaluation completed successfully!")
        print("\n📋 EVALUATION SUMMARY:")
        print("-" * 40)
        
        overall_summary = evaluation_result.get("overall_summary", {})
        print(f"Performance Level: {overall_summary.get('performance_level', 'Unknown')}")
        print(f"Key Strengths: {', '.join(overall_summary.get('key_strengths', []))}")
        print(f"Key Weaknesses: {', '.join(overall_summary.get('key_weaknesses', []))}")
        print(f"Time Management: {overall_summary.get('time_management', 'No analysis')}")
        
        print(f"\n🎯 QUESTION-BY-QUESTION ANALYSIS:")
        print("-" * 40)
        for qa in evaluation_result.get("question_by_question_analysis", []):
            print(f"Q{qa.get('question_number', '?')}: {qa.get('status', 'unknown').upper()}")
            print(f"   Feedback: {qa.get('detailed_feedback', 'No feedback')}")
            print(f"   Concepts: {', '.join(qa.get('related_concepts', []))}")
            print()
        
        print(f"📚 LEARNING RECOMMENDATIONS:")
        print("-" * 40)
        recommendations = evaluation_result.get("learning_recommendations", {})
        immediate_actions = recommendations.get("immediate_actions", [])
        if immediate_actions:
            print("Immediate Actions:")
            for action in immediate_actions[:3]:  # Show first 3
                print(f"  • {action}")
        
        external_resources = recommendations.get("external_resources", [])
        if external_resources:
            print("\nRecommended Resources:")
            for resource in external_resources[:2]:  # Show first 2
                print(f"  • {resource.get('type', 'Resource')}: {resource.get('title', 'Untitled')}")
                print(f"    {resource.get('url', 'No URL')}")
        
        print(f"\n🏆 COMPARATIVE ANALYSIS:")
        print("-" * 40)
        comp_analysis = evaluation_result.get("comparative_analysis", {})
        print(f"Grade Interpretation: {comp_analysis.get('grade_interpretation', 'No analysis')}")
        print(f"Improvement Potential: {comp_analysis.get('improvement_potential', 'No analysis')}")
        
        # Save results to file
        with open("/tmp/exam_evaluation_result.json", "w") as f:
            json.dump(evaluation_result, f, indent=2, default=str)
        print(f"\n💾 Full evaluation saved to: /tmp/exam_evaluation_result.json")
        
        return evaluation_result
        
    except Exception as e:
        print(f"❌ Error during evaluation: {str(e)}")
        return None

def test_simple_evaluation():
    """Test the simple evaluation function"""
    print("\n🔍 Testing Simple Evaluation Function")
    print("=" * 60)
    
    # Simplified test data
    simple_exam_data = {
        "title": "JavaScript Programming Assessment",
        "score": 78.5,
        "time_taken": 40,  # minutes
        "questions": sample_exam_context["questions"],
        "answers": {
            "q1": "const myVar = 10;",
            "q2": "function sumEvenNumbers(arr) { let sum = 0; for(let i = 0; i < arr.length; i++) { if(arr[i] % 2 === 0) { sum += arr[i]; } } return sum; }",
            "q3": "== checks for equality with type coercion, === checks for strict equality without type conversion"
        }
    }
    
    try:
        # You would need to set your OpenAI API key here
        api_key = "sk-test-key"  # Replace with actual key
        
        print("📊 Generating simple evaluation...")
        evaluation_result = create_simple_openai_evaluation(
            api_key=api_key,
            exam_data=simple_exam_data,
            model="gpt-4o"
        )
        
        print("\n✅ Simple evaluation completed!")
        print("\n📋 SIMPLE EVALUATION RESULT:")
        print("-" * 40)
        print(evaluation_result["analysis"][:500] + "..." if len(evaluation_result["analysis"]) > 500 else evaluation_result["analysis"])
        print(f"\nModel Used: {evaluation_result['model_used']}")
        
        return evaluation_result
        
    except Exception as e:
        print(f"❌ Error during simple evaluation: {str(e)}")
        return None

def demonstrate_api_usage():
    """Demonstrate how to use the evaluation endpoints"""
    print("\n🌐 API Usage Examples")
    print("=" * 60)
    
    print("""
📡 To use the comprehensive evaluation endpoint:

1. POST /exam/{exam_id}/evaluate/{session_id}
   Headers:
   - x-user-id: 123
   - x-openai-key: your-openai-api-key
   
   Response: Comprehensive evaluation report with:
   - Overall performance analysis
   - Question-by-question feedback
   - Knowledge gaps identification
   - Learning recommendations
   - External resources (YouTube, articles, courses)
   - Teacher insights
   - Visual analytics data

2. GET /exam/{exam_id}/evaluation/{session_id}
   Retrieves previously generated evaluation from database

Example cURL command:
curl -X POST "http://localhost:8000/api/exam/{exam_id}/evaluate/{session_id}" \\
  -H "x-user-id: 123" \\
  -H "x-openai-key: your-openai-api-key"
""")
    
    print("""
🔧 Integration in your application:

// Frontend JavaScript
async function generateEvaluation(examId, sessionId, openaiKey) {
    const response = await fetch(`/api/exam/${examId}/evaluate/${sessionId}`, {
        method: 'POST',
        headers: {
            'x-user-id': getCurrentUserId(),
            'x-openai-key': openaiKey,
            'Content-Type': 'application/json'
        }
    });
    
    const evaluation = await response.json();
    
    // Display comprehensive results
    displayOverallSummary(evaluation.evaluation.overall_summary);
    displayQuestionAnalysis(evaluation.evaluation.question_by_question_analysis);
    displayLearningRecommendations(evaluation.evaluation.learning_recommendations);
    displayTeacherInsights(evaluation.evaluation.teacher_insights);
    
    return evaluation;
}
""")

if __name__ == "__main__":
    print("🚀 Sensai AI - Exam Evaluation System Test")
    print("=" * 60)
    
    # Test simple evaluation (synchronous)
    print("Testing simple evaluation function...")
    test_simple_evaluation()
    
    # Test comprehensive evaluation (async)
    print("\nTesting comprehensive evaluation function...")
    asyncio.run(test_comprehensive_evaluation())
    
    # Show API usage
    demonstrate_api_usage()
    
    print("\n🎉 Test completed! The evaluation system is ready to use.")
    print("\nTo get started:")
    print("1. Set up your OpenAI API key")
    print("2. Start the FastAPI server")
    print("3. Use the /exam/{exam_id}/evaluate/{session_id} endpoint")
    print("4. View comprehensive evaluation results")
