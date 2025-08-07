#!/usr/bin/env python3
"""
Demo script to create sample exam data for testing
"""
import asyncio
import json
import uuid
import sys
import os
from datetime import datetime

# Add the src directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from api.db import init_db
from api.config import exams_table_name
from api.utils.db import get_new_db_connection

async def create_demo_exams():
    """Create demo exam configurations for testing"""
    
    # Sample exam 1: Programming Quiz
    programming_exam = {
        "id": str(uuid.uuid4()),
        "title": "JavaScript Programming Assessment",
        "description": "A comprehensive assessment covering JavaScript fundamentals, ES6 features, and problem-solving skills.",
        "duration": 45,  # minutes
        "questions": [
            {
                "id": "q1",
                "type": "multiple_choice",
                "question": "Which of the following is the correct way to declare a constant in JavaScript?",
                "options": [
                    "const myVar = 10;",
                    "constant myVar = 10;", 
                    "let myVar = 10;",
                    "var myVar = 10;"
                ],
                "correct_answer": "const myVar = 10;",
                "points": 2
            },
            {
                "id": "q2", 
                "type": "code",
                "question": "Write a function that takes an array of numbers and returns the sum of all even numbers.",
                "points": 5,
                "metadata": {"language": "javascript"}
            },
            {
                "id": "q3",
                "type": "multiple_choice", 
                "question": "What will console.log(typeof null) output?",
                "options": [
                    "null",
                    "undefined",
                    "object",
                    "boolean"
                ],
                "correct_answer": "object",
                "points": 2
            },
            {
                "id": "q4",
                "type": "text",
                "question": "Explain the difference between == and === operators in JavaScript.",
                "points": 3
            },
            {
                "id": "q5",
                "type": "essay",
                "question": "Discuss the concept of closures in JavaScript. Provide an example and explain how they can be useful in real-world scenarios.",
                "points": 8
            }
        ],
        "settings": {
            "allow_tab_switch": False,
            "max_tab_switches": 2,
            "allow_copy_paste": False,
            "require_camera": True,
            "require_microphone": True,
            "fullscreen_required": True,
            "auto_submit": True,
            "shuffle_questions": False,
            "show_timer": True
        },
        "monitoring": {
            "video_recording": True,
            "audio_recording": True,
            "screen_recording": False,
            "keystroke_logging": True,
            "mouse_tracking": True,
            "face_detection": True,
            "gaze_tracking": False,
            "network_monitoring": True
        }
    }

    # Sample exam 2: General Knowledge Quiz
    general_exam = {
        "id": str(uuid.uuid4()),
        "title": "General Knowledge Assessment",
        "description": "A quick assessment covering various topics including science, history, and current affairs.",
        "duration": 20,
        "questions": [
            {
                "id": "g1",
                "type": "multiple_choice",
                "question": "What is the capital of Australia?",
                "options": [
                    "Sydney",
                    "Melbourne", 
                    "Canberra",
                    "Perth"
                ],
                "correct_answer": "Canberra",
                "points": 1
            },
            {
                "id": "g2",
                "type": "multiple_choice",
                "question": "Which planet is known as the Red Planet?",
                "options": [
                    "Venus",
                    "Mars",
                    "Jupiter",
                    "Saturn"
                ],
                "correct_answer": "Mars",
                "points": 1
            },
            {
                "id": "g3",
                "type": "text",
                "question": "Name the longest river in the world.",
                "correct_answer": "Nile River",
                "points": 2
            },
            {
                "id": "g4",
                "type": "multiple_choice",
                "question": "In what year did World War II end?",
                "options": [
                    "1944",
                    "1945",
                    "1946", 
                    "1947"
                ],
                "correct_answer": "1945",
                "points": 1
            },
            {
                "id": "g5",
                "type": "text",
                "question": "What is the chemical symbol for gold?",
                "correct_answer": "Au",
                "points": 1
            }
        ],
        "settings": {
            "allow_tab_switch": True,
            "max_tab_switches": 5,
            "allow_copy_paste": False,
            "require_camera": True,
            "require_microphone": False,
            "fullscreen_required": False,
            "auto_submit": True,
            "shuffle_questions": True,
            "show_timer": True
        },
        "monitoring": {
            "video_recording": True,
            "audio_recording": False,
            "screen_recording": False,
            "keystroke_logging": False,
            "mouse_tracking": False,
            "face_detection": True,
            "gaze_tracking": False,
            "network_monitoring": False
        }
    }

    # Sample exam 3: Math Problem Solving
    math_exam = {
        "id": str(uuid.uuid4()),
        "title": "Mathematics Problem Solving",
        "description": "Advanced mathematical problems testing analytical and problem-solving skills.",
        "duration": 60,
        "questions": [
            {
                "id": "m1",
                "type": "text",
                "question": "Solve for x: 2x + 5 = 17",
                "correct_answer": "6",
                "points": 3
            },
            {
                "id": "m2",
                "type": "essay",
                "question": "Explain the Pythagorean theorem and provide a practical example of its application.",
                "points": 5
            },
            {
                "id": "m3",
                "type": "multiple_choice",
                "question": "What is the derivative of x²?",
                "options": [
                    "x",
                    "2x",
                    "x²/2",
                    "2x²"
                ],
                "correct_answer": "2x",
                "points": 2
            },
            {
                "id": "m4",
                "type": "text",
                "question": "If a triangle has sides of length 3, 4, and 5, what type of triangle is it?",
                "correct_answer": "Right triangle",
                "points": 2
            },
            {
                "id": "m5",
                "type": "essay",
                "question": "Describe the relationship between exponential and logarithmic functions. Include graphs or examples to support your explanation.",
                "points": 8
            }
        ],
        "settings": {
            "allow_tab_switch": False,
            "max_tab_switches": 1,
            "allow_copy_paste": False,
            "require_camera": True,
            "require_microphone": True,
            "fullscreen_required": True,
            "auto_submit": True,
            "shuffle_questions": False,
            "show_timer": True
        },
        "monitoring": {
            "video_recording": True,
            "audio_recording": True,
            "screen_recording": False,
            "keystroke_logging": True,
            "mouse_tracking": True,
            "face_detection": True,
            "gaze_tracking": True,
            "network_monitoring": True
        }
    }

    exams = [programming_exam, general_exam, math_exam]

    async with get_new_db_connection() as conn:
        cursor = await conn.cursor()
        
        for exam in exams:
            await cursor.execute(
                f"""INSERT OR REPLACE INTO {exams_table_name} 
                    (id, title, description, duration, questions, settings, monitoring, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    exam["id"],
                    exam["title"],
                    exam["description"], 
                    exam["duration"],
                    json.dumps(exam["questions"]),
                    json.dumps(exam["settings"]),
                    json.dumps(exam["monitoring"]),
                    datetime.now(),
                    datetime.now()
                )
            )
            print(f"Created exam: {exam['title']} (ID: {exam['id']})")
        
        await conn.commit()
        print("Demo exams created successfully!")

async def main():
    """Main function to set up demo data"""
    print("Setting up demo exam data...")
    
    # Initialize database first
    print("Database initialized.")
    
    # Create demo exams
    await create_demo_exams()
    
    print("\nDemo setup complete!")
    print("\nAvailable demo exams:")
    
    async with get_new_db_connection() as conn:
        cursor = await conn.cursor()
        await cursor.execute(f"SELECT id, title, duration FROM {exams_table_name}")
        
        async for row in cursor:
            print(f"  - {row[1]} ({row[2]} minutes) - ID: {row[0]}")

if __name__ == "__main__":
    asyncio.run(main())
