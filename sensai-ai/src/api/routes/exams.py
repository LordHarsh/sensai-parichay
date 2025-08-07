from fastapi import APIRouter, HTTPException
from api.db import exams_table_name
import json
from api.utils.db import get_new_db_connection

router = APIRouter(prefix="/api/exams", tags=["exams"])

@router.get("/", response_model=dict)
async def list_exams():
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""SELECT id, title, description, duration, questions, created_at
                    FROM {exams_table_name}
                    ORDER BY created_at DESC"""
            )
            
            exams = []
            async for row in cursor:
                exam_data = {
                    "id": row[0],
                    "title": row[1],
                    "description": row[2],
                    "duration": row[3],
                    "questions": json.loads(row[4]),
                    "created_at": row[5]
                }
                exams.append(exam_data)
            
            return {"exams": exams}
            
    except Exception as e:
        print(f"Error fetching exams: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch exams")
