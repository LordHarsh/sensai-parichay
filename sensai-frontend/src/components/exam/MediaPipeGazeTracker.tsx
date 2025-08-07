import { useEffect, useRef, useState, useCallback } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";
import { GazeTrackingEvent } from "@/types/exam";

interface MediaPipeGazeTrackerProps {
  websocket: ExamWebSocket | null;
  enabled: boolean;
}

interface GazePosition {
  x: number;
  y: number;
  confidence: number;
}

let FaceLandmarker: any = null;
let FilesetResolver: any = null;

const MediaPipeGazeTracker: React.FC<MediaPipeGazeTrackerProps> = ({ websocket, enabled }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [isLookingAway, setIsLookingAway] = useState(false);
  const [gazePosition, setGazePosition] = useState<GazePosition | null>(null);
  const [awayDuration, setAwayDuration] = useState<number>(0);
  
  // Calibration baseline - center position when looking straight
  const [baseline, setBaseline] = useState<{x: number, y: number} | null>(null);
  const calibrationSamples = useRef<{x: number, y: number}[]>([]);
  const calibrationStartTime = useRef<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const lastGazeTime = useRef<number>(Date.now());
  const gazeAwayStartTime = useRef<number | null>(null);
  const cheatingWarningLogged = useRef<boolean>(false);
  const calibrationPoints = useRef<GazePosition[]>([]);

  // Constants - optimized for better detection
  const SCREEN_MARGIN = 50; // pixels from edge to consider "looking away" - reduced for better sensitivity
  const GAZE_AWAY_THRESHOLD = 1000; // ms before considering "looking away" - reduced for faster detection
  const CHEATING_THRESHOLD = 10000; // 10 seconds in ms
  const TRACKING_INTERVAL = 500; // ms between gaze tracking events

  const logGazeEvent = useCallback((gazeData: GazePosition, timestamp: number, lookingAway: boolean) => {
    if (!websocket?.isConnected()) return;

    const event: GazeTrackingEvent = {
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

    if (lookingAway) {
      console.log(`📊 MediaPipe Gaze: Looking away detected at (${event.data.gaze_x}, ${event.data.gaze_y}) with confidence ${gazeData.confidence.toFixed(2)}`);
    }
  }, [websocket]);

  const calculateGazePosition = useCallback((landmarks: any[]): GazePosition | null => {
    if (!landmarks || landmarks.length < 468) return null;

    try {
      // Key facial landmarks
      const noseTip = landmarks[1];        // Nose tip
      const leftEyeCorner = landmarks[33]; // Left eye outer corner
      const rightEyeCorner = landmarks[263]; // Right eye outer corner

      // Simplified eye center calculation
      const leftEyeCenter = {
        x: (landmarks[33].x + landmarks[133].x) / 2,
        y: (landmarks[159].y + landmarks[145].y) / 2
      };
      const rightEyeCenter = {
        x: (landmarks[362].x + landmarks[263].x) / 2,
        y: (landmarks[386].y + landmarks[374].y) / 2
      };

      // Calculate face center and orientation
      const faceCenter = {
        x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
        y: (leftEyeCenter.y + rightEyeCenter.y) / 2
      };

      // Calculate head rotation based on nose position relative to face center
      const rawHeadRotationX = (noseTip.x - faceCenter.x); // Horizontal head rotation
      const rawHeadRotationY = (noseTip.y - faceCenter.y); // Vertical head rotation

      // Auto-calibration: collect samples for 3 seconds, then average them
      const now = Date.now();
      if (!baseline) {
        if (calibrationStartTime.current === 0) {
          calibrationStartTime.current = now;
          console.log(`[MediaPipe] Starting calibration - please look straight at the screen for 3 seconds...`);
        }
        
        // Collect samples for 3 seconds
        if (now - calibrationStartTime.current < 3000) {
          calibrationSamples.current.push({ x: rawHeadRotationX, y: rawHeadRotationY });
          return {
            x: window.innerWidth / 2, // Return center during calibration
            y: window.innerHeight / 2,
            confidence: 0.5
          };
        } else {
          // Calculate average baseline from collected samples
          const avgX = calibrationSamples.current.reduce((sum, s) => sum + s.x, 0) / calibrationSamples.current.length;
          const avgY = calibrationSamples.current.reduce((sum, s) => sum + s.y, 0) / calibrationSamples.current.length;
          setBaseline({ x: avgX, y: avgY });
          setIsCalibrated(true);
          console.log(`[MediaPipe] Calibration complete! Baseline: (${avgX.toFixed(3)}, ${avgY.toFixed(3)}) from ${calibrationSamples.current.length} samples`);
        }
      }

      // Calculate relative movement from baseline (calibrated position)
      const calibratedX = baseline ? rawHeadRotationX - baseline.x : 0;
      const calibratedY = baseline ? rawHeadRotationY - baseline.y : 0;

      // Map to screen coordinates with reasonable sensitivity (much lower than before)
      const screenCenterX = window.innerWidth / 2;
      const screenCenterY = window.innerHeight / 2;
      
      // Reduced sensitivity for more stable detection
      const gazeX = screenCenterX + (calibratedX * window.innerWidth * 3);
      const gazeY = screenCenterY + (calibratedY * window.innerHeight * 3);

      // Calculate confidence based on face detection quality
      const eyeDistance = Math.abs(rightEyeCorner.x - leftEyeCorner.x);
      const faceSize = eyeDistance * Math.abs(landmarks[175].y - landmarks[10].y); // width * height
      const confidence = Math.min(1.0, Math.max(0.5, faceSize * 100));

      // Debug logging
      if (now % 3000 < 100) {
        console.log(`[MediaPipe Debug] Raw: (${rawHeadRotationX.toFixed(3)}, ${rawHeadRotationY.toFixed(3)}) | Calibrated: (${calibratedX.toFixed(3)}, ${calibratedY.toFixed(3)}) | Gaze: (${gazeX.toFixed(1)}, ${gazeY.toFixed(1)}) | Screen: ${window.innerWidth}x${window.innerHeight}`);
        if (baseline) {
          console.log(`[MediaPipe Debug] Baseline: (${baseline.x.toFixed(3)}, ${baseline.y.toFixed(3)})`);
        }
      }

      // DON'T clamp coordinates - let them go outside screen bounds for proper "looking away" detection
      return {
        x: gazeX,
        y: gazeY,
        confidence
      };
    } catch (error) {
      console.warn('Error calculating gaze position:', error);
      return null;
    }
  }, []);

  const handleGazeDetection = useCallback((landmarks: any[]) => {
    const gazePos = calculateGazePosition(landmarks);
    if (!gazePos) return;

    const now = Date.now();
    setGazePosition(gazePos);

    // Check if looking away from screen
    const isOutsideScreen = 
      gazePos.x < SCREEN_MARGIN || 
      gazePos.x > window.innerWidth - SCREEN_MARGIN ||
      gazePos.y < SCREEN_MARGIN || 
      gazePos.y > window.innerHeight - SCREEN_MARGIN;

    // Enhanced debug logging (more frequent for testing)
    if (now % 2000 < 100) { // Log every 2 seconds for better debugging
      const leftMargin = gazePos.x < SCREEN_MARGIN;
      const rightMargin = gazePos.x > window.innerWidth - SCREEN_MARGIN;
      const topMargin = gazePos.y < SCREEN_MARGIN;
      const bottomMargin = gazePos.y > window.innerHeight - SCREEN_MARGIN;
      console.log(`[MediaPipe Gaze] Position: (${Math.round(gazePos.x)}, ${Math.round(gazePos.y)}) | Screen: ${window.innerWidth}x${window.innerHeight} | Margin: ${SCREEN_MARGIN}px`);
      console.log(`[MediaPipe Gaze] Margins - Left: ${leftMargin}, Right: ${rightMargin}, Top: ${topMargin}, Bottom: ${bottomMargin} | Looking away: ${isOutsideScreen} | Confidence: ${(gazePos.confidence * 100).toFixed(0)}%`);
    }

    // Handle looking away detection
    if (isOutsideScreen) {
      if (!gazeAwayStartTime.current) {
        gazeAwayStartTime.current = now;
        cheatingWarningLogged.current = false;
      } else {
        const awayDuration = now - gazeAwayStartTime.current;
        
        if (awayDuration > GAZE_AWAY_THRESHOLD && !isLookingAway) {
          setIsLookingAway(true);
          // Send event when starting to look away
          logGazeEvent(gazePos, now, true);
          console.log('🔍 MediaPipe: Exam taker is looking away from screen');
        }
        
        if (awayDuration > CHEATING_THRESHOLD && !cheatingWarningLogged.current) {
          cheatingWarningLogged.current = true;
          console.log('---MIGHT BE CHEATING---');
          console.log(`🚨 ALERT: Exam taker has been looking away for ${Math.round(awayDuration / 1000)} seconds`);
          
          // Send extended violation event
          const cheatingEvent: GazeTrackingEvent = {
            type: 'gaze_tracking',
            timestamp: now,
            data: {
              gaze_x: Math.round(gazePos.x),
              gaze_y: Math.round(gazePos.y),
              screen_x: window.innerWidth,
              screen_y: window.innerHeight,
              looking_away: true,
              confidence: gazePos.confidence,
              timestamp: now,
              violation_type: 'extended_gaze_away',
              duration_away: awayDuration
            }
          };
          
          if (websocket?.isConnected()) {
            websocket.sendEvent(cheatingEvent);
          }
        }
      }
    } else {
      if (gazeAwayStartTime.current) {
        const awayDuration = now - gazeAwayStartTime.current;
        
        if (isLookingAway) {
          setIsLookingAway(false);
          // Send event when returning to look at screen (end of violation)
          logGazeEvent(gazePos, now, false);
          console.log(`✅ MediaPipe: Exam taker is looking back at screen (was away for ${Math.round(awayDuration / 1000)}s)`);
        }
        
        gazeAwayStartTime.current = null;
        cheatingWarningLogged.current = false;
      }
    }

    // REMOVED: No longer send periodic gaze tracking events when looking normally
    // Only send events when violations occur (looking away = true) or when returning to normal (looking away = false)
  }, [calculateGazePosition, isLookingAway, logGazeEvent, websocket]);

  const processVideoFrame = useCallback(() => {
    if (!faceLandmarkerRef.current || !videoRef.current || !isInitialized) {
      animationRef.current = requestAnimationFrame(processVideoFrame);
      return;
    }

    try {
      const result = faceLandmarkerRef.current.detectForVideo(videoRef.current, Date.now());
      
      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        const landmarks = result.faceLandmarks[0];
        handleGazeDetection(landmarks);
      }
    } catch (error) {
      console.warn('Error processing video frame:', error);
    }

    animationRef.current = requestAnimationFrame(processVideoFrame);
  }, [handleGazeDetection, isInitialized]);

  const initializeCamera = useCallback(async () => {
    try {
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
      
      return true;
    } catch (error) {
      console.error('Failed to access camera:', error);
      return false;
    }
  }, []);

  const initializeMediaPipe = useCallback(async () => {
    try {
      console.log('Initializing MediaPipe Face Landmarker...');
      
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
          numFaces: 1,
          minFaceDetectionConfidence: 0.5, // Increased for better accuracy
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true // Enable for head pose
        }
      );

      console.log('MediaPipe Face Landmarker initialized successfully');
      setIsInitialized(true);
      
      // Start processing video frames
      processVideoFrame();
      
      // Auto-calibration (simplified - MediaPipe doesn't need extensive calibration)
      setTimeout(() => {
        setIsCalibrated(true);
        console.log('MediaPipe gaze tracking calibrated and ready');
      }, 2000);

    } catch (error) {
      console.error('Failed to initialize MediaPipe:', error);
    }
  }, [processVideoFrame]);

  const startGazeTracking = useCallback(async () => {
    if (!enabled) return;

    const cameraReady = await initializeCamera();
    if (!cameraReady) return;

    await initializeMediaPipe();
  }, [enabled, initializeCamera, initializeMediaPipe]);

  useEffect(() => {
    if (enabled) {
      startGazeTracking();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [enabled, startGazeTracking]);

  // Update away duration in real-time
  useEffect(() => {
    if (!isLookingAway || !gazeAwayStartTime.current) {
      setAwayDuration(0);
      return;
    }

    const updateDuration = () => {
      if (gazeAwayStartTime.current) {
        setAwayDuration(Date.now() - gazeAwayStartTime.current);
      }
    };

    const interval = setInterval(updateDuration, 100);
    return () => clearInterval(interval);
  }, [isLookingAway]);

  const renderStatusIndicator = () => {
    if (!enabled) return null;

    let status = 'Disabled';
    let color = 'bg-gray-500';
    let awayTimeDisplay = '';

    if (isInitialized && isCalibrated) {
      if (isLookingAway && awayDuration > 0) {
        const awayTime = Math.round(awayDuration / 1000);
        status = `Away (${awayTime}s)`;
        color = awayTime >= 10 ? 'bg-red-600 animate-pulse' : 'bg-red-500';
        if (awayTime >= 10) {
          awayTimeDisplay = '⚠️ MIGHT BE CHEATING';
        }
      } else {
        status = 'Tracking';
        color = 'bg-green-500';
      }
    } else if (isInitialized && !isCalibrated) {
      const elapsed = calibrationStartTime.current ? Math.round((Date.now() - calibrationStartTime.current) / 1000) : 0;
      const remaining = Math.max(0, 3 - elapsed);
      status = `Calibrating (${remaining}s)`;
      color = 'bg-yellow-500 animate-pulse';
    } else if (enabled) {
      status = 'Starting...';
      color = 'bg-blue-500';
    }

    return (
      <div className="fixed top-20 right-4 z-50">
        <div className={`px-3 py-1 rounded-full text-white text-xs font-medium ${color} shadow-lg`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isLookingAway ? 'animate-pulse' : ''} bg-white`}></div>
            MediaPipe Gaze: {status}
          </div>
        </div>
        {awayTimeDisplay && (
          <div className="mt-1 text-xs text-red-600 bg-red-100 px-2 py-1 rounded shadow font-bold">
            {awayTimeDisplay}
          </div>
        )}
        {gazePosition && isInitialized && (
          <div className="mt-1 text-xs text-gray-600 bg-white px-2 py-1 rounded shadow">
            {Math.round(gazePosition.x)}, {Math.round(gazePosition.y)} ({(gazePosition.confidence * 100).toFixed(0)}%)
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

export default MediaPipeGazeTracker;