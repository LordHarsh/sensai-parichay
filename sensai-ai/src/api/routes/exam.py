from fastapi import APIRouter, HTTPException, Depends, Query
from api.db import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name
)
from typing import List, Optional
import json
import uuid
from datetime import datetime
from api.models import (
    CreateExamRequest,
    ExamSubmissionRequest, 
    ExamConfiguration,
    ExamSession,
    ExamQuestion
)
from api.utils.db import get_new_db_connection
from api.config import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name
)

router = APIRouter(prefix="/exam", tags=["exam"])


@router.post("/", response_model=dict)
async def create_exam(exam_request: CreateExamRequest):
    try:
        exam_id = str(uuid.uuid4())
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Create exam configuration
            await cursor.execute(
                f"""INSERT INTO {exams_table_name} 
                    (id, title, description, duration, questions, settings, monitoring, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    exam_id,
                    exam_request.title,
                    exam_request.description,
                    exam_request.duration,
                    json.dumps([q.dict() for q in exam_request.questions]),
                    json.dumps(exam_request.settings),
                    json.dumps(exam_request.monitoring),
                    datetime.now(),
                    datetime.now()
                )
            )
            
            await conn.commit()
            
        return {"id": exam_id, "message": "Exam created successfully"}
        
    except Exception as e:
        print(f"Error creating exam: {e}")
        raise HTTPException(status_code=500, detail="Failed to create exam")


@router.get("/{exam_id}", response_model=dict)
async def get_exam(exam_id: str):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""SELECT id, title, description, duration, questions, settings, monitoring, created_at, updated_at
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
                "updated_at": row[8]
            }
            
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
async def submit_exam(exam_id: str, submission: ExamSubmissionRequest, user_id: str = Query(...)):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Find active session
            await cursor.execute(
                f"""SELECT id FROM {exam_sessions_table_name}
                    WHERE exam_id = ? AND user_id = ? AND status IN ('active', 'pending')""",
                (exam_id, user_id)
            )
            
            session_row = await cursor.fetchone()
            if not session_row:
                # Create a new session automatically if none exists
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
                        'active',
                        json.dumps({}),
                        datetime.now(),
                        datetime.now()
                    )
                )
            else:
                session_id = session_row[0]
            
            # Calculate score (basic implementation)
            score = await calculate_exam_score(exam_id, submission.answers, cursor)
            
            # Update session
            await cursor.execute(
                f"""UPDATE {exam_sessions_table_name}
                    SET end_time = ?, status = 'completed', answers = ?, score = ?, updated_at = ?
                    WHERE id = ?""",
                (datetime.now(), json.dumps(submission.answers), score, datetime.now(), session_id)
            )
            
            await conn.commit()
            
        return {"message": "Exam submitted successfully", "score": score, "session_id": session_id}
        
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
            
            await cursor.execute(
                f"""SELECT id, user_id, start_time, end_time, status, score, created_at
                    FROM {exam_sessions_table_name}
                    WHERE exam_id = ?
                    ORDER BY created_at DESC""",
                (exam_id,)
            )
            
            sessions = []
            async for row in cursor:
                sessions.append({
                    "id": row[0],
                    "user_id": row[1], 
                    "start_time": row[2],
                    "end_time": row[3],
                    "status": row[4],
                    "score": row[5],
                    "created_at": row[6]
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
            
            # Get video file info - for now just set basic info
            video_info = {"has_recording": True, "chunk_count": 0, "total_size": 0}
            
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
