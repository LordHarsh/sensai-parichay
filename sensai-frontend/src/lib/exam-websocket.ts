import { ExamEvent, ExamNotification } from '@/types/exam';

export class ExamWebSocket {
  private ws: WebSocket | null = null;
  private examId: string;
  private userId: string;
  private token?: string;
  private sessionId?: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  
  public onNotification: ((notification: ExamNotification) => void) | null = null;
  public onExamUpdate: ((data: any) => void) | null = null;
  public onVideoDataAck: ((timestamp: number, status: string) => void) | null = null;
  public onVideoControlAck: ((status: string) => void) | null = null;
  public onSessionEstablished: ((sessionId: string) => void) | null = null;

  constructor(examId: string, userId: string, token?: string) {
    this.examId = examId;
    this.userId = userId;
    this.token = token;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    
    try {
      // Connect directly to the backend WebSocket
      const backendHost = process.env.NEXT_PUBLIC_BACKEND_WS_URL || 'ws://localhost:8000';
      const protocol = backendHost.startsWith('wss:') ? 'wss:' : 'ws:';
      const host = backendHost.replace(/^wss?:\/\//, '');
      
      // Build parameters - include both user_id and token if available
      const params = new URLSearchParams();
      params.append('user_id', this.userId);
      if (this.token) {
        params.append('token', this.token);
      }
      
      const wsUrl = `${protocol}//${host}/ws/exam/${this.examId}/ws?${params.toString()}`;
      console.log('Connecting to WebSocket with user_id:', this.userId, 'and token:', this.token ? 'available' : 'not available');
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.sendEvent({
          type: 'connection_established',
          timestamp: Date.now(),
          data: {
            exam_id: this.examId,
            user_agent: navigator.userAgent,
            screen_resolution: {
              width: window.screen.width,
              height: window.screen.height
            }
          }
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.isConnecting = false;
        this.ws = null;
        
        // Don't reconnect if it was a normal close or auth error
        if (event.code !== 1000 && event.code !== 1008 && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log(`WebSocket closed unexpectedly (${event.code}), attempting reconnection...`);
          this.scheduleReconnect();
        } else if (event.code === 1008) {
          console.error('WebSocket closed due to authentication error');
        } else {
          console.log('WebSocket closed normally or max reconnect attempts reached');
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
      
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.isConnecting = false;
      throw error;
    }
  }

  private handleMessage(data: any): void {
    switch (data.type) {
      case 'connection_established':
        console.log('WebSocket connection confirmed:', data.message);
        this.sessionId = data.session_id;
        console.log('Session ID received:', this.sessionId);
        
        // Notify that session is established
        if (this.onSessionEstablished && this.sessionId) {
          this.onSessionEstablished(this.sessionId);
        }
        break;
        
      case 'exam_event_ack':
        console.log(`Exam event acknowledged: ${data.event_type} at ${data.timestamp}`);
        // Event was received and processed by backend
        break;
        
      case 'notification':
        if (this.onNotification) {
          this.onNotification(data.notification);
        }
        break;
        
      case 'exam_update':
        if (this.onExamUpdate) {
          this.onExamUpdate(data);
        }
        break;
        
      case 'video_chunk_ack':
        if (this.onVideoDataAck) {
          this.onVideoDataAck(data.timestamp, data.status);
        }
        break;
        
      case 'video_start_ack':
      case 'video_stop_ack':
        if (this.onVideoControlAck) {
          this.onVideoControlAck(data.status);
        }
        break;
        
      case 'video_finalized':
        console.log('Video recording finalized:', data);
        break;
        
      case 'test_response':
        console.log('Test connection response:', data.message);
        break;
        
      case 'ping':
        this.sendMessage({ type: 'pong', timestamp: Date.now() });
        break;
        
      case 'pong':
        console.log('Received pong from server');
        break;
        
      case 'error':
        console.error('WebSocket error from server:', data.message);
        break;
        
      default:
        console.log('Received unknown message type:', data.type, data);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connect();
    }, delay);
  }

  sendEvent(event: ExamEvent): void {
    this.sendMessage({
      type: 'exam_event',
      event
    });
  }

  sendVideoData(data: Blob, timestamp: number, isFinal: boolean = false): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send video data');
      return;
    }

    if (data.size === 0) {
      console.warn('Empty video data blob, skipping');
      return;
    }

    console.log(`Sending video data: ${data.size} bytes, type: ${data.type}`);

    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const result = reader.result as string;
        if (!result || typeof result !== 'string') {
          console.warn('FileReader result is null or not a string');
          return;
        }
        
        // FileReader.readAsDataURL returns "data:mime/type;base64,actualdata"
        // We need to extract just the base64 part after the last comma
        const commaIndex = result.lastIndexOf(',');
        if (commaIndex === -1) {
          console.warn('No comma found in data URL:', result.substring(0, 100));
          return;
        }
        
        const base64Data = result.substring(commaIndex + 1);
        if (!base64Data || base64Data.length === 0) {
          console.warn('No base64 data found after comma');
          return;
        }
        
        // Additional validation - base64 should not contain these characters
        if (base64Data.includes('base64') || base64Data.includes(';') || base64Data.includes('data:')) {
          console.error('Base64 data appears to be malformed, contains metadata:', base64Data.substring(0, 50));
          return;
        }
        
        // Check if it's valid base64 pattern (only A-Z, a-z, 0-9, +, /, and = for padding)
        const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
        if (!base64Pattern.test(base64Data)) {
          console.error('Base64 data contains invalid characters:', base64Data.substring(0, 50));
          return;
        }
        
        console.log(`Converted to base64: ${base64Data.length} characters (original: ${data.size} bytes)`);
        console.log(`First 50 chars: ${base64Data.substring(0, 50)}`);
        
        this.sendMessage({
          type: 'video_chunk',
          timestamp,
          data: base64Data,
          is_final: isFinal,
          size: data.size
        });
        
      } catch (error) {
        console.error('Error processing video data:', error);
      }
    };

    // Use readAsDataURL for reliable base64 encoding
    reader.readAsDataURL(data);
  }

  sendVideoControl(action: 'start' | 'stop', timestamp: number): void {
    this.sendMessage({
      type: `video_${action}`,
      timestamp
    });
  }

  testConnection(): void {
    this.sendMessage({
      type: 'test_connection',
      timestamp: Date.now()
    });
  }

  ping(): void {
    this.sendMessage({
      type: 'ping',
      timestamp: Date.now()
    });
  }

  private sendMessage(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
      }
    } else {
      console.warn('WebSocket is not connected, message not sent:', message);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}
