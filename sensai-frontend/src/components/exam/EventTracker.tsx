import { forwardRef, useImperativeHandle, useRef, useEffect, useState } from "react";
import { ExamWebSocket } from "@/lib/exam-websocket";
import { ExamEvent, TabSwitchEvent, KeystrokeMismatchEvent, ClipboardPasteEvent, MouseMovementEvent, WindowFocusEvent } from "@/types/exam";

interface EventTrackerProps {
  websocket: ExamWebSocket | null;
  examId: string;
}

interface EventTrackerRef {
  getStats: () => any;
}

const EventTracker = forwardRef<EventTrackerRef, EventTrackerProps>(
  ({ websocket, examId }, ref) => {
    const lastFocusTime = useRef<number>(Date.now());
    const lastMousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const mouseMovements = useRef<Array<{ x: number; y: number; timestamp: number }>>([]);
    const keystrokesBuffer = useRef<string>('');
    const visibleInputBuffer = useRef<string>('');
    const tabSwitchCount = useRef<number>(0);
    const suspiciousActivities = useRef<number>(0);
    
    const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);
    const [stats, setStats] = useState({
      tabSwitches: 0,
      keystrokesMismatch: 0,
      clipboardPastes: 0,
      suspiciousMouseActivity: 0,
      totalEvents: 0
    });

    useImperativeHandle(ref, () => ({
      getStats: () => stats
    }));

    useEffect(() => {
      const handleVisibilityChange = () => {
        const isVisible = !document.hidden;
        const now = Date.now();
        
        if (!isVisible && isWindowFocused) {
          lastFocusTime.current = now;
          setIsWindowFocused(false);
        } else if (isVisible && !isWindowFocused) {
          const awayDuration = now - lastFocusTime.current;
          tabSwitchCount.current++;
          
          const event: TabSwitchEvent = {
            type: 'tab_switch',
            timestamp: now,
            data: {
              away_duration: awayDuration,
              timestamp: now
            }
          };
          
          sendEvent(event);
          setIsWindowFocused(true);
          updateStats('tabSwitches');
        }
      };

      const handleFocus = () => {
        const now = Date.now();
        if (!isWindowFocused) {
          const awayDuration = now - lastFocusTime.current;
          
          const event: WindowFocusEvent = {
            type: 'window_focus',
            timestamp: now,
            data: {
              is_focused: true,
              duration_unfocused: awayDuration,
              timestamp: now
            }
          };
          
          sendEvent(event);
          setIsWindowFocused(true);
        }
      };

      const handleBlur = () => {
        lastFocusTime.current = Date.now();
        setIsWindowFocused(false);
        
        const event: WindowFocusEvent = {
          type: 'window_focus',
          timestamp: Date.now(),
          data: {
            is_focused: false,
            timestamp: Date.now()
          }
        };
        
        sendEvent(event);
      };

      const handleMouseMove = (e: MouseEvent) => {
        const now = Date.now();
        const currentPos = { x: e.clientX, y: e.clientY };
        const lastPos = lastMousePosition.current;
        
        const distance = Math.sqrt(
          Math.pow(currentPos.x - lastPos.x, 2) + Math.pow(currentPos.y - lastPos.y, 2)
        );
        
        const velocity = distance / 16; // Assuming 16ms intervals
        
        mouseMovements.current.push({ ...currentPos, timestamp: now });
        
        if (mouseMovements.current.length > 100) {
          mouseMovements.current = mouseMovements.current.slice(-50);
        }
        
        const recentMovements = mouseMovements.current.slice(-10);
        const avgVelocity = recentMovements.reduce((sum, movement, index) => {
          if (index === 0) return sum;
          const prevMovement = recentMovements[index - 1];
          const dist = Math.sqrt(
            Math.pow(movement.x - prevMovement.x, 2) + Math.pow(movement.y - prevMovement.y, 2)
          );
          const timeDiff = movement.timestamp - prevMovement.timestamp;
          return sum + (dist / timeDiff);
        }, 0) / (recentMovements.length - 1);
        
        let patternType: 'normal' | 'suspicious' | 'rapid' = 'normal';
        
        if (velocity > 50) {
          patternType = 'rapid';
        } else if (avgVelocity > 10 && recentMovements.length >= 5) {
          const isLinearPattern = checkLinearPattern(recentMovements);
          if (isLinearPattern) {
            patternType = 'suspicious';
            suspiciousActivities.current++;
          }
        }
        
        if (patternType !== 'normal') {
          const event: MouseMovementEvent = {
            type: 'mouse_movement',
            timestamp: now,
            data: {
              coordinates: currentPos,
              velocity: avgVelocity,
              pattern_type: patternType,
              timestamp: now
            }
          };
          
          sendEvent(event);
          
          if (patternType === 'suspicious') {
            updateStats('suspiciousMouseActivity');
          }
        }
        
        lastMousePosition.current = currentPos;
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        const char = e.key.length === 1 ? e.key : `[${e.key}]`;
        keystrokesBuffer.current += char;
        
        if (keystrokesBuffer.current.length > 100) {
          keystrokesBuffer.current = keystrokesBuffer.current.slice(-50);
        }
        
        if (e.ctrlKey && (e.key === 'c' || e.key === 'v')) {
          if (e.key === 'v') {
            handlePasteDetection();
          }
        }
        
        setTimeout(() => {
          checkKeystrokeMismatch();
        }, 100);
      };

      const handlePaste = async (e: ClipboardEvent) => {
        const clipboardData = e.clipboardData?.getData('text') || '';
        const contentHash = await hashString(clipboardData);
        
        const event: ClipboardPasteEvent = {
          type: 'clipboard_paste',
          timestamp: Date.now(),
          data: {
            content_hash: contentHash,
            length: clipboardData.length,
            timestamp: Date.now()
          }
        };
        
        sendEvent(event);
        updateStats('clipboardPastes');
      };

      const throttledMouseMove = throttle(handleMouseMove, 16);
      const throttledKeyDown = throttle(handleKeyDown, 50);

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
      document.addEventListener('mousemove', throttledMouseMove);
      document.addEventListener('keydown', throttledKeyDown);
      document.addEventListener('paste', handlePaste);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('mousemove', throttledMouseMove);
        document.removeEventListener('keydown', throttledKeyDown);
        document.removeEventListener('paste', handlePaste);
      };
    }, [websocket, examId, isWindowFocused]);

    const checkKeystrokeMismatch = () => {
      const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        const visibleText = activeElement.value;
        const recentKeystrokes = keystrokesBuffer.current.slice(-visibleText.length);
        
        const mismatchThreshold = Math.max(3, Math.floor(visibleText.length * 0.1));
        
        if (visibleText.length > 5 && calculateLevenshteinDistance(recentKeystrokes, visibleText) > mismatchThreshold) {
          const event: KeystrokeMismatchEvent = {
            type: 'keystroke_mismatch',
            timestamp: Date.now(),
            data: {
              typed_chars: recentKeystrokes,
              visible_input: visibleText,
              timestamp: Date.now()
            }
          };
          
          sendEvent(event);
          updateStats('keystrokesMismatch');
        }
        
        visibleInputBuffer.current = visibleText;
      }
    };

    const handlePasteDetection = () => {
      setTimeout(async () => {
        try {
          const clipboardText = await navigator.clipboard.readText();
          const contentHash = await hashString(clipboardText);
          
          const event: ClipboardPasteEvent = {
            type: 'clipboard_paste',
            timestamp: Date.now(),
            data: {
              content_hash: contentHash,
              length: clipboardText.length,
              timestamp: Date.now()
            }
          };
          
          sendEvent(event);
          updateStats('clipboardPastes');
        } catch (error) {
          console.warn('Could not read clipboard:', error);
        }
      }, 10);
    };

    const sendEvent = (event: ExamEvent) => {
      if (websocket?.isConnected()) {
        websocket.sendEvent(event);
        setStats(prev => ({ ...prev, totalEvents: prev.totalEvents + 1 }));
      }
    };

    const updateStats = (key: keyof typeof stats) => {
      setStats(prev => ({ ...prev, [key]: prev[key] + 1 }));
    };

    return null;
  }
);

const checkLinearPattern = (movements: Array<{ x: number; y: number; timestamp: number }>): boolean => {
  if (movements.length < 5) return false;
  
  let linearCount = 0;
  for (let i = 2; i < movements.length; i++) {
    const p1 = movements[i - 2];
    const p2 = movements[i - 1];
    const p3 = movements[i];
    
    const slope1 = (p2.y - p1.y) / (p2.x - p1.x + 0.001);
    const slope2 = (p3.y - p2.y) / (p3.x - p2.x + 0.001);
    
    if (Math.abs(slope1 - slope2) < 0.1) {
      linearCount++;
    }
  }
  
  return linearCount / (movements.length - 2) > 0.8;
};

const calculateLevenshteinDistance = (str1: string, str2: string): number => {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[str2.length][str1.length];
};

const hashString = async (str: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const throttle = <T extends (...args: any[]) => any>(func: T, limit: number): T => {
  let inThrottle: boolean;
  return ((...args: any[]) => {
    if (!inThrottle) {
      func.apply(null, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }) as T;
};

EventTracker.displayName = 'EventTracker';

export default EventTracker;
