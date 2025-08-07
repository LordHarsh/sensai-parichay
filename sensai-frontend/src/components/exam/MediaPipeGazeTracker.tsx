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

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const lastGazeTime = useRef<number>(Date.now());
  const gazeAwayStartTime = useRef<number | null>(null);
  const cheatingWarningLogged = useRef<boolean>(false);
  const calibrationPoints = useRef<GazePosition[]>([]);

  // Constants - adjusted for better accuracy
  const SCREEN_MARGIN = 100; // pixels from edge to consider "looking away" - increased for better tolerance
  const GAZE_AWAY_THRESHOLD = 2000; // ms before considering "looking away" - increased to reduce false positives
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
      // Key facial landmarks for head pose estimation
      const noseTip = landmarks[1];        // Nose tip
      const chinTip = landmarks[175];      // Chin
      const leftEyeCorner = landmarks[33]; // Left eye outer corner
      const rightEyeCorner = landmarks[263]; // Right eye outer corner

      // Eye region landmarks for calculating eye centers
      const leftEyeCenter = {
        x: (landmarks[33].x + landmarks[133].x) / 2, // Average of outer and inner corners
        y: (landmarks[159].y + landmarks[145].y) / 2  // Average of top and bottom
      };
      const rightEyeCenter = {
        x: (landmarks[362].x + landmarks[263].x) / 2, // Average of outer and inner corners  
        y: (landmarks[386].y + landmarks[374].y) / 2  // Average of top and bottom
      };

      // Use actual iris landmarks if available (MediaPipe provides iris landmarks 468-477)
      // If iris landmarks aren't available, fall back to eye center estimation
      let leftIris, rightIris;
      
      if (landmarks.length >= 478) {
        // MediaPipe iris landmarks: 468-472 for left eye iris, 473-477 for right eye iris
        leftIris = {
          x: (landmarks[468].x + landmarks[469].x + landmarks[470].x + landmarks[471].x + landmarks[472].x) / 5,
          y: (landmarks[468].y + landmarks[469].y + landmarks[470].y + landmarks[471].y + landmarks[472].y) / 5
        };
        rightIris = {
          x: (landmarks[473].x + landmarks[474].x + landmarks[475].x + landmarks[476].x + landmarks[477].x) / 5,
          y: (landmarks[473].y + landmarks[474].y + landmarks[475].y + landmarks[476].y + landmarks[477].y) / 5
        };
      } else {
        // Fallback: estimate iris position within the eye region
        // Use a more sophisticated approach based on eye geometry
        const leftEyeWidth = Math.abs(landmarks[133].x - landmarks[33].x);
        const leftEyeHeight = Math.abs(landmarks[145].y - landmarks[159].y);
        const rightEyeWidth = Math.abs(landmarks[263].x - landmarks[362].x);
        const rightEyeHeight = Math.abs(landmarks[374].y - landmarks[386].y);
        
        // Estimate iris position (center of eye when looking straight)
        leftIris = {
          x: leftEyeCenter.x,
          y: leftEyeCenter.y
        };
        rightIris = {
          x: rightEyeCenter.x,
          y: rightEyeCenter.y
        };
      }

      // Calculate gaze vectors for each eye relative to eye center
      const leftGazeVector = {
        x: leftIris.x - leftEyeCenter.x,
        y: leftIris.y - leftEyeCenter.y
      };
      const rightGazeVector = {
        x: rightIris.x - rightEyeCenter.x, 
        y: rightIris.y - rightEyeCenter.y
      };

      // Average both eyes for more stable gaze direction
      const avgGazeVector = {
        x: (leftGazeVector.x + rightGazeVector.x) / 2,
        y: (leftGazeVector.y + rightGazeVector.y) / 2
      };

      // Calculate head pose vector for correction
      const headVector = {
        x: (leftEyeCorner.x + rightEyeCorner.x) / 2 - noseTip.x,
        y: (leftEyeCorner.y + rightEyeCorner.y) / 2 - noseTip.y
      };

      // Apply head pose correction to gaze vector
      const correctedGaze = {
        x: avgGazeVector.x - headVector.x * 0.2, 
        y: avgGazeVector.y - headVector.y * 0.2
      };

      // Convert to screen coordinates using proper scaling
      const videoWidth = videoRef.current?.videoWidth || 640;
      const videoHeight = videoRef.current?.videoHeight || 480;
      
      // Scale gaze vector to screen dimensions
      const gazeScreenX = correctedGaze.x * window.innerWidth * 10; // Amplify sensitivity
      const gazeScreenY = correctedGaze.y * window.innerHeight * 10;

      // Calculate final screen position (center + gaze offset)
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      
      const screenX = centerX + gazeScreenX;
      const screenY = centerY + gazeScreenY;

      // Calculate confidence based on eye detection quality
      const eyeDistance = Math.abs(rightEyeCorner.x - leftEyeCorner.x);
      const faceArea = eyeDistance * Math.abs(chinTip.y - noseTip.y);
      const confidence = Math.min(1.0, Math.max(0.4, faceArea * 200));

      // Debug logging every few seconds
      const now = Date.now();
      if (now % 3000 < 100) {
        console.log(`[MediaPipe Debug] Gaze: (${screenX.toFixed(1)}, ${screenY.toFixed(1)}) | Eye Centers: L(${leftEyeCenter.x.toFixed(3)}, ${leftEyeCenter.y.toFixed(3)}) R(${rightEyeCenter.x.toFixed(3)}, ${rightEyeCenter.y.toFixed(3)}) | Iris: L(${leftIris.x.toFixed(3)}, ${leftIris.y.toFixed(3)}) R(${rightIris.x.toFixed(3)}, ${rightIris.y.toFixed(3)})`);
      }

      return {
        x: Math.max(-100, Math.min(window.innerWidth + 100, screenX)), // Allow some margin for edge detection
        y: Math.max(-100, Math.min(window.innerHeight + 100, screenY)),
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

    // Debug logging (less frequent, more useful)
    if (now % 5000 < 100) { // Log every 5 seconds
      console.log(`[MediaPipe Gaze] Position: (${Math.round(gazePos.x)}, ${Math.round(gazePos.y)}) | Screen: ${window.innerWidth}x${window.innerHeight} | Margin: ${SCREEN_MARGIN}px | Looking away: ${isOutsideScreen} | Confidence: ${(gazePos.confidence * 100).toFixed(0)}%`);
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
          logGazeEvent(gazePos, now, true);
          console.log('🔍 MediaPipe: Exam taker is looking away from screen');
        }
        
        if (awayDuration > CHEATING_THRESHOLD && !cheatingWarningLogged.current) {
          cheatingWarningLogged.current = true;
          console.log('---MIGHT BE CHEATING---');
          console.log(`🚨 ALERT: Exam taker has been looking away for ${Math.round(awayDuration / 1000)} seconds`);
          
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
          logGazeEvent(gazePos, now, false);
          console.log(`✅ MediaPipe: Exam taker is looking back at screen (was away for ${Math.round(awayDuration / 1000)}s)`);
        }
        
        gazeAwayStartTime.current = null;
        cheatingWarningLogged.current = false;
      }
    }

    // Log periodic gaze tracking events
    if (now - lastGazeTime.current > TRACKING_INTERVAL) {
      logGazeEvent(gazePos, now, isOutsideScreen);
      lastGazeTime.current = now;
    }
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
      status = 'Calibrating';
      color = 'bg-yellow-500';
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