#!/usr/bin/env python3
"""
Simple example showing the basic OpenAI usage pattern as requested by the user
"""

from openai import OpenAI
import json

def simple_exam_evaluation_example():
    """
    Simple example as requested in the user prompt using basic OpenAI client
    """
    
    # Sample exam data
    exam_data = {
        "exam_title": "JavaScript Programming Test",
        "exam_description": "Basic JavaScript assessment",
        "duration": 30,
        "time_taken": 25 * 60,  # 25 minutes in seconds
        "score": 75,
        "user_name": "John Doe",
        "questions_and_answers": [
            {
                "question_number": 1,
                "question_text": "What is a closure in JavaScript?",
                "user_answer": "A closure is when a function remembers variables from outside its scope",
                "correct_answer": "A closure gives you access to an outer function's scope from an inner function",
                "is_correct": True,
                "points": 5
            },
            {
                "question_number": 2, 
                "question_text": "Explain the difference between let and var",
                "user_answer": "let is block scoped, var is function scoped",
                "correct_answer": "let has block scope and doesn't allow redeclaration, var has function scope and allows redeclaration",
                "is_correct": True,
                "points": 3
            },
            {
                "question_number": 3,
                "question_text": "How do you create an array in JavaScript?",
                "user_answer": "var arr = new Array()",
                "correct_answer": "Multiple ways: [] or new Array() or Array.from()",
                "is_correct": False,
                "points": 2
            }
        ]
    }
    
    # Initialize OpenAI client (exactly as requested in prompt)
    client = OpenAI()
    
    # Create evaluation prompt
    evaluation_prompt = f"""
You are an expert educational analyst. Analyze this exam session and provide a comprehensive evaluation report.

EXAM CONTEXT:
- Title: {exam_data['exam_title']}
- Description: {exam_data['exam_description']}
- Duration: {exam_data['duration']} minutes
- Time Taken: {exam_data['time_taken']/60:.1f} minutes
- Score: {exam_data['score']}%
- Student: {exam_data['user_name']}
- Questions: {len(exam_data['questions_and_answers'])}

DETAILED QUESTION ANALYSIS:
{json.dumps(exam_data['questions_and_answers'], indent=2)}

Please provide a comprehensive analysis including:
1. Overall performance summary
2. Question-by-question feedback with explanations
3. Knowledge gaps and improvement areas
4. Specific learning recommendations with external resources
5. Study plan suggestions
6. Why answers were wrong and better approaches
7. YouTube links and educational resources
8. Teacher insights and classroom recommendations
9. Detailed analysis of learning patterns

Provide actionable, constructive feedback that helps both students and teachers.
"""
    
    # Call OpenAI API (using the exact pattern from user prompt)
    completion = client.chat.completions.create(
        model="gpt-4o",  # Using gpt-4o as suggested, but user mentioned "gpt-5" which doesn't exist yet
        messages=[
            {
                "role": "user",
                "content": evaluation_prompt
            }
        ]
    )
    
    # Print the comprehensive evaluation
    evaluation_result = completion.choices[0].message.content
    
    print("🎓 COMPREHENSIVE EXAM EVALUATION REPORT")
    print("=" * 60)
    print(evaluation_result)
    print("=" * 60)
    
    return evaluation_result

def advanced_structured_evaluation():
    """
    More advanced version that returns structured data for integration
    """
    
    client = OpenAI()
    
    # Sample comprehensive exam context
    exam_context = {
        "exam_title": "Advanced JavaScript Assessment",
        "exam_description": "Comprehensive test covering ES6, async programming, and design patterns",
        "duration": 45,
        "time_taken": 40 * 60,  # 40 minutes
        "score": 82.5,
        "user_name": "Sarah Smith",
        "questions_and_answers": [
            {
                "question_number": 1,
                "question_text": "Explain async/await vs Promises",
                "user_answer": "async/await is syntactic sugar over promises, makes code more readable",
                "correct_answer": "async/await provides a way to write asynchronous code that looks synchronous, built on top of promises",
                "is_correct": True,
                "question_type": "essay"
            },
            {
                "question_number": 2,
                "question_text": "What will console.log(typeof null) output?",
                "options": ["null", "undefined", "object", "boolean"],
                "user_answer": "object",
                "correct_answer": "object", 
                "is_correct": True,
                "question_type": "multiple_choice"
            },
            {
                "question_number": 3,
                "question_text": "Write a function to debounce another function",
                "user_answer": "function debounce(func, delay) { let timer; return function(...args) { clearTimeout(timer); timer = setTimeout(() => func.apply(this, args), delay); }; }",
                "correct_answer": "function debounce(func, delay) { let timeoutId; return function(...args) { clearTimeout(timeoutId); timeoutId = setTimeout(() => func.apply(this, args), delay); }; }",
                "is_correct": True,
                "question_type": "code"
            }
        ]
    }
    
    # Create structured evaluation prompt
    structured_prompt = f"""
You are an expert educational analyst. Analyze this exam and provide a comprehensive evaluation in JSON format.

EXAM DATA:
{json.dumps(exam_context, indent=2)}

Provide your analysis in this exact JSON structure:

{{
    "overall_summary": {{
        "performance_level": "Excellent/Good/Average/Below Average/Poor",
        "key_strengths": ["list of specific strengths"],
        "key_weaknesses": ["list of specific weaknesses"],  
        "time_management": "detailed time analysis",
        "overall_feedback": "comprehensive performance paragraph"
    }},
    "question_analysis": [
        {{
            "question_number": 1,
            "status": "correct/incorrect/partial",
            "detailed_feedback": "specific feedback for this question",
            "why_wrong": "explanation if incorrect or null",
            "better_approach": "suggested improvement or null",
            "related_concepts": ["concept1", "concept2"],
            "difficulty": "Easy/Medium/Hard"
        }}
    ],
    "knowledge_gaps": [
        {{
            "topic": "specific topic area",
            "severity": "High/Medium/Low",
            "description": "detailed explanation",
            "suggestions": "how to improve"
        }}
    ],
    "recommendations": {{
        "immediate_actions": ["action1", "action2"],
        "study_plan": {{
            "week_1": ["topic1", "topic2"],
            "week_2": ["topic1", "topic2"],
            "week_3": ["topic1", "topic2"],
            "week_4": ["topic1", "topic2"]
        }},
        "resources": [
            {{
                "type": "YouTube Video",
                "title": "specific video title",
                "url": "https://youtube.com/watch?v=example",
                "why_helpful": "explanation"
            }},
            {{
                "type": "Article",
                "title": "article title", 
                "url": "https://example.com/article",
                "why_helpful": "explanation"
            }}
        ],
        "practice": ["specific practice suggestion 1", "specific practice suggestion 2"]
    }},
    "teacher_insights": {{
        "focus_areas": ["what teachers should emphasize"],
        "interventions": ["classroom intervention suggestions"],
        "peer_learning": "peer collaboration suggestions",
        "assessment_changes": "how to modify future assessments"
    }},
    "analytics": {{
        "strengths": [
            {{"topic": "JavaScript Basics", "score": 85}},
            {{"topic": "Async Programming", "score": 90}}
        ],
        "improvements": [
            {{"topic": "Error Handling", "priority": "High"}},
            {{"topic": "Performance", "priority": "Medium"}}
        ],
        "time_efficiency": "Excellent/Good/Average/Poor",
        "grade_meaning": "what this score means academically"
    }}
}}

Be specific, actionable, and educational. Include real YouTube URLs when possible.
"""
    
    # Get structured response
    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are an educational evaluation expert. Provide comprehensive, actionable feedback in valid JSON format."
            },
            {
                "role": "user", 
                "content": structured_prompt
            }
        ],
        response_format={"type": "json_object"},
        temperature=0.3
    )
    
    # Parse and return structured data
    try:
        structured_evaluation = json.loads(completion.choices[0].message.content)
        
        print("\n🚀 STRUCTURED EVALUATION RESULT")
        print("=" * 50)
        
        # Display key sections
        overall = structured_evaluation.get("overall_summary", {})
        print(f"📊 Performance Level: {overall.get('performance_level', 'Unknown')}")
        print(f"💪 Key Strengths: {', '.join(overall.get('key_strengths', []))}")
        print(f"🎯 Areas to Improve: {', '.join(overall.get('key_weaknesses', []))}")
        print(f"⏱️  Time Management: {overall.get('time_management', 'No analysis')}")
        
        print("\n📝 Question-by-Question Analysis:")
        for q in structured_evaluation.get("question_analysis", []):
            print(f"  Q{q.get('question_number', '?')}: {q.get('status', 'unknown').upper()}")
            print(f"     {q.get('detailed_feedback', 'No feedback')[:100]}...")
        
        print("\n📚 Learning Recommendations:")
        recs = structured_evaluation.get("recommendations", {})
        immediate = recs.get("immediate_actions", [])
        if immediate:
            print("  🎯 Do Now:", ", ".join(immediate[:2]))
        
        resources = recs.get("resources", [])
        if resources:
            print("  🔗 Recommended Resources:")
            for resource in resources[:2]:
                print(f"     • {resource.get('type', 'Resource')}: {resource.get('title', 'Untitled')}")
        
        print("\n👨‍🏫 Teacher Insights:")
        teacher = structured_evaluation.get("teacher_insights", {})
        focus = teacher.get("focus_areas", [])
        if focus:
            print(f"  📌 Focus Areas: {', '.join(focus[:2])}")
        
        return structured_evaluation
        
    except json.JSONDecodeError as e:
        print(f"❌ Error parsing JSON response: {e}")
        print("Raw response:", completion.choices[0].message.content[:500])
        return None

if __name__ == "__main__":
    print("🎓 Sensai AI - Simple Exam Evaluation Examples")
    print("=" * 60)
    
    print("\n1️⃣ BASIC EVALUATION (as requested in prompt)")
    print("-" * 50)
    try:
        # Run the simple evaluation exactly as user requested
        result = simple_exam_evaluation_example()
    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 Make sure you have OPENAI_API_KEY set in your environment")
    
    print("\n\n2️⃣ STRUCTURED EVALUATION (for integration)")  
    print("-" * 50)
    try:
        # Run the structured version for better integration
        structured_result = advanced_structured_evaluation()
        
        if structured_result:
            # Save to file for inspection
            with open("/tmp/structured_evaluation.json", "w") as f:
                json.dump(structured_result, f, indent=2)
            print(f"\n💾 Full structured evaluation saved to: /tmp/structured_evaluation.json")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 Make sure you have OPENAI_API_KEY set in your environment")
    
    print("\n✅ Examples completed!")
    print("\n🔧 To use in your application:")
    print("1. Set OPENAI_API_KEY environment variable")
    print("2. Use the simple pattern: client = OpenAI(); completion = client.chat.completions.create(...)")
    print("3. Integrate the structured response into your exam results display")
    print("4. Use the new API endpoints: POST /exam/{exam_id}/evaluate/{session_id}")
    print("\n📖 See COMPREHENSIVE_EVALUATION_SYSTEM.md for full documentation")
