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
    ExamAnalytics
)
from api.utils.db import get_new_db_connection
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
            
            # Join with users table to get user information and count events
            await cursor.execute(
                f"""SELECT 
                    s.id, 
                    s.user_id, 
                    u.email,
                    u.first_name,
                    u.last_name,
                    s.start_time, 
                    s.end_time, 
                    s.status, 
                    s.score, 
                    s.created_at,
                    COUNT(e.id) as event_count
                    FROM {exam_sessions_table_name} s
                    LEFT JOIN {users_table_name} u ON s.user_id = u.id
                    LEFT JOIN {exam_events_table_name} e ON s.id = e.session_id
                    WHERE s.exam_id = ?
                    GROUP BY s.id, s.user_id, u.email, u.first_name, u.last_name, s.start_time, s.end_time, s.status, s.score, s.created_at
                    ORDER BY s.created_at DESC""",
                (exam_id,)
            )
            
            sessions = []
            async for row in cursor:
                # Create user display name: prefer "FirstName LastName", fallback to email
                user_display = "Unknown User"
                if row[2]:  # email exists
                    if row[3] and row[4]:  # first_name and last_name exist
                        user_display = f"{row[3]} {row[4]}"
                    elif row[3]:  # only first_name exists
                        user_display = row[3]
                    else:
                        user_display = row[2]  # fallback to email
                
                sessions.append({
                    "id": row[0],
                    "user_id": row[1], 
                    "user_display": user_display,
                    "user_email": row[2],
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
                
                # Calculate priority and flagging based on event type
                priority = 1
                confidence_score = 0.5
                is_flagged = False
                
                # Define suspicious activities with priority and confidence
                if event_type == 'tab_switch':
                    priority = 3
                    confidence_score = 0.9
                    is_flagged = True
                    flagged_events += 1
                    high_priority_events += 1
                elif event_type == 'copy_paste':
                    priority = 3
                    confidence_score = 0.8
                    is_flagged = True
                    flagged_events += 1
                    high_priority_events += 1
                elif event_type == 'rapid_paste_burst':
                    priority = 3
                    confidence_score = 0.95
                    is_flagged = True
                    flagged_events += 1
                    high_priority_events += 1
                elif event_type == 'content_similarity':
                    similarity_score = event_data.get('similarity_score', 0)
                    priority = 3 if similarity_score > 0.7 else 2
                    confidence_score = similarity_score
                    is_flagged = similarity_score > 0.5
                    if is_flagged:
                        flagged_events += 1
                        if priority == 3:
                            high_priority_events += 1
                elif event_type == 'writing_style_drift':
                    style_similarity = event_data.get('similarity_score', 0)
                    priority = 2 if style_similarity < 0.3 else 1
                    confidence_score = 1.0 - style_similarity  # Lower similarity = higher suspicion
                    is_flagged = style_similarity < 0.4
                    if is_flagged:
                        flagged_events += 1
                elif event_type == 'typing_pattern_anomaly':
                    anomaly_confidence = event_data.get('confidence', 0)
                    priority = 2
                    confidence_score = anomaly_confidence
                    is_flagged = anomaly_confidence > 0.7
                    if is_flagged:
                        flagged_events += 1
                elif event_type == 'wpm_tracking':
                    # WPM events are informational, not flagged
                    priority = 1
                    confidence_score = 0.5
                    is_flagged = False
                elif event_type == 'keystroke_anomaly':
                    priority = 2
                    confidence_score = 0.7
                    is_flagged = True
                    flagged_events += 1
                elif event_type == 'window_focus_lost':
                    priority = 2
                    confidence_score = 0.6
                    is_flagged = True
                    flagged_events += 1
                elif event_type == 'face_not_detected':
                    priority = 2
                    confidence_score = 0.7
                    is_flagged = True
                    flagged_events += 1
                
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
            
            # Calculate analytics
            avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0
            suspicious_score = min(1.0, flagged_events / max(total_events, 1) * 2)  # Scale suspicious activity
            
            analytics = ExamAnalytics(
                session_id=session_id,
                total_events=total_events,
                flagged_events=flagged_events,
                high_priority_events=high_priority_events,
                average_confidence_score=avg_confidence,
                suspicious_activity_score=suspicious_score,
                timeline_events=events,
                step_timeline=step_timeline  # Add step-by-step timeline
            )
            
            return analytics
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching exam analytics: {e}")
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
