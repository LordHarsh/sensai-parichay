"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";

interface MultiFaceDetectorProps {
  websocket: ExamWebSocket | null;
  enabled: boolean;
}

interface FaceDetectionEvent {
  type: 'face_count_violation' | 'face_detection_update';
  timestamp: number;
  data: {
    face_count: number;
    expected_faces: number;
    violation_duration?: number;
    confidence_scores?: number[];
    face_positions?: Array<{x: number, y: number, width: number, height: number}>;
    timestamp: number;
  };
}

let FaceDetector: any = null;
let FilesetResolver: any = null;

const MultiFaceDetector: React.FC<MultiFaceDetectorProps> = ({ websocket, enabled }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [violationStartTime, setViolationStartTime] = useState<number | null>(null);
  const [violationDuration, setViolationDuration] = useState(0);
  const [isViolating, setIsViolating] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceDetectorRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const lastDetectionTime = useRef<number>(Date.now());

  // Constants
  const EXPECTED_FACES = 1;
  const VIOLATION_THRESHOLD = 3000; // 3 seconds before logging violation
  const DETECTION_INTERVAL = 1000; // Check every second
  const CONFIDENCE_THRESHOLD = 0.7; // Minimum confidence for face detection

  const logFaceEvent = useCallback((eventType: 'face_count_violation' | 'face_detection_update', faces: number, duration?: number) => {
    if (!websocket?.isConnected()) return;

    const event: FaceDetectionEvent = {
      type: eventType,
      timestamp: Date.now(),
      data: {
        face_count: faces,
        expected_faces: EXPECTED_FACES,
        violation_duration: duration,
        timestamp: Date.now()
      }
    };

    websocket.sendEvent(event);

    if (eventType === 'face_count_violation') {
      console.log(`🚨 MultiFace Violation: ${faces} faces detected (expected ${EXPECTED_FACES}) for ${Math.round((duration || 0) / 1000)}s`);
    }
  }, [websocket]);

  const handleFaceDetection = useCallback((detections: any[]) => {
    const now = Date.now();
    
    // Filter detections by confidence
    const validDetections = detections.filter(detection => 
      detection.categories && detection.categories[0] && detection.categories[0].score > CONFIDENCE_THRESHOLD
    );
    
    const detectedFaces = validDetections.length;
    setFaceCount(detectedFaces);

    // Check for violations (not exactly 1 face)
    const hasViolation = detectedFaces !== EXPECTED_FACES;
    
    if (hasViolation) {
      if (!violationStartTime) {
        setViolationStartTime(now);
        console.log(`👥 MultiFace: ${detectedFaces} faces detected (expected ${EXPECTED_FACES}) - starting timer`);
      } else {
        const duration = now - violationStartTime;
        setViolationDuration(duration);
        
        // Send violation event when threshold is reached (first time only)
        if (duration > VIOLATION_THRESHOLD && !isViolating) {
          setIsViolating(true);
          logFaceEvent('face_count_violation', detectedFaces, duration);
          console.log(`🚨 MultiFace: Violation threshold reached - ${detectedFaces} faces for ${Math.round(duration / 1000)}s`);
        }
        
        // Log extended violations periodically (every 5 seconds) - only if already violating
        if (isViolating && duration > VIOLATION_THRESHOLD && (duration % 5000 < 100)) {
          logFaceEvent('face_count_violation', detectedFaces, duration);
          console.log(`🚨 MultiFace: Extended violation - ${detectedFaces} faces for ${Math.round(duration / 1000)}s`);
        }
      }
    } else {
      if (violationStartTime) {
        const totalDuration = now - violationStartTime;
        
        // Send end-of-violation event
        if (isViolating) {
          logFaceEvent('face_detection_update', detectedFaces); // Send "back to normal" event
          console.log(`MultiFace: Back to ${EXPECTED_FACES} face (violation lasted ${Math.round(totalDuration / 1000)}s)`);
        }
        
        setViolationStartTime(null);
        setViolationDuration(0);
        setIsViolating(false);
      }
    }

    // Log periodic updates ONLY when not violating (to reduce spam)
    if (!hasViolation && now - lastDetectionTime.current > DETECTION_INTERVAL) {
      logFaceEvent('face_detection_update', detectedFaces);
      lastDetectionTime.current = now;
    }

    // Debug logging (always continue) - MORE FREQUENT FOR DEBUGGING
    if (now % 1000 < 100) { // Every 1 second during debugging
      console.log(`[MultiFace Debug] Faces: ${detectedFaces} | Expected: ${EXPECTED_FACES} | Violation: ${hasViolation} | ViolationStart: ${violationStartTime} | IsViolating: ${isViolating} | Duration: ${violationDuration}ms | Processing continues...`);
    }
  }, [violationStartTime, violationDuration, isViolating, logFaceEvent]);

  const processVideoFrame = useCallback(() => {
    // Heartbeat every 2 seconds to confirm processing continues
    const now = Date.now();
    if (now % 2000 < 50) {
      console.log('[MultiFace Heartbeat] Video processing active at', new Date(now).toLocaleTimeString());
    }

    if (!faceDetectorRef.current || !videoRef.current || !isInitialized) {
      animationRef.current = requestAnimationFrame(processVideoFrame);
      return;
    }

    try {
      const result = faceDetectorRef.current.detectForVideo(videoRef.current, Date.now());
      
      if (result.detections) {
        handleFaceDetection(result.detections);
      } else {
        // No detections found, treat as 0 faces
        console.log('[MultiFace] No detections in frame, treating as 0 faces');
        handleFaceDetection([]);
      }
    } catch (error) {
      console.error('[MultiFace] Error processing video frame, but continuing:', error);
      // Continue processing even if there's an error - DO NOT STOP!
    }

    // ALWAYS continue the animation loop - this is critical!
    animationRef.current = requestAnimationFrame(processVideoFrame);
  }, [handleFaceDetection, isInitialized]);

  const initializeCamera = useCallback(async () => {
    try {
      console.log('[MultiFace] Attempting to find existing video streams...');
      
      // Try to find an existing video element with a stream (from MediaPipeGazeTracker)
      const existingVideoElements = document.querySelectorAll('video');
      let existingStream: MediaStream | null = null;
      
      for (const videoElement of existingVideoElements) {
        if (videoElement.srcObject && videoElement.srcObject instanceof MediaStream) {
          existingStream = videoElement.srcObject;
          console.log('[MultiFace] Found existing camera stream, reusing it!');
          break;
        }
      }
      
      if (existingStream) {
        // Reuse existing stream
        streamRef.current = existingStream;
        if (videoRef.current) {
          videoRef.current.srcObject = existingStream;
          console.log('[MultiFace] Reusing existing video stream');
        }
        return true;
      } else {
        // Fallback: try to get new stream (will likely fail due to camera conflict)
        console.log('[MultiFace] No existing stream found, requesting new camera access...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            frameRate: { ideal: 15 }
          } 
        });
        
        console.log('[MultiFace] Camera access granted');
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = resolve;
            }
          });
          console.log('[MultiFace] Video stream ready');
        }
        return true;
      }
    } catch (error) {
      console.error('[MultiFace] Failed to access camera:', error);
      console.error('[MultiFace] Error details:', (error as Error).name, (error as Error).message);
      return false;
    }
  }, []);

  const initializeMediaPipe = useCallback(async () => {
    try {
      console.log('[MultiFace] Initializing MediaPipe Face Detector...');
      
      if (!FaceDetector || !FilesetResolver) {
        console.log('[MultiFace] Loading MediaPipe tasks-vision module...');
        const vision = await import('@mediapipe/tasks-vision');
        FaceDetector = vision.FaceDetector;
        FilesetResolver = vision.FilesetResolver;
        console.log('[MultiFace] MediaPipe module loaded');
      }

      console.log('[MultiFace] Creating FilesetResolver...');
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      console.log('[MultiFace] FilesetResolver ready');
      
      console.log('[MultiFace] Creating FaceDetector with model...');
      faceDetectorRef.current = await FaceDetector.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          minDetectionConfidence: CONFIDENCE_THRESHOLD,
          minSuppressionThreshold: 0.3
        }
      );

      console.log('[MultiFace] MediaPipe Face Detector initialized successfully!');
      setIsInitialized(true);
      
      // Start processing video frames
      console.log('[MultiFace] Starting video frame processing...');
      processVideoFrame();

    } catch (error) {
      console.error('[MultiFace] Failed to initialize MediaPipe Face Detector:', error);
      console.error('[MultiFace] Error details:', (error as Error).name, (error as Error).message, (error as Error).stack);
    }
  }, [processVideoFrame]);

  const startFaceDetection = useCallback(async () => {
    console.log('[MultiFace] startFaceDetection called, enabled:', enabled);
    if (!enabled) {
      console.log('[MultiFace] Face detection disabled, skipping initialization');
      return;
    }

    console.log('[MultiFace] Initializing camera...');
    const cameraReady = await initializeCamera();
    if (!cameraReady) {
      console.log('[MultiFace] Camera initialization failed, aborting');
      return;
    }

    console.log('[MultiFace] Camera ready, initializing MediaPipe...');
    await initializeMediaPipe();
  }, [enabled, initializeCamera, initializeMediaPipe]);

  useEffect(() => {
    if (enabled) {
      // Add a delay to ensure MediaPipeGazeTracker has initialized first
      console.log('[MultiFace] Waiting 5 seconds for MediaPipeGazeTracker to initialize first...');
      setTimeout(() => {
        startFaceDetection();
      }, 5000);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, startFaceDetection]);

  // Update violation duration in real-time
  useEffect(() => {
    if (!violationStartTime) {
      setViolationDuration(0);
      return;
    }

    const updateDuration = () => {
      if (violationStartTime) {
        setViolationDuration(Date.now() - violationStartTime);
      }
    };

    const interval = setInterval(updateDuration, 100);
    return () => clearInterval(interval);
  }, [violationStartTime]);

  const renderStatusIndicator = () => {
    if (!enabled) return null;

    let status = 'Disabled';
    let color = 'bg-gray-500';
    let violationTimeDisplay = '';

    if (isInitialized) {
      if (isViolating && violationDuration > 0) {
        const violationTime = Math.round(violationDuration / 1000);
        const faceText = faceCount === 0 ? 'No faces' : `${faceCount} faces`;
        status = `${faceText} (${violationTime}s) - MONITORING`;
        color = violationTime >= 3 ? 'bg-red-600 animate-pulse' : 'bg-orange-500';
        if (violationTime >= 3) {
          violationTimeDisplay = faceCount === 0 ? '⚠️ EXAM TAKER NOT VISIBLE' : '⚠️ MULTIPLE PEOPLE DETECTED';
        }
      } else {
        status = `${faceCount} face detected - MONITORING`;
        color = faceCount === 1 ? 'bg-green-500' : 'bg-yellow-500';
      }
    } else if (enabled) {
      status = 'Starting...';
      color = 'bg-blue-500';
    }

    return (
      <div className="fixed top-4 right-4 z-50">
        <div className={`px-3 py-1 rounded-md text-white text-xs font-medium ${color} shadow-lg`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-md ${isViolating ? 'animate-pulse' : ''} bg-white`}></div>
            Face Count: {status}
          </div>
        </div>
        {violationTimeDisplay && (
          <div className="mt-1 text-xs text-red-600 bg-red-100 px-2 py-1 rounded shadow font-bold">
            {violationTimeDisplay}
          </div>
        )}
        {isInitialized && (
          <div className="mt-1 text-xs text-gray-600 bg-white px-2 py-1 rounded shadow">
            Expected: {EXPECTED_FACES} | Detected: {faceCount}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderStatusIndicator()}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: 'none' }}
      />
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />
    </>
  );
};

export default MultiFaceDetector;