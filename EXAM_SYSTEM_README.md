# Exam Monitoring System

A comprehensive online examination platform with real-time monitoring, video recording, and event tracking capabilities.

## Features

### 🎯 Exam Management
- Create and configure exams with multiple question types
- Support for multiple choice, text, essay, and code questions
- Configurable time limits and scoring
- Exam templates and reusable configurations

### 📹 Real-time Monitoring  
- **Video Recording**: Continuous video capture during exams
- **Audio Recording**: Optional audio monitoring
- **Event Tracking**: Comprehensive tracking of user interactions
- **WebSocket Communication**: Real-time event streaming to backend

### 🔍 Advanced Event Detection
- **Tab Switching**: Detects when users navigate away from exam
- **Clipboard Monitoring**: Tracks copy/paste activities  
- **Keystroke Analysis**: Compares typed vs visible text for anomalies
- **Mouse Movement**: Analyzes movement patterns for suspicious activity
- **Window Focus**: Monitors application focus changes
- **Face Detection**: Computer vision-based face tracking (planned)
- **Network Activity**: Monitors suspicious network requests (planned)

### 📊 Analytics & Reporting
- Detailed exam results with performance metrics
- Event summary and timeline analysis
- Video playback with synchronized events
- Suspicious activity flagging and scoring
- Export capabilities for further analysis

## Architecture

### Frontend (Next.js)
```
src/
├── app/
│   ├── exam/
│   │   ├── [examId]/
│   │   │   ├── page.tsx          # Main exam interface
│   │   │   └── results/
│   │   │       └── page.tsx      # Results display
│   │   ├── create/
│   │   │   └── page.tsx          # Exam creation interface
│   │   └── page.tsx              # Exam list
│   └── api/
│       └── exam/                 # API proxy routes
├── components/
│   └── exam/
│       ├── ExamHeader.tsx        # Timer and controls
│       ├── QuestionPanel.tsx     # Question display and navigation  
│       ├── VideoRecorder.tsx     # Video capture component
│       ├── EventTracker.tsx      # Event monitoring system
│       └── ExamNotification.tsx  # Real-time notifications
├── lib/
│   └── exam-websocket.ts         # WebSocket client
└── types/
    └── exam.ts                   # TypeScript definitions
```

### Backend (FastAPI)
```
src/api/
├── routes/
│   └── exam.py                   # Exam CRUD operations
├── websockets.py                 # WebSocket handlers
├── models.py                     # Pydantic models
└── db/
    └── __init__.py              # Database schema
```

### Database Schema
```sql
-- Exam configurations
CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL,
    questions TEXT NOT NULL,     -- JSON array
    settings TEXT,               -- JSON object
    monitoring TEXT,             -- JSON object
    created_at DATETIME,
    updated_at DATETIME
);

-- Exam sessions (user attempts)
CREATE TABLE exam_sessions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    user_id INTEGER NOT NULL, 
    start_time DATETIME,
    end_time DATETIME,
    status TEXT DEFAULT 'pending',
    answers TEXT,                -- JSON object
    score REAL,
    metadata TEXT,               -- JSON object
    FOREIGN KEY (exam_id) REFERENCES exams(id)
);

-- Event tracking
CREATE TABLE exam_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,    -- JSON object
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
);

-- Video storage
CREATE TABLE exam_sessions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    start_time DATETIME,
    end_time DATETIME,
    status TEXT DEFAULT 'pending',
    answers TEXT,
    score REAL,
    metadata TEXT,
    video_file_path TEXT,  -- Path to MP4 recording file
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## Event Types

### Tab Switching
```typescript
{
  type: 'tab_switch',
  timestamp: number,
  data: {
    away_duration: number,      // milliseconds away from page
    timestamp: number
  }
}
```

### Keystroke Mismatch
```typescript
{
  type: 'keystroke_mismatch', 
  timestamp: number,
  data: {
    typed_chars: string,        // What was actually typed
    visible_input: string,      // What appears in the input field
    timestamp: number
  }
}
```

### Clipboard Activity  
```typescript
{
  type: 'clipboard_paste',
  timestamp: number,
  data: {
    content_hash: string,       // SHA-256 hash of pasted content
    length: number,             // Content length
    timestamp: number
  }
}
```

### Mouse Movement
```typescript
{
  type: 'mouse_movement',
  timestamp: number,
  data: {
    coordinates: { x: number, y: number },
    velocity: number,           // Movement speed
    pattern_type: 'normal' | 'suspicious' | 'rapid',
    timestamp: number
  }
}
```

### Video Stream
```typescript
{
  type: 'video_stream',
  timestamp: number, 
  data: {
    chunk_id: string,           // Unique chunk identifier
    timestamp: number,          // Recording timestamp
    duration: number            // Chunk duration in ms
  }
}
```

## WebSocket Protocol

### Connection
```
ws://localhost:8000/ws/exam/{examId}/ws?token={authToken}
```

### Message Types

#### Client to Server
```typescript
// Exam events
{
  type: 'exam_event',
  event: ExamEvent
}

// Video chunks (base64 encoded)
{
  type: 'video_chunk',
  chunk_id: string,
  timestamp: number,
  data: string,               // base64 encoded video data
  size: number
}

// Audio chunks
{
  type: 'audio_chunk', 
  chunk_id: string,
  timestamp: number,
  data: string,               // base64 encoded audio data
  size: number
}

// Heartbeat
{
  type: 'ping'
}
```

#### Server to Client
```typescript
// Notifications
{
  type: 'notification',
  notification: {
    id: string,
    message: string,
    type: 'info' | 'warning' | 'error' | 'success',
    timestamp: number
  }
}

// Exam updates  
{
  type: 'exam_update',
  data: any                   // Exam state changes
}

// Upload confirmations
{
  type: 'video_chunk_ack',
  chunk_id: string,
  status: 'saved' | 'error'
}

// Heartbeat response
{
  type: 'pong'
}
```

## Setup Instructions

### Backend Setup
1. Install dependencies:
```bash
cd sensai-ai
pip install -r requirements.txt
```

2. Initialize database:
```bash
python create_demo_exams.py
```

3. Start the backend:
```bash
python -m uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup  
1. Install dependencies:
```bash
cd sensai-frontend
npm install
```

2. Set environment variables:
```bash
# .env.local
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000
API_BASE_URL=http://localhost:8000
```

3. Start the frontend:
```bash
npm run dev
```

### Demo Data
Run the demo script to create sample exams:
```bash
cd sensai-ai
python create_demo_exams.py
```

## Usage

### Creating an Exam
1. Navigate to `/exam/create`
2. Fill in exam details (title, description, duration)
3. Add questions of various types
4. Configure monitoring settings
5. Save and publish

### Taking an Exam
1. Go to `/exam` to see available exams
2. Click "Start Exam" on desired exam
3. Grant camera/microphone permissions when prompted
4. Review exam rules and click "Start Exam"
5. Answer questions within the time limit
6. Submit or auto-submit when time expires

### Viewing Results
1. Results are displayed immediately after submission
2. View score, time taken, and monitoring summary
3. Review individual question responses
4. Analyze suspicious activity flags

## Security Features

### Client-Side Monitoring
- **Fullscreen enforcement**: Prevents window resizing/switching
- **Context menu blocking**: Disables right-click menus
- **Copy/paste detection**: Monitors clipboard activity
- **Tab switch detection**: Tracks focus loss events
- **Keystroke validation**: Compares input patterns

### Server-Side Validation  
- **Session management**: Secure session tokens
- **Event validation**: Server-side event processing
- **Video integrity**: Chunk-based upload with verification
- **Time enforcement**: Server-side time tracking
- **Answer validation**: Secure answer submission

### Privacy & Compliance
- **Consent management**: Clear permission requests
- **Data encryption**: Encrypted video and event storage
- **Retention policies**: Configurable data retention
- **Access controls**: Role-based result access
- **Audit logging**: Complete activity audit trail

## Configuration Options

### Exam Settings
```typescript
{
  allow_tab_switch: boolean,      // Allow switching away from exam
  max_tab_switches: number,       // Maximum allowed switches  
  allow_copy_paste: boolean,      // Allow clipboard operations
  require_camera: boolean,        // Mandate video recording
  require_microphone: boolean,    // Mandate audio recording
  fullscreen_required: boolean,   // Force fullscreen mode
  auto_submit: boolean,           // Auto-submit on time expiry
  shuffle_questions: boolean,     // Randomize question order
  show_timer: boolean            // Display countdown timer
}
```

### Monitoring Settings
```typescript
{
  video_recording: boolean,       // Enable video capture
  audio_recording: boolean,       // Enable audio capture  
  screen_recording: boolean,      // Enable screen capture (future)
  keystroke_logging: boolean,     // Track typing patterns
  mouse_tracking: boolean,        // Monitor mouse movement
  face_detection: boolean,        // Computer vision face tracking
  gaze_tracking: boolean,         // Eye movement tracking (future)
  network_monitoring: boolean     // Monitor network requests
}
```

## API Endpoints

### Exam Management
```
POST   /api/exam              # Create exam
GET    /api/exam/{examId}     # Get exam details
PUT    /api/exam/{examId}     # Update exam
DELETE /api/exam/{examId}     # Delete exam
```

### Exam Sessions
```
POST   /api/exam/{examId}/start    # Start exam session
POST   /api/exam/{examId}/submit   # Submit exam answers
GET    /api/exam/{examId}/sessions # List sessions
GET    /api/exam/{examId}/results/{sessionId} # Get results
```

### WebSocket
```
WS     /ws/exam/{examId}/ws        # Real-time exam connection
```

## Monitoring Dashboard (Future)

### Admin Features
- **Live Monitoring**: Real-time exam session overview
- **Suspicious Activity**: Flagged events and patterns  
- **Video Review**: Synchronized video playback with events
- **Analytics**: Performance and integrity metrics
- **Reporting**: Exportable reports and statistics

### Instructor Features
- **Exam Management**: Create, edit, and manage exams
- **Student Progress**: Monitor ongoing exam sessions
- **Results Analysis**: Detailed performance analytics
- **Integrity Reports**: Cheating detection summaries

## Technology Stack

### Frontend
- **Next.js 14**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling  
- **WebRTC**: Video/audio capture APIs
- **WebSockets**: Real-time communication

### Backend
- **FastAPI**: High-performance Python API framework
- **WebSockets**: Real-time bidirectional communication
- **SQLite**: Embedded database for development
- **Pydantic**: Data validation and serialization
- **AsyncIO**: Asynchronous request handling

### Infrastructure
- **Docker**: Containerized deployment
- **NGINX**: Reverse proxy and static file serving
- **Redis**: Session storage and caching (future)
- **S3**: Video file storage (future)
- **CloudFront**: CDN for video delivery (future)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make changes and add tests
4. Commit changes: `git commit -am 'Add new feature'`
5. Push to branch: `git push origin feature/new-feature`
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please contact the development team or create an issue in the repository.
