from fastapi import APIRouter, HTTPException, Depends, Query, Header
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
from datetime import datetime
from api.models import (
    CreateExamRequest,
    ExamSubmissionRequest, 
    ExamConfiguration,
    ExamSession,
    ExamQuestion,
    ExamTimelineEvent,
    ExamAnalytics,
    ExamEvaluationRequest,
    ExamEvaluationReport
)
from api.utils.db import get_new_db_connection
from api.utils.event_scoring import EventScorer
from api.config import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name
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
                            'active',
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
            
        return {"message": "Exam submitted successfully", "score": score, "session_id": existing_session_id}
        
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
