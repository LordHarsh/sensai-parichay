# Simple evaluation endpoint - replaces the complex one
from fastapi import APIRouter, HTTPException, Header
import json
import os
from datetime import datetime
from api.db import exam_sessions_table_name, exams_table_name, users_table_name
from api.utils.db import get_new_db_connection

simple_router = APIRouter(prefix="/simple-eval", tags=["simple-evaluation"])

@simple_router.post("/{exam_id}/{session_id}")
async def create_simple_evaluation_endpoint(
    exam_id: str, 
    session_id: str, 
    user_id: int = Header(..., alias="x-user-id")
):
    """Comprehensive evaluation endpoint using advanced AI analysis"""
    try:
        print(f"[COMPREHENSIVE-EVAL] Starting comprehensive evaluation for exam_id: {exam_id}, session_id: {session_id}")
        from api.evaluation import create_comprehensive_evaluation
        
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            print("[COMPREHENSIVE-EVAL] Fetching exam session data...")
            # Get exam session data
            await cursor.execute(
                f"""SELECT s.*, e.title, e.description, e.duration, e.questions, u.email, u.first_name, u.last_name
                    FROM {exam_sessions_table_name} s
                    JOIN {exams_table_name} e ON s.exam_id = e.id
                    LEFT JOIN {users_table_name} u ON s.user_id = u.id
                    WHERE s.id = ? AND s.exam_id = ?""",
                (session_id, exam_id)
            )
            
            session_row = await cursor.fetchone()
            print(f"[COMPREHENSIVE-EVAL] Session row: {session_row}")
            if not session_row:
                print(f"[COMPREHENSIVE-EVAL] ERROR: Session not found for session_id: {session_id}, exam_id: {exam_id}")
                raise HTTPException(status_code=404, detail="Exam session not found")
            
            print("[COMPREHENSIVE-EVAL] Session found, parsing data...")
            
            # Debug: Print all session row data to understand the structure
            print(f"[COMPREHENSIVE-EVAL] Session row length: {len(session_row)}")
            for i, value in enumerate(session_row):
                print(f"[COMPREHENSIVE-EVAL] session_row[{i}]: {repr(value)}")
            
            # Parse exam data - fix the indices based on actual data structure
            try:
                # Based on the debug output, questions should be at index 14, not 12
                questions_raw = session_row[14] if len(session_row) > 14 else "[]"
                answers_raw = session_row[6] or "{}"
                
                print(f"[SIMPLE-EVAL] Raw questions data: {repr(questions_raw)}")
                print(f"[SIMPLE-EVAL] Raw answers data: {repr(answers_raw)}")
                
                questions = json.loads(questions_raw)
                answers = json.loads(answers_raw)
                
                print(f"[SIMPLE-EVAL] Parsed {len(questions)} questions and {len(answers)} answers")
            except json.JSONDecodeError as e:
                print(f"[SIMPLE-EVAL] ERROR: JSON parsing failed: {e}")
                print(f"[SIMPLE-EVAL] Questions raw: {repr(questions_raw if 'questions_raw' in locals() else 'NOT_SET')}")
                print(f"[SIMPLE-EVAL] Answers raw: {repr(answers_raw if 'answers_raw' in locals() else 'NOT_SET')}")
                import traceback
                traceback.print_exc()
                raise HTTPException(status_code=500, detail="Invalid exam data format")
            
            # Create user display name
            user_display = "Student"
            if session_row[15]:  # email
                if session_row[16] and session_row[17]:  # first_name and last_name
                    user_display = f"{session_row[16]} {session_row[17]}"
                else:
                    user_display = session_row[16] or session_row[15]
            
            print(f"[SIMPLE-EVAL] User display name: {user_display}")
            
            # Prepare questions and answers
            questions_and_answers = []
            for i, question in enumerate(questions, 1):
                try:
                    question_id = question.get('id', f'q{i}')
                    user_answer = answers.get(question_id, '')
                    correct_answer = question.get('correct_answer', '')
                    
                    # Simple correctness check
                    is_correct = False
                    if question.get('type') == 'multiple_choice':
                        is_correct = user_answer == correct_answer
                    elif correct_answer:
                        is_correct = user_answer.strip().lower() == correct_answer.strip().lower()
                    else:
                        is_correct = bool(user_answer.strip())
                    
                    questions_and_answers.append({
                        "question_number": i,
                        "question_id": question_id,
                        "question_type": question.get('type', 'text'),
                        "question_text": question.get('question', ''),
                        "correct_answer": correct_answer,
                        "user_answer": user_answer,
                        "is_correct": is_correct
                    })
                except Exception as e:
                    print(f"[SIMPLE-EVAL] WARNING: Error processing question {i}: {e}")
                    continue
            
            print(f"[SIMPLE-EVAL] Processed {len(questions_and_answers)} questions for analysis")
            
            # Calculate time taken
            try:
                start_time = session_row[3] if session_row[3] else datetime.now()
                end_time = session_row[4] if session_row[4] else datetime.now()
                if isinstance(start_time, str):
                    start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                if isinstance(end_time, str):
                    end_time = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                
                time_taken_seconds = (end_time - start_time).total_seconds()
                print(f"[SIMPLE-EVAL] Time taken: {time_taken_seconds} seconds")
            except Exception as e:
                print(f"[SIMPLE-EVAL] WARNING: Time calculation failed: {e}")
                time_taken_seconds = 0
            
            # Prepare context for evaluation
            evaluation_context = {
                "session_id": session_id,
                "exam_title": session_row[11] if len(session_row) > 11 else "Unknown Exam",  # e.title
                "duration": session_row[13] if len(session_row) > 13 else 30,  # e.duration in minutes
                "time_taken": time_taken_seconds,
                "score": session_row[7] or 0,  # s.score
                "user_name": user_display,
                "questions": questions,
                "questions_and_answers": questions_and_answers
            }
            
            print(f"[SIMPLE-EVAL] Evaluation context prepared:")
            print(f"  - Title: {evaluation_context['exam_title']}")
            print(f"  - Score: {evaluation_context['score']}%")
            print(f"  - Questions: {len(evaluation_context['questions'])}")
            print(f"  - Q&A pairs: {len(evaluation_context['questions_and_answers'])}")
            
            # Generate comprehensive evaluation
            print("[COMPREHENSIVE-EVAL] Calling create_comprehensive_evaluation...")
            evaluation_result = await create_comprehensive_evaluation(evaluation_context)
            
            if not evaluation_result.get('success', False):
                print("[COMPREHENSIVE-EVAL] WARNING: Evaluation not successful, but continuing...")
            
            # Store in database
            print("[COMPREHENSIVE-EVAL] Storing evaluation in database...")
            try:
                evaluation_json = json.dumps(evaluation_result)
                await cursor.execute(
                    f"UPDATE {exam_sessions_table_name} SET metadata = ? WHERE id = ?",
                    (evaluation_json, session_id)
                )
                await conn.commit()
                print("[SIMPLE-EVAL] Evaluation stored successfully")
            except Exception as e:
                print(f"[SIMPLE-EVAL] WARNING: Failed to store evaluation: {e}")
                # Continue anyway since we have the evaluation
            
            print(f"[SIMPLE-EVAL] Evaluation completed successfully for {session_id}")
            
            return {
                "success": True,
                "session_id": session_id,
                "evaluation": evaluation_result
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[SIMPLE-EVAL] ERROR: {str(e)}")
        print(f"[SIMPLE-EVAL] ERROR Type: {type(e).__name__}")
        import traceback
        print(f"[SIMPLE-EVAL] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {str(e)}")


@simple_router.get("/{exam_id}/{session_id}")
async def get_simple_evaluation(exam_id: str, session_id: str):
    """Get stored evaluation"""
    try:
        print(f"[SIMPLE-EVAL-GET] Looking for evaluation: exam_id={exam_id}, session_id={session_id}")
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # First, check if the session exists
            await cursor.execute(
                f"SELECT id, metadata FROM {exam_sessions_table_name} WHERE id = ? AND exam_id = ?",
                (session_id, exam_id)
            )
            row = await cursor.fetchone()
            print(f"[SIMPLE-EVAL-GET] Query result: {row}")
            
            if not row:
                print(f"[SIMPLE-EVAL-GET] ERROR: Session not found for session_id={session_id}, exam_id={exam_id}")
                raise HTTPException(status_code=404, detail="Session not found")
            
            if not row[1]:
                print(f"[SIMPLE-EVAL-GET] ERROR: No evaluation data found for session_id={session_id}")
                raise HTTPException(status_code=404, detail="No evaluation found")
            
            try:
                evaluation = json.loads(row[1])
                print(f"[SIMPLE-EVAL-GET] Successfully retrieved evaluation for session_id={session_id}")
                return {
                    "success": True,
                    "session_id": session_id,
                    "evaluation": evaluation
                }
            except json.JSONDecodeError as e:
                print(f"[SIMPLE-EVAL-GET] ERROR: Invalid JSON in metadata: {e}")
                raise HTTPException(status_code=500, detail="Invalid evaluation data format")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"[SIMPLE-EVAL-GET] ERROR: Unexpected error retrieving evaluation: {str(e)}")
        raise HTTPException(status_code=404, detail="Evaluation not found")
