from typing import Dict, List
import backoff
import openai
import instructor
import json

from openai import OpenAI

from pydantic import BaseModel

from api.utils.logging import logger
from api.db.course import get_course as get_course_from_db

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


async def format_course_details_for_ai(course_id: int) -> str:
    """
    Fetch course details and format them for AI prompt use
    
    Args:
        course_id: Course ID to fetch details for
        
    Returns:
        Formatted string with course information for AI
    """
    try:
        course = await get_course_from_db(course_id, only_published=True)
        if not course:
            raise Exception(f"Course with ID {course_id} not found")
        
        # Build comprehensive course information
        course_info = []
        course_info.append(f"**COURSE NAME**: {course['name']}")
        
        # Add milestones and tasks
        if course.get('milestones'):
            course_info.append("\n**COURSE STRUCTURE**:")
            for milestone in course['milestones']:
                milestone_name = milestone.get('name', 'Unnamed Milestone')
                course_info.append(f"\n📚 **{milestone_name}**")
                
                if milestone.get('tasks'):
                    for task in milestone['tasks']:
                        task_title = task.get('title', 'Untitled Task')
                        task_type = task.get('type', 'unknown')
                        course_info.append(f"  • {task_title} ({task_type})")
                        if task.get('num_questions') and task_type == 'QUIZ':
                            course_info.append(f"    [{task['num_questions']} questions]")
                else:
                    course_info.append("  • No tasks available in this milestone")
        else:
            course_info.append("\n**COURSE STRUCTURE**: No structured milestones available")
        
        # Add summary
        course_info.append("\n**COURSE SCOPE**: This course covers comprehensive topics organized in structured milestones with various learning activities including quizzes, exercises, and projects.")
        
        formatted_course = "\n".join(course_info)
        logger.info(f"Formatted course details for course ID {course_id} ({len(formatted_course)} characters)")
        return formatted_course
        
    except Exception as e:
        logger.error(f"Error formatting course details for course {course_id}: {str(e)}")
        raise Exception(f"Failed to fetch course details: {str(e)}")


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


async def generate_exam_questions_with_openai(
    api_key: str,
    title: str,
    description: str,
    max_questions: int = 10,
    model: str = "gpt-4o",
    course_id: int = None
) -> dict:
    """
    Generate exam questions using OpenAI GPT-4o
    
    Args:
        api_key: OpenAI API key
        title: Exam title
        description: Exam description/topic
        max_questions: Maximum number of questions to generate
        model: OpenAI model to use
        course_id: Optional course ID to base exam on course content
        
    Returns:
        Dictionary with generated questions and metadata
    """
    try:
        client = OpenAI(api_key=api_key)
        
        # Get course details if course_id is provided
        course_context = ""
        if course_id:
            try:
                course_context = await format_course_details_for_ai(course_id)
                # Update description to include course context
                description = f"{description}\n\nBased on the course content detailed below:\n{course_context}"
            except Exception as e:
                logger.warning(f"Failed to fetch course details for course {course_id}: {e}")
                # Continue without course context
        
        # Create a detailed prompt for question generation
        generation_prompt = f"""
You are an expert educational content creator. Generate a comprehensive exam based on the following requirements:

EXAM DETAILS:
- Title: {title}
- Description: {description}
- Number of Questions: {max_questions}

{'COURSE-BASED EXAM: This exam should be specifically designed based on the course structure, milestones, and tasks provided in the description above. Create questions that align with the learning objectives and content covered in the course.' if course_id else 'TOPIC-BASED EXAM: This exam should comprehensively cover the topic described above.'}

Please create {max_questions} high-quality exam questions that thoroughly assess knowledge on the given topic{'s and course content' if course_id else ''}. Include a variety of question types and difficulty levels.

Provide your response in the following JSON format:

{{
    "questions": [
        {{
            "id": "q1",
            "type": "multiple_choice",
            "question": "Your question text here",
            "options": [
                "Option A",
                "Option B", 
                "Option C",
                "Option D"
            ],
            "correct_answer": "Option A",
            "points": 2
        }},
        {{
            "id": "q2",
            "type": "text",
            "question": "Short answer question here",
            "correct_answer": "Expected answer",
            "points": 3
        }},
        {{
            "id": "q3",
            "type": "essay",
            "question": "Essay question requiring detailed response",
            "points": 10
        }},
        {{
            "id": "q4",
            "type": "code",
            "question": "Programming question here",
            "correct_answer": "// Sample solution code",
            "points": 15,
            "metadata": {{"language": "javascript"}}
        }}
    ],
    "exam_metadata": {{
        "suggested_duration": 60,
        "difficulty_level": "Medium",
        "topics_covered": ["Topic 1", "Topic 2", "Topic 3"],
        "question_distribution": {{
            "multiple_choice": 4,
            "text": 3,
            "essay": 2,
            "code": 1
        }},
        "total_points": 45
    }}
}}

GUIDELINES:
1. Create diverse question types: multiple_choice, text, essay, and code (if relevant to the topic)
2. Ensure questions are clear, specific, and well-structured
3. For multiple choice: provide 4 options with only one correct answer
4. For text questions: expect concise but complete answers
5. For essay questions: require analytical or explanatory responses
6. For code questions: include realistic programming challenges (use javascript, python, or other relevant languages)
7. Assign appropriate point values based on difficulty and time required
8. Cover different aspects and difficulty levels of the topic
9. Make questions educational and assessment-worthy
10. Ensure all questions are directly related to the exam topic
{'11. COURSE-ALIGNED QUESTIONS: When course content is provided, create questions that specifically assess the milestones, tasks, and learning objectives covered in the course structure. Include questions that span across different milestones and difficulty levels appropriate for the course content.' if course_id else ''}

Make sure each question ID is unique (q1, q2, q3, etc.) and that the JSON is properly formatted.
"""

        logger.info("Generating exam questions with OpenAI...")
        
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert educational content creator specializing in creating comprehensive, fair, and educationally valuable exam questions. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": generation_prompt
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.7,  # Slightly higher temperature for creativity
        )
        
        logger.info(f"OpenAI completion received. Usage: {completion.usage}")
        
        # Check if we got a valid response
        if not completion.choices or not completion.choices[0].message.content:
            logger.error("OpenAI returned empty response or no choices")
            raise Exception("OpenAI returned empty response")
        
        content = completion.choices[0].message.content.strip()
        if not content:
            logger.error("OpenAI returned empty content")
            raise Exception("OpenAI returned empty content")
        
        logger.info(f"OpenAI response content length: {len(content)}")
        
        # Parse the JSON response
        try:
            result = json.loads(content)
            logger.info("Successfully parsed OpenAI response as JSON")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse OpenAI response as JSON: {e}")
            logger.error(f"Raw content that failed to parse: {repr(content)}")
            raise Exception(f"OpenAI response is not valid JSON: {str(e)}")
        
        # Validate the structure
        if "questions" not in result:
            raise Exception("Generated content missing 'questions' field")
        
        questions = result["questions"]
        if not isinstance(questions, list) or len(questions) == 0:
            raise Exception("No questions generated")
        
        # Add metadata
        result["generation_metadata"] = {
            "model_used": model,
            "generation_timestamp": json.loads(json.dumps({"timestamp": "now"}, default=str)),
            "total_tokens": completion.usage.total_tokens if completion.usage else 0,
            "questions_generated": len(questions),
            "course_based": course_id is not None,
            "course_id": course_id
        }
        
        logger.info(f"Generated {len(questions)} exam questions successfully")
        return result
        
    except Exception as e:
        logger.error(f"Error in exam question generation: {str(e)}")
        raise Exception(f"Failed to generate exam questions: {str(e)}")


async def generate_exam_description_with_openai(
    api_key: str,
    title: str,
    model: str = "gpt-4o",
    course_id: int = None
) -> str:
    """
    Generate exam description based on the title using OpenAI GPT-4o
    
    Args:
        api_key: OpenAI API key
        title: Exam title to base the description on
        model: OpenAI model to use
        course_id: Optional course ID to base description on course content
        
    Returns:
        Generated description string
    """
    try:
        client = OpenAI(api_key=api_key)
        
        # Get course details if course_id is provided
        course_context = ""
        if course_id:
            try:
                course_context = await format_course_details_for_ai(course_id)
            except Exception as e:
                logger.warning(f"Failed to fetch course details for course {course_id}: {e}")
                # Continue without course context
        
        # Create a prompt for description generation
        description_prompt = f"""
You are an expert educational content creator. Based on the exam title provided{'and course content' if course_id else ''}, generate a comprehensive and professional exam description.

EXAM TITLE: "{title}"

{f'COURSE CONTEXT:\n{course_context}\n' if course_context else ''}

Generate a detailed description that:
1. Clearly explains what topics and concepts will be covered
2. Describes the scope and depth of the assessment
3. Mentions the types of skills being evaluated
4. Sets appropriate expectations for students
5. Is professional and educational in tone
6. Is 2-4 sentences long
7. Is specific to the subject matter indicated by the title
{f'8. COURSE-ALIGNED: When course content is provided, ensure the description reflects the specific milestones, tasks, and learning objectives covered in the course structure.' if course_id else ''}

The description should help students understand what to expect and how to prepare for the exam.

Return only the description text, without quotes or additional formatting.
"""

        logger.info("Generating exam description with OpenAI...")
        
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert educational content creator specializing in creating clear, comprehensive exam descriptions that help students understand what to expect."
                },
                {
                    "role": "user",
                    "content": description_prompt
                }
            ],
            temperature=0.5,  # Balanced creativity and consistency
            max_tokens=300  # Limit description length
        )
        
        logger.info(f"OpenAI completion received. Usage: {completion.usage}")
        
        # Check if we got a valid response
        if not completion.choices or not completion.choices[0].message.content:
            logger.error("OpenAI returned empty response or no choices")
            raise Exception("OpenAI returned empty response")
        
        content = completion.choices[0].message.content.strip()
        if not content:
            logger.error("OpenAI returned empty content")
            raise Exception("OpenAI returned empty content")
        
        logger.info(f"Generated exam description successfully")
        return content
        
    except Exception as e:
        logger.error(f"Error in exam description generation: {str(e)}")
        raise Exception(f"Failed to generate exam description: {str(e)}")


async def generate_surprise_viva_questions(
    api_key: str,
    original_questions: list,
    exam_context: dict,
    model: str = "gpt-4o-mini"  # Using 4o-mini as the current equivalent to 4.1-nano
) -> dict:
    """
    Generate 1-2 similar questions for surprise viva when cheating is detected
    
    Args:
        api_key: OpenAI API key
        original_questions: List of original exam questions
        exam_context: Context about the exam and student behavior
        model: OpenAI model to use
        
    Returns:
        Dictionary with generated viva questions and answers
    """
    try:
        client = OpenAI(api_key=api_key)
        
        # Create context for the AI
        questions_context = "\n".join([
            f"Q{i+1}: {q.get('question', 'Unknown question')}" 
            for i, q in enumerate(original_questions[:3])  # Limit to first 3 for context
        ])
        
        # Create prompt for viva question generation
        viva_prompt = f"""
You are an expert exam proctor who needs to create surprise viva questions to verify student understanding.

CONTEXT:
- Suspicious activity detected during exam (potential cheating)
- Need to generate 1-2 similar questions to verify genuine understanding
- Questions should test the same concepts but with different wording/examples

ORIGINAL EXAM QUESTIONS:
{questions_context}

EXAM DETAILS:
- Subject: {exam_context.get('title', 'Unknown')}
- Level: {exam_context.get('description', 'General assessment')}

REQUIREMENTS:
1. Generate exactly 2 questions that test similar concepts to the original questions
2. Questions should be at the same difficulty level
3. Require short, specific answers (1-3 sentences)
4. Focus on understanding, not memorization
5. Should be answerable within 2-3 minutes each

Generate questions in this JSON format:

{{
    "viva_questions": [
        {{
            "id": "viva_1",
            "question": "Clear, specific question testing understanding",
            "expected_answer": "Brief expected answer or key points",
            "difficulty": "same",
            "time_limit": 180
        }},
        {{
            "id": "viva_2", 
            "question": "Another question testing related concepts",
            "expected_answer": "Brief expected answer or key points",
            "difficulty": "same",
            "time_limit": 180
        }}
    ],
    "instructions": "Answer these questions to verify your understanding. This is a standard verification process."
}}

Make the questions fair but effective at detecting genuine understanding vs. copied answers.
"""

        logger.info("Generating surprise viva questions with OpenAI...")
        
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert exam proctor who creates fair but effective verification questions to detect genuine understanding. Always respond with valid JSON."
                },
                {
                    "role": "user",
                    "content": viva_prompt
                }
            ],
            response_format={"type": "json_object"},
            temperature=0.7,  # Balanced creativity and consistency
            max_tokens=1000  # Limit for concise questions
        )
        
        logger.info(f"OpenAI viva generation completed. Usage: {completion.usage}")
        
        # Check if we got a valid response
        if not completion.choices or not completion.choices[0].message.content:
            logger.error("OpenAI returned empty response for viva generation")
            raise Exception("OpenAI returned empty response")
        
        content = completion.choices[0].message.content.strip()
        if not content:
            logger.error("OpenAI returned empty content for viva generation")
            raise Exception("OpenAI returned empty content")
        
        # Parse the JSON response
        try:
            result = json.loads(content)
            logger.info("Successfully parsed viva questions response as JSON")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse viva questions response as JSON: {e}")
            logger.error(f"Raw content: {repr(content)}")
            raise Exception(f"OpenAI response is not valid JSON: {str(e)}")
        
        # Validate the structure
        if "viva_questions" not in result:
            raise Exception("Generated content missing 'viva_questions' field")
        
        questions = result["viva_questions"]
        if not isinstance(questions, list) or len(questions) == 0:
            raise Exception("No viva questions generated")
        
        # Add metadata
        result["generation_metadata"] = {
            "model_used": model,
            "generation_timestamp": json.dumps({"timestamp": "now"}, default=str),
            "total_tokens": completion.usage.total_tokens if completion.usage else 0,
            "questions_generated": len(questions),
            "trigger": "cheating_detection"
        }
        
        logger.info(f"Generated {len(questions)} surprise viva questions successfully")
        return result
        
    except Exception as e:
        logger.error(f"Error in surprise viva generation: {str(e)}")
        raise Exception(f"Failed to generate surprise viva questions: {str(e)}")
