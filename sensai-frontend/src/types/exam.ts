export interface ExamQuestion {
  id: string;
  type: "multiple_choice" | "text" | "code" | "essay";
  question: string;
  options?: string[];
  correct_answer?: string;
  points: number;
  time_limit?: number;
  metadata?: Record<string, any>;
}

export interface ExamEvent {
  type: string;
  timestamp: number;
  data: Record<string, any>;
}

export interface TabSwitchEvent extends ExamEvent {
  type: "tab_switch";
  data: {
    away_duration: number;
    timestamp: number;
  };
}

export interface KeystrokeMismatchEvent extends ExamEvent {
  type: "keystroke_mismatch";
  data: {
    typed_chars: string;
    visible_input: string;
    timestamp: number;
  };
}

export interface ClipboardPasteEvent extends ExamEvent {
  type: "clipboard_paste";
  data: {
    content_hash: string;
    length: number;
    timestamp: number;
  };
}

export interface MouseMovementEvent extends ExamEvent {
  type: "mouse_movement";
  data: {
    coordinates: { x: number; y: number };
    velocity: number;
    pattern_type: "normal" | "suspicious" | "rapid";
    timestamp: number;
  };
}

export interface VideoRecordingEvent extends ExamEvent {
  type: "video_recording";
  data: {
    action: "start" | "stop" | "chunk";
    timestamp: number;
    file_size?: number;
  };
}

export interface AnswerChangeEvent extends ExamEvent {
  type: "answer_changed";
  data: {
    question_id: string;
    answer: string;
    time_spent: number;
  };
}

export interface QuestionNavigationEvent extends ExamEvent {
  type: "question_navigation";
  data: {
    from_question: number;
    to_question: number;
    navigation_time: number;
  };
}

export interface ExamStartEvent extends ExamEvent {
  type: "exam_started";
  data: {
    exam_id: string;
    start_time: string;
  };
}

export interface ExamEndEvent extends ExamEvent {
  type: "exam_ended";
  data: {
    exam_id: string;
    end_time: string;
    answers: Record<string, string>;
    time_taken: number;
  };
}

export interface AudioDetectionEvent extends ExamEvent {
  type: "audio_detection";
  data: {
    volume_level: number;
    frequency_analysis: Record<string, number>;
    speech_detected: boolean;
    timestamp: number;
  };
}

export interface FaceDetectionEvent extends ExamEvent {
  type: "face_detection";
  data: {
    faces_count: number;
    face_positions: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    gaze_direction: { x: number; y: number };
    timestamp: number;
  };
}

export interface NetworkActivityEvent extends ExamEvent {
  type: "network_activity";
  data: {
    requests: Array<{
      url: string;
      method: string;
      timestamp: number;
    }>;
    suspicious_domains: string[];
  };
}

export interface WindowFocusEvent extends ExamEvent {
  type: "window_focus";
  data: {
    is_focused: boolean;
    duration_unfocused?: number;
    timestamp: number;
  };
}

export interface ScreenResolutionEvent extends ExamEvent {
  type: "screen_resolution";
  data: {
    width: number;
    height: number;
    fullscreen: boolean;
    timestamp: number;
  };
}

export interface ExamNotification {
  id: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  timestamp: number;
  auto_dismiss?: boolean;
  action?: {
    label: string;
    callback: () => void;
  };
}

export interface ExamSession {
  id: string;
  exam_id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  status: "pending" | "active" | "completed" | "terminated";
  answers: Record<string, string>;
  events: ExamEvent[];
  video_file_path?: string;
  score?: number;
  metadata?: Record<string, any>;
}

export interface ExamConfiguration {
  id: string;
  title: string;
  description: string;
  duration: number; // in minutes
  questions: ExamQuestion[];
  settings: {
    allow_tab_switch: boolean;
    max_tab_switches: number;
    allow_copy_paste: boolean;
    require_camera: boolean;
    require_microphone: boolean;
    fullscreen_required: boolean;
    auto_submit: boolean;
    shuffle_questions: boolean;
    show_timer: boolean;
  };
  monitoring: {
    video_recording: boolean;
    audio_recording: boolean;
    screen_recording: boolean;
    keystroke_logging: boolean;
    mouse_tracking: boolean;
    face_detection: boolean;
    gaze_tracking: boolean;
    network_monitoring: boolean;
  };
  created_at: string;
  updated_at: string;
}

export type ExamEventType =
  | TabSwitchEvent
  | KeystrokeMismatchEvent
  | ClipboardPasteEvent
  | MouseMovementEvent
  | VideoRecordingEvent
  | AnswerChangeEvent
  | QuestionNavigationEvent
  | ExamStartEvent
  | ExamEndEvent
  | AudioDetectionEvent
  | FaceDetectionEvent
  | NetworkActivityEvent
  | WindowFocusEvent
  | ScreenResolutionEvent;
