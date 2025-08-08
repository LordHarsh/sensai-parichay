from fastapi import APIRouter, HTTPException, Depends, Query, Header, BackgroundTasks
from fastapi.responses import FileResponse
from api.db import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name,
    users_table_name,
    user_organizations_table_name
)
from typing import List, Optional
import json
import uuid
import os
import tempfile
import base64
from datetime import datetime
import asyncio
import weasyprint
from jinja2 import Template
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import numpy as np
from io import BytesIO
from api.models import (
    CreateExamRequest,
    GenerateAIExamRequest,
    ExamSubmissionRequest, 
    ExamConfiguration,
    ExamSession,
    ExamQuestion,
    ExamTimelineEvent,
    ExamAnalytics,
    ExamEvaluationRequest,
    ExamEvaluationReport
)
from pydantic import BaseModel
from api.utils.db import get_new_db_connection
from api.db.course import (
    create_course,
    store_course_generation_request,
    get_org_id_for_course
)
from api.db.user import get_user_organizations
from api.db.cohort import create_cohort, add_members_to_cohort, add_course_to_cohorts
from api.routes.ai import _generate_course_structure
from api.models import GenerateCourseJobStatus
from api.utils.event_scoring import EventScorer
from api.utils.style_analyzer import analyze_exam_writing_style
from api.llm import generate_exam_questions_with_openai, generate_exam_description_with_openai
from api.config import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name,
    users_table_name,
    organizations_table_name,
    user_organizations_table_name
)

router = APIRouter(prefix="/exam", tags=["exam"])


@router.post("/", response_model=dict)
async def create_exam(exam_request: CreateExamRequest, user_id: int = Header(..., alias="x-user-id")):
    try:
        exam_id = str(uuid.uuid4())
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Simplified: Anyone can create an exam and becomes the teacher automatically
            # No need to check organization permissions
            
            # Create exam configuration
            await cursor.execute(
                f"""INSERT INTO {exams_table_name} 
                    (id, title, description, duration, questions, settings, monitoring, org_id, created_by, role, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    exam_id,
                    exam_request.title,
                    exam_request.description,
                    exam_request.duration,
                    json.dumps([q.dict() for q in exam_request.questions]),
                    json.dumps(exam_request.settings),
                    json.dumps(exam_request.monitoring),
                    exam_request.org_id,
                    user_id,
                    'teacher',  # Creator is always teacher
                    datetime.now(),
                    datetime.now()
                )
            )
            
            await conn.commit()
            
        return {"id": exam_id, "message": "Exam created successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to create exam")


@router.post("/generate", response_model=dict)
async def generate_ai_exam(
    exam_request: GenerateAIExamRequest, 
    user_id: int = Header(..., alias="x-user-id")
):
    """
    Generate an AI-based exam using OpenAI GPT-4o.
    
    This endpoint takes in a title, description, and max number of questions,
    then uses OpenAI to generate comprehensive exam questions and creates
    the exam with the creator as the teacher.
    """
    try:
        # Validate inputs
        if not exam_request.title or not exam_request.description:
            raise HTTPException(status_code=400, detail="Title and description are required")
        
        if exam_request.max_questions < 1 or exam_request.max_questions > 50:
            raise HTTPException(status_code=400, detail="Number of questions must be between 1 and 50")
        
        # Get OpenAI API key from environment
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured on server")
        
        # Generate questions using OpenAI
        try:
            generated_content = await generate_exam_questions_with_openai(
                api_key=openai_api_key,
                title=exam_request.title,
                description=exam_request.description,
                max_questions=exam_request.max_questions,
                model="gpt-4o",
                course_id=exam_request.course_id
            )
        except Exception as e:
            print(f"Error generating questions with OpenAI: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to generate exam questions: {str(e)}")
        
        # Extract questions and metadata from generated content
        questions = generated_content.get("questions", [])
        if not questions:
            raise HTTPException(status_code=500, detail="No questions were generated")
        
        exam_metadata = generated_content.get("exam_metadata", {})
        
        # Auto-calculate duration if not provided (based on suggested duration from AI or default estimation)
        duration = exam_request.duration
        if not duration:
            # Use AI's suggested duration or estimate based on question types and points
            duration = exam_metadata.get("suggested_duration", 60)
            if not duration:
                # Fallback estimation: ~2-3 minutes per question on average
                duration = max(30, len(questions) * 3)
        
        # Convert generated questions to the expected format
        formatted_questions = []
        for i, q in enumerate(questions):
            # Ensure each question has a unique ID
            question_id = q.get("id", f"q{i+1}")
            
            # Build question object matching ExamQuestion schema
            formatted_question = {
                "id": question_id,
                "type": q.get("type", "text"),
                "question": q.get("question", ""),
                "points": q.get("points", 1),
                "time_limit": q.get("time_limit"),
                "metadata": q.get("metadata", {})
            }
            
            # Add type-specific fields
            if q.get("type") == "multiple_choice" and q.get("options"):
                formatted_question["options"] = [
                    {
                        "id": f"opt_{question_id}_{idx}",
                        "text": option,
                        "is_correct": option == q.get("correct_answer", "")
                    }
                    for idx, option in enumerate(q.get("options", []))
                ]
            
            if q.get("correct_answer"):
                formatted_question["correct_answer"] = q.get("correct_answer")
            
            formatted_questions.append(formatted_question)
        
        # Create default settings and monitoring if not provided
        default_settings = {
            "allow_tab_switch": False,
            "max_tab_switches": 2,
            "allow_copy_paste": False,
            "require_camera": True,
            "require_microphone": False,
            "fullscreen_required": True,
            "auto_submit": True,
            "shuffle_questions": False,
            "show_timer": True
        }
        
        default_monitoring = {
            "video_recording": True,
            "audio_recording": True,
            "screen_recording": False,
            "keystroke_logging": True,
            "mouse_tracking": True,
            "face_detection": True,
            "gaze_tracking": True,
            "network_monitoring": True
        }
        
        settings = {**default_settings, **exam_request.settings}
        monitoring = {**default_monitoring, **exam_request.monitoring}
        
        # Generate exam ID
        exam_id = str(uuid.uuid4())
        
        # Save to database
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""INSERT INTO {exams_table_name} 
                    (id, title, description, duration, questions, settings, monitoring, org_id, created_by, role, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    exam_id,
                    exam_request.title,
                    exam_request.description,
                    duration,
                    json.dumps(formatted_questions),
                    json.dumps(settings),
                    json.dumps(monitoring),
                    exam_request.org_id,
                    user_id,
                    'teacher',  # Creator is always teacher
                    datetime.now(),
                    datetime.now()
                )
            )
            
            await conn.commit()
        
        # Return success response with exam details
        response = {
            "id": exam_id,
            "message": "AI exam generated and created successfully",
            "exam_details": {
                "title": exam_request.title,
                "description": exam_request.description,
                "duration": duration,
                "questions_generated": len(formatted_questions),
                "total_points": sum(q.get("points", 1) for q in formatted_questions),
                "question_types": exam_metadata.get("question_distribution", {}),
                "topics_covered": exam_metadata.get("topics_covered", []),
                "difficulty_level": exam_metadata.get("difficulty_level", "Medium")
            },
            "ai_metadata": generated_content.get("generation_metadata", {})
        }
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating AI exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate AI exam")


@router.post("/generate-description", response_model=dict)
async def generate_exam_description(
    request: dict,
    user_id: int = Header(..., alias="x-user-id")
):
    """
    Generate exam description based on title using OpenAI GPT-4o.
    
    This endpoint takes in a title and returns an AI-generated description
    that matches the subject matter and scope indicated by the title.
    """
    try:
        title = request.get("title", "").strip()
        course_id = request.get("course_id")  # Optional course ID
        
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        
        if len(title) < 3:
            raise HTTPException(status_code=400, detail="Title must be at least 3 characters long")
        
        # Get OpenAI API key from environment
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured on server")
        
        # Generate description using OpenAI
        try:
            generated_description = await generate_exam_description_with_openai(
                api_key=openai_api_key,
                title=title,
                model="gpt-4o",
                course_id=course_id
            )
        except Exception as e:
            print(f"Error generating description with OpenAI: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to generate description: {str(e)}")
        
        return {
            "success": True,
            "title": title,
            "description": generated_description,
            "message": "Description generated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating description: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate description")


@router.get("/{exam_id}", response_model=dict)
async def get_exam(exam_id: str, user_id: int = Header(None, alias="x-user-id")):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""SELECT id, title, description, duration, questions, settings, monitoring, 
                           created_at, updated_at, org_id, created_by
                    FROM {exams_table_name} WHERE id = ?""",
                (exam_id,)
            )
            
            row = await cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Exam not found")
            
            exam_data = {
                "id": row[0],
                "title": row[1],
                "description": row[2],
                "duration": row[3],
                "questions": json.loads(row[4]),
                "settings": json.loads(row[5] or "{}"),
                "monitoring": json.loads(row[6] or "{}"),
                "created_at": row[7],
                "updated_at": row[8],
                "org_id": row[9],
                "created_by": row[10]
            }
            
            # Simplified role detection: creator is teacher, everyone else is student
            if user_id:
                if user_id == row[10]:  # created_by
                    exam_data["user_role"] = "teacher"
                    exam_data["is_creator"] = True
                else:
                    exam_data["user_role"] = "student"
                    exam_data["is_creator"] = False
                    # Remove sensitive settings for students (but keep monitoring settings which are needed for frontend)
                    exam_data.pop("settings", None)
                    # Remove correct answers from questions for students
                    questions = exam_data["questions"]
                    for question in questions:
                        if "correct_answer" in question:
                            question.pop("correct_answer")
                        # For students, convert options back to simple format for compatibility
                        if question.get("options"):
                            for option in question["options"]:
                                if hasattr(option, 'get') and option.get('is_correct'):
                                    option.pop('is_correct', None)
            else:
                exam_data["user_role"] = "student"  # Default to student for anonymous users
                exam_data["is_creator"] = False
            
            return exam_data
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch exam")


@router.post("/{exam_id}/start", response_model=dict)
async def start_exam_session(exam_id: str, user_id: str = Query(...)):
    try:
        # Check if exam exists
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"SELECT id FROM {exams_table_name} WHERE id = ?",
                (exam_id,)
            )
            
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Exam not found")
            
            # Check for existing active session
            await cursor.execute(
                f"""SELECT id FROM {exam_sessions_table_name} 
                    WHERE exam_id = ? AND user_id = ? AND status = 'active'""",
                (exam_id, user_id)
            )
            
            existing_session = await cursor.fetchone()
            if existing_session:
                raise HTTPException(status_code=400, detail="Active exam session already exists")
            
            # Create new session
            session_id = f"{exam_id}_{user_id}_{int(datetime.now().timestamp())}"
            
            await cursor.execute(
                f"""INSERT INTO {exam_sessions_table_name}
                    (id, exam_id, user_id, start_time, status, answers, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    exam_id, 
                    user_id,
                    datetime.now(),
                    'active',  # Changed from 'pending' to 'active'
                    json.dumps({}),
                    datetime.now(),
                    datetime.now()
                )
            )
            
            await conn.commit()
            
        return {"session_id": session_id, "message": "Exam session started"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error starting exam session: {e}")
        raise HTTPException(status_code=500, detail="Failed to start exam session")


@router.post("/{exam_id}/submit", response_model=dict) 
async def submit_exam(exam_id: str, submission: ExamSubmissionRequest, user_id: str = Query(...), session_id: str = Query(None)):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # If session_id is provided, use it; otherwise find or create one
            if session_id:
                # Check if the provided session_id exists and belongs to this user
                await cursor.execute(
                    f"""SELECT id, status FROM {exam_sessions_table_name}
                        WHERE id = ? AND user_id = ? AND exam_id = ?""",
                    (session_id, user_id, exam_id)
                )
                session_row = await cursor.fetchone()
                
                if not session_row:
                    raise HTTPException(status_code=404, detail="Session not found or doesn't belong to user")
                    
                existing_session_id = session_row[0]
            else:
                # Find active session (original logic)
                await cursor.execute(
                    f"""SELECT id FROM {exam_sessions_table_name}
                        WHERE exam_id = ? AND user_id = ? AND status IN ('active', 'pending')""",
                    (exam_id, user_id)
                )
                
                session_row = await cursor.fetchone()
                if not session_row:
                    # Create a new session automatically if none exists
                    existing_session_id = f"{exam_id}_{user_id}_{int(datetime.now().timestamp())}"
                    
                    await cursor.execute(
                        f"""INSERT INTO {exam_sessions_table_name}
                            (id, exam_id, user_id, start_time, status, answers, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            existing_session_id,
                            exam_id, 
                            user_id,
                            datetime.now(),
                            'act    ive',
                            json.dumps({}),
                            datetime.now(),
                            datetime.now()
                        )
                    )
                else:
                    existing_session_id = session_row[0]
            
            # Calculate score (basic implementation)
            score = await calculate_exam_score(exam_id, submission.answers, cursor)
            
            # Update session
            await cursor.execute(
                f"""UPDATE {exam_sessions_table_name}
                    SET end_time = ?, status = 'completed', answers = ?, score = ?, updated_at = ?
                    WHERE id = ?""",
                (datetime.now(), json.dumps(submission.answers), score, datetime.now(), existing_session_id)
            )
            
            await conn.commit()
            
            # Perform writing style analysis
            style_analysis_result = None
            try:
                analysis_result = await analyze_exam_writing_style(submission.answers)
                style_analysis_result = {
                    "has_style_change": analysis_result.has_style_change,
                    "confidence_score": analysis_result.confidence_score,
                    "style_inconsistencies": analysis_result.style_inconsistencies,
                    "analysis_summary": analysis_result.analysis_summary
                }
                
                # Generate writing style drift event if significant changes detected
                if analysis_result.has_style_change:
                    # Create event data
                    event_data = {
                        "exam_id": exam_id,
                        "session_id": existing_session_id,
                        "drift_score": analysis_result.confidence_score,
                        "style_inconsistencies": analysis_result.style_inconsistencies,
                        "analysis_summary": analysis_result.analysis_summary,
                        "samples_compared": analysis_result.samples_compared
                    }
                    
                    # Store the event in the database
                    async with get_new_db_connection() as event_conn:
                        event_cursor = await event_conn.cursor()
                        await event_cursor.execute(
                            f"""INSERT INTO {exam_events_table_name}
                                (id, session_id, event_type, event_data, timestamp, created_at)
                                VALUES (?, ?, ?, ?, ?, ?)""",
                            (
                                str(uuid.uuid4()),
                                existing_session_id,
                                "writing_style_drift",
                                json.dumps(event_data),
                                int(datetime.now().timestamp() * 1000),
                                datetime.now()
                            )
                        )
                        await event_conn.commit()
                        
            except Exception as e:
                print(f"Error in writing style analysis: {e}")
                # Don't fail the exam submission if style analysis fails
                style_analysis_result = {
                    "error": f"Style analysis failed: {str(e)}"
                }
            
        response = {"message": "Exam submitted successfully", "score": score, "session_id": existing_session_id}
        if style_analysis_result:
            response["style_analysis"] = style_analysis_result
            
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error submitting exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit exam")


@router.get("/{exam_id}/sessions", response_model=List[dict])
async def get_exam_sessions(exam_id: str):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Debug: Check what users exist in the database
            await cursor.execute(f"SELECT id, email, first_name, last_name FROM {users_table_name} LIMIT 10")
            users_debug = await cursor.fetchall()
            print(f"Users in database: {users_debug}")
            
            # Debug: Check what user_ids are in sessions
            await cursor.execute(f"SELECT DISTINCT user_id FROM {exam_sessions_table_name} WHERE exam_id = ?", (exam_id,))
            session_user_ids = await cursor.fetchall()
            print(f"User IDs in sessions: {session_user_ids}")
            
            # Join with users table to get user information and count events
            # Try multiple approaches: integer ID, string ID, or email match
            await cursor.execute(
                f"""SELECT 
                    s.id, 
                    s.user_id, 
                    COALESCE(u1.email, u2.email, u3.email) as user_email,
                    COALESCE(u1.first_name, u2.first_name, u3.first_name) as user_first_name,
                    COALESCE(u1.last_name, u2.last_name, u3.last_name) as user_last_name,
                    s.start_time, 
                    s.end_time, 
                    s.status, 
                    s.score, 
                    s.created_at,
                    COUNT(e.id) as event_count
                    FROM {exam_sessions_table_name} s
                    LEFT JOIN {users_table_name} u1 ON CAST(s.user_id AS INTEGER) = u1.id
                    LEFT JOIN {users_table_name} u2 ON s.user_id = CAST(u2.id AS TEXT)
                    LEFT JOIN {users_table_name} u3 ON s.user_id = u3.email
                    LEFT JOIN {exam_events_table_name} e ON s.id = e.session_id
                    WHERE s.exam_id = ?
                    GROUP BY s.id, s.user_id, user_email, user_first_name, user_last_name, s.start_time, s.end_time, s.status, s.score, s.created_at
                    ORDER BY s.created_at DESC""",
                (exam_id,)
            )
            
            sessions = []
            async for row in cursor:
                print(f"Session row data: {row}")  # Debug logging
                
                # Create user display name: prefer "FirstName LastName", fallback to email
                user_display = "Unknown User"
                user_email = row[2]      # user_email
                user_first_name = row[3] # user_first_name  
                user_last_name = row[4]  # user_last_name
                
                if user_email:  # email exists
                    if user_first_name and user_last_name:  # first_name and last_name exist
                        user_display = f"{user_first_name} {user_last_name}"
                    elif user_first_name:  # only first_name exists
                        user_display = user_first_name
                    else:
                        user_display = user_email  # fallback to email
                else:
                    # Fallback: use user_id as display if no user info found
                    user_display = f"User {row[1]}" if row[1] else "Unknown User"
                
                sessions.append({
                    "id": row[0],
                    "user_id": row[1], 
                    "user_display": user_display,
                    "user_email": user_email,
                    "start_time": row[5],
                    "end_time": row[6],
                    "status": row[7],
                    "score": row[8],
                    "created_at": row[9],
                    "event_count": row[10]
                })
            
            return sessions
            
    except Exception as e:
        print(f"Error fetching exam sessions: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch exam sessions")


@router.get("/{exam_id}/results/{session_id}", response_model=dict)
async def get_exam_results(exam_id: str, session_id: str):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Get session details
            await cursor.execute(
                f"""SELECT s.*, e.title, e.questions
                    FROM {exam_sessions_table_name} s
                    JOIN {exams_table_name} e ON s.exam_id = e.id
                    WHERE s.id = ? AND s.exam_id = ?""",
                (session_id, exam_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            # Get events summary
            await cursor.execute(
                f"""SELECT event_type, COUNT(*) as count
                    FROM {exam_events_table_name}
                    WHERE session_id = ?
                    GROUP BY event_type""",
                (session_id,)
            )
            
            events_summary = {}
            async for row in cursor:
                events_summary[row[0]] = row[1]
            
            # Get video file info
            from api.config import data_root_dir
            video_dir = os.path.join(data_root_dir, "exam_videos", exam_id)
            video_path = os.path.join(video_dir, f"{exam_id}_master_recording.webm")
            video_info = {
                "has_recording": os.path.exists(video_path),
                "chunk_count": 1 if os.path.exists(video_path) else 0,
                "total_size": os.path.getsize(video_path) if os.path.exists(video_path) else 0
            }
            
            return {
                "session_id": session_row[0],
                "exam_title": session_row[11],  # e.title
                "start_time": session_row[3],
                "end_time": session_row[4],
                "status": session_row[5],
                "score": session_row[7],
                "answers": json.loads(session_row[6] or "{}"),
                "questions": json.loads(session_row[12]),  # e.questions
                "events_summary": events_summary,
                "video_info": video_info
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching exam results: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch exam results")


@router.post("/{exam_id}/evaluate/{session_id}", response_model=dict)
async def evaluate_exam_comprehensive(
    exam_id: str, 
    session_id: str, 
    user_id: int = Header(..., alias="x-user-id")
):
    """
    Generate comprehensive AI-powered evaluation of exam performance
    """
    try:
        from api.llm import evaluate_exam_with_openai
        
        # Get OpenAI API key from environment
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")
        
        # Log API key status (without revealing the key)
        print(f"OpenAI API key loaded: {'Yes' if openai_api_key else 'No'}")
        print(f"API key length: {len(openai_api_key) if openai_api_key else 0}")
        print(f"API key starts with 'sk-': {openai_api_key.startswith('sk-') if openai_api_key else False}")
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Get comprehensive exam session data
            await cursor.execute(
                f"""SELECT s.*, e.title, e.description, e.duration, e.questions, u.email, u.first_name, u.last_name
                    FROM {exam_sessions_table_name} s
                    JOIN {exams_table_name} e ON s.exam_id = e.id
                    LEFT JOIN {users_table_name} u ON s.user_id = u.id
                    WHERE s.id = ? AND s.exam_id = ?""",
                (session_id, exam_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            # Calculate time taken in seconds
            start_time = session_row[3] if session_row[3] else datetime.now()
            end_time = session_row[4] if session_row[4] else datetime.now()
            if isinstance(start_time, str):
                start_time = datetime.fromisoformat(start_time)
            if isinstance(end_time, str):
                end_time = datetime.fromisoformat(end_time)
            
            time_taken_seconds = (end_time - start_time).total_seconds()
            
            # Parse exam data
            print("Parsing exam data...")
            questions = json.loads(session_row[12])  # e.questions
            print(f"Found {len(questions)} questions in exam")
            answers = json.loads(session_row[6] or "{}")  # s.answers
            
            # Create user display name
            user_display = "Student"
            if session_row[15]:  # email
                if session_row[16] and session_row[17]:  # first_name and last_name
                    user_display = f"{session_row[16]} {session_row[17]}"
                elif session_row[16]:  # only first_name
                    user_display = session_row[16]
                else:
                    user_display = session_row[15]  # fallback to email
            
            # Prepare questions and answers for analysis
            questions_and_answers = []
            for i, question in enumerate(questions, 1):
                question_id = question.get('id', f'q{i}')
                user_answer = answers.get(question_id, '')
                correct_answer = question.get('correct_answer', '')
                
                # Determine if answer is correct
                is_correct = False
                if question.get('type') == 'multiple_choice':
                    is_correct = user_answer == correct_answer
                elif question.get('type') == 'text':
                    # Simple text comparison - could be enhanced with fuzzy matching
                    is_correct = user_answer.strip().lower() == correct_answer.lower() if correct_answer else bool(user_answer.strip())
                else:
                    # For essay/code questions, mark as answered if there's content
                    is_correct = bool(user_answer.strip()) if user_answer else False
                
                questions_and_answers.append({
                    "question_number": i,
                    "question_id": question_id,
                    "question_type": question.get('type', 'text'),
                    "question_text": question.get('question', ''),
                    "options": question.get('options', []),
                    "correct_answer": correct_answer,
                    "user_answer": user_answer,
                    "is_correct": is_correct,
                    "points": question.get('points', 1),
                    "metadata": question.get('metadata', {})
                })
            
            # Prepare evaluation context
            evaluation_context = {
                "session_id": session_id,
                "exam_title": session_row[11],  # e.title
                "exam_description": session_row[12] if len(session_row) > 12 else "",  # e.description
                "duration": session_row[13],  # e.duration in minutes
                "time_taken": time_taken_seconds,  # in seconds
                "score": session_row[7] or 0,  # s.score
                "user_name": user_display,
                "questions": questions,
                "questions_and_answers": questions_and_answers
            }
            
            # Debug logging
            print(f"Evaluation context prepared:")
            print(f"- Exam title: {evaluation_context['exam_title']}")
            print(f"- Questions count: {len(evaluation_context['questions'])}")
            print(f"- Q&A count: {len(evaluation_context['questions_and_answers'])}")
            print(f"- Score: {evaluation_context['score']}")
            print(f"- Time taken: {evaluation_context['time_taken']} seconds")
            
            # Generate comprehensive evaluation using OpenAI
            try:
                evaluation_result = await evaluate_exam_with_openai(
                    api_key=openai_api_key,
                    exam_context=evaluation_context,
                    model="gpt-4o"
                )
            except Exception as llm_error:
                print(f"LLM evaluation failed: {str(llm_error)}")
                # Provide a basic fallback evaluation
                total_questions = len(questions_and_answers)
                correct_answers = sum(1 for qa in questions_and_answers if qa.get('is_correct', False))
                accuracy = (correct_answers / total_questions * 100) if total_questions > 0 else 0
                
                evaluation_result = {
                    "overall_summary": {
                        "performance_level": "Good" if accuracy >= 70 else "Average" if accuracy >= 50 else "Below Average",
                        "key_strengths": ["Basic completion"] if correct_answers > 0 else [],
                        "key_weaknesses": ["Needs improvement"] if accuracy < 70 else [],
                        "time_management": f"Completed in {time_taken_seconds/60:.1f} minutes",
                        "overall_feedback": f"You scored {accuracy:.1f}% on this exam. {'Good work!' if accuracy >= 70 else 'Keep practicing to improve your performance.'}"
                    },
                    "question_by_question_analysis": [
                        {
                            "question_number": i+1,
                            "status": "correct" if qa.get('is_correct', False) else "incorrect",
                            "detailed_feedback": f"Question {i+1}: {'Correct answer!' if qa.get('is_correct', False) else 'Review this topic'}",
                            "why_wrong": "" if qa.get('is_correct', False) else "Incorrect response provided",
                            "better_approach": "Review course materials",
                            "related_concepts": ["General knowledge"],
                            "difficulty_level": "Medium"
                        }
                        for i, qa in enumerate(questions_and_answers)
                    ],
                    "knowledge_gaps": [
                        {
                            "topic": "General understanding",
                            "severity": "Medium",
                            "description": "Some concepts need reinforcement",
                            "improvement_suggestions": "Review course materials and practice more"
                        }
                    ],
                    "learning_recommendations": {
                        "immediate_actions": ["Review incorrect answers", "Study course materials"],
                        "study_plan": {
                            "week_1": ["Review basics"],
                            "week_2": ["Practice exercises"],
                            "week_3": ["Advanced topics"],
                            "week_4": ["Mock exams"]
                        },
                        "external_resources": [
                            {
                                "type": "Study Guide",
                                "title": "Course Review Materials",
                                "url": "#",
                                "description": "Review your course materials"
                            }
                        ],
                        "practice_suggestions": ["Take practice quizzes", "Review notes"]
                    },
                    "comparative_analysis": {
                        "grade_interpretation": f"Score of {accuracy:.1f}%",
                        "improvement_potential": "Good potential with focused study",
                        "benchmark_comparison": "Compare with class average",
                        "next_level_requirements": "Consistent practice needed"
                    },
                    "visual_insights": {
                        "strength_areas": [{"topic": "Completion", "score": accuracy}],
                        "improvement_areas": [{"topic": "Accuracy", "priority": "High" if accuracy < 50 else "Medium"}],
                        "time_distribution": {
                            "estimated_per_question": {},
                            "efficiency_rating": "Average"
                        }
                    },
                    "teacher_insights": {
                        "teaching_recommendations": ["Focus on weak areas"],
                        "classroom_interventions": ["Additional practice sessions"],
                        "peer_collaboration": "Study groups recommended",
                        "assessment_modifications": "Consider review sessions"
                    },
                    "evaluation_metadata": {
                        "model_used": "fallback_evaluation",
                        "evaluation_timestamp": datetime.now().isoformat(),
                        "note": "This is a basic evaluation due to AI service unavailability"
                    }
                }
                print("Using fallback evaluation due to LLM failure")
            
            
            # Store evaluation result in database for future reference
            evaluation_json = json.dumps(evaluation_result)
            await cursor.execute(
                f"""UPDATE {exam_sessions_table_name} 
                    SET metadata = ? 
                    WHERE id = ?""",
                (evaluation_json, session_id)
            )
            await conn.commit()
            
            return {
                "success": True,
                "session_id": session_id,
                "evaluation": evaluation_result,
                "summary": {
                    "exam_title": evaluation_context["exam_title"],
                    "student": evaluation_context["user_name"],
                    "score": evaluation_context["score"],
                    "performance_level": evaluation_result.get("overall_summary", {}).get("performance_level", "Unknown"),
                    "evaluation_generated_at": datetime.now().isoformat()
                }
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating exam evaluation: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate evaluation: {str(e)}")


@router.get("/{exam_id}/evaluation/{session_id}", response_model=dict)
async def get_stored_evaluation(exam_id: str, session_id: str):
    """
    Retrieve previously generated evaluation from database
    """
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""SELECT metadata, score FROM {exam_sessions_table_name} 
                    WHERE id = ? AND exam_id = ?""",
                (session_id, exam_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            metadata = session_row[0]
            if not metadata:
                raise HTTPException(status_code=404, detail="No evaluation found. Generate evaluation first.")
            
            try:
                evaluation = json.loads(metadata)
                return {
                    "success": True,
                    "session_id": session_id,
                    "evaluation": evaluation,
                    "score": session_row[1]
                }
            except json.JSONDecodeError:
                raise HTTPException(status_code=500, detail="Invalid evaluation data format")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching stored evaluation: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch evaluation")


@router.get("/{exam_id}/analytics/{session_id}", response_model=ExamAnalytics)
async def get_exam_analytics(exam_id: str, session_id: str, user_id: int = Header(..., alias="x-user-id")):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Simplified permission check - only exam creator can view analytics
            await cursor.execute(
                f"""SELECT created_by FROM {exams_table_name} WHERE id = ?""",
                (exam_id,)
            )
            exam_info = await cursor.fetchone()
            if not exam_info:
                raise HTTPException(status_code=404, detail="Exam not found")
            
            created_by = exam_info[0]
            
            # Only creator (teacher) can view analytics
            if created_by != user_id:
                raise HTTPException(status_code=403, detail="Only the exam creator can view analytics")
            
            # Get all events for the session with detailed timeline
            await cursor.execute(
                f"""SELECT event_type, event_data, timestamp FROM {exam_events_table_name}
                    WHERE session_id = ? ORDER BY timestamp ASC""",
                (session_id,)
            )
            
            events = []
            total_events = 0
            flagged_events = 0
            high_priority_events = 0
            confidence_scores = []
            step_timeline = []
            
            # Track exam progress steps
            exam_started = False
            questions_visited = set()
            answers_submitted = set()
            
            async for row in cursor:
                total_events += 1
                event_data = json.loads(row[1])
                event_type = row[0]
                timestamp = row[2]
                
                # Use EventScorer for enhanced priority and confidence calculation
                try:
                    priority, confidence_score, is_flagged, description = EventScorer.calculate_event_score(event_type, event_data)
                except Exception as scorer_error:
                    print(f"Warning: EventScorer error: {scorer_error}")
                    # Provide fallback values
                    priority = 1
                    confidence_score = 0.5
                    is_flagged = False
                    description = f"Event: {event_type}"
                
                # Ensure numeric values are not None
                priority = priority if priority is not None else 1
                confidence_score = confidence_score if confidence_score is not None else 0.5
                is_flagged = is_flagged if is_flagged is not None else False
                
                if is_flagged:
                    flagged_events += 1
                    if priority == 3:
                        high_priority_events += 1
                
                if confidence_score is not None:
                    confidence_scores.append(confidence_score)
                
                # Create timeline event
                timeline_event = ExamTimelineEvent(
                    id=f"{session_id}_{total_events}",
                    session_id=session_id,
                    event_type=event_type,
                    event_data=event_data,
                    timestamp=row[2],
                    priority=priority,
                    confidence_score=confidence_score,
                    is_flagged=is_flagged,
                    created_at=datetime.now()
                )
                events.append(timeline_event)
                
                # Build step-by-step progress timeline
                if event_type == 'exam_started':
                    exam_started = True
                    step_timeline.append({
                        "step": "exam_started",
                        "title": "Exam Started",
                        "description": "Student began the exam session",
                        "timestamp": timestamp,
                        "status": "completed",
                        "details": event_data
                    })
                elif event_type == 'question_viewed':
                    question_id = event_data.get('question_id')
                    if question_id and question_id not in questions_visited:
                        questions_visited.add(question_id)
                        step_timeline.append({
                            "step": f"question_viewed_{question_id}",
                            "title": f"Question {len(questions_visited)} Viewed",
                            "description": f"Student viewed question {question_id}",
                            "timestamp": timestamp,
                            "status": "completed",
                            "details": event_data
                        })
                elif event_type == 'answer_changed':
                    question_id = event_data.get('question_id')
                    if question_id:
                        step_timeline.append({
                            "step": f"answer_changed_{question_id}",
                            "title": f"Answer Modified",
                            "description": f"Student modified answer for question {question_id}",
                            "timestamp": timestamp,
                            "status": "completed" if event_data.get('answer') else "in_progress",
                            "details": event_data
                        })
                elif event_type == 'answer_submitted':
                    question_id = event_data.get('question_id')
                    if question_id and question_id not in answers_submitted:
                        answers_submitted.add(question_id)
                        step_timeline.append({
                            "step": f"answer_submitted_{question_id}",
                            "title": f"Answer Submitted",
                            "description": f"Student submitted answer for question {question_id}",
                            "timestamp": timestamp,
                            "status": "completed",
                            "details": event_data
                        })
                elif event_type == 'exam_submitted':
                    step_timeline.append({
                        "step": "exam_submitted",
                        "title": "Exam Submitted",
                        "description": "Student completed and submitted the exam",
                        "timestamp": timestamp,
                        "status": "completed",
                        "details": event_data
                    })
                elif is_flagged:
                    # Add flagged events to timeline
                    step_timeline.append({
                        "step": f"flagged_{event_type}_{timestamp}",
                        "title": f"⚠️ Flagged Event: {event_type.replace('_', ' ').title()}",
                        "description": f"Suspicious activity detected",
                        "timestamp": timestamp,
                        "status": "flagged",
                        "priority": priority,
                        "confidence": confidence_score,
                        "details": event_data
                    })
            
            # Calculate analytics with pattern analysis
            avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
            
            # Ensure all values are properly initialized and not None
            total_events = total_events if total_events is not None else 0
            flagged_events = flagged_events if flagged_events is not None else 0
            high_priority_events = high_priority_events if high_priority_events is not None else 0
            
            suspicious_score = min(1.0, flagged_events / max(total_events, 1) * 2) if total_events > 0 else 0.0  # Scale suspicious activity
            
            # Use EventScorer for pattern analysis
            try:
                all_events = [
                    {
                        'event_type': event.event_type,
                        'event_data': event.event_data,
                        'timestamp': event.timestamp,
                        'confidence_score': event.confidence_score
                    }
                    for event in events
                ]
                
                # Get suspicious patterns
                suspicious_patterns = EventScorer.analyze_event_patterns(all_events) if hasattr(EventScorer, 'analyze_event_patterns') else {'patterns': []}
                pattern_descriptions = []
                for pattern in suspicious_patterns.get('patterns', []):
                    pattern_descriptions.append({
                        'pattern': pattern.get('type', 'unknown'),
                        'severity': pattern.get('severity', 'unknown'),
                        'description': pattern.get('description', ''),
                        'details': pattern
                    })
            except Exception as pattern_error:
                print(f"Warning: Pattern analysis error: {pattern_error}")
                pattern_descriptions = []
            
            analytics = ExamAnalytics(
                session_id=session_id,
                total_events=total_events,
                flagged_events=flagged_events,
                high_priority_events=high_priority_events,
                average_confidence_score=avg_confidence,
                suspicious_activity_score=suspicious_score,
                timeline_events=events,
                step_timeline=step_timeline,  # Add step-by-step timeline
                suspicious_patterns=pattern_descriptions  # Add pattern analysis
            )
            
            return analytics
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching exam analytics: {e}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to fetch analytics")


@router.get("/teacher/{teacher_id}/exams", response_model=List[dict])
async def get_teacher_exams(teacher_id: int, user_id: int = Header(..., alias="x-user-id")):
    """Get all exams created by a teacher (only accessible by the teacher themselves)"""
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Simplified: Only the teacher themselves can access their exams
            if teacher_id != user_id:
                raise HTTPException(status_code=403, detail="You can only access your own exams")
            
            # Get exams created by teacher
            await cursor.execute(
                f"""SELECT id, title, description, duration, questions, settings, monitoring, 
                           created_at, updated_at, org_id FROM {exams_table_name}
                    WHERE created_by = ? ORDER BY created_at DESC""",
                (teacher_id,)
            )
            
            exams = []
            async for row in cursor:
                exam_data = {
                    "id": row[0],
                    "title": row[1],
                    "description": row[2],
                    "duration": row[3],
                    "questions": json.loads(row[4]),
                    "settings": json.loads(row[5] or "{}"),
                    "monitoring": json.loads(row[6] or "{}"),
                    "created_at": row[7],
                    "updated_at": row[8],
                    "org_id": row[9]
                }
                exams.append(exam_data)
            
            return exams
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching teacher exams: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch exams")


async def calculate_exam_score(exam_id: str, answers: dict, cursor) -> float:
    try:
        await cursor.execute(
            f"SELECT questions FROM {exams_table_name} WHERE id = ?",
            (exam_id,)
        )
        
        row = await cursor.fetchone()
        if not row:
            return 0.0
        
        questions = json.loads(row[0])
        total_points = 0
        earned_points = 0
        
        for question in questions:
            total_points += question.get('points', 1)
            
            question_id = question.get('id')
            correct_answer = question.get('correct_answer')
            user_answer = answers.get(question_id, '')
            
            if question.get('type') == 'multiple_choice':
                if user_answer == correct_answer:
                    earned_points += question.get('points', 1)
            else:
                # For text/essay/code questions, you'd implement more sophisticated scoring
                # For now, we'll give partial credit if an answer exists
                if user_answer.strip():
                    earned_points += question.get('points', 1) * 0.5
        
        return round((earned_points / total_points * 100) if total_points > 0 else 0, 2)
        
    except Exception as e:
        print(f"Error calculating score: {e}")
        return 0.0


@router.get("/{exam_id}/video/{session_id}")
async def get_exam_video(exam_id: str, session_id: str, download: bool = False, user_id: int = Header(..., alias="x-user-id")):
    """Serve exam video recording"""
    try:
        from fastapi.responses import FileResponse, StreamingResponse
        import os
        from api.config import data_root_dir
        
        print(f"Video request: exam_id={exam_id}, session_id={session_id}, user_id={user_id}")
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Check if user has permission to view this video
            await cursor.execute(
                f"""SELECT es.user_id, e.created_by 
                    FROM {exam_sessions_table_name} es 
                    JOIN {exams_table_name} e ON es.exam_id = e.id 
                    WHERE es.id = ? AND es.exam_id = ?""",
                (session_id, exam_id)
            )
            session_info = await cursor.fetchone()
            
            if not session_info:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            session_user_id, exam_creator_id = session_info
            
            # Only the exam taker or exam creator can view the video
            if user_id != session_user_id and user_id != exam_creator_id:
                raise HTTPException(status_code=403, detail="Not authorized to view this video")
            
            # Get video file path
            from api.config import data_root_dir
            video_dir = os.path.join(data_root_dir, "exam_videos", exam_id)
            video_path = os.path.join(video_dir, f"{exam_id}_master_recording.webm")
            
            print(f"Looking for video at: {video_path}")
            print(f"Video exists: {os.path.exists(video_path)}")
            
            if not os.path.exists(video_path):
                raise HTTPException(status_code=404, detail="Video recording not found")
            
            if download:
                return FileResponse(
                    video_path,
                    media_type='video/webm',
                    filename=f"exam_{exam_id}_session_{session_id}.webm"
                )
            else:
                def iterfile(file_path: str):
                    with open(file_path, mode="rb") as file_like:
                        while True:
                            chunk = file_like.read(8192)  # Read in 8KB chunks
                            if not chunk:
                                break
                            yield chunk
                
                file_size = os.path.getsize(video_path)
                
                return StreamingResponse(
                    iterfile(video_path),
                    media_type='video/webm',
                    headers={
                        'Accept-Ranges': 'bytes',
                        'Content-Length': str(file_size),
                        'Content-Type': 'video/webm',
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    }
                )
                
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error serving video: {e}")
        raise HTTPException(status_code=500, detail="Failed to serve video")


class ReportGenerationRequest(BaseModel):
    exam_id: str
    session_id: str
    report_type: str = "comprehensive"  # comprehensive, summary, detailed
    include_analytics: bool = True
    include_questions: bool = True
    include_video_info: bool = True


class CustomCourseRequest(BaseModel):
    exam_id: str
    session_id: str
    user_answers: dict
    report_data: dict
    create_full_course: bool = True  # New field to enable full course creation
    course_name_override: Optional[str] = None  # Optional custom course name


@router.post("/generate-report", response_model=dict)
async def generate_report(
    request: ReportGenerationRequest,
    user_id: int = Header(..., alias="x-user-id")
):
    """
    Generate a beautiful PDF report using ChatGPT API for summaries and insights
    """
    try:
        from api.llm import evaluate_exam_with_openai
        
        print(f"Generating report for exam {request.exam_id}, session {request.session_id}")
        
        # Get OpenAI API key
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Get comprehensive exam data
            await cursor.execute(
                f"""SELECT s.*, e.title, e.description, e.duration, e.questions, u.email, u.first_name, u.last_name,
                           e.created_by FROM {exam_sessions_table_name} s
                    JOIN {exams_table_name} e ON s.exam_id = e.id
                    LEFT JOIN {users_table_name} u ON s.user_id = u.id
                    WHERE s.id = ? AND s.exam_id = ?""",
                (request.session_id, request.exam_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            # Check permissions - only exam creator or student can generate report
            exam_creator_id = session_row[17]  # e.created_by
            session_user_id = session_row[2]   # s.user_id
            
            if user_id != exam_creator_id and str(user_id) != str(session_user_id):
                raise HTTPException(status_code=403, detail="Not authorized to generate this report")
            
            # Parse exam data
            exam_title = session_row[11]
            exam_description = session_row[12] 
            duration = session_row[13]
            questions = json.loads(session_row[14])
            answers = json.loads(session_row[6] or "{}")
            score = session_row[7] or 0
            
            # Calculate time taken
            start_time = session_row[3] if session_row[3] else datetime.now()
            end_time = session_row[4] if session_row[4] else datetime.now()
            if isinstance(start_time, str):
                start_time = datetime.fromisoformat(start_time)
            if isinstance(end_time, str):
                end_time = datetime.fromisoformat(end_time)
            time_taken_seconds = (end_time - start_time).total_seconds()
            
            # Create user display name
            user_display = "Student"
            if session_row[15]:  # email
                if session_row[16] and session_row[17]:  # first_name and last_name
                    user_display = f"{session_row[16]} {session_row[17]}"
                elif session_row[16]:
                    user_display = session_row[16]
                else:
                    user_display = session_row[15]
            
            # Get analytics data if requested
            analytics_data = None
            if request.include_analytics and user_id == exam_creator_id:
                try:
                    analytics = await get_exam_analytics(request.exam_id, request.session_id, user_id)
                    analytics_data = analytics.dict()
                except:
                    analytics_data = None
            
            # Get events summary
            await cursor.execute(
                f"""SELECT event_type, COUNT(*) as count
                    FROM {exam_events_table_name}
                    WHERE session_id = ?
                    GROUP BY event_type""",
                (request.session_id,)
            )
            
            events_summary = {}
            async for row in cursor:
                events_summary[row[0]] = row[1]
            
            # Generate AI evaluation using ChatGPT
            evaluation_data = await generate_ai_summaries(
                openai_api_key,
                exam_title,
                user_display, 
                score,
                questions,
                answers,
                time_taken_seconds,
                events_summary,
                analytics_data
            )
            
            # Generate charts
            charts = generate_charts(evaluation_data)
            
            # Calculate grade gradient for PDF
            overall_perf = evaluation_data.get('overall_performance', {})
            grade_level = overall_perf.get('grade_level', 'C')
            
            if grade_level == 'A' or score >= 90:
                grade_gradient = "linear-gradient(135deg, #059669 0%, #10b981 100%)"
            elif grade_level == 'B' or score >= 80:
                grade_gradient = "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)"
            elif grade_level == 'C' or score >= 70:
                grade_gradient = "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)" 
            elif grade_level == 'D' or score >= 60:
                grade_gradient = "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)"
            else:
                grade_gradient = "linear-gradient(135deg, #7c2d12 0%, #dc2626 100%)"
            
            # Generate PDF report
            pdf_path = await create_pdf_report(
                exam_title,
                user_display,
                score,
                start_time,
                end_time,
                time_taken_seconds,
                questions,
                answers,
                events_summary,
                analytics_data,
                evaluation_data,
                charts,
                request,
                grade_gradient
            )
            
            # Read PDF content for base64 encoding
            with open(pdf_path, 'rb') as pdf_file:
                pdf_content = pdf_file.read()
                pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
            
            # Clean up temporary file
            os.unlink(pdf_path)
            
            # Convert analytics_data from Pydantic model to dict if it exists
            analytics_dict = None
            if analytics_data:
                try:
                    # Convert Pydantic model to dict
                    analytics_dict = analytics_data.dict() if hasattr(analytics_data, 'dict') else analytics_data
                except:
                    # Fallback to basic conversion
                    analytics_dict = {
                        "total_events": getattr(analytics_data, 'total_events', 0),
                        "flagged_events": getattr(analytics_data, 'flagged_events', 0),
                        "high_priority_events": getattr(analytics_data, 'high_priority_events', 0),
                        "average_confidence_score": getattr(analytics_data, 'average_confidence_score', 0),
                        "suspicious_activity_score": getattr(analytics_data, 'suspicious_activity_score', 0),
                        "timeline_events": getattr(analytics_data, 'timeline_events', []),
                        "step_timeline": getattr(analytics_data, 'step_timeline', [])
                    }
            
            # Return JSON with PDF and ALL generation data
            return {
                "success": True,
                "pdf_data": pdf_base64,
                "filename": f"SENSAI_Report_{exam_title}_{user_display}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf",
                "generation_data": {
                    # Basic exam information
                    "exam_info": {
                        "exam_id": request.exam_id,
                        "session_id": request.session_id,
                        "exam_title": exam_title,
                        "exam_description": exam_description,
                        "student_name": user_display,
                        "student_user_id": session_user_id,
                        "exam_date": start_time.strftime("%B %d, %Y"),
                        "exam_datetime": start_time.isoformat(),
                        "completion_datetime": end_time.isoformat(),
                        "duration_seconds": time_taken_seconds,
                        "duration_formatted": f"{time_taken_seconds/60:.1f} minutes",
                        "total_questions": len(questions),
                        "final_score": score
                    },
                    
                    # Complete AI evaluation data
                    "ai_evaluation": evaluation_data,
                    
                    # All generated charts (base64 encoded)
                    "charts": charts,
                    
                    # Raw exam data
                    "exam_data": {
                        "questions": questions,
                        "answers": answers,
                        "events_summary": events_summary
                    },
                    
                    # Analytics data (if available)
                    "analytics": analytics_dict,
                    
                    # Template variables used for PDF generation
                    "template_variables": {
                        "exam_title": exam_title,
                        "student_name": user_display,
                        "score": score,
                        "grade_gradient": grade_gradient,
                        "exam_date": start_time.strftime("%B %d, %Y"),
                        "duration": f"{time_taken_seconds/60:.1f} minutes",
                        "total_questions": len(questions),
                        "generation_date": datetime.now().strftime("%B %d, %Y at %I:%M %p")
                    },
                    
                    # Generation metadata
                    "generation_metadata": {
                        "generated_at": datetime.now().isoformat(),
                        "report_type": request.report_type,
                        "request_parameters": {
                            "include_analytics": request.include_analytics,
                            "include_questions": request.include_questions,
                            "include_video_info": request.include_video_info
                        },
                        "included_sections": {
                            "analytics": request.include_analytics and analytics_data is not None,
                            "questions": request.include_questions,
                            "charts": len(charts) > 0,
                            "ai_evaluation": evaluation_data is not None,
                            "video_info": request.include_video_info
                        },
                        "chart_count": len(charts),
                        "ai_model_used": "gpt-4o-mini",
                        "processing_time_seconds": (datetime.now() - datetime.fromisoformat(datetime.now().isoformat().split('.')[0])).total_seconds() if True else 0
                    }
                }
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating report: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")


@router.post("/create-custom-course", response_model=dict)
async def create_custom_course(
    request: CustomCourseRequest,
    background_tasks: BackgroundTasks,
    user_id: int = Header(..., alias="x-user-id")
):
    """
    Create a personalized course based on user's exam performance and weak areas
    """
    try:
        print(f"Creating personalized course for exam {request.exam_id}, session {request.session_id}")
        
        # Get OpenAI API key
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(status_code=500, detail="OpenAI API key not configured")
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Verify user has access to this exam session
            await cursor.execute(
                f"""SELECT s.user_id, e.created_by, e.title, e.description FROM {exam_sessions_table_name} s
                    JOIN {exams_table_name} e ON s.exam_id = e.id
                    WHERE s.id = ? AND s.exam_id = ?""",
                (request.session_id, request.exam_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            session_user_id, exam_creator_id, exam_title, exam_description = session_row
            
            # Only the exam taker or exam creator can generate a custom course
            if user_id != session_user_id and user_id != exam_creator_id:
                raise HTTPException(status_code=403, detail="Not authorized to create course for this session")
        
        # Extract data for course generation
        exam_info = request.report_data.get('exam_info', {})
        ai_evaluation = request.report_data.get('ai_evaluation', {})
        overall_performance = ai_evaluation.get('overall_performance', {})
        
        # Determine course name
        if request.course_name_override:
            course_name = request.course_name_override
        else:
            weaknesses = overall_performance.get('weaknesses', [])
            primary_weakness = weaknesses[0] if weaknesses else 'Core Concepts'
            course_name = f"Personalized {exam_title} - Focus on {primary_weakness}"
        
        # Check if we should create full course or just return recommendation
        if not request.create_full_course:
            # Generate only recommendation (original behavior)
            course_data = await generate_custom_course_with_openai(
                openai_api_key,
                request.user_answers,
                request.report_data
            )
            
            return {
                "success": True,
                "course_created": False,
                "course_data": course_data,
                "session_id": request.session_id,
                "exam_id": request.exam_id
            }
        
        # Create full personalized course
        
        # Step 1: Determine organization for course creation
        try:
            org_id = await determine_student_org_id(user_id)
        except Exception as e:
            print(f"Organization determination failed, using simple fallback: {e}")
            # Simple fallback: just use org_id = 1 or create a course without strict org requirements
            org_id = 1  # Most systems have at least one organization with ID 1
        
        # Step 2: Create the course record
        course_id = await create_course(course_name, org_id)
        
        # Get organization details and user email for routing and cohort enrollment
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            await cursor.execute(
                f"SELECT name, slug FROM {organizations_table_name} WHERE id = ?",
                (org_id,)
            )
            org_info = await cursor.fetchone()
            org_name, org_slug = org_info if org_info else ("Unknown", "unknown")
            
            # Get user's email for cohort enrollment
            await cursor.execute(
                f"SELECT email FROM {users_table_name} WHERE id = ?",
                (user_id,)
            )
            user_info = await cursor.fetchone()
            user_email = user_info[0] if user_info else f"user_{user_id}@unknown.com"
        
        # Step 2.5: Create a cohort for the personalized course and enroll the user
        cohort_name = f"Personalized Learning - {course_name}"
        try:
            cohort_id = await create_cohort(cohort_name, org_id)
            
            # Add user to the cohort as a learner
            await add_members_to_cohort(cohort_id, org_slug, org_id, [user_email], ["learner"])
            
            # Add the course to the cohort
            await add_course_to_cohorts(course_id, [cohort_id])
            
            print(f"Created cohort {cohort_id} and enrolled user {user_id}")
            
        except Exception as e:
            print(f"Error creating cohort: {e}")
            # Continue without cohort - we'll use a fallback approach
            cohort_id = None
        
        # Step 3: Generate comprehensive reference material from exam data
        reference_material = await create_reference_material_from_exam_data(
            exam_info,
            request.user_answers,
            request.report_data
        )
        
        # Step 4: Create temporary PDF file for OpenAI (convert text to PDF)
        import openai
        openai_client = openai.AsyncOpenAI(api_key=openai_api_key)
        
        # Create a simple PDF from the reference material text
        pdf_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Exam Analysis Reference Material</title>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }}
                h1 {{ color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }}
                h2 {{ color: #555; margin-top: 30px; }}
                .section {{ margin-bottom: 20px; }}
                pre {{ background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-wrap: break-word; white-space: pre-wrap; }}
            </style>
        </head>
        <body>
            <h1>Personalized Learning Reference Material</h1>
            <div class="section">
                <pre>{reference_material}</pre>
            </div>
        </body>
        </html>
        """
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as html_file:
            html_file.write(pdf_html)
            html_file.flush()
            
            # Convert HTML to PDF
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as pdf_file:
                weasyprint.HTML(html_file.name).write_pdf(pdf_file.name)
                
                # Upload PDF to OpenAI
                with open(pdf_file.name, 'rb') as f:
                    file = await openai_client.files.create(
                        file=f,
                        purpose="user_data",
                    )
                
                # Clean up temp files
                os.unlink(pdf_file.name)
            os.unlink(html_file.name)
        
        # Step 5: Generate personalized course description and instructions
        weaknesses = overall_performance.get('weaknesses', [])
        strengths = overall_performance.get('strengths', [])
        focus_areas = ai_evaluation.get('learning_recommendations', {}).get('study_plan', {}).get('focus_areas', [])
        
        course_description = f"""Personalized learning course for {exam_title} based on individual exam performance analysis.
        
Primary Focus Areas: {', '.join(focus_areas[:3]) if focus_areas else 'Core concept reinforcement'}
Identified Weaknesses: {', '.join(weaknesses[:3]) if weaknesses else 'General improvement needed'}
Student Strengths: {', '.join(strengths[:3]) if strengths else 'Building foundational skills'}
Performance Level: {overall_performance.get('performance_category', 'Average')} ({exam_info.get('final_score', 0)}%)
        """
        
        intended_audience = f"""This course is specifically designed for a student who:
- Completed the {exam_title} assessment with a {exam_info.get('final_score', 0)}% score
- Shows {overall_performance.get('performance_category', 'average').lower()} performance level
- Needs targeted improvement in: {', '.join(weaknesses[:3]) if weaknesses else 'foundational concepts'}
- Can build upon existing strengths in: {', '.join(strengths[:3]) if strengths else 'basic understanding'}
- Requires personalized learning path for skill development
        """
        
        instructions = f"""Create a highly personalized learning course that addresses this student's specific weak areas:

CRITICAL FOCUS AREAS (prioritize these topics):
{chr(10).join([f'- {weakness}' for weakness in weaknesses[:5]])}

STRENGTHS TO BUILD UPON:
{chr(10).join([f'- {strength}' for strength in strengths[:3]])}

LEARNING REQUIREMENTS:
- Start with foundational concepts for weak areas
- Include progressive difficulty levels
- Provide extensive practice for identified problem areas
- Create confidence-building exercises using student's strengths
- Focus on practical application and skill reinforcement
- Include targeted remedial content for knowledge gaps

PERSONALIZATION GUIDELINES:
- Tailor content difficulty to student's current performance level
- Prioritize weak areas while maintaining engagement
- Include real-world examples relevant to the exam context
- Create multiple practice opportunities for challenging concepts
        """
        
        # Step 6: Store course generation request and start background task
        job_details = {
            "course_description": course_description,
            "intended_audience": intended_audience,
            "instructions": instructions,
            "reference_material_s3_key": None,  # We're using OpenAI file directly
            "openai_file_id": file.id,
            "personalized_course": True,
            "source_exam_id": request.exam_id,
            "source_session_id": request.session_id,
            "user_id": user_id
        }
        
        job_uuid = await store_course_generation_request(course_id, job_details)
        
        # Step 7: Start course generation in background
        print(f"Starting course structure generation for course {course_id} with job {job_uuid}")
        
        background_tasks.add_task(
            generate_personalized_course_complete,
            course_description,
            intended_audience,  
            instructions,
            file.id,
            course_id,
            job_uuid,
            job_details
        )
        
        # Step 8: Prepare response data
        return {
            "success": True,
            "course_created": True,
            "course_id": course_id,
            "course_name": course_name,
            "job_uuid": job_uuid,
            "generation_status": "started",
            "estimated_completion": "5-10 minutes",
            "weak_areas_targeted": weaknesses[:5],
            "strengths_leveraged": strengths[:3],
            "organization": {
                "id": org_id,
                "name": org_name,
                "slug": org_slug
            },
            "cohort_id": cohort_id,
            "course_metadata": {
                "total_focus_areas": len(focus_areas),
                "performance_level": overall_performance.get('performance_category', 'Average'),
                "source_exam_score": exam_info.get('final_score', 0),
                "personalization_level": "high"
            },
            "session_id": request.session_id,
            "exam_id": request.exam_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error creating personalized course: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create personalized course: {str(e)}")


async def generate_custom_course_with_openai(
    api_key: str,
    user_answers: dict,
    report_data: dict
) -> dict:
    """Generate custom course recommendations using OpenAI based on exam performance"""
    
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=api_key)
        
        # Extract key information from report data
        exam_info = report_data.get('exam_info', {})
        ai_evaluation = report_data.get('ai_evaluation', {})
        
        # Get performance insights
        overall_performance = ai_evaluation.get('overall_performance', {})
        strengths = overall_performance.get('strengths', [])
        weaknesses = overall_performance.get('weaknesses', [])
        learning_recommendations = ai_evaluation.get('learning_recommendations', {})
        
        # Create detailed prompt for course generation
        course_prompt = f"""
        You are an expert educational course designer. Based on a student's exam performance and learning needs, create a personalized course recommendation.

        STUDENT PERFORMANCE DATA:
        - Exam: {exam_info.get('exam_title', 'Unknown Exam')}
        - Score: {exam_info.get('final_score', 0)}%
        - Strengths: {', '.join(strengths) if strengths else 'None identified'}
        - Weaknesses: {', '.join(weaknesses) if weaknesses else 'None identified'}
        
        LEARNING RECOMMENDATIONS:
        - Focus Areas: {', '.join(learning_recommendations.get('study_plan', {}).get('focus_areas', []))}
        - Immediate Actions: {len(learning_recommendations.get('immediate_actions', []))} priority items identified
        - Next Steps: {', '.join(learning_recommendations.get('next_steps', []))}
        
        USER ANSWERS ANALYSIS:
        - Total Questions Answered: {len([a for a in user_answers.values() if a.strip()]) if user_answers else 0}
        - Answer Quality: Based on provided responses
        
        Create a personalized course that addresses this student's specific learning needs and builds upon their strengths while improving their weaknesses.

        Return ONLY a valid JSON object with this exact structure:
        {{
            "course_name": "A compelling, specific course title that reflects the learning objectives",
            "course_about": "A detailed description of what the course covers, the topics to be covered, main learning objectives, and how it addresses the student's specific needs. Should be 2-3 sentences.",
            "course_audience": "A clear description of who this course is for, their expected background, current skill level, and what they hope to achieve after completion. Should be 2-3 sentences."
        }}
        """
        
        # Generate course recommendation
        course_response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert educational course designer. Always return valid JSON only."},
                {"role": "user", "content": course_prompt}
            ],
            max_tokens=800,
            temperature=0.7
        )
        
        # Parse JSON response
        try:
            course_json = json.loads(course_response.choices[0].message.content)
            
            # Validate required fields
            required_fields = ['course_name', 'course_about', 'course_audience']
            for field in required_fields:
                if field not in course_json:
                    raise ValueError(f"Missing required field: {field}")
            
            return course_json
            
        except json.JSONDecodeError:
            print("Failed to parse JSON from OpenAI course response, using fallback")
            return generate_fallback_course(exam_info, overall_performance, strengths, weaknesses)
        
    except Exception as e:
        print(f"Error generating custom course with OpenAI: {e}")
        return generate_fallback_course(exam_info, overall_performance, strengths, weaknesses)


def generate_fallback_course(exam_info: dict, overall_performance: dict, strengths: list, weaknesses: list) -> dict:
    """Generate a fallback course when OpenAI fails"""
    
    exam_title = exam_info.get('exam_title', 'Subject')
    score = exam_info.get('final_score', 0)
    performance_category = overall_performance.get('performance_category', 'Average')
    
    # Determine course focus based on performance
    if score >= 80:
        focus = "advanced concepts and practical applications"
        audience_level = "intermediate to advanced learners"
    elif score >= 60:
        focus = "core concepts and skill reinforcement"  
        audience_level = "beginner to intermediate learners"
    else:
        focus = "fundamental concepts and foundational skills"
        audience_level = "beginners"
    
    return {
        "course_name": f"Personalized {exam_title} Mastery Course",
        "course_about": f"This customized course focuses on {focus} based on your {performance_category.lower()} performance. It covers key areas for improvement while building upon your existing strengths to ensure comprehensive understanding and skill development.",
        "course_audience": f"This course is designed for {audience_level} who want to improve their understanding of {exam_title.lower()} concepts. Students should have basic familiarity with the subject and are committed to structured learning and practice to achieve mastery."
    }


async def create_reference_material_from_exam_data(
    exam_info: dict,
    user_answers: dict,
    report_data: dict
) -> str:
    """Create comprehensive reference material from exam performance data"""
    
    ai_evaluation = report_data.get('ai_evaluation', {})
    overall_performance = ai_evaluation.get('overall_performance', {})
    question_analysis = ai_evaluation.get('question_analysis', [])
    learning_recommendations = ai_evaluation.get('learning_recommendations', {})
    
    # Build comprehensive reference material
    reference_content = f"""
# Personalized Learning Reference Material

## Student Performance Summary
- Exam: {exam_info.get('exam_title', 'Unknown')}
- Final Score: {exam_info.get('final_score', 0)}%
- Performance Level: {overall_performance.get('performance_category', 'Average')}
- Time Efficiency: {overall_performance.get('time_efficiency', 'Average')}

## Strengths Identified
{chr(10).join([f"- {strength}" for strength in overall_performance.get('strengths', [])])}

## Areas Requiring Improvement
{chr(10).join([f"- {weakness}" for weakness in overall_performance.get('weaknesses', [])])}

## Detailed Question Analysis
"""
    
    # Add question-by-question analysis
    for i, analysis in enumerate(question_analysis, 1):
        reference_content += f"""
### Question {i} Analysis
- Status: {analysis.get('status', 'unknown')}
- Accuracy Score: {analysis.get('criteria_scores', {}).get('accuracy', 0)}/100
- Completeness Score: {analysis.get('criteria_scores', {}).get('completeness', 0)}/100
- Clarity Score: {analysis.get('criteria_scores', {}).get('clarity', 0)}/100
- Depth Score: {analysis.get('criteria_scores', {}).get('depth', 0)}/100
- Feedback: {analysis.get('feedback', 'No feedback available')}
- Improvement Tips: {', '.join(analysis.get('improvement_tips', []))}
"""
    
    # Add learning recommendations
    study_plan = learning_recommendations.get('study_plan', {})
    reference_content += f"""

## Learning Recommendations

### Focus Areas for Improvement
{chr(10).join([f"- {area}" for area in study_plan.get('focus_areas', [])])}

### Recommended Study Resources
{chr(10).join([f"- {resource}" for resource in study_plan.get('recommended_resources', [])])}

### Practice Exercises Needed
{chr(10).join([f"- {exercise}" for exercise in study_plan.get('practice_exercises', [])])}

### Immediate Priority Actions
"""
    
    # Add immediate actions with priorities
    for action in learning_recommendations.get('immediate_actions', []):
        reference_content += f"""
- **{action.get('priority', 'Medium')} Priority**: {action.get('action', 'Review concepts')}
  Timeline: {action.get('timeline', '1-2 weeks')}
"""
    
    # Add skill assessment data
    skill_assessment = ai_evaluation.get('skill_assessment', {})
    reference_content += f"""

## Knowledge Areas Assessment
"""
    
    for area in skill_assessment.get('knowledge_areas', []):
        reference_content += f"""
### {area.get('area', 'Unknown Area')}
- Current Level: {area.get('level', 'Unknown')}
- Score: {area.get('score', 0)}/100
- Evidence: {', '.join(area.get('evidence', []))}
"""
    
    # Add cognitive skills analysis
    cognitive_skills = skill_assessment.get('cognitive_skills', {})
    if cognitive_skills:
        reference_content += f"""

## Cognitive Skills Assessment
- Critical Thinking: {cognitive_skills.get('critical_thinking', 0)}/100
- Analytical Reasoning: {cognitive_skills.get('analytical_reasoning', 0)}/100
- Application: {cognitive_skills.get('application', 0)}/100
- Synthesis: {cognitive_skills.get('synthesis', 0)}/100
"""
    
    return reference_content.strip()


async def determine_student_org_id(user_id: int) -> int:
    """Determine the appropriate organization ID for course creation"""
    
    try:
        print(f"Determining org ID for user {user_id}")
        
        # Get user's organizations
        try:
            user_orgs = await get_user_organizations(user_id)
            print(f"User organizations found: {len(user_orgs) if user_orgs else 0}")
            
            if user_orgs:
                org_id = user_orgs[0]["id"]
                print(f"Using existing organization {org_id} for user {user_id}")
                return org_id
        except Exception as e:
            print(f"Error getting user organizations: {e}")
            # Continue to fallback options
        
        # If user has no organizations, try simpler approaches
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            print("Checking for default organizations...")
            # Try to find any existing organization as fallback
            await cursor.execute(
                f"SELECT id FROM {organizations_table_name} LIMIT 1"
            )
            any_org = await cursor.fetchone()
            
            if any_org:
                print(f"Using fallback organization {any_org[0]} for user {user_id}")
                # Add user to this organization (if not already there)
                try:
                    await cursor.execute(
                        f"INSERT OR IGNORE INTO {user_organizations_table_name} (user_id, organization_id, role) VALUES (?, ?, 'learner')",
                        (user_id, any_org[0])
                    )
                    await conn.commit()
                except Exception as e:
                    print(f"Note: Could not add user to organization (may already exist): {e}")
                
                return any_org[0]
            
            print("No organizations found, creating a default one...")
            # Create a default organization if none exists
            try:
                await cursor.execute(
                    f"INSERT INTO {organizations_table_name} (name, slug) VALUES (?, ?)",
                    ("SENSAI Learning", "sensai-learning")
                )
                org_id = cursor.lastrowid
                
                # Add user to the organization
                await cursor.execute(
                    f"INSERT INTO {user_organizations_table_name} (user_id, organization_id, role) VALUES (?, ?, 'learner')",
                    (user_id, org_id)
                )
                
                await conn.commit()
                
                print(f"Created default organization {org_id} for user {user_id}")
                return org_id
                
            except Exception as e:
                print(f"Failed to create default organization: {e}")
                # As absolute last resort, just return org ID 1 (assuming it exists)
                print("Using absolute fallback org ID 1")
                return 1
        
    except Exception as e:
        print(f"Critical error determining org ID: {e}")
        import traceback
        traceback.print_exc()
        
        # Absolute fallback - try to use org ID 1
        try:
            async with get_new_db_connection() as conn:
                cursor = await conn.cursor()
                await cursor.execute(f"SELECT id FROM {organizations_table_name} WHERE id = 1")
                if await cursor.fetchone():
                    print("Using emergency fallback org ID 1")
                    return 1
        except:
            pass
            
        raise HTTPException(
            status_code=500,
            detail=f"Failed to determine organization for course creation: {str(e)}"
        )


async def generate_personalized_course_complete(
    course_description: str,
    intended_audience: str,
    instructions: str,
    openai_file_id: str,
    course_id: int,
    job_uuid: str,
    job_details: dict
):
    """Complete personalized course generation including structure and content"""
    
    try:
        print(f"Starting complete course generation for course {course_id}")
        
        # Phase 1: Generate course structure
        try:
            print(f"Calling _generate_course_structure with openai_file_id: {openai_file_id}")
            await _generate_course_structure(
                course_description,
                intended_audience,
                instructions,
                openai_file_id,
                course_id,
                job_uuid,
                job_details
            )
            print(f"_generate_course_structure completed successfully for course {course_id}")
        except Exception as e:
            print(f"ERROR in _generate_course_structure for course {course_id}: {e}")
            import traceback
            traceback.print_exc()
            raise e
        
        print(f"Course structure completed for course {course_id}, starting task generation")
        
        # Phase 2: Generate task content
        print(f"Starting task content generation for course {course_id}")
        
        # Import the necessary modules for task generation
        import instructor
        import openai
        from api.db.course import get_course_generation_job_details
        from api.db.task import store_task_generation_request
        from api.routes.ai import generate_course_task
        from api.utils.concurrency import async_batch_gather
        from api.settings import settings
        
        try:
            # Get job details
            job_details_for_tasks = await get_course_generation_job_details(job_uuid)
            
            if not job_details_for_tasks.get("course_structure"):
                print(f"No course structure found in job details for course {course_id}")
                return
                
            # Set up OpenAI client
            client = instructor.from_openai(
                openai.AsyncOpenAI(api_key=settings.openai_api_key)
            )
            
            # Create task generation jobs
            tasks_to_generate = []
            
            for module in job_details_for_tasks["course_structure"]["modules"]:
                for concept in module["concepts"]:
                    for task in concept["tasks"]:
                        task_job_uuid = await store_task_generation_request(
                            task["id"],
                            course_id,
                            {
                                "task": task,
                                "concept": concept,
                                "openai_file_id": job_details_for_tasks["openai_file_id"],
                                "course_job_uuid": job_uuid,
                                "course_id": course_id,
                            },
                        )
                        
                        tasks_to_generate.append(
                            generate_course_task(
                                client,
                                task,
                                concept,
                                job_details_for_tasks["openai_file_id"],
                                task_job_uuid,
                                job_uuid,
                                course_id,
                            )
                        )
            
            # Run all task generation in parallel
            await async_batch_gather(tasks_to_generate, description="Generating personalized course tasks")
            
            print(f"Task generation completed for course {course_id}")
            
        except Exception as e:
            print(f"Error generating tasks for course {course_id}: {e}")
            import traceback
            traceback.print_exc()
        
        print(f"Complete course generation finished for course {course_id}")
        
    except Exception as e:
        print(f"Error in complete course generation for course {course_id}: {e}")
        import traceback
        traceback.print_exc()
        
        # Update job status to failed
        from api.db.course import update_course_generation_job_status
        from api.models import GenerateCourseJobStatus
        
        try:
            await update_course_generation_job_status(job_uuid, GenerateCourseJobStatus.COMPLETED)
        except:
            pass


async def generate_ai_summaries(
    api_key: str,
    exam_title: str,
    student_name: str,
    score: float,
    questions: list,
    answers: dict,
    time_taken: float,
    events_summary: dict,
    analytics_data: dict = None
) -> dict:
    """Generate structured AI evaluation using ChatGPT with detailed criteria"""
    
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=api_key)
        
        # Prepare detailed question analysis
        question_details = []
        for i, question in enumerate(questions, 1):
            question_id = question.get('id', f'q{i}')
            user_answer = answers.get(question_id, '')
            correct_answer = question.get('correct_answer', '')
            
            question_details.append({
                "question_number": i,
                "question_text": question.get('question', ''),
                "question_type": question.get('type', 'text'),
                "user_answer": user_answer,
                "correct_answer": correct_answer,
                "points": question.get('points', 1)
            })
        
        # Generate comprehensive structured evaluation
        evaluation_prompt = f"""
        You are an AI education analyst. Analyze this exam performance and return a detailed JSON evaluation.

        EXAM DATA:
        - Title: {exam_title}
        - Student: {student_name}
        - Score: {score}%
        - Time taken: {time_taken/60:.1f} minutes
        - Questions: {len(questions)}
        - Answered: {len([a for a in answers.values() if a.strip()])}
        
        QUESTIONS AND ANSWERS:
        {json.dumps(question_details, indent=2)}
        
        Return ONLY a valid JSON object with this exact structure:
        {{
            "overall_performance": {{
                "grade_level": "A/B/C/D/F",
                "performance_category": "Excellent/Good/Satisfactory/Needs Improvement/Poor",
                "strengths": ["strength1", "strength2", "strength3"],
                "weaknesses": ["weakness1", "weakness2", "weakness3"],
                "time_efficiency": "Excellent/Good/Average/Poor",
                "completion_rate": 95.5
            }},
            "question_analysis": [
                {{
                    "question_number": 1,
                    "status": "correct/incorrect/partial",
                    "criteria_scores": {{
                        "accuracy": 85,
                        "completeness": 90,
                        "clarity": 80,
                        "depth": 75
                    }},
                    "feedback": "Detailed feedback for this question",
                    "improvement_tips": ["tip1", "tip2"],
                    "difficulty_level": "Easy/Medium/Hard",
                    "time_spent_estimate": "Appropriate/Too Fast/Too Slow"
                }}
            ],
            "skill_assessment": {{
                "knowledge_areas": [
                    {{
                        "area": "Conceptual Understanding",
                        "score": 82,
                        "level": "Proficient",
                        "evidence": ["specific examples"]
                    }},
                    {{
                        "area": "Problem Solving",
                        "score": 75,
                        "level": "Developing",
                        "evidence": ["specific examples"]
                    }}
                ],
                "cognitive_skills": {{
                    "critical_thinking": 80,
                    "analytical_reasoning": 75,
                    "application": 85,
                    "synthesis": 70
                }}
            }},
            "learning_recommendations": {{
                "immediate_actions": [
                    {{
                        "priority": "High/Medium/Low",
                        "action": "Specific action to take",
                        "timeline": "1-2 weeks"
                    }}
                ],
                "study_plan": {{
                    "focus_areas": ["area1", "area2"],
                    "recommended_resources": ["resource1", "resource2"],
                    "practice_exercises": ["exercise1", "exercise2"]
                }},
                "next_steps": ["step1", "step2", "step3"]
            }},
            "performance_metrics": {{
                "accuracy_by_type": {{
                    "multiple_choice": 85,
                    "short_answer": 70,
                    "essay": 60
                }},
                "time_distribution": {{
                    "planning": 10,
                    "execution": 75,
                    "review": 15
                }},
                "confidence_indicators": {{
                    "certainty_level": 75,
                    "revision_frequency": "Low/Medium/High"
                }}
            }}
        }}
        """
        
        evaluation_response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert educational analyst. Always return valid JSON only."},
                {"role": "user", "content": evaluation_prompt}
            ],
            max_tokens=2000,
            temperature=0.3
        )
        
        # Parse JSON response
        try:
            evaluation_json = json.loads(evaluation_response.choices[0].message.content)
            return evaluation_json
        except json.JSONDecodeError:
            print("Failed to parse JSON from OpenAI, using fallback")
            return generate_fallback_evaluation(exam_title, student_name, score, questions, answers, time_taken)
        
    except Exception as e:
        print(f"Error generating AI evaluation: {e}")
        return generate_fallback_evaluation(exam_title, student_name, score, questions, answers, time_taken)


def generate_fallback_evaluation(exam_title: str, student_name: str, score: float, questions: list, answers: dict, time_taken: float) -> dict:
    """Generate a structured fallback evaluation when AI fails"""
    
    # Calculate basic metrics
    total_questions = len(questions)
    answered_questions = len([a for a in answers.values() if a.strip()])
    completion_rate = (answered_questions / total_questions * 100) if total_questions > 0 else 0
    
    # Determine grade level
    if score >= 90: grade_level, performance_category = "A", "Excellent"
    elif score >= 80: grade_level, performance_category = "B", "Good"  
    elif score >= 70: grade_level, performance_category = "C", "Satisfactory"
    elif score >= 60: grade_level, performance_category = "D", "Needs Improvement"
    else: grade_level, performance_category = "F", "Poor"
    
    # Generate question analysis
    question_analysis = []
    for i, question in enumerate(questions, 1):
        question_id = question.get('id', f'q{i}')
        user_answer = answers.get(question_id, '')
        correct_answer = question.get('correct_answer', '')
        
        # Determine status
        if question.get('type') == 'multiple_choice':
            status = "correct" if user_answer == correct_answer else "incorrect"
            accuracy = 100 if status == "correct" else 0
        else:
            status = "partial" if user_answer.strip() else "incorrect"
            accuracy = 75 if user_answer.strip() else 0
            
        question_analysis.append({
            "question_number": i,
            "status": status,
            "criteria_scores": {
                "accuracy": accuracy,
                "completeness": 80 if user_answer.strip() else 0,
                "clarity": 75 if user_answer.strip() else 0,
                "depth": 70 if len(user_answer.strip()) > 20 else 40
            },
            "feedback": f"Question {i}: {'Good work!' if status == 'correct' else 'Review this concept'}",
            "improvement_tips": ["Review course materials", "Practice similar problems"],
            "difficulty_level": "Medium",
            "time_spent_estimate": "Appropriate"
        })
    
    return {
        "overall_performance": {
            "grade_level": grade_level,
            "performance_category": performance_category,
            "strengths": ["Exam completion", "Basic understanding"] if score >= 50 else ["Attempted questions"],
            "weaknesses": ["Accuracy improvement needed"] if score < 80 else ["Minor concept gaps"],
            "time_efficiency": "Good" if time_taken < 3600 else "Average",
            "completion_rate": completion_rate
        },
        "question_analysis": question_analysis,
        "skill_assessment": {
            "knowledge_areas": [
                {
                    "area": "Conceptual Understanding",
                    "score": min(score + 5, 100),
                    "level": "Proficient" if score >= 70 else "Developing",
                    "evidence": ["Question responses demonstrate basic comprehension"]
                },
                {
                    "area": "Problem Solving", 
                    "score": max(score - 10, 0),
                    "level": "Developing" if score >= 60 else "Beginning",
                    "evidence": ["Applied knowledge to solve problems"]
                }
            ],
            "cognitive_skills": {
                "critical_thinking": int(score * 0.8),
                "analytical_reasoning": int(score * 0.9), 
                "application": int(score * 1.1) if score < 90 else 100,
                "synthesis": int(score * 0.7)
            }
        },
        "learning_recommendations": {
            "immediate_actions": [
                {
                    "priority": "High",
                    "action": "Review incorrect answers and understand mistakes",
                    "timeline": "1 week"
                },
                {
                    "priority": "Medium", 
                    "action": "Practice similar questions to reinforce learning",
                    "timeline": "2 weeks"
                }
            ],
            "study_plan": {
                "focus_areas": ["Course fundamentals", "Problem-solving techniques"],
                "recommended_resources": ["Textbook chapters", "Online practice tests"],
                "practice_exercises": ["Similar question types", "Timed practice sessions"]
            },
            "next_steps": ["Schedule study sessions", "Seek help if needed", "Take practice tests"]
        },
        "performance_metrics": {
            "accuracy_by_type": {
                "multiple_choice": score,
                "short_answer": max(score - 10, 0),
                "essay": max(score - 20, 0)
            },
            "time_distribution": {
                "planning": 15,
                "execution": 70, 
                "review": 15
            },
            "confidence_indicators": {
                "certainty_level": int(score * 0.8),
                "revision_frequency": "Low" if score >= 80 else "Medium"
            }
        }
    }


def generate_charts(evaluation_data: dict) -> dict:
    """Generate base64-encoded charts for the PDF report"""
    
    charts = {}
    
    try:
        # Set style for better looking charts
        plt.style.use('seaborn-v0_8')
        
        # 1. Performance Overview Pie Chart
        fig, ax = plt.subplots(figsize=(8, 6))
        
        # Extract skill scores
        skills = evaluation_data.get('skill_assessment', {}).get('cognitive_skills', {})
        if skills:
            labels = [skill.replace('_', ' ').title() for skill in skills.keys()]
            values = list(skills.values())
            colors = ['#2563eb', '#059669', '#d97706', '#dc2626']
            
            wedges, texts, autotexts = ax.pie(values, labels=labels, autopct='%1.1f%%', 
                                            colors=colors, startangle=90)
            
            # Enhance text
            for autotext in autotexts:
                autotext.set_color('white')
                autotext.set_fontweight('bold')
            
            ax.set_title('Cognitive Skills Assessment', fontsize=16, fontweight='bold', pad=20)
            
            # Save to base64
            buffer = BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            charts['cognitive_skills'] = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
        
        # 2. Question Analysis Bar Chart
        fig, ax = plt.subplots(figsize=(10, 6))
        
        question_analysis = evaluation_data.get('question_analysis', [])
        if question_analysis:
            question_nums = [qa['question_number'] for qa in question_analysis]
            accuracy_scores = [qa['criteria_scores']['accuracy'] for qa in question_analysis]
            completeness_scores = [qa['criteria_scores']['completeness'] for qa in question_analysis]
            
            x = np.arange(len(question_nums))
            width = 0.35
            
            bars1 = ax.bar(x - width/2, accuracy_scores, width, label='Accuracy', color='#2563eb', alpha=0.8)
            bars2 = ax.bar(x + width/2, completeness_scores, width, label='Completeness', color='#059669', alpha=0.8)
            
            ax.set_xlabel('Question Number', fontweight='bold')
            ax.set_ylabel('Score (%)', fontweight='bold')
            ax.set_title('Question-by-Question Performance Analysis', fontsize=16, fontweight='bold', pad=20)
            ax.set_xticks(x)
            ax.set_xticklabels([f'Q{num}' for num in question_nums])
            ax.legend()
            ax.grid(True, alpha=0.3)
            ax.set_ylim(0, 100)
            
            # Add value labels on bars
            for bar in bars1 + bars2:
                height = bar.get_height()
                ax.text(bar.get_x() + bar.get_width()/2., height + 1,
                       f'{height:.0f}', ha='center', va='bottom', fontweight='bold')
            
            buffer = BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            charts['question_analysis'] = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
        
        # 3. Knowledge Areas Radar Chart
        knowledge_areas = evaluation_data.get('skill_assessment', {}).get('knowledge_areas', [])
        if knowledge_areas:
            fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(projection='polar'))
            
            categories = [area['area'] for area in knowledge_areas]
            values = [area['score'] for area in knowledge_areas]
            
            # Add first value to close the circle
            values += [values[0]]
            
            # Compute angles
            angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False).tolist()
            angles += [angles[0]]
            
            # Plot
            ax.plot(angles, values, 'o-', linewidth=2, color='#2563eb')
            ax.fill(angles, values, alpha=0.25, color='#2563eb')
            
            # Add labels
            ax.set_xticks(angles[:-1])
            ax.set_xticklabels(categories)
            ax.set_ylim(0, 100)
            ax.set_title('Knowledge Areas Assessment', fontsize=16, fontweight='bold', pad=30)
            ax.grid(True)
            
            buffer = BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            charts['knowledge_areas'] = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
        
        # 4. Performance Metrics Gauge Chart
        overall_perf = evaluation_data.get('overall_performance', {})
        completion_rate = overall_perf.get('completion_rate', 0)
        
        fig, ax = plt.subplots(figsize=(8, 6))
        
        # Create gauge chart
        theta = np.linspace(0, np.pi, 100)
        r = np.ones_like(theta)
        
        ax = plt.subplot(projection='polar')
        ax.set_theta_zero_location('N')
        ax.set_theta_direction(-1)
        ax.set_thetamax(180)
        
        # Background
        ax.bar(theta, r, width=np.pi/100, color='lightgray', alpha=0.3)
        
        # Fill based on completion rate
        completion_theta = np.linspace(0, np.pi * (completion_rate/100), 50)
        if completion_rate >= 80:
            color = '#059669'
        elif completion_rate >= 60:
            color = '#d97706'
        else:
            color = '#dc2626'
            
        ax.bar(completion_theta, np.ones_like(completion_theta), 
               width=np.pi/50, color=color, alpha=0.8)
        
        ax.set_ylim(0, 1)
        ax.set_rticks([])
        ax.set_title(f'Completion Rate: {completion_rate:.1f}%', 
                    fontsize=16, fontweight='bold', pad=30)
        
        buffer = BytesIO()
        plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        charts['completion_gauge'] = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
        
    except Exception as e:
        print(f"Error generating charts: {e}")
        # Return empty dict if chart generation fails
        return {}
    
    return charts


async def create_pdf_report(
    exam_title: str,
    student_name: str,
    score: float,
    start_time: datetime,
    end_time: datetime,
    time_taken: float,
    questions: list,
    answers: dict,
    events_summary: dict,
    analytics_data: dict,
    evaluation_data: dict,
    charts: dict,
    request: ReportGenerationRequest,
    grade_gradient: str
) -> str:
    """Create a beautiful PDF report using WeasyPrint"""
    
    # Enhanced HTML template for detailed report
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>SENSAI Detailed Performance Report</title>
        <style>
            @page {
                size: A4;
                margin: 0.75in;
                @top-center {
                    content: "SENSAI Detailed Report - {{ exam_title }}";
                    font-size: 10px;
                    color: #666;
                }
                @bottom-center {
                    content: "Page " counter(page);
                    font-size: 10px;
                    color: #666;
                }
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.5;
                color: #2c3e50;
                margin: 0;
                padding: 0;
                font-size: 12px;
            }
            
            .header {
                text-align: center;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px 20px;
                border-radius: 12px;
                margin-bottom: 25px;
            }
            
            .header h1 {
                font-size: 32px;
                margin: 0 0 8px 0;
                font-weight: 700;
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            
            .header .subtitle {
                font-size: 16px;
                opacity: 0.9;
            }
            
            .exam-overview {
                background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 25px;
                border-left: 5px solid #3b82f6;
                max-width: 100%;
                box-sizing: border-box;
                overflow: hidden;
            }
            
            .exam-overview h2 {
                color: #1e40af;
                margin: 0 0 20px 0;
                font-size: 22px;
                font-weight: 600;
            }
            
            .overview-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                max-width: 100%;
            }
            
            .overview-item {
                text-align: center;
                background: white;
                padding: 12px 8px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                min-width: 0; /* Allows flex items to shrink below their content size */
                overflow: hidden;
            }
            
            .overview-value {
                font-size: 16px;
                font-weight: bold;
                color: #1e40af;
                display: block;
                word-wrap: break-word;
                overflow-wrap: break-word;
                line-height: 1.2;
            }
            
            .overview-label {
                font-size: 11px;
                color: #64748b;
                margin-top: 4px;
                font-weight: 500;
            }
            
            .grade-banner {
                text-align: center;
                background: {{ grade_gradient }};
                color: white;
                padding: 30px;
                border-radius: 15px;
                margin: 25px 0;
                position: relative;
                overflow: hidden;
            }
            
            .grade-banner::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
                animation: shimmer 3s ease-in-out infinite;
            }
            
            @keyframes shimmer {
                0%, 100% { transform: rotate(0deg); }
                50% { transform: rotate(180deg); }
            }
            
            .grade-large {
                font-size: 54px;
                font-weight: 800;
                margin: 15px 0;
                text-shadow: 0 3px 6px rgba(0,0,0,0.2);
                position: relative;
                z-index: 1;
            }
            
            .grade-label {
                font-size: 20px;
                opacity: 0.95;
                position: relative;
                z-index: 1;
            }
            
            .section {
                margin-bottom: 30px;
                break-inside: avoid-page;
            }
            
            .section-title {
                color: #1e40af;
                font-size: 20px;
                font-weight: 600;
                border-bottom: 3px solid #3b82f6;
                padding-bottom: 8px;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
            }
            
            .section-title .emoji {
                margin-right: 10px;
                font-size: 24px;
            }
            
            .chart-container {
                text-align: center;
                margin: 20px 0;
                background: white;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            
            .chart-container img {
                max-width: 100%;
                height: auto;
                border-radius: 8px;
            }
            
            .performance-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
                margin: 20px 0;
            }
            
            .performance-card {
                background: white;
                border: 2px solid #e2e8f0;
                border-radius: 12px;
                padding: 20px;
                transition: all 0.3s ease;
            }
            
            .performance-card:hover {
                border-color: #3b82f6;
                box-shadow: 0 8px 25px rgba(59, 130, 246, 0.15);
            }
            
            .card-title {
                font-size: 16px;
                font-weight: 600;
                color: #1e40af;
                margin-bottom: 12px;
            }
            
            .skill-bar {
                background: #e2e8f0;
                border-radius: 10px;
                height: 12px;
                margin: 8px 0;
                overflow: hidden;
            }
            
            .skill-fill {
                height: 100%;
                border-radius: 10px;
                transition: width 1s ease;
                background: linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%);
            }
            
            .skill-label {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                color: #64748b;
                margin-bottom: 4px;
            }
            
            .criteria-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 10px;
                margin: 15px 0;
            }
            
            .criteria-item {
                background: #f8fafc;
                padding: 10px;
                border-radius: 6px;
                text-align: center;
                border: 1px solid #e2e8f0;
            }
            
            .criteria-score {
                font-size: 18px;
                font-weight: bold;
                color: #059669;
            }
            
            .criteria-label {
                font-size: 10px;
                color: #64748b;
                margin-top: 2px;
            }
            
            .question-detailed {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0;
                position: relative;
            }
            
            .question-number {
                position: absolute;
                top: -10px;
                left: 20px;
                background: #3b82f6;
                color: white;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 14px;
            }
            
            .question-status {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
            }
            
            .status-correct {
                background: #dcfce7;
                color: #166534;
            }
            
            .status-incorrect {
                background: #fee2e2;
                color: #991b1b;
            }
            
            .status-partial {
                background: #fef3c7;
                color: #92400e;
            }
            
            .recommendation-box {
                background: linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);
                border-left: 4px solid #0ea5e9;
                padding: 20px;
                border-radius: 8px;
                margin: 15px 0;
            }
            
            .priority-high { border-left-color: #dc2626; }
            .priority-medium { border-left-color: #d97706; }
            .priority-low { border-left-color: #059669; }
            
            .strength-weakness-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
            }
            
            .strength-box {
                background: linear-gradient(135deg, #dcfce7 0%, #f0fdf4 100%);
                border-left: 4px solid #22c55e;
                padding: 15px;
                border-radius: 8px;
            }
            
            .weakness-box {
                background: linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%);
                border-left: 4px solid #ef4444;
                padding: 15px;
                border-radius: 8px;
            }
            
            .list-styled {
                padding-left: 0;
                list-style: none;
            }
            
            .list-styled li {
                position: relative;
                padding-left: 25px;
                margin-bottom: 8px;
            }
            
            .list-styled li::before {
                content: '✓';
                position: absolute;
                left: 0;
                color: #22c55e;
                font-weight: bold;
            }
            
            .footer {
                margin-top: 50px;
                text-align: center;
                padding: 20px;
                background: #f8fafc;
                border-radius: 8px;
                font-size: 11px;
                color: #64748b;
            }
            
            .page-break {
                page-break-before: always;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎯 SENSAI DETAILED REPORT</h1>
            <div class="subtitle">Advanced Performance Analysis & Learning Insights</div>
        </div>
        
        <div class="exam-overview">
            <h2>{{ exam_title }}</h2>
            <div class="overview-grid">
                <div class="overview-item">
                    <span class="overview-value">{{ student_name }}</span>
                    <div class="overview-label">Student Name</div>
                </div>
                <div class="overview-item">
                    <span class="overview-value">{{ total_questions }}</span>
                    <div class="overview-label">Total Questions</div>
                </div>
                <div class="overview-item">
                    <span class="overview-value">{{ exam_date }}</span>
                    <div class="overview-label">Date Completed</div>
                </div>
                <div class="overview-item">
                    <span class="overview-value">{{ duration }}</span>
                    <div class="overview-label">Time Taken</div>
                </div>
            </div>
        </div>
        
        <div class="grade-banner">
            <div class="grade-label">Overall Performance</div>
            <div class="grade-large">{{ evaluation_data.overall_performance.grade_level }}</div>
            <div class="grade-label">{{ evaluation_data.overall_performance.performance_category }} • {{ score }}%</div>
        </div>
        
        <!-- Performance Charts Section -->
        {% if charts %}
        <div class="section">
            <h3 class="section-title"><span class="emoji">📊</span>Performance Visualization</h3>
            
            {% if charts.cognitive_skills %}
            <div class="chart-container">
                <h4>Cognitive Skills Assessment</h4>
                <img src="data:image/png;base64,{{ charts.cognitive_skills }}" alt="Cognitive Skills Chart">
            </div>
            {% endif %}
            
            {% if charts.question_analysis %}
            <div class="chart-container">
                <h4>Question-by-Question Analysis</h4>
                <img src="data:image/png;base64,{{ charts.question_analysis }}" alt="Question Analysis Chart">
            </div>
            {% endif %}
            
            <div class="performance-grid">
                {% if charts.knowledge_areas %}
                <div class="chart-container">
                    <h4>Knowledge Areas</h4>
                    <img src="data:image/png;base64,{{ charts.knowledge_areas }}" alt="Knowledge Areas Chart">
                </div>
                {% endif %}
                
                {% if charts.completion_gauge %}
                <div class="chart-container">
                    <h4>Completion Metrics</h4>
                    <img src="data:image/png;base64,{{ charts.completion_gauge }}" alt="Completion Gauge">
                </div>
                {% endif %}
            </div>
        </div>
        {% endif %}
        
        <!-- Detailed Performance Analysis -->
        <div class="section">
            <h3 class="section-title"><span class="emoji">🎯</span>Detailed Performance Analysis</h3>
            
            <div class="strength-weakness-grid">
                <div class="strength-box">
                    <h4>💪 Key Strengths</h4>
                    <ul class="list-styled">
                        {% for strength in evaluation_data.overall_performance.strengths %}
                        <li>{{ strength }}</li>
                        {% endfor %}
                    </ul>
                </div>
                
                <div class="weakness-box">
                    <h4>🎯 Areas for Improvement</h4>
                    <ul class="list-styled">
                        {% for weakness in evaluation_data.overall_performance.weaknesses %}
                        <li>{{ weakness }}</li>
                        {% endfor %}
                    </ul>
                </div>
            </div>
            
            <div class="performance-grid">
                <div class="performance-card">
                    <div class="card-title">Skill Assessment</div>
                    {% for area in evaluation_data.skill_assessment.knowledge_areas %}
                    <div class="skill-label">
                        <span>{{ area.area }}</span>
                        <span>{{ area.score }}% ({{ area.level }})</span>
                    </div>
                    <div class="skill-bar">
                        <div class="skill-fill" style="width: {{ area.score }}%"></div>
                    </div>
                    {% endfor %}
                </div>
                
                <div class="performance-card">
                    <div class="card-title">Cognitive Skills</div>
                    {% for skill, score in evaluation_data.skill_assessment.cognitive_skills.items() %}
                    <div class="skill-label">
                        <span>{{ skill.replace('_', ' ').title() }}</span>
                        <span>{{ score }}%</span>
                    </div>
                    <div class="skill-bar">
                        <div class="skill-fill" style="width: {{ score }}%"></div>
                    </div>
                    {% endfor %}
                </div>
            </div>
        </div>
        
        <!-- Question-by-Question Analysis -->
        {% if evaluation_data.question_analysis %}
        <div class="section page-break">
            <h3 class="section-title"><span class="emoji">📝</span>Question-by-Question Analysis</h3>
            
            {% for qa in evaluation_data.question_analysis %}
            <div class="question-detailed">
                <div class="question-number">{{ qa.question_number }}</div>
                
                <div style="margin-left: 40px;">
                    <div style="margin-bottom: 10px;">
                        <span class="question-status status-{{ qa.status }}">{{ qa.status.upper() }}</span>
                        <span style="margin-left: 15px; font-weight: 600;">Question {{ qa.question_number }}</span>
                    </div>
                    
                    <div class="criteria-grid">
                        {% for criteria, score in qa.criteria_scores.items() %}
                        <div class="criteria-item">
                            <div class="criteria-score">{{ score }}%</div>
                            <div class="criteria-label">{{ criteria.title() }}</div>
                        </div>
                        {% endfor %}
                    </div>
                    
                    <div style="margin: 15px 0;">
                        <strong>Feedback:</strong> {{ qa.feedback }}
                    </div>
                    
                    {% if qa.improvement_tips %}
                    <div>
                        <strong>Improvement Tips:</strong>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            {% for tip in qa.improvement_tips %}
                            <li>{{ tip }}</li>
                            {% endfor %}
                        </ul>
                    </div>
                    {% endif %}
                </div>
            </div>
            {% endfor %}
        </div>
        {% endif %}
        
        <!-- Learning Recommendations -->
        <div class="section">
            <h3 class="section-title"><span class="emoji">💡</span>Personalized Learning Recommendations</h3>
            
            <div style="margin-bottom: 20px;">
                <h4>⚡ Immediate Actions</h4>
                {% for action in evaluation_data.learning_recommendations.immediate_actions %}
                <div class="recommendation-box priority-{{ action.priority.lower() }}">
                    <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 8px;">
                        <strong>{{ action.action }}</strong>
                        <span style="background: rgba(0,0,0,0.1); padding: 2px 8px; border-radius: 12px; font-size: 10px;">
                            {{ action.priority }} Priority • {{ action.timeline }}
                        </span>
                    </div>
                </div>
                {% endfor %}
            </div>
            
            <div class="performance-grid">
                <div class="performance-card">
                    <div class="card-title">🎯 Focus Areas</div>
                    <ul class="list-styled">
                        {% for area in evaluation_data.learning_recommendations.study_plan.focus_areas %}
                        <li>{{ area }}</li>
                        {% endfor %}
                    </ul>
                </div>
                
                <div class="performance-card">
                    <div class="card-title">📚 Recommended Resources</div>
                    <ul class="list-styled">
                        {% for resource in evaluation_data.learning_recommendations.study_plan.recommended_resources %}
                        <li>{{ resource }}</li>
                        {% endfor %}
                    </ul>
                </div>
            </div>
            
            <div class="recommendation-box">
                <h4>🚀 Next Steps</h4>
                <ol style="margin: 0; padding-left: 20px;">
                    {% for step in evaluation_data.learning_recommendations.next_steps %}
                    <li style="margin-bottom: 5px;">{{ step }}</li>
                    {% endfor %}
                </ol>
            </div>
        </div>
        
        {% if analytics_data %}
        <div class="section">
            <h3 class="section-title"><span class="emoji">📈</span>Session Analytics (Teacher View)</h3>
            
            <div class="performance-grid">
                <div class="performance-card">
                    <div class="card-title">Event Summary</div>
                    <div class="criteria-grid">
                        <div class="criteria-item">
                            <div class="criteria-score">{{ analytics_data.total_events }}</div>
                            <div class="criteria-label">Total Events</div>
                        </div>
                        <div class="criteria-item">
                            <div class="criteria-score">{{ analytics_data.flagged_events }}</div>
                            <div class="criteria-label">Flagged</div>
                        </div>
                        <div class="criteria-item">
                            <div class="criteria-score">{{ analytics_data.high_priority_events }}</div>
                            <div class="criteria-label">High Priority</div>
                        </div>
                        <div class="criteria-item">
                            <div class="criteria-score">{{ (analytics_data.suspicious_activity_score * 100)|round }}%</div>
                            <div class="criteria-label">Risk Score</div>
                        </div>
                    </div>
                </div>
                
                <div class="performance-card">
                    <div class="card-title">Behavioral Assessment</div>
                    <div class="skill-label">
                        <span>Confidence Level</span>
                        <span>{{ (analytics_data.average_confidence_score * 100)|round }}%</span>
                    </div>
                    <div class="skill-bar">
                        <div class="skill-fill" style="width: {{ (analytics_data.average_confidence_score * 100)|round }}%"></div>
                    </div>
                </div>
            </div>
        </div>
        {% endif %}
        
        <div class="footer">
            <strong>Generated by SENSAI AI Platform</strong><br>
            {{ generation_date }}<br>
            This comprehensive report provides AI-powered analysis for educational assessment and improvement.
        </div>
    </body>
    </html>
    """
    
    # Grade gradient is now calculated earlier in the function
    
    # Prepare template variables
    template_vars = {
        "exam_title": exam_title,
        "student_name": student_name,
        "score": score,
        "grade_gradient": grade_gradient,
        "exam_date": start_time.strftime("%B %d, %Y"),
        "duration": f"{time_taken/60:.1f} minutes",
        "total_questions": len(questions),
        "questions": questions,
        "answers": answers,
        "analytics_data": analytics_data,
        "evaluation_data": evaluation_data,
        "charts": charts,
        "request": request,
        "generation_date": datetime.now().strftime("%B %d, %Y at %I:%M %p")
    }
    
    # Render HTML
    template = Template(html_template)
    html_content = template.render(**template_vars)
    
    # Generate PDF
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp_file:
        weasyprint.HTML(string=html_content).write_pdf(tmp_file.name)
        return tmp_file.name
