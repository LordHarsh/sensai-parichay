from typing import Dict, List
import backoff
import openai
import instructor
import json

from openai import OpenAI

from pydantic import BaseModel

from api.utils.logging import logger

# Test log message
logger.info("Logging system initialized")


def is_reasoning_model(model: str) -> bool:
    return model in [
        "o3-mini-2025-01-31",
        "o3-mini",
        "o1-preview-2024-09-12",
        "o1-preview",
        "o1-mini",
        "o1-mini-2024-09-12",
        "o1",
        "o1-2024-12-17",
    ]


def validate_openai_api_key(openai_api_key: str) -> bool:
    client = OpenAI(api_key=openai_api_key)
    try:
        models = client.models.list()
        model_ids = [model.id for model in models.data]

        if "gpt-4o-audio-preview-2024-12-17" in model_ids:
            return False  # paid account
        else:
            return True  # free trial account
    except Exception:
        return None


@backoff.on_exception(backoff.expo, Exception, max_tries=5, factor=2)
async def run_llm_with_instructor(
    api_key: str,
    model: str,
    messages: List,
    response_model: BaseModel,
    max_completion_tokens: int,
):
    client = instructor.from_openai(openai.AsyncOpenAI(api_key=api_key))

    model_kwargs = {}

    if not is_reasoning_model(model):
        model_kwargs["temperature"] = 0

    return await client.chat.completions.create(
        model=model,
        messages=messages,
        response_model=response_model,
        max_completion_tokens=max_completion_tokens,
        store=True,
        **model_kwargs,
    )


@backoff.on_exception(backoff.expo, Exception, max_tries=5, factor=2)
async def stream_llm_with_instructor(
    api_key: str,
    model: str,
    messages: List,
    response_model: BaseModel,
    max_completion_tokens: int,
    **kwargs,
):
    client = instructor.from_openai(openai.AsyncOpenAI(api_key=api_key))

    model_kwargs = {}

    if not is_reasoning_model(model):
        model_kwargs["temperature"] = 0

    model_kwargs.update(kwargs)

    return client.chat.completions.create_partial(
        model=model,
        messages=messages,
        response_model=response_model,
        stream=True,
        max_completion_tokens=max_completion_tokens,
        store=True,
        **model_kwargs,
    )


@backoff.on_exception(backoff.expo, Exception, max_tries=5, factor=2)
def stream_llm_with_openai(
    api_key: str,
    model: str,
    messages: List,
    max_completion_tokens: int,
):
    client = openai.OpenAI(api_key=api_key)

    model_kwargs = {}

    if not is_reasoning_model(model):
        model_kwargs["temperature"] = 0

    return client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
        max_completion_tokens=max_completion_tokens,
        store=True,
        **model_kwargs,
    )


def should_retry(exception):
    """Determine if we should retry the request based on the exception"""
    error_str = str(exception).lower()
    # Don't retry on authentication or billing errors
    if any(term in error_str for term in ['invalid', 'unauthorized', 'quota', 'billing']):
        return False
    # Retry on other errors
    return True

# Temporarily disable backoff to see actual errors
# @backoff.on_exception(
#     backoff.expo, 
#     Exception, 
#     max_tries=3, 
#     factor=2,
#     giveup=lambda e: not should_retry(e)
# )
async def evaluate_exam_with_openai(
    api_key: str,
    exam_context: dict,
    model: str = "gpt-4o"
) -> dict:
    """
    Comprehensive exam evaluation using OpenAI GPT-4
    
    Args:
        api_key: OpenAI API key
        exam_context: Dictionary containing all exam session data
        model: OpenAI model to use for evaluation
    
    Returns:
        Detailed evaluation report as dictionary
    """
    print(f"[DEBUG] evaluate_exam_with_openai function called with model: {model}")
    client = OpenAI(api_key=api_key)
    
    # Extract key information from exam context
    exam_title = exam_context.get("exam_title", "Unknown Exam")
    exam_description = exam_context.get("exam_description", "")
    duration = exam_context.get("duration", 0)
    time_taken = exam_context.get("time_taken", 0)
    score = exam_context.get("score", 0)
    user_name = exam_context.get("user_name", "Student")
    questions = exam_context.get("questions", [])
    questions_and_answers = exam_context.get("questions_and_answers", [])
    
    # Create the detailed evaluation prompt
    evaluation_prompt = f"""
You are an expert educational analyst. Analyze this exam session and provide a comprehensive evaluation report.

EXAM CONTEXT:
- Title: {exam_title}
- Description: {exam_description}
- Duration: {duration} minutes
- Time Taken: {time_taken/60:.1f} minutes
- Score: {score}%
- Student: {user_name}
- Questions: {len(questions)}

DETAILED QUESTION ANALYSIS:
{json.dumps(questions_and_answers, indent=2)}

Please provide a comprehensive analysis in the following JSON format:

{{
    "overall_summary": {{
        "performance_level": "Excellent/Good/Average/Below Average/Poor",
        "key_strengths": ["list of strengths"],
        "key_weaknesses": ["list of weaknesses"],
        "time_management": "analysis of time usage",
        "overall_feedback": "detailed paragraph about overall performance"
    }},
    "question_by_question_analysis": [
        {{
            "question_number": 1,
            "status": "correct/incorrect/partial",
            "detailed_feedback": "specific feedback for this question",
            "why_wrong": "explanation if incorrect",
            "better_approach": "suggested better approach",
            "related_concepts": ["list of related topics"],
            "difficulty_level": "Easy/Medium/Hard"
        }}
    ],
    "knowledge_gaps": [
        {{
            "topic": "specific topic area",
            "severity": "High/Medium/Low",
            "description": "detailed explanation of the gap",
            "improvement_suggestions": "how to improve in this area"
        }}
    ],
    "learning_recommendations": {{
        "immediate_actions": ["things to do right now"],
        "study_plan": {{
            "week_1": ["specific topics and activities"],
            "week_2": ["specific topics and activities"],
            "week_3": ["specific topics and activities"],
            "week_4": ["specific topics and activities"]
        }},
        "external_resources": [
            {{
                "type": "YouTube Video",
                "title": "specific video title",
                "url": "https://youtube.com/watch?v=example",
                "description": "why this resource is helpful"
            }},
            {{
                "type": "Article/Blog",
                "title": "specific article title",
                "url": "https://example.com/article",
                "description": "why this resource is helpful"
            }},
            {{
                "type": "Course",
                "title": "course name",
                "url": "https://example.com/course",
                "description": "why this course is recommended"
            }}
        ],
        "practice_suggestions": ["specific practice activities"]
    }},
    "comparative_analysis": {{
        "grade_interpretation": "what this score means in academic context",
        "improvement_potential": "how much improvement is possible",
        "benchmark_comparison": "how this compares to typical students",
        "next_level_requirements": "what's needed to reach next level"
    }},
    "visual_insights": {{
        "strength_areas": [
            {{"topic": "topic name", "score": 85.5}}
        ],
        "improvement_areas": [
            {{"topic": "topic name", "priority": "High/Medium/Low"}}
        ],
        "time_distribution": {{
            "estimated_per_question": {{"Q1": 2.5, "Q2": 3.0}},
            "efficiency_rating": "Excellent/Good/Average/Poor"
        }}
    }},
    "teacher_insights": {{
        "teaching_recommendations": ["what teachers should focus on"],
        "classroom_interventions": ["specific interventions needed"],
        "peer_collaboration": "suggestions for peer learning",
        "assessment_modifications": "how to modify future assessments"
    }}
}}

Make sure to:
1. Provide specific, actionable feedback
2. Include real YouTube URLs and educational resources when possible
3. Give detailed explanations for wrong answers
4. Suggest concrete improvement strategies
5. Analyze learning patterns and knowledge gaps
6. Provide both student and teacher perspectives
7. Include comparative benchmarks
8. Suggest alternative solution approaches where applicable

Be thorough, constructive, and educational in your analysis.
"""

    try:
        print(f"[DEBUG] About to make OpenAI API call with model: {model}")
        logger.info("Starting comprehensive evaluation with OpenAI...")
        
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert educational analyst specializing in comprehensive exam evaluation. Provide detailed, actionable feedback that helps both students and teachers improve learning outcomes."
                },
                {
                    "role": "user",
                    "content": evaluation_prompt
                }
            ],
            response_format={"type": "json_object"},
        )
        
        print("[DEBUG] OpenAI API call completed")
        
        logger.info(f"OpenAI completion received. Usage: {completion.usage}")
        logger.info(f"Completion choices count: {len(completion.choices) if completion.choices else 0}")
        
        # Check if we got a valid response
        if not completion.choices or not completion.choices[0].message.content:
            logger.error("OpenAI returned empty response or no choices")
            raise Exception("OpenAI returned empty response")
        
        content = completion.choices[0].message.content.strip()
        if not content:
            logger.error("OpenAI returned empty content")
            raise Exception("OpenAI returned empty content")
        
        logger.info(f"OpenAI response content length: {len(content)}")
        logger.info(f"OpenAI response content preview: {content[:500]}...")
        
        # Parse the JSON response
        try:
            evaluation_result = json.loads(content)
            logger.info("Successfully parsed OpenAI response as JSON")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            logger.error(f"Raw content that failed to parse: {repr(content)}")
            raise Exception(f"OpenAI response is not valid JSON: {str(e)}")
        
        # Add metadata
        evaluation_result["evaluation_metadata"] = {
            "model_used": model,
            "evaluation_timestamp": json.loads(json.dumps({"timestamp": "now"}, default=str)),
            "total_tokens": completion.usage.total_tokens if completion.usage else 0,
            "exam_context_summary": {
                "exam_title": exam_title,
                "score": score,
                "time_efficiency": round((time_taken / 60) / duration * 100, 1) if duration > 0 else 0,
                "questions_count": len(questions)
            }
        }
        
        logger.info(f"Generated comprehensive exam evaluation for session {exam_context.get('session_id', 'unknown')}")
        return evaluation_result
        
    except Exception as e:
        logger.error(f"Error in exam evaluation: {str(e)}")
        raise Exception(f"Failed to generate exam evaluation: {str(e)}")


def create_simple_openai_evaluation(
    api_key: str,
    exam_data: dict,
    model: str = "gpt-4o"
) -> dict:
    """
    Simple synchronous evaluation function as requested in the user prompt
    """
    client = OpenAI(api_key=api_key)
    
    # Create a basic evaluation prompt
    prompt = f"""
Analyze this exam performance and provide educational insights:

Exam: {exam_data.get('title', 'Unknown')}
Score: {exam_data.get('score', 0)}%
Time: {exam_data.get('time_taken', 0)} minutes
Questions: {len(exam_data.get('questions', []))}

Student answers: {json.dumps(exam_data.get('answers', {}), indent=2)}
Questions: {json.dumps(exam_data.get('questions', []), indent=2)}

Provide a comprehensive analysis with strengths, weaknesses, and improvement suggestions.
"""
    
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "user", 
                "content": prompt
            }
        ]
    )
    
    return {
        "analysis": completion.choices[0].message.content,
        "model_used": model
    }
