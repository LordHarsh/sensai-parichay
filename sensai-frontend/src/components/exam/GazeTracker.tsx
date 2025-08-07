import { useEffect, useRef, useState, useCallback } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";
import { GazeTrackingEvent } from "@/types/exam";

interface GazeTrackerProps {
  websocket: ExamWebSocket | null;
  enabled: boolean;
}

interface WebGazerAPI {
  setRegression: (type: string) => WebGazerAPI;
  setTracker: (type: string) => WebGazerAPI;
  setGazeListener: (callback: (data: { x: number; y: number } | null, timestamp: number) => void) => WebGazerAPI;
  begin: () => Promise<WebGazerAPI>;
  end: () => void;
  showVideoPreview: (show: boolean) => void;
  showPredictionPoints: (show: boolean) => void;
  showFaceOverlay: (show: boolean) => void;
  showFaceFeedbackBox: (show: boolean) => void;
  recordScreenPosition: (x: number, y: number, eventType: string) => void;
  getConfidence?: () => number;
}

declare global {
  interface Window {
    webgazer: WebGazerAPI;
  }
}

const GazeTracker: React.FC<GazeTrackerProps> = ({ websocket, enabled }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [isLookingAway, setIsLookingAway] = useState(false);
  const [gazePosition, setGazePosition] = useState<{ x: number; y: number } | null>(null);
  const lastGazeTime = useRef<number>(Date.now());
  const gazeAwayStartTime = useRef<number | null>(null);
  const isCalibrating = useRef(false);

  // Screen boundaries for determining if looking away
  const SCREEN_MARGIN = 50; // pixels from edge to consider "looking away"
  const GAZE_AWAY_THRESHOLD = 1000; // ms before considering "looking away"
  const TRACKING_INTERVAL = 500; // ms between gaze tracking events

  const logGazeEvent = useCallback((gazeData: { x: number; y: number }, timestamp: number, lookingAway: boolean) => {
    if (!websocket?.isConnected()) return;

    // Get the confidence from WebGazer (if available)
    const confidence = window.webgazer?.getConfidence?.() || 0.5;

    const event: GazeTrackingEvent = {
      type: 'gaze_tracking',
      timestamp,
      data: {
        gaze_x: Math.round(gazeData.x),
        gaze_y: Math.round(gazeData.y),
        screen_x: window.innerWidth,
        screen_y: window.innerHeight,
        looking_away: lookingAway,
        confidence,
        timestamp
      }
    };

    websocket.sendEvent(event);

    // Extra logging for looking away events
    if (lookingAway) {
      console.log(`📊 Gaze Event: Looking away detected at (${event.data.gaze_x}, ${event.data.gaze_y}) with confidence ${confidence.toFixed(2)}`);
    }
  }, [websocket]);

  const handleGazeData = useCallback((data: { x: number; y: number } | null) => {
    if (!data || !isInitialized) return;

    const now = Date.now();
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Update gaze position
    setGazePosition({ x: data.x, y: data.y });

    // Check if looking away from screen
    const isOutsideScreen = 
      data.x < SCREEN_MARGIN || 
      data.x > screenWidth - SCREEN_MARGIN ||
      data.y < SCREEN_MARGIN || 
      data.y > screenHeight - SCREEN_MARGIN;

    // Handle looking away detection
    if (isOutsideScreen) {
      if (!gazeAwayStartTime.current) {
        gazeAwayStartTime.current = now;
      } else if (now - gazeAwayStartTime.current > GAZE_AWAY_THRESHOLD && !isLookingAway) {
        setIsLookingAway(true);
        logGazeEvent(data, now, true);
        console.log('🔍 Exam taker is looking away from screen');
      }
    } else {
      if (gazeAwayStartTime.current) {
        if (isLookingAway) {
          setIsLookingAway(false);
          logGazeEvent(data, now, false);
          console.log('✅ Exam taker is looking back at screen');
        }
        gazeAwayStartTime.current = null;
      }
    }

    // Log periodic gaze tracking events
    if (now - lastGazeTime.current > TRACKING_INTERVAL) {
      logGazeEvent(data, now, isOutsideScreen);
      lastGazeTime.current = now;
    }
  }, [isInitialized, isLookingAway, logGazeEvent, SCREEN_MARGIN, GAZE_AWAY_THRESHOLD, TRACKING_INTERVAL]);

  const startAutoCalibration = useCallback(() => {
    if (isCalibrating.current || isCalibrated) return;

    isCalibrating.current = true;
    console.log('Starting automatic calibration...');

    // Define calibration points (corners and center)
    const points = [
      { x: window.innerWidth * 0.1, y: window.innerHeight * 0.1 },   // Top-left
      { x: window.innerWidth * 0.9, y: window.innerHeight * 0.1 },   // Top-right
      { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 },   // Center
      { x: window.innerWidth * 0.1, y: window.innerHeight * 0.9 },   // Bottom-left
      { x: window.innerWidth * 0.9, y: window.innerHeight * 0.9 },   // Bottom-right
    ];

    let currentPoint = 0;

    const calibrateNextPoint = () => {
      if (currentPoint >= points.length) {
        console.log('Auto-calibration completed');
        setIsCalibrated(true);
        isCalibrating.current = false;
        return;
      }

      const point = points[currentPoint];
      
      // Simulate click at calibration point
      if (window.webgazer) {
        window.webgazer.recordScreenPosition(point.x, point.y, 'click');
        console.log(`Calibrating point ${currentPoint + 1}/${points.length}: (${Math.round(point.x)}, ${Math.round(point.y)})`);
      }

      currentPoint++;
      setTimeout(calibrateNextPoint, 1000); // Wait 1 second between points
    };

    calibrateNextPoint();
  }, [isCalibrated]);

  const initializeWebGazer = useCallback(async () => {
    if (!window.webgazer || isInitialized) return;

    try {
      console.log('Initializing WebGazer...');
      
      // Initialize WebGazer with ridge regression
      await window.webgazer
        .setRegression('ridge')
        .setTracker('clmtrackr')
        .setGazeListener(handleGazeData)
        .begin();

      // Hide the default video preview
      window.webgazer.showVideoPreview(false);
      window.webgazer.showPredictionPoints(false);
      window.webgazer.showFaceOverlay(false);
      window.webgazer.showFaceFeedbackBox(false);

      setIsInitialized(true);
      console.log('WebGazer initialized successfully');

      // Start auto-calibration
      setTimeout(() => {
        startAutoCalibration();
      }, 2000);

    } catch (error) {
      console.error('Failed to initialize WebGazer:', error);
    }
  }, [handleGazeData, isInitialized, startAutoCalibration]);

  useEffect(() => {
    if (!enabled) return;

    // Load WebGazer script if not already loaded
    if (!window.webgazer) {
      const script = document.createElement('script');
      script.src = 'https://webgazer.cs.brown.edu/webgazer.js';
      script.onload = initializeWebGazer;
      document.head.appendChild(script);
    } else {
      initializeWebGazer();
    }

    return () => {
      if (window.webgazer && isInitialized) {
        window.webgazer.end();
        setIsInitialized(false);
        setIsCalibrated(false);
      }
    };
  }, [enabled, initializeWebGazer, isInitialized]);

  // Render calibration status indicator
  const renderStatusIndicator = () => {
    if (!enabled) return null;

    let status = 'Disabled';
    let color = 'bg-gray-500';

    if (isInitialized && isCalibrated) {
      status = isLookingAway ? 'Looking Away' : 'Tracking';
      color = isLookingAway ? 'bg-red-500' : 'bg-green-500';
    } else if (isInitialized && isCalibrating.current) {
      status = 'Calibrating';
      color = 'bg-yellow-500';
    } else if (isInitialized) {
      status = 'Initializing';
      color = 'bg-blue-500';
    }

    return (
      <div className="fixed top-20 right-4 z-50">
        <div className={`px-3 py-1 rounded-full text-white text-xs font-medium ${color} shadow-lg`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isLookingAway ? 'animate-pulse' : ''} bg-white`}></div>
            Gaze: {status}
          </div>
        </div>
        {gazePosition && isInitialized && (
          <div className="mt-1 text-xs text-gray-600 bg-white px-2 py-1 rounded shadow">
            {Math.round(gazePosition.x)}, {Math.round(gazePosition.y)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderStatusIndicator()}
      {/* Hidden div to help with WebGazer initialization */}
      <div id="webgazer-video-container" style={{ display: 'none' }}></div>
    </>
  );
};

export default GazeTracker;
