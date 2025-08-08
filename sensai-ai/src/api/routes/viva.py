from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Dict, Optional
import json
from api.utils.db import get_new_db_connection
from api.db import surprise_viva_questions_table_name

router = APIRouter()

class VivaSubmission(BaseModel):
    session_id: str
    answers: Dict[str, str]

@router.post("/surprise-viva/submit")
async def submit_surprise_viva(
    submission: VivaSubmission,
    x_user_id: Optional[str] = Header(None)
):
    """Submit surprise viva answers and calculate score"""
    try:
        if not x_user_id:
            raise HTTPException(status_code=401, detail="User ID required")
        
        session_id = submission.session_id
        answers = submission.answers
        
        # Get viva questions for this session
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Get all viva questions for this session
            await cursor.execute(
                f"""SELECT id, question_text, expected_answer, confidence_score 
                   FROM {surprise_viva_questions_table_name} 
                   WHERE session_id = ?""",
                (session_id,)
            )
            questions = await cursor.fetchall()
        
        if not questions:
            raise HTTPException(status_code=404, detail="No viva questions found for this session")
        
        # Calculate score (simple scoring for now)
        total_questions = len(questions)
        total_score = 0.0
        
        for question in questions:
            question_id = str(question[0])  # viva_id as string
            expected_answer = question[2]
            confidence_score = question[3]
            
            user_answer = answers.get(question_id, "").strip().lower()
            expected_lower = expected_answer.lower()
            
            # Simple scoring based on keyword matching
            if user_answer and expected_lower:
                # Basic keyword matching - count common words
                user_words = set(user_answer.split())
                expected_words = set(expected_lower.split())
                
                if len(expected_words) > 0:
                    common_words = user_words.intersection(expected_words)
                    similarity = len(common_words) / len(expected_words)
                    question_score = similarity * confidence_score * 10  # Scale to 10
                    total_score += question_score
        
        # Average score out of 10
        final_score = total_score / total_questions if total_questions > 0 else 0
        
        # Store the submission result
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # You might want to create a viva_submissions table later
            # For now, just return the score
            pass
        
        return {
            "success": True,
            "session_id": session_id,
            "score": final_score,
            "total_questions": total_questions,
            "message": f"Viva completed with score {final_score:.1f}/10"
        }
        
    except Exception as e:
        print(f"Error submitting viva: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to submit viva: {str(e)}")
