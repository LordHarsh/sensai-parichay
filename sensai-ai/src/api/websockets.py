from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from fastapi.routing import APIRouter
from fastapi.websockets import WebSocketState
import json
import base64
import os
import uuid
import asyncio
from datetime import datetime
from api.models import (
    ExamEventMessage, 
    VideoDataMessage, 
    VideoControlMessage, 
    WebSocketMessage
)
from api.config import data_root_dir
from api.utils.db import get_new_db_connection
from api.utils.event_scoring import EventScorer
from api.llm import generate_surprise_viva_questions
from api.settings import settings
from api.db import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name,
    surprise_viva_questions_table_name
)

router = APIRouter()

# Helper function to safely send WebSocket messages
async def safe_send_json(websocket: WebSocket, data: dict):
    """Safely send JSON data through WebSocket, checking connection state first"""
    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_json(data)
        else:
            print(f"WebSocket not connected, cannot send message: {data.get('type', 'unknown')}")
    except Exception as e:
        print(f"Error sending WebSocket message: {e}")


# WebSocket connection manager to handle multiple client connections
class ConnectionManager:
    def __init__(self):
        # Dictionary to store WebSocket connections by course_id
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, course_id: int):
        await websocket.accept()
        if course_id not in self.active_connections:
            self.active_connections[course_id] = set()
        self.active_connections[course_id].add(websocket)

    def disconnect(self, websocket: WebSocket, course_id: int):
        if course_id in self.active_connections:
            self.active_connections[course_id].discard(websocket)
            if not self.active_connections[course_id]:
                del self.active_connections[course_id]

    async def send_item_update(self, course_id: int, item_data: Dict):
        if course_id in self.active_connections:
            disconnected_websockets = set()
            for websocket in self.active_connections[course_id]:
                try:
                    await websocket.send_json(item_data)
                except Exception as exception:
                    print(exception)

                    # Mark for removal if sending fails
                    disconnected_websockets.add(websocket)

            # Remove disconnected websockets
            for websocket in disconnected_websockets:
                self.disconnect(websocket, course_id)


# Create a connection manager instance
manager = ConnectionManager()


# WebSocket endpoint for course generation updates
@router.websocket("/course/{course_id}/generation")
async def websocket_course_generation(websocket: WebSocket, course_id: int):
    try:
        await manager.connect(websocket, course_id)

        # Keep the connection alive until client disconnects
        while True:
            # Wait for any message from the client to detect disconnection
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, course_id)


# Function to get the connection manager instance
def get_manager() -> ConnectionManager:
    return manager


# Exam WebSocket connection manager
class ExamConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str, user_id: str):
        # Don't accept here - it should be accepted in the main handler
        if session_id not in self.active_connections:
            self.active_connections[session_id] = {}
        self.active_connections[session_id][user_id] = websocket

    def disconnect(self, session_id: str, user_id: str):
        if session_id in self.active_connections:
            if user_id in self.active_connections[session_id]:
                del self.active_connections[session_id][user_id]
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def send_to_session(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            disconnected_users = []
            for user_id, websocket in self.active_connections[session_id].items():
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    print(f"Error sending message to user {user_id}: {e}")
                    disconnected_users.append(user_id)
            
            for user_id in disconnected_users:
                self.disconnect(session_id, user_id)

    async def send_notification(self, session_id: str, notification: dict):
        await self.send_to_session(session_id, {
            "type": "notification",
            "notification": notification
        })


exam_manager = ExamConnectionManager()

# Track viva sessions and suspicious activity
class VivaSessionTracker:
    def __init__(self):
        self.session_scores: Dict[str, float] = {}  # session_id -> cumulative suspicion score
        self.session_flags: Dict[str, int] = {}     # session_id -> flag count
        self.viva_triggered: Set[str] = set()       # sessions where viva was already triggered
        self.viva_in_progress: Set[str] = set()     # sessions with active viva
        self.viva_threshold = 3.0                   # cumulative score threshold
        self.flag_threshold = 3                     # number of flagged events threshold

    def add_event_score(self, session_id: str, priority: int, confidence: float, is_flagged: bool):
        """Add event score to session tracking"""
        if session_id not in self.session_scores:
            self.session_scores[session_id] = 0.0
            self.session_flags[session_id] = 0
        
        # Weight score by priority (higher priority = more suspicious)
        weighted_score = confidence * priority
        self.session_scores[session_id] += weighted_score
        
        if is_flagged:
            self.session_flags[session_id] += 1
        
        print(f"📊 Session {session_id}: Score={self.session_scores[session_id]:.2f}, Flags={self.session_flags[session_id]}, Viva In Progress: {session_id in self.viva_in_progress}")
        
    def should_trigger_viva(self, session_id: str) -> bool:
        """Check if viva should be triggered for this session"""
        # Don't trigger if already triggered or in progress
        if session_id in self.viva_triggered or session_id in self.viva_in_progress:
            return False
            
        score = self.session_scores.get(session_id, 0.0)
        flags = self.session_flags.get(session_id, 0)
        
        # Trigger if either threshold is met
        return score >= self.viva_threshold or flags >= self.flag_threshold
    
    def mark_viva_triggered(self, session_id: str):
        """Mark that viva was triggered for this session"""
        self.viva_triggered.add(session_id)
        self.viva_in_progress.add(session_id)
        print(f"🚨 Viva triggered for session {session_id}")
    
    def mark_viva_completed(self, session_id: str):
        """Mark that viva was completed for this session"""
        self.viva_in_progress.discard(session_id)
        print(f"✅ Viva completed for session {session_id}")
    
    def is_viva_in_progress(self, session_id: str) -> bool:
        """Check if viva is currently in progress for this session"""
        return session_id in self.viva_in_progress

viva_tracker = VivaSessionTracker()


async def trigger_surprise_viva(session_id: str, exam_id: str, suspicious_events: list):
    """Generate and send surprise viva questions based on suspicious activity"""
    try:
        print(f"🚨 Triggering surprise viva for session {session_id} due to suspicious activity")
        
        # Double-check that viva is not already in progress
        if viva_tracker.is_viva_in_progress(session_id):
            print(f"⚠️  Viva already in progress for session {session_id}, skipping")
            return False
        
        # Mark viva as in progress NOW to prevent duplicate triggers
        viva_tracker.mark_viva_triggered(session_id)
        print(f"🔒 Viva marked as in progress for session {session_id}")
        
        # Get exam details for context
        async with get_new_db_connection() as conn:
            print(f"Fetching exam data for {exam_id}...")
            cursor = await conn.cursor()
            
            # Get exam data
            await cursor.execute(
                f"""SELECT title, description, questions FROM {exams_table_name} WHERE id = ?""",
                (exam_id,)
            )
            exam_data = await cursor.fetchone()
            print(f"Exam data for {exam_id}: {exam_data}")  
            
            if not exam_data:
                print(f"❌ Exam {exam_id} not found for viva generation")
                return False
                
            exam_title = exam_data[0]
            exam_description = exam_data[1] 
            exam_questions = json.loads(exam_data[2]) if exam_data[2] else []
        
        # Prepare context for viva generation
        exam_context = {
            'title': exam_title,
            'description': exam_description,
            'cheating_evidence': [
                {
                    'type': event.get('type', 'unknown'),
                    'description': event.get('description', ''),
                    'confidence': event.get('confidence', 0)
                }
                for event in suspicious_events[-5:]  # Last 5 suspicious events
            ]
        }
        
        # Get OpenAI API key
        api_key = settings.openai_api_key
        if not api_key:
            print(f"❌ OpenAI API key not configured for viva generation")
            # Clean up the in-progress state since we can't generate questions
            viva_tracker.mark_viva_completed(session_id)
            return False
        
        # Generate viva questions using OpenAI
        print(f"🔄 Generating viva questions using OpenAI...")
        try:
            viva_result = await generate_surprise_viva_questions(
                api_key=api_key,
                original_questions=exam_questions,
                exam_context=exam_context
            )
            print(f"📝 Viva generation successful!")
        except Exception as llm_error:
            print(f"❌ Error calling OpenAI for viva generation: {llm_error}")
            # Clean up the in-progress state since generation failed
            viva_tracker.mark_viva_completed(session_id)
            return False
        
        viva_questions = viva_result.get("viva_questions", [])
        print(f"Generated {len(viva_questions)} viva questions for session {session_id}")
        
        if not viva_questions:
            print(f"❌ Failed to generate viva questions for session {session_id}")
            # Clean up the in-progress state since no questions were generated
            viva_tracker.mark_viva_completed(session_id)
            return False
        
        # Store viva questions in database
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            viva_session_id = f"viva_{session_id}_{int(datetime.now().timestamp())}"
            stored_questions = []
            
            # Insert each question individually
            for question in viva_questions:
                await cursor.execute(
                    f"""INSERT INTO {surprise_viva_questions_table_name} 
                        (session_id, original_question_id, question_text, expected_answer, confidence_score)
                        VALUES (?, ?, ?, ?, ?)""",
                    (
                        session_id,  # Use the actual session_id, not viva_session_id
                        question.get("id", f"viva_{int(datetime.now().timestamp())}"),
                        question.get("question", ""),
                        question.get("expected_answer", ""),
                        0.9  # High confidence for generated questions
                    )
                )
                
                # Get the inserted ID and add to stored questions
                viva_id = cursor.lastrowid
                stored_questions.append({
                    "viva_id": viva_id,
                    "question": question.get("question", ""),
                    "expected_answer": question.get("expected_answer", ""),
                    "time_limit": question.get("time_limit", 180)
                })
            
            await conn.commit()
            print(f"💾 Stored {len(stored_questions)} viva questions in database")
            
        # Send viva questions via WebSocket
        await exam_manager.send_to_session(session_id, {
            "type": "surprise_viva",
            "questions": stored_questions,  # Use the stored questions format
            "time_limit": 300,  # 5 minutes total
            "session_id": session_id,  # Use original session_id, not viva_session_id
            "message": "Suspicious activity detected. Please answer these verification questions to continue.",
            "instructions": viva_result.get("instructions", "Answer these questions to verify your understanding.")
        })
        
        print(f"✅ Surprise viva sent to session {session_id} with {len(stored_questions)} questions")
        return True
        
    except Exception as e:
        print(f"❌ Error triggering surprise viva: {e}")
        # Clean up the in-progress state if there was an unexpected error
        viva_tracker.mark_viva_completed(session_id)
        return False


async def save_exam_event(session_id: str, event: dict):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""INSERT INTO {exam_events_table_name} 
                    (session_id, event_type, event_data, timestamp)
                    VALUES (?, ?, ?, ?)""",
                (session_id, event['type'], json.dumps(event['data']), event['timestamp'])
            )
            
            await conn.commit()
    except Exception as e:
        print(f"Error saving exam event: {e}")


async def save_video_chunk(exam_id: str, session_id: str, video_data: bytes, video_dir: str, chunk_index: int):
    """Save video chunk to master WebM file only"""
    try:
        # Create chunks subdirectory (for future use if needed)
        # chunks_dir = os.path.join(video_dir, "chunks")
        # os.makedirs(chunks_dir, exist_ok=True)
        
        # Save individual chunk for processing (commented out - too much storage)
        # chunk_filename = f"{session_id}_chunk_{chunk_index:06d}.webm"
        # chunk_path = os.path.join(chunks_dir, chunk_filename)
        
        # with open(chunk_path, 'wb') as f:
        #     f.write(video_data)
        
        # Just append to master WebM file - WebM handles streaming chunks better
        master_video_path = os.path.join(video_dir, f"{exam_id}_master_recording.webm")
        with open(master_video_path, 'ab') as f:
            f.write(video_data)
        
        # Update exam with video file path (only master file)
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""UPDATE {exams_table_name} 
                    SET video_file_path = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?""",
                (master_video_path, exam_id)
            )
            
            await conn.commit()
        
        return master_video_path  # Return master path instead of chunk path
            
    except Exception as e:
        print(f"Error saving video chunk: {e}")
        return None


async def get_video_chunks_for_processing(exam_id: str, video_dir: str):
    """Get list of video chunks available for processing"""
    try:
        chunks_dir = os.path.join(video_dir, "chunks")
        if not os.path.exists(chunks_dir):
            return []
        
        chunks = []
        for filename in sorted(os.listdir(chunks_dir)):
            if filename.endswith('.mp4'):
                chunk_path = os.path.join(chunks_dir, filename)
                chunk_info = {
                    'filename': filename,
                    'path': chunk_path,
                    'size': os.path.getsize(chunk_path),
                    'created_time': os.path.getctime(chunk_path)
                }
                chunks.append(chunk_info)
        
        return chunks
        
    except Exception as e:
        print(f"Error getting video chunks: {e}")
        return []


async def finalize_video_recording(exam_id: str, video_dir: str):
    """Finalize video recording and ensure WebM format"""
    try:
        master_video_path = os.path.join(video_dir, f"{exam_id}_master_recording.webm")
        
        if os.path.exists(master_video_path):
            # Get file size
            file_size = os.path.getsize(master_video_path)
            print(f"Video recording finalized for exam {exam_id}: {file_size} bytes (WebM format)")
            
            # Get chunks info for processing (not needed since we're using single file)
            chunks = []  # No individual chunks since we append directly to master
            print(f"Master WebM file completed: {master_video_path}")
            
            # Update exam with final video info
            async with get_new_db_connection() as conn:
                cursor = await conn.cursor()
                
                await cursor.execute(
                    f"""UPDATE {exams_table_name} 
                        SET video_file_path = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?""",
                    (master_video_path, exam_id)
                )
                
                await conn.commit()
                
            return {
                'master_video': master_video_path,
                'chunks': chunks,
                'total_size': file_size,
                'format': 'webm'
            }
        else:
            print(f"Master video file not found: {master_video_path}")
            return None
                
    except Exception as e:
        print(f"Error finalizing video recording: {e}")
        return None


async def update_session_status(session_id: str, status: str):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            await cursor.execute(
                f"""UPDATE {exam_sessions_table_name} 
                    SET status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?""",
                (status, session_id)
            )
            
            await conn.commit()
    except Exception as e:
        print(f"Error updating session status: {e}")


async def create_or_update_session(session_id: str, exam_id: str, user_id: str, status: str):
    try:
        async with get_new_db_connection() as conn:
            cursor = await conn.cursor()
            
            # Check if session exists
            await cursor.execute(
                f"""SELECT id FROM {exam_sessions_table_name} WHERE id = ?""",
                (session_id,)
            )
            
            existing = await cursor.fetchone()
            
            if existing:
                # Update existing session
                await cursor.execute(
                    f"""UPDATE {exam_sessions_table_name} 
                        SET status = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?""",
                    (status, session_id)
                )
            else:
                # Create new session
                await cursor.execute(
                    f"""INSERT INTO {exam_sessions_table_name}
                        (id, exam_id, user_id, start_time, status, answers, created_at, updated_at)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, '{{}}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
                    (session_id, exam_id, user_id, status)
                )
            
            await conn.commit()
            print(f"Session {session_id} created/updated with status: {status}")
    except Exception as e:
        print(f"Error creating/updating session: {e}")


@router.websocket("/exam/{exam_id}/ws")
async def websocket_exam_session(websocket: WebSocket, exam_id: str, token: str = Query(None), user_id: str = Query(None)):
    # Accept the connection first
    await websocket.accept()
    
    # Accept either token or user_id for now
    if not token and not user_id:
        await websocket.send_json({
            "type": "error",
            "message": "Authentication token or user_id required"
        })
        await websocket.close(code=1008, reason="Authentication token or user_id required")
        return
    
    # Use user_id directly if provided, otherwise extract from token (when implemented)
    if user_id:
        actual_user_id = user_id
    else:
        # TODO: Validate token and get user_id
        actual_user_id = "user_from_token"  # This should come from token validation
        
    session_id = f"{exam_id}_{actual_user_id}_{int(datetime.now().timestamp())}"
    chunk_counter = 0  # Track video chunks for this session
    
    try:
        await exam_manager.connect(websocket, session_id, actual_user_id)
        print(f"Client connected to exam {exam_id}, session {session_id}, user {actual_user_id}")
        
        # Send connection confirmation to frontend
        await websocket.send_json({
            "type": "connection_established",
            "session_id": session_id,
            "exam_id": exam_id,
            "message": "WebSocket connection established successfully"
        })
        
        # Create video storage directory for exam
        video_dir = os.path.join(data_root_dir, "exam_videos", exam_id)
        os.makedirs(video_dir, exist_ok=True)
        
        # Create or update session to active
        await create_or_update_session(session_id, exam_id, actual_user_id, "active")
        
        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    message = json.loads(data)
                    
                    # Log message type but avoid printing large video data
                    message_type = message.get("type", "unknown")
                    if message_type == "video_chunk":
                        data_size = message.get("size", 0)
                        is_final = message.get("is_final", False)
                        print(f"Received video_chunk: {data_size} bytes, final={is_final}")
                    else:
                        print(f"Received message: {message_type}")
                    
                    # Handle message and update chunk counter if needed
                    result = await handle_exam_message(websocket, session_id, actual_user_id, exam_id, message, video_dir, chunk_counter)
                    if result and 'chunk_counter' in result:
                        chunk_counter = result['chunk_counter']
                    
                except json.JSONDecodeError:
                    await safe_send_json(websocket, {
                        "type": "error",
                        "message": "Invalid JSON format"
                    })
                except WebSocketDisconnect:
                    # Break the loop on disconnect
                    print(f"WebSocket disconnected during message processing")
                    break
                except Exception as e:
                    print(f"Error processing message: {e}")
                    await safe_send_json(websocket, {
                        "type": "error", 
                        "message": "Error processing message"
                    })
                    # Don't break on general errors, continue processing
                    
        except WebSocketDisconnect:
            print(f"WebSocket disconnected from main loop")
    except WebSocketDisconnect:
        print(f"Client disconnected from exam {exam_id}, session {session_id}")
    finally:
        # Cleanup regardless of how we exit
        exam_manager.disconnect(session_id, actual_user_id)
        await update_session_status(session_id, "completed")
        # Finalize video recording on disconnect
        await finalize_video_recording(exam_id, video_dir)


async def handle_exam_message(websocket: WebSocket, session_id: str, user_id: str, exam_id: str, message: dict, video_dir: str, chunk_counter: int):
    message_type = message.get("type")
    
    if message_type == "exam_event":
        event = message.get("event")
        if event:
            await save_exam_event(session_id, event)
            
            # Score the event for suspicion analysis
            scorer = EventScorer()
            event_type = event.get("type", "unknown")
            event_data = event.get("data", {})
            
            priority, confidence_score, is_flagged, description = scorer.calculate_event_score(
                event_type, event_data
            )
            
            # Track suspicious activity
            viva_tracker.add_event_score(session_id, priority, confidence_score, is_flagged)
            
            # Check if we should trigger surprise viva
            if viva_tracker.should_trigger_viva(session_id):
                # Get recent suspicious events for context
                async with get_new_db_connection() as conn:
                    cursor = await conn.cursor()
                    await cursor.execute(
                        f"""SELECT event_type, event_data, timestamp FROM {exam_events_table_name} 
                            WHERE session_id = ? 
                            ORDER BY timestamp DESC 
                            LIMIT 10""",
                        (session_id,)
                    )
                    recent_events = await cursor.fetchall()
                
                suspicious_events = []
                for event_row in recent_events:
                    evt_type = event_row[0]
                    evt_data = json.loads(event_row[1]) if isinstance(event_row[1], str) else event_row[1]
                    evt_timestamp = event_row[2]
                    
                    evt_priority, evt_confidence, evt_flagged, evt_desc = scorer.calculate_event_score(evt_type, evt_data)
                    if evt_flagged or evt_confidence > 0.7:
                        suspicious_events.append({
                            'type': evt_type,
                            'data': evt_data,
                            'timestamp': evt_timestamp,
                            'confidence': evt_confidence,
                            'description': evt_desc
                        })
                
                # Trigger viva in background
                asyncio.create_task(trigger_surprise_viva(session_id, exam_id, suspicious_events))
            
            # Send acknowledgment for exam events
            await websocket.send_json({
                "type": "exam_event_ack",
                "event_type": event["type"],
                "timestamp": event["timestamp"],
                "status": "received"
            })
            
            # Handle special events
            if event["type"] == "tab_switch" and event["data"]["away_duration"] > 30000:  # 30 seconds
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": "Extended tab switching detected. Please remain on the exam page.",
                    "type": "warning",
                    "timestamp": event["timestamp"]
                })
            
            elif event["type"] == "clipboard_paste":
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": "Clipboard paste detected. This activity is being monitored.",
                    "type": "info", 
                    "timestamp": event["timestamp"]
                })
            
            # Advanced cheating detection events
            elif event["type"] == "rapid_paste_burst":
                paste_count = event["data"].get("paste_count", 0)
                time_window = event["data"].get("time_window", 0) / 1000  # Convert to seconds
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": f"Multiple paste operations detected: {paste_count} pastes in {time_window:.1f} seconds",
                    "type": "warning",
                    "timestamp": event["timestamp"]
                })
            
            elif event["type"] == "writing_style_drift":
                similarity_score = event["data"].get("similarity_score", 0)
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": f"Writing style inconsistency detected (similarity: {similarity_score:.2f})",
                    "type": "warning",
                    "timestamp": event["timestamp"]
                })
            
            elif event["type"] == "content_similarity":
                similarity_score = event["data"].get("similarity_score", 0)
                phrases_count = len(event["data"].get("matching_phrases", []))
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": f"Content similarity detected: {phrases_count} common phrases (score: {similarity_score:.2f})",
                    "type": "warning",
                    "timestamp": event["timestamp"]
                })
            
            elif event["type"] == "typing_pattern_anomaly":
                anomaly_type = event["data"].get("anomaly_type", "unknown")
                confidence = event["data"].get("confidence", 0)
                await exam_manager.send_notification(session_id, {
                    "id": str(uuid.uuid4()),
                    "message": f"Typing pattern anomaly: {anomaly_type} (confidence: {confidence:.2f})",
                    "type": "info",
                    "timestamp": event["timestamp"]
                })
            
            elif event["type"] == "wpm_tracking":
                # WPM events don't generate notifications, just stored for analytics
                pass
            elif event["type"] == "gaze_tracking" and event["data"].get("looking_away"):
                print(f"🔍 Gaze Event: User {session_id} looking away at ({event['data']['gaze_x']}, {event['data']['gaze_y']}) with confidence {event['data']['confidence']:.2f}")
                # Optionally send notification for looking away
                if event["data"].get("confidence", 0) > 0.7:  # Only if confidence is high
                    await exam_manager.send_notification(session_id, {
                        "id": str(uuid.uuid4()),
                        "message": "Please maintain focus on the exam screen.",
                        "type": "info",
                        "timestamp": event["timestamp"]
                    })
            
            elif event["type"] == "face_count_violation":
                face_count = event["data"].get("face_count", 0)
                expected_faces = event["data"].get("expected_faces", 1)
                violation_duration = event["data"].get("violation_duration", 0) / 1000  # Convert to seconds
                print(f"👥 Face Count Violation: User {session_id} has {face_count} faces (expected {expected_faces}) for {violation_duration:.1f}s")
                
                if face_count == 0:
                    await exam_manager.send_notification(session_id, {
                        "id": str(uuid.uuid4()),
                        "message": "Please ensure your face is visible to the camera at all times.",
                        "type": "warning",
                        "timestamp": event["timestamp"]
                    })
                elif face_count > expected_faces:
                    await exam_manager.send_notification(session_id, {
                        "id": str(uuid.uuid4()),
                        "message": f"Multiple people detected in camera. Only the exam taker should be visible.",
                        "type": "warning",
                        "timestamp": event["timestamp"]
                    })
            
            elif event["type"] == "face_detection_update":
                # Face detection updates don't generate notifications, just stored for analytics
                face_count = event["data"].get("face_count", 0)
                if face_count != 1:  # Log non-standard face counts
                    print(f"📊 Face Detection: User {session_id} - {face_count} faces detected")
                pass
    
    elif message_type == "video_chunk":
        timestamp = message.get("timestamp")
        data = message.get("data")
        is_final = message.get("is_final", False)
        original_size = message.get("size", 0)
        
        if data:
            try:
                # Decode base64 video data
                video_data = base64.b64decode(data)
                
                # Save chunk and append to master WebM file
                chunk_path = await save_video_chunk(exam_id, session_id, video_data, video_dir, chunk_counter)
                
                # Send acknowledgment safely
                await safe_send_json(websocket, {
                    "type": "video_chunk_ack",
                    "timestamp": timestamp,
                    "status": "saved",
                    "chunk_index": chunk_counter,
                    "decoded_size": len(video_data)
                })
                
                # Increment chunk counter for next chunk
                chunk_counter += 1
                
                # If this is the final chunk, finalize the recording
                if is_final:
                    result = await finalize_video_recording(exam_id, video_dir)
                    if result:
                        await websocket.send_json({
                            "type": "video_finalized",
                            "master_video": result['master_video'],
                            "chunks_count": len(result['chunks']),
                            "total_size": result['total_size']
                        })
                
            except Exception as e:
                print(f"Error saving video data: {e}")
                await safe_send_json(websocket, {
                    "type": "video_chunk_error",
                    "timestamp": timestamp,
                    "error": str(e)
                })
        
        return {"chunk_counter": chunk_counter}
    
    elif message_type == "video_start":
        # Initialize video recording - use WebM for better streaming
        try:
            video_file_path = os.path.join(video_dir, f"{exam_id}_master_recording.webm")
            
            # Create empty file to start recording
            # WebM format handles streaming chunks much better than MP4
            with open(video_file_path, 'wb') as f:
                # Start with an empty file - MediaRecorder will provide proper WebM structure
                pass
                
            print(f"Video recording initialized for exam {exam_id} using WebM format")
            await safe_send_json(websocket, {
                "type": "video_start_ack",
                "status": "ready",
                "format": "webm"
            })
            
        except Exception as e:
            print(f"Error starting video recording: {e}")
            await safe_send_json(websocket, {
                "type": "video_start_ack",
                "status": "error",
                "error": str(e)
            })
    
    elif message_type == "video_stop":
        # Finalize video recording
        try:
            await finalize_video_recording(exam_id, video_dir)
            
            await safe_send_json(websocket, {
                "type": "video_stop_ack",
                "status": "finalized"
            })
            
        except Exception as e:
            print(f"Error stopping video recording: {e}")
            await safe_send_json(websocket, {
                "type": "video_stop_ack",
                "status": "error",
                "error": str(e)
            })
    
    elif message_type == "ping":
        await websocket.send_json({"type": "pong"})
    
    elif message_type == "test_connection":
        await websocket.send_json({
            "type": "test_response",
            "message": "WebSocket is working correctly",
            "timestamp": int(datetime.now().timestamp()),
            "session_id": session_id
        })
    
    elif message_type == "viva_completed":
        # Mark viva as completed to allow future triggers if needed
        viva_tracker.mark_viva_completed(session_id)
        print(f"📝 Viva completed for session {session_id}")
        
        await websocket.send_json({
            "type": "viva_completion_ack",
            "message": "Viva completion acknowledged",
            "session_id": session_id
        })
    
    elif message_type == "surprise_viva":
        # Frontend is sending back a surprise_viva message - this shouldn't happen normally
        # This might be debug/test code or an echo. Just acknowledge it.
        print(f"⚠️  Frontend sent surprise_viva message back (unexpected)")
        print(f"    Message keys: {list(message.keys())}")
        print(f"    Has instructions: {'instructions' in message}")
        print(f"    Has questions: {'questions' in message}")
        print(f"    This suggests the frontend is echoing our message back to us")
        
        await websocket.send_json({
            "type": "surprise_viva_ack", 
            "message": "Surprise viva message received but not expected from frontend",
            "session_id": session_id
        })
    
    else:
        await websocket.send_json({
            "type": "error",
            "message": f"Unknown message type: {message_type}"
        })
    
    # Return None for non-video messages
    return None


# HTTP endpoint to get video chunks for processing
from fastapi import HTTPException
from fastapi.responses import JSONResponse

@router.get("/exam/{exam_id}/video/chunks")
async def get_exam_video_chunks(exam_id: str):
    """Get list of video chunks for an exam for processing"""
    try:
        video_dir = os.path.join(data_root_dir, "exam_videos", exam_id)
        chunks = await get_video_chunks_for_processing(exam_id, video_dir)
        
        master_video_path = os.path.join(video_dir, f"{exam_id}_master_recording.mp4")
        master_exists = os.path.exists(master_video_path)
        master_size = os.path.getsize(master_video_path) if master_exists else 0
        
        return JSONResponse({
            "exam_id": exam_id,
            "master_video": {
                "path": master_video_path,
                "exists": master_exists,
                "size": master_size
            },
            "chunks": chunks,
            "chunks_count": len(chunks),
            "total_chunks_size": sum(chunk['size'] for chunk in chunks)
        })
        
    except Exception as e:
        print(f"Error getting video chunks: {e}")
        raise HTTPException(status_code=500, detail="Failed to get video chunks")


@router.post("/exam/{exam_id}/video/process-chunk")
async def process_video_chunk(exam_id: str, chunk_filename: str):
    """Mark a video chunk as processed or get chunk data for processing"""
    try:
        video_dir = os.path.join(data_root_dir, "exam_videos", exam_id)
        chunks_dir = os.path.join(video_dir, "chunks")
        chunk_path = os.path.join(chunks_dir, chunk_filename)
        
        if not os.path.exists(chunk_path):
            raise HTTPException(status_code=404, detail="Chunk not found")
        
        chunk_info = {
            'filename': chunk_filename,
            'path': chunk_path,
            'size': os.path.getsize(chunk_path),
            'created_time': os.path.getctime(chunk_path),
            'available_for_processing': True
        }
        
        return JSONResponse(chunk_info)
        
    except Exception as e:
        print(f"Error processing video chunk: {e}")
        raise HTTPException(status_code=500, detail="Failed to process video chunk")


@router.get("/exam/{exam_id}/test")
async def test_exam_endpoint(exam_id: str):
    """Test endpoint to verify exam functionality"""
    return JSONResponse({
        "message": "Exam endpoint is working",
        "exam_id": exam_id,
        "timestamp": int(datetime.now().timestamp())
    })


@router.post("/exam/{exam_id}/trigger-viva")
async def manually_trigger_viva(exam_id: str, session_id: str = Query(...)):
    """Manually trigger surprise viva for testing purposes"""
    try:
        # Create fake suspicious events for testing
        test_events = [
            {
                'type': 'clipboard_paste',
                'description': 'Clipboard paste detected',
                'confidence': 0.9
            },
            {
                'type': 'tab_switch', 
                'description': 'User navigated away from exam',
                'confidence': 0.85
            }
        ]
        
        success = await trigger_surprise_viva(session_id, exam_id, test_events)
        
        if success:
            return JSONResponse({
                "message": "Surprise viva triggered successfully",
                "session_id": session_id,
                "exam_id": exam_id
            })
        else:
            raise HTTPException(status_code=500, detail="Failed to trigger viva")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error triggering viva: {str(e)}")
