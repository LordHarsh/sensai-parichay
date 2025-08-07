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
from api.db import (
    exams_table_name,
    exam_sessions_table_name,
    exam_events_table_name
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


@router.websocket("/exam/{exam_id}/ws")
async def websocket_exam_session(websocket: WebSocket, exam_id: str, token: str = Query(None)):
    # Accept the connection first
    await websocket.accept()
    
    if not token:
        await websocket.send_json({
            "type": "error",
            "message": "Authentication token required"
        })
        await websocket.close(code=1008, reason="Authentication token required")
        return
    
    # TODO: Validate token and get user_id
    user_id = "user_123"  # This should come from token validation
    session_id = f"{exam_id}_{user_id}_{int(datetime.now().timestamp())}"
    chunk_counter = 0  # Track video chunks for this session
    
    try:
        await exam_manager.connect(websocket, session_id, user_id)
        print(f"Client connected to exam {exam_id}, session {session_id}")
        
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
        
        # Update session to active
        await update_session_status(session_id, "active")
        
        try:
            while True:
                try:
                    data = await websocket.receive_text()
                    message = json.loads(data)
                    print(f"Received message: {message}")
                    
                    # Handle message and update chunk counter if needed
                    result = await handle_exam_message(websocket, session_id, user_id, exam_id, message, video_dir, chunk_counter)
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
        exam_manager.disconnect(session_id, user_id)
        await update_session_status(session_id, "completed")
        # Finalize video recording on disconnect
        await finalize_video_recording(exam_id, video_dir)


async def handle_exam_message(websocket: WebSocket, session_id: str, user_id: str, exam_id: str, message: dict, video_dir: str, chunk_counter: int):
    message_type = message.get("type")
    
    if message_type == "exam_event":
        event = message.get("event")
        if event:
            await save_exam_event(session_id, event)
            
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
    
    elif message_type == "video_chunk":
        timestamp = message.get("timestamp")
        data = message.get("data")
        is_final = message.get("is_final", False)
        original_size = message.get("size", 0)
        
        if data:
            try:
                # Decode base64 video data
                video_data = base64.b64decode(data)
                print(f"Video chunk received: base64 length={len(data)}, decoded size={len(video_data)}, original_size={original_size}")
                
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
