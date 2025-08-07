"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";

interface UnifiedCameraTrackerProps {
  websocket: ExamWebSocket | null;
  gazeEnabled: boolean;
  faceEnabled: boolean;
}

interface GazePosition {
  x: number;
  y: number;
  confidence: number;
}

let FaceLandmarker: any = null;
let FilesetResolver: any = null;

const UnifiedCameraTracker: React.FC<UnifiedCameraTrackerProps> = ({ websocket, gazeEnabled, faceEnabled }) => {
  // Gaze tracking state
  const [gazeIsCalibrated, setGazeIsCalibrated] = useState(false);
  const [gazeIsLookingAway, setGazeIsLookingAway] = useState(false);
  const [gazePosition, setGazePosition] = useState<GazePosition | null>(null);
  const [gazeAwayDuration, setGazeAwayDuration] = useState(0);
  const [gazeBaseline, setGazeBaseline] = useState<{x: number, y: number} | null>(null);

  // Face counting state
  const [faceCount, setFaceCount] = useState(0);
  const [faceViolationDuration, setFaceViolationDuration] = useState(0);
  const [isFaceViolating, setIsFaceViolating] = useState(false);

  // Shared state
  const [isInitialized, setIsInitialized] = useState(false);

  // Shared refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);

  // Gaze tracking refs
  const gazeAwayStartTime = useRef<number | null>(null);
  const gazeCalibrationSamples = useRef<{x: number, y: number}[]>([]);
  const gazeCalibrationStartTime = useRef<number>(0);
  const gazeLastEventTime = useRef<number>(Date.now());

  // Face tracking refs
  const faceViolationStartTime = useRef<number | null>(null);
  const faceLastDetectionTime = useRef<number>(Date.now());

  // Constants
  const GAZE_SCREEN_MARGIN = 50;
  const GAZE_AWAY_THRESHOLD = 1000;
  const GAZE_CHEATING_THRESHOLD = 10000;
  
  const FACE_EXPECTED_COUNT = 1;
  const FACE_VIOLATION_THRESHOLD = 3000;
  const FACE_CONFIDENCE_THRESHOLD = 0.7;

  const logGazeEvent = useCallback((gazeData: GazePosition, timestamp: number, lookingAway: boolean) => {
    if (!websocket?.isConnected()) return;

    const event = {
      type: 'gaze_tracking',
      timestamp,
      data: {
        gaze_x: Math.round(gazeData.x),
        gaze_y: Math.round(gazeData.y),
        screen_x: window.innerWidth,
        screen_y: window.innerHeight,
        looking_away: lookingAway,
        confidence: gazeData.confidence,
        timestamp
      }
    };

    websocket.sendEvent(event);
  }, [websocket]);

  const logFaceEvent = useCallback((eventType: 'face_count_violation' | 'face_detection_update', faces: number, duration?: number) => {
    if (!websocket?.isConnected()) return;

    const event = {
      type: eventType,
      timestamp: Date.now(),
      data: {
        face_count: faces,
        expected_faces: FACE_EXPECTED_COUNT,
        violation_duration: duration,
        timestamp: Date.now()
      }
    };

    websocket.sendEvent(event);
  }, [websocket]);

  const calculateGazePosition = useCallback((landmarks: any[]): GazePosition | null => {
    if (!landmarks || landmarks.length < 468) return null;

    try {
      const noseTip = landmarks[1];
      const leftEyeCorner = landmarks[33];
      const rightEyeCorner = landmarks[263];

      const leftEyeCenter = {
        x: (landmarks[33].x + landmarks[133].x) / 2,
        y: (landmarks[159].y + landmarks[145].y) / 2
      };
      const rightEyeCenter = {
        x: (landmarks[362].x + landmarks[263].x) / 2,
        y: (landmarks[386].y + landmarks[374].y) / 2
      };

      const faceCenter = {
        x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
        y: (leftEyeCenter.y + rightEyeCenter.y) / 2
      };

      const rawHeadRotationX = (noseTip.x - faceCenter.x);
      const rawHeadRotationY = (noseTip.y - faceCenter.y);

      const now = Date.now();
      if (!gazeBaseline) {
        if (gazeCalibrationStartTime.current === 0) {
          gazeCalibrationStartTime.current = now;
          console.log(`[Unified] Starting gaze calibration - look straight for 3 seconds...`);
        }
        
        if (now - gazeCalibrationStartTime.current < 3000) {
          gazeCalibrationSamples.current.push({ x: rawHeadRotationX, y: rawHeadRotationY });
          return {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            confidence: 0.5
          };
        } else {
          const avgX = gazeCalibrationSamples.current.reduce((sum, s) => sum + s.x, 0) / gazeCalibrationSamples.current.length;
          const avgY = gazeCalibrationSamples.current.reduce((sum, s) => sum + s.y, 0) / gazeCalibrationSamples.current.length;
          setGazeBaseline({ x: avgX, y: avgY });
          setGazeIsCalibrated(true);
          console.log(`[Unified] Gaze calibration complete! Baseline: (${avgX.toFixed(3)}, ${avgY.toFixed(3)})`);
        }
      }

      const calibratedX = gazeBaseline ? rawHeadRotationX - gazeBaseline.x : 0;
      const calibratedY = gazeBaseline ? rawHeadRotationY - gazeBaseline.y : 0;

      const screenCenterX = window.innerWidth / 2;
      const screenCenterY = window.innerHeight / 2;
      
      const gazeX = screenCenterX + (calibratedX * window.innerWidth * 3);
      const gazeY = screenCenterY + (calibratedY * window.innerHeight * 3);

      const eyeDistance = Math.abs(rightEyeCorner.x - leftEyeCorner.x);
      const faceSize = eyeDistance * Math.abs(landmarks[175].y - landmarks[10].y);
      const confidence = Math.min(1.0, Math.max(0.5, faceSize * 100));

      return { x: gazeX, y: gazeY, confidence };
    } catch (error) {
      console.warn('Error calculating gaze position:', error);
      return null;
    }
  }, [gazeBaseline]);

  const handleDetection = useCallback((landmarks: any[]) => {
    const now = Date.now();
    
    // GAZE TRACKING (if enabled) - include calibration logic here
    if (gazeEnabled) {
      const gazePos = calculateGazePosition(landmarks); // This handles calibration internally
      if (gazePos && gazeIsCalibrated) { // Only do gaze tracking after calibration
        setGazePosition(gazePos);

        const isOutsideScreen = 
          gazePos.x < GAZE_SCREEN_MARGIN || 
          gazePos.x > window.innerWidth - GAZE_SCREEN_MARGIN ||
          gazePos.y < GAZE_SCREEN_MARGIN || 
          gazePos.y > window.innerHeight - GAZE_SCREEN_MARGIN;

        if (isOutsideScreen) {
          if (!gazeAwayStartTime.current) {
            gazeAwayStartTime.current = now;
          } else {
            const awayDuration = now - gazeAwayStartTime.current;
            
            if (awayDuration > GAZE_AWAY_THRESHOLD && !gazeIsLookingAway) {
              setGazeIsLookingAway(true);
              logGazeEvent(gazePos, now, true);
              console.log('🔍 Unified: Gaze away detected');
            }
          }
        } else {
          if (gazeAwayStartTime.current && gazeIsLookingAway) {
            const awayDuration = now - gazeAwayStartTime.current;
            setGazeIsLookingAway(false);
            logGazeEvent(gazePos, now, false);
            console.log(`✅ Unified: Gaze returned (was away ${Math.round(awayDuration / 1000)}s)`);
            gazeAwayStartTime.current = null;
          }
        }
      }
    }

    // FACE COUNTING (if enabled) - this will be updated in processVideoFrame with actual face count
    // This function only handles the first detected face for gaze tracking

    // Debug logging
    if (now % 2000 < 100) {
      console.log(`[Unified Debug] Gaze: ${gazeEnabled ? 'ON' : 'OFF'} | Faces: ${faceEnabled ? 'ON' : 'OFF'} | Count: ${faceCount} | Processing...`);
    }
  }, [gazeEnabled, faceEnabled, gazeIsCalibrated, calculateGazePosition, gazeIsLookingAway, isFaceViolating, logGazeEvent, logFaceEvent, faceCount]);

  const processVideoFrame = useCallback(() => {
    if (!faceLandmarkerRef.current || !videoRef.current || !isInitialized) {
      animationRef.current = requestAnimationFrame(processVideoFrame);
      return;
    }

    try {
      const result = faceLandmarkerRef.current.detectForVideo(videoRef.current, Date.now());
      
      // Handle face counting first
      if (faceEnabled) {
        const detectedFaces = result.faceLandmarks ? result.faceLandmarks.length : 0;
        const now = Date.now();
        setFaceCount(detectedFaces);

        const hasViolation = detectedFaces !== FACE_EXPECTED_COUNT;
        
        if (hasViolation) {
          if (!faceViolationStartTime.current) {
            faceViolationStartTime.current = now;
            console.log(`👥 Unified: ${detectedFaces} faces detected (expected ${FACE_EXPECTED_COUNT})`);
          } else {
            const duration = now - faceViolationStartTime.current;
            setFaceViolationDuration(duration);
            
            if (duration > FACE_VIOLATION_THRESHOLD && !isFaceViolating) {
              setIsFaceViolating(true);
              logFaceEvent('face_count_violation', detectedFaces, duration);
              console.log(`🚨 Unified: Face violation - ${detectedFaces} faces for ${Math.round(duration / 1000)}s`);
            }
          }
        } else {
          if (faceViolationStartTime.current && isFaceViolating) {
            const totalDuration = now - faceViolationStartTime.current;
            logFaceEvent('face_detection_update', detectedFaces);
            console.log(`✅ Unified: Back to ${FACE_EXPECTED_COUNT} face`);
            faceViolationStartTime.current = null;
            setFaceViolationDuration(0);
            setIsFaceViolating(false);
          }
        }
      }
      
      // Handle gaze tracking using first detected face
      if (gazeEnabled && result.faceLandmarks && result.faceLandmarks.length > 0) {
        const landmarks = result.faceLandmarks[0]; // Use first detected face for gaze tracking
        handleDetection(landmarks);
      } else if (gazeEnabled) {
        // No face detected, handle calibration/gaze tracking with empty landmarks
        handleDetection([]);
      }
    } catch (error) {
      console.warn('[Unified] Error processing video frame:', error);
    }

    animationRef.current = requestAnimationFrame(processVideoFrame);
  }, [handleDetection, isInitialized, faceEnabled, gazeEnabled, isFaceViolating, logFaceEvent, faceCount]);

  const initializeCamera = useCallback(async () => {
    try {
      console.log('[Unified] Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        } 
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = resolve;
          }
        });
      }
      
      console.log('[Unified] Camera ready');
      return true;
    } catch (error) {
      console.error('[Unified] Failed to access camera:', error);
      return false;
    }
  }, []);

  const initializeMediaPipe = useCallback(async () => {
    try {
      console.log('[Unified] Initializing MediaPipe Face Landmarker...');
      
      if (!FaceLandmarker || !FilesetResolver) {
        const vision = await import('@mediapipe/tasks-vision');
        FaceLandmarker = vision.FaceLandmarker;
        FilesetResolver = vision.FilesetResolver;
      }

      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numFaces: 5, // Allow multiple faces for face counting
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false
        }
      );

      console.log('[Unified] MediaPipe initialized successfully');
      setIsInitialized(true);
      processVideoFrame();

    } catch (error) {
      console.error('[Unified] Failed to initialize MediaPipe:', error);
    }
  }, [processVideoFrame]);

  const startTracking = useCallback(async () => {
    if (!gazeEnabled && !faceEnabled) return;

    console.log('[Unified] Starting unified camera tracking...');
    const cameraReady = await initializeCamera();
    if (!cameraReady) return;

    await initializeMediaPipe();
  }, [gazeEnabled, faceEnabled, initializeCamera, initializeMediaPipe]);

  useEffect(() => {
    if (gazeEnabled || faceEnabled) {
      startTracking();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [gazeEnabled, faceEnabled, startTracking]);

  // Update durations in real-time
  useEffect(() => {
    if (!gazeAwayStartTime.current) {
      setGazeAwayDuration(0);
      return;
    }
    const interval = setInterval(() => {
      if (gazeAwayStartTime.current) {
        setGazeAwayDuration(Date.now() - gazeAwayStartTime.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [gazeIsLookingAway]);

  useEffect(() => {
    if (!faceViolationStartTime.current) {
      setFaceViolationDuration(0);
      return;
    }
    const interval = setInterval(() => {
      if (faceViolationStartTime.current) {
        setFaceViolationDuration(Date.now() - faceViolationStartTime.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isFaceViolating]);

  const renderStatusIndicator = () => {
    if (!gazeEnabled && !faceEnabled) return null;

    return (
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {/* Gaze Tracking Status */}
        {gazeEnabled && (
          <div className={`px-3 py-1 rounded-full text-white text-xs font-medium shadow-lg ${
            !isInitialized ? 'bg-blue-500' :
            !gazeIsCalibrated ? 'bg-yellow-500 animate-pulse' :
            gazeIsLookingAway ? 'bg-red-500 animate-pulse' : 'bg-green-500'
          }`}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white"></div>
              {!isInitialized ? 'Starting...' :
               !gazeIsCalibrated ? `Calibrating...` :
               gazeIsLookingAway ? `Away (${Math.round(gazeAwayDuration / 1000)}s)` : 'Gaze: Tracking'}
            </div>
          </div>
        )}

        {/* Face Counting Status */}
        {faceEnabled && isInitialized && (
          <div className={`px-3 py-1 rounded-full text-white text-xs font-medium shadow-lg ${
            isFaceViolating ? 'bg-red-500 animate-pulse' :
            faceCount === 1 ? 'bg-green-500' : 'bg-yellow-500'
          }`}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white"></div>
              {isFaceViolating ? 
                `${faceCount} faces (${Math.round(faceViolationDuration / 1000)}s)` : 
                `Faces: ${faceCount}`}
            </div>
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

export default UnifiedCameraTracker;