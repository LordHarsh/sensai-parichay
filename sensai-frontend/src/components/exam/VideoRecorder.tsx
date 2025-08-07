import { useRef, useState, useEffect } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";
import { Camera, CameraOff, Wifi, WifiOff, AlertTriangle, CheckCircle, Video, Mic } from "lucide-react";

interface VideoRecorderProps {
  isRecording: boolean;
  examId: string;
  websocket: ExamWebSocket | null;
}

export default function VideoRecorder({ isRecording, examId, websocket }: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dataTransferred, setDataTransferred] = useState<number>(0);

  useEffect(() => {
    if (isRecording && hasPermission !== false) {
      startRecording();
    } else if (!isRecording && recordingStatus === 'recording') {
      stopRecording();
    }
  }, [isRecording]);

  useEffect(() => {
    requestPermissions();
    
    return () => {
      cleanup();
    };
  }, []);

  // Set up WebSocket callbacks and connection monitoring
  useEffect(() => {
    if (websocket) {
      websocket.onVideoDataAck = (timestamp: number, status: string) => {
        console.log(`Video data acknowledged: ${timestamp}, status: ${status}`);
      };
      
      websocket.onVideoControlAck = (status: string) => {
        console.log(`Video control acknowledged: ${status}`);
      };

      // Monitor WebSocket connection status
      const connectionMonitor = setInterval(() => {
        if (!websocket.isConnected() && recordingStatus === 'recording') {
          console.warn('WebSocket disconnected, stopping video recording');
          stopRecording();
        }
      }, 1000); // Check every second

      return () => {
        clearInterval(connectionMonitor);
      };
    }
  }, [websocket, recordingStatus]);

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }, 
        audio: true 
      });
      
      setHasPermission(true);
      setError(null);
      
      // Keep the stream active for video preview
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
      
      // Don't stop tracks immediately - keep stream for preview
      // stream.getTracks().forEach(track => track.stop());
      
    } catch (err) {
      console.error('Permission denied:', err);
      setHasPermission(false);
      setError('Camera and microphone access is required for the exam.');
    }
  };

  const startRecording = async () => {
    if (recordingStatus !== 'idle' || !hasPermission) {
      return;
    }

    try {
      setRecordingStatus('starting');
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }, 
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Use WebM format for better streaming support (MP4 doesn't work well with chunked streaming)
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'; // Fallback to MP4
        }
      }

      console.log('Using MIME type:', mimeType);
      const options: MediaRecorderOptions = { mimeType };

      mediaRecorderRef.current = new MediaRecorder(stream, options);

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('Video chunk size:', event.data.size, 'type:', event.data.type);
          // Only stream if WebSocket is connected
          if (websocket?.isConnected()) {
            streamVideoData(event.data);
          } else {
            console.log('Skipping video chunk - WebSocket not connected');
          }
        }
      };

      mediaRecorderRef.current.onstop = () => {
        console.log('MediaRecorder stopped');
        setRecordingStatus('idle');
        // Send final chunk when stopping
        if (websocket?.isConnected()) {
          websocket.sendVideoControl('stop', Date.now());
        }
      };

      mediaRecorderRef.current.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setError('Recording error occurred');
        setRecordingStatus('idle');
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      };

      // Send start signal to backend
      if (websocket?.isConnected()) {
        websocket.sendVideoControl('start', Date.now());
      }

      // Start recording with longer intervals for better file integrity
      mediaRecorderRef.current.start(2000); // Request data every 2 seconds for more stable chunks
      setRecordingStatus('recording');

      // Also set up interval as backup
      streamIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.requestData();
        }
      }, 2000);

    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to start video recording. Please check your camera and microphone.');
      setRecordingStatus('idle');
    }
  };

  const stopRecording = () => {
    if (recordingStatus !== 'recording') {
      return;
    }

    setRecordingStatus('stopping');

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    cleanup();
    setRecordingStatus('idle');
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  };

  const streamVideoData = async (blob: Blob) => {
    if (!websocket || !websocket.isConnected()) {
      console.warn('WebSocket not connected, cannot stream video data');
      return;
    }

    const timestamp = Date.now();

    try {
      websocket.sendVideoData(blob, timestamp, false);
      setDataTransferred(prev => prev + blob.size);
      
    } catch (err) {
      console.error('Failed to stream video data:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getStatusColor = () => {
    switch (recordingStatus) {
      case 'recording':
        return 'text-red-400';
      case 'starting':
      case 'stopping':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusText = () => {
    switch (recordingStatus) {
      case 'recording':
        return 'Recording';
      case 'starting':
        return 'Starting...';
      case 'stopping':
        return 'Stopping...';
      default:
        return 'Ready';
    }
  };

  if (hasPermission === false) {
    return (
      <div className="h-full bg-gray-900 border-l border-gray-700 p-6">
        <div className="flex flex-col h-full">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Camera Access</h3>
            <div className="h-px bg-gray-700"></div>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CameraOff className="w-8 h-8 text-red-400" />
              </div>
              <h4 className="text-lg font-semibold text-gray-100 mb-2">Camera Permission Required</h4>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                To proceed with the exam, we need access to your camera and microphone for monitoring purposes.
              </p>
              <button
                onClick={requestPermissions}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
              >
                Grant Permission
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-100">Video Monitor</h3>
          <div className="flex items-center space-x-2">
            {websocket?.isConnected() ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-400" />
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <div className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${
            recordingStatus === 'recording' 
              ? 'bg-red-900/50 text-red-400 border border-red-500' 
              : 'bg-gray-800 text-gray-400 border border-gray-600'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              recordingStatus === 'recording' ? 'bg-red-400 animate-pulse' : 'bg-gray-500'
            }`}></div>
            <span className="font-medium">{getStatusText()}</span>
          </div>
        </div>
      </div>

      {/* Video Feed */}
      <div className="flex-1 p-4">
        <div className="relative aspect-video bg-gray-800 rounded-lg overflow-hidden border border-gray-600">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          
          {recordingStatus === 'recording' && (
            <div className="absolute top-3 left-3">
              <div className="bg-red-600 text-white px-2 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                <span>RECORDING</span>
              </div>
            </div>
          )}

          {!streamRef.current && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="text-center">
                <Camera className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Camera not active</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-amber-900/20 border border-amber-500/50 rounded-lg">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-300">Recording Issue</p>
                <p className="text-sm text-amber-400">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <Video className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-medium text-gray-300">Video Quality</span>
            </div>
            <p className="text-sm font-semibold text-gray-100">720p • 30fps</p>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center space-x-2 mb-1">
              <Mic className="w-4 h-4 text-gray-400" />
              <span className="text-xs font-medium text-gray-300">Data Transfer</span>
            </div>
            <p className="text-sm font-semibold text-gray-100">{formatBytes(dataTransferred)}</p>
          </div>
        </div>

        {/* Connection Status */}
        <div className="mt-4">
          <div className="flex items-center space-x-2">
            {hasPermission ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            )}
            <span className="text-sm text-gray-300">
              {hasPermission ? 'Camera permissions granted' : 'Camera permissions required'}
            </span>
          </div>
          
          <div className="flex items-center space-x-2 mt-2">
            {websocket?.isConnected() ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            )}
            <span className="text-sm text-gray-300">
              {websocket?.isConnected() ? 'Connection stable' : 'Connection issues'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
