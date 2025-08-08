import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, FastForward, Clock, Activity, AlertTriangle, Video, SkipBack, SkipForward } from 'lucide-react';

interface ExamEvent {
  type: string;
  timestamp: number;
  data: any;
  id?: string;
  priority?: number;
  is_flagged?: boolean;
  confidence_score?: number;
}

interface EnhancedEventReplayProps {
  sessionId: string;
  events: ExamEvent[];
  examId: string;
  videoBlobUrl?: string | null;
  onVideoSeek?: (timestamp: number) => void;
  examStartTime?: string; // ISO string of when exam started
}

export default function EnhancedEventReplay({ 
  sessionId, 
  events, 
  examId, 
  videoBlobUrl,
  onVideoSeek,
  examStartTime 
}: EnhancedEventReplayProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [filteredEvents, setFilteredEvents] = useState<ExamEvent[]>([]);
  const [syncWithVideo, setSyncWithVideo] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const currentEventRef = useRef<HTMLDivElement>(null);

  // Sort events by timestamp and filter
  useEffect(() => {
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    
    // Debug: Log some sample events to understand timestamp format
    if (sortedEvents.length > 0) {
      console.log('Event replay debug - Sample events:');
      console.log('Exam start time:', examStartTime);
      console.log('First few events:', sortedEvents.slice(0, 3).map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        timestampType: typeof e.timestamp
      })));
      if (sortedEvents.length > 3) {
        console.log('Last few events:', sortedEvents.slice(-3).map(e => ({
          type: e.type,
          timestamp: e.timestamp,
          timestampType: typeof e.timestamp
        })));
      }
    }
    
    if (selectedEventType === 'all') {
      setFilteredEvents(sortedEvents);
    } else if (selectedEventType === 'flagged') {
      setFilteredEvents(sortedEvents.filter(event => event.is_flagged));
    } else if (selectedEventType === 'high_priority') {
      setFilteredEvents(sortedEvents.filter(event => event.priority && event.priority >= 2));
    } else {
      setFilteredEvents(sortedEvents.filter(event => event.type === selectedEventType));
    }
    setCurrentEventIndex(0);
  }, [events, selectedEventType, examStartTime]);

  // Calculate video timestamp from event timestamp
  const getVideoTimestamp = (eventTimestamp: number) => {
    if (!examStartTime) {
      console.warn('No examStartTime provided, returning 0');
      return 0;
    }
    
    // Parse examStartTime to get the actual start moment
    let examStartMs;
    try {
      // Try to parse as both ISO and local format
      let examStartDate = new Date(examStartTime);
      
      // If the original date string doesn't have timezone info, assume UTC
      if (!examStartTime.includes('T') && !examStartTime.includes('Z') && !examStartTime.includes('+')) {
        // This looks like "2025-08-07 23:32:31" format without timezone
        // Let's try parsing it as UTC first, then local if that doesn't work
        const utcDate = new Date(examStartTime + 'Z'); // Add Z for UTC
        const localDate = new Date(examStartTime);
        
        // Use the interpretation that gives us a more reasonable time difference
        const utcDiff = Math.abs(eventTimestamp - utcDate.getTime());
        const localDiff = Math.abs(eventTimestamp - localDate.getTime());
        
        examStartDate = utcDiff < localDiff ? utcDate : localDate;
        
        console.log('Timezone detection:', {
          originalExamStartTime: examStartTime,
          utcInterpretation: utcDate.toISOString(),
          localInterpretation: localDate.toISOString(),
          eventTimestamp,
          utcDiff: utcDiff / 1000 + 's',
          localDiff: localDiff / 1000 + 's',
          chosen: utcDiff < localDiff ? 'UTC' : 'local'
        });
      }
      
      examStartMs = examStartDate.getTime();
    } catch (e) {
      console.error('Invalid examStartTime format:', examStartTime);
      return 0;
    }
    
    // Handle different event timestamp formats
    let eventTimeMs = eventTimestamp;
    
    // If timestamp is a string, parse it as a date
    if (typeof eventTimestamp === 'string') {
      try {
        eventTimeMs = new Date(eventTimestamp).getTime();
      } catch (e) {
        console.error('Invalid event timestamp string:', eventTimestamp);
        return 0;
      }
    } 
    // Event timestamp should be in milliseconds (since it's > 1e12)
    else if (typeof eventTimestamp === 'number') {
      if (eventTimestamp > 1e12) {
        // This is already in milliseconds
        eventTimeMs = eventTimestamp;
      } else if (eventTimestamp > 1e9) {
        // This might be in seconds, convert to milliseconds
        eventTimeMs = eventTimestamp * 1000;
      } else {
        // This is likely a relative timestamp from exam start
        console.log(`Treating ${eventTimestamp} as seconds from exam start`);
        return Math.max(0, Math.min(eventTimestamp, 86400)); // Cap at 24 hours
      }
    }
    
    // Calculate the difference in seconds
    const timeDiffMs = eventTimeMs - examStartMs;
    const timeDiffSeconds = timeDiffMs / 1000;
    
    // Debug logging
    console.log('Video timestamp calculation details:', {
      originalEventTimestamp: eventTimestamp,
      eventTimestampType: typeof eventTimestamp,
      examStartTime,
      examStartMs,
      processedEventTimeMs: eventTimeMs,
      timeDiffMs,
      timeDiffSeconds,
      finalResult: Math.max(0, Math.min(timeDiffSeconds, 86400))
    });
    
    // Sanity checks - if the difference is unreasonable, something is wrong
    if (Math.abs(timeDiffSeconds) > 86400) { // More than 24 hours difference
      console.warn(`Time difference is too large: ${timeDiffSeconds} seconds. Possible timezone mismatch.`);
      
      // Try alternative interpretations
      const alternativeResults = [];
      
      // Try treating the exam start time in different ways
      const utcStart = new Date(examStartTime + 'Z').getTime();
      const localStart = new Date(examStartTime).getTime();
      
      alternativeResults.push({
        method: 'UTC interpretation',
        diff: (eventTimeMs - utcStart) / 1000,
        startTime: utcStart
      });
      
      alternativeResults.push({
        method: 'Local interpretation', 
        diff: (eventTimeMs - localStart) / 1000,
        startTime: localStart
      });
      
      // Find the most reasonable result (smallest positive difference under 1 hour)
      const reasonable = alternativeResults.find(r => r.diff >= 0 && r.diff <= 3600);
      
      if (reasonable) {
        console.log(`Using ${reasonable.method}: ${reasonable.diff}s`);
        return Math.max(0, reasonable.diff);
      } else {
        // Fallback: use the smallest absolute difference that's positive
        const fallback = alternativeResults
          .filter(r => r.diff >= 0)
          .sort((a, b) => a.diff - b.diff)[0];
        
        if (fallback) {
          console.log(`Fallback to ${fallback.method}: ${fallback.diff}s`);
          return Math.max(0, Math.min(fallback.diff, 86400));
        }
      }
    }
    
    // Return the calculated time, capped at reasonable bounds
    return Math.max(0, Math.min(timeDiffSeconds, 86400));
  };

  // Seek video to current event timestamp and auto-scroll
  const seekVideoToCurrentEvent = () => {
    if (!filteredEvents[currentEventIndex]) return;
    
    const currentEvent = filteredEvents[currentEventIndex];
    const videoTime = getVideoTimestamp(currentEvent.timestamp);
    
    console.log(`Seeking to event ${currentEventIndex + 1}/${filteredEvents.length}`, {
      eventTimestamp: currentEvent.timestamp,
      examStartTime,
      calculatedVideoTime: videoTime,
      videoRefCurrent: !!videoRef.current,
      syncWithVideo,
      eventType: currentEvent.type
    });
    
    // Seek video if sync is enabled
    if (syncWithVideo && videoRef.current) {
      // Ensure video is loaded before seeking
      const video = videoRef.current;
      
      if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
        // Cap the video time to the actual video duration to prevent seeking beyond the end
        const cappedVideoTime = Math.min(videoTime, video.duration || videoTime);
        
        if (cappedVideoTime !== videoTime) {
          console.warn(`Video time ${videoTime}s exceeds video duration ${video.duration}s, capping to ${cappedVideoTime}s`);
        }
        
        video.currentTime = cappedVideoTime;
        console.log(`Video seeked to: ${cappedVideoTime}s (requested: ${videoTime}s, duration: ${video.duration}s, current time now: ${video.currentTime}s)`);
        
        // Small delay to ensure seeking is complete
        setTimeout(() => {
          console.log(`Video current time after seek: ${video.currentTime}s`);
        }, 100);
      } else {
        // If video isn't loaded yet, wait for it
        const handleLoadedData = () => {
          const cappedVideoTime = Math.min(videoTime, video.duration || videoTime);
          video.currentTime = cappedVideoTime;
          console.log(`Video seeked to: ${cappedVideoTime}s after loading (requested: ${videoTime}s, duration: ${video.duration}s, current time now: ${video.currentTime}s)`);
          video.removeEventListener('loadeddata', handleLoadedData);
          
          setTimeout(() => {
            console.log(`Video current time after seek: ${video.currentTime}s`);
          }, 100);
        };
        video.addEventListener('loadeddata', handleLoadedData);
        console.log('Video not ready, waiting for loadeddata event');
      }
    }
    
    if (onVideoSeek) {
      onVideoSeek(videoTime);
    }
    
    // Auto-scroll to current event removed - user doesn't want automatic scrolling
    // if (currentEventRef.current && timelineRef.current) {
    //   currentEventRef.current.scrollIntoView({
    //     behavior: 'smooth',
    //     block: 'center'
    //   });
    // }
  };

  // Auto-play functionality with video sync and auto-scroll
  useEffect(() => {
    if (isPlaying && currentEventIndex < filteredEvents.length - 1) {
      const currentEvent = filteredEvents[currentEventIndex];
      const nextEvent = filteredEvents[currentEventIndex + 1];
      
      if (currentEvent && nextEvent) {
        // Seek video to current event - no auto-scroll
        seekVideoToCurrentEvent();
        
        // Calculate time difference between events
        let timeDiff = nextEvent.timestamp - currentEvent.timestamp;
        
        // Handle different timestamp formats
        if (timeDiff < 1000) {
          // If difference is less than 1 second, assume seconds format
          timeDiff = timeDiff * 1000;
        }
        
        const playbackDelay = Math.max(500, timeDiff / playbackSpeed); // Minimum 500ms between events
        
        intervalRef.current = setTimeout(() => {
          setCurrentEventIndex(prev => prev + 1);
        }, playbackDelay);
        
        return () => {
          if (intervalRef.current) {
            clearTimeout(intervalRef.current);
          }
        };
      }
    } else if (currentEventIndex >= filteredEvents.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, currentEventIndex, filteredEvents, playbackSpeed, syncWithVideo, examStartTime]);

  // Effect to handle manual navigation (seek video only, no scrolling)
  useEffect(() => {
    if (!isPlaying) {
      seekVideoToCurrentEvent();
    }
  }, [currentEventIndex, syncWithVideo]);

  const handlePlay = () => {
    if (currentEventIndex >= filteredEvents.length - 1) {
      setCurrentEventIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleRestart = () => {
    setCurrentEventIndex(0);
    setIsPlaying(false);
    if (syncWithVideo && videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  const handlePrevious = () => {
    const newIndex = Math.max(0, currentEventIndex - 1);
    setCurrentEventIndex(newIndex);
  };

  const handleNext = () => {
    const newIndex = Math.min(filteredEvents.length - 1, currentEventIndex + 1);
    setCurrentEventIndex(newIndex);
  };

  const handleEventClick = (index: number) => {
    setCurrentEventIndex(index);
  };

  const getEventIcon = (event: ExamEvent) => {
    if (event.is_flagged) {
      if (event.priority === 3) return <AlertTriangle className="w-4 h-4 text-red-400" />;
      if (event.priority === 2) return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }

    switch (event.type) {
      case 'clipboard_paste':
      case 'copy_paste':
        return <Activity className="w-4 h-4 text-blue-400" />;
      case 'rapid_paste_burst':
        return <FastForward className="w-4 h-4 text-orange-400" />;
      case 'writing_style_drift':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'content_similarity':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'typing_pattern_anomaly':
      case 'keystroke_anomaly':
        return <Activity className="w-4 h-4 text-purple-400" />;
      case 'wpm_tracking':
        return <Clock className="w-4 h-4 text-green-400" />;
      case 'tab_switch':
      case 'window_focus_lost':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'face_not_detected':
        return <Video className="w-4 h-4 text-orange-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getEventColor = (event: ExamEvent) => {
    if (event.is_flagged) {
      if (event.priority === 3) return 'border-red-500 bg-red-900/20';
      if (event.priority === 2) return 'border-yellow-500 bg-yellow-900/20';
      return 'border-orange-500 bg-orange-900/20';
    }

    switch (event.type) {
      case 'clipboard_paste':
      case 'copy_paste':
        return 'border-blue-500 bg-blue-900/20';
      case 'wpm_tracking':
        return 'border-green-500 bg-green-900/20';
      case 'tab_switch':
      case 'window_focus_lost':
        return 'border-red-500 bg-red-900/20';
      default:
        return 'border-gray-500 bg-black/20';
    }
  };

  const formatEventData = (event: ExamEvent) => {
    const confidence = event.confidence_score ? ` (${(event.confidence_score * 100).toFixed(0)}% confidence)` : '';
    
    switch (event.type) {
      case 'clipboard_paste':
      case 'copy_paste':
        return `Pasted content detected${confidence}`;
      case 'rapid_paste_burst':
        return `Multiple paste operations${confidence}`;
      case 'writing_style_drift':
        return `Writing style change detected${confidence}`;
      case 'content_similarity':
        return `Similar content found${confidence}`;
      case 'typing_pattern_anomaly':
      case 'keystroke_anomaly':
        return `Unusual typing pattern${confidence}`;
      case 'wpm_tracking':
        return `Typing speed: ${event.data?.wpm || 'N/A'} WPM`;
      case 'tab_switch':
        return `Student switched tabs/windows${confidence}`;
      case 'window_focus_lost':
        return `Browser lost focus${confidence}`;
      case 'face_not_detected':
        return `Student's face not visible${confidence}`;
      case 'exam_started':
        return 'Exam session started';
      case 'exam_submitted':
        return 'Exam submitted';
      case 'question_viewed':
        return `Viewed question ${event.data?.question_id || ''}`;
      case 'answer_changed':
        return `Modified answer for question ${event.data?.question_id || ''}`;
      default:
        return `${event.type.replace('_', ' ')} event${confidence}`;
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatRelativeTime = (timestamp: number) => {
    if (!examStartTime) return formatTimestamp(timestamp);
    
    const examStart = new Date(examStartTime).getTime();
    let eventTime = timestamp;
    
    // Handle different timestamp formats consistently with getVideoTimestamp
    if (typeof timestamp === 'string') {
      eventTime = new Date(timestamp).getTime();
    } else if (typeof timestamp === 'number' && timestamp < 1e12) {
      eventTime = timestamp * 1000;
    } else if (typeof timestamp === 'number') {
      eventTime = timestamp;
    }
    
    const diffSeconds = Math.floor((eventTime - examStart) / 1000);
    const minutes = Math.floor(Math.abs(diffSeconds) / 60);
    const seconds = Math.abs(diffSeconds) % 60;
    
    const sign = diffSeconds < 0 ? '-' : '+';
    
    return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const eventTypes = [...new Set(events.map(event => event.type))];

  if (!events.length) {
    return (
      <div className="bg-black border border-gray-700 p-8 rounded-md">
        <h2 className="text-2xl font-semibold mb-6 flex items-center text-white">
          <Video className="mr-3" size={24} />
          Enhanced Event Replay
        </h2>
        <div className="text-center py-12 text-gray-400">
          <Play size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg">No events recorded for this session.</p>
          <p className="text-sm text-gray-500 mt-2">Events will appear here during exam playback.</p>
        </div>
      </div>
    );
  }

  const currentEvent = filteredEvents[currentEventIndex];

  return (
    <div className="bg-black border border-gray-700 p-6 rounded-md">
      <h2 className="text-2xl font-semibold mb-6 flex items-center text-white">
        <Play className="mr-3" size={24} />
        Event Replay 
        <span className="ml-3 px-3 py-1 bg-[#111111] border border-gray-600 rounded-md text-sm">
          {filteredEvents.length} events
        </span>
      </h2>

      {/* Main Layout: Events (Left) + Video (Right) */}
      <div className="flex gap-6 h-[800px]">
        {/* Left Side: Event Controls and Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Controls */}
          <div className="bg-[#111111] border border-gray-700 p-4 rounded-md mb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <button
                  onClick={handlePlay}
                  className="flex items-center space-x-2 bg-white text-black hover:opacity-90 px-4 py-2 rounded text-white font-medium transition-colors"
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                
                <button
                  onClick={handleRestart}
                  className="bg-gray-600 hover:bg-gray-500 px-3 py-2 rounded text-white transition-colors"
                  title="Restart"
                >
                  <RotateCcw size={18} />
                </button>

                <div className="flex items-center bg-gray-700 rounded border border-gray-600">
                  <button
                    onClick={handlePrevious}
                    disabled={currentEventIndex === 0}
                    className="px-3 py-2 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-l"
                    title="Previous Event"
                  >
                    <SkipBack size={18} />
                  </button>

                  <div className="w-px h-8 bg-gray-600"></div>

                  <button
                    onClick={handleNext}
                    disabled={currentEventIndex >= filteredEvents.length - 1}
                    className="px-3 py-2 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-r"
                    title="Next Event"
                  >
                    <SkipForward size={18} />
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-200">Speed:</label>
                  <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="bg-gray-700 border border-gray-600 text-white px-2 py-1 rounded text-sm"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={4}>4x</option>
                  </select>
                </div>

                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-200">Filter:</label>
                  <select
                    value={selectedEventType}
                    onChange={(e) => setSelectedEventType(e.target.value)}
                    className="bg-gray-700 border border-gray-600 text-white px-2 py-1 rounded text-sm min-w-32"
                  >
                    <option value="all">All Events</option>
                    <option value="flagged">Flagged Only</option>
                    <option value="high_priority">High Priority</option>
                    {eventTypes.map(type => (
                      <option key={type} value={type}>
                        {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="bg-[#111111] border border-gray-700 p-4 rounded-md mb-4">
            <div className="flex justify-between text-sm text-gray-200 mb-3">
              <span className="font-medium">Event {currentEventIndex + 1} of {filteredEvents.length}</span>
              <div className="flex space-x-4 font-mono text-xs">
                <span className="text-gray-400">Absolute: <span className="text-blue-400">{formatTimestamp(currentEvent?.timestamp || 0)}</span></span>
                <span className="text-gray-400">Relative: <span className="text-green-400">{formatRelativeTime(currentEvent?.timestamp || 0)}</span></span>
              </div>
            </div>
            <div className="w-full bg-gray-700 rounded-md h-2">
              <div 
                className="bg-blue-600 h-2 rounded-md transition-all duration-300"
                style={{ width: `${((currentEventIndex + 1) / filteredEvents.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Current Event Display */}
          {currentEvent && (
            <div className={`border-2 rounded-md p-4 mb-4 ${getEventColor(currentEvent)}`}>
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {getEventIcon(currentEvent)}
                </div>
                <div className="flex-grow">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <h4 className="font-semibold text-white">
                        {currentEvent.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </h4>
                      {currentEvent.is_flagged && (
                        <div className="flex items-center space-x-1">
                          <span className="px-2 py-1 bg-red-600 text-white text-xs font-medium rounded flex items-center space-x-1">
                            <AlertTriangle size={10} />
                            <span>FLAGGED</span>
                          </span>
                          {currentEvent.priority === 3 && (
                            <span className="px-2 py-1 bg-orange-600 text-white text-xs font-medium rounded">
                              HIGH
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-gray-200 font-mono">{formatTimestamp(currentEvent.timestamp)}</div>
                      <div className="text-green-400 font-mono text-xs">{formatRelativeTime(currentEvent.timestamp)}</div>
                    </div>
                  </div>
                  <div className="bg-[#111111] rounded p-3 border border-gray-700">
                    <p className="text-gray-200">
                      {formatEventData(currentEvent)}
                    </p>
                  </div>
                  {currentEvent.data && Object.keys(currentEvent.data).length > 0 && (
                    <details className="mt-3 bg-[#111111] rounded border border-gray-700">
                      <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-200 p-2">
                        Raw event data
                      </summary>
                      <div className="p-2">
                        <pre className="text-xs text-gray-400 bg-black p-2 rounded border border-gray-700 overflow-x-auto font-mono">
                          {JSON.stringify(currentEvent.data, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Event Timeline */}
          <div className="flex-1 bg-[#111111] border border-gray-700 rounded-md overflow-hidden">
            <div className="p-3 border-b border-gray-700">
              <h4 className="text-sm font-medium text-gray-200">Event Timeline</h4>
            </div>
            <div 
              ref={timelineRef}
              className="h-full overflow-y-auto p-2 space-y-2"
            >
              {filteredEvents.map((event, index) => (
                <div
                  key={event.id || index}
                  ref={index === currentEventIndex ? currentEventRef : null}
                  onClick={() => handleEventClick(index)}
                  className={`border rounded p-2 cursor-pointer transition-all ${
                    index === currentEventIndex 
                      ? `${getEventColor(event)} ring-2 ring-blue-400` 
                      : `${getEventColor(event)} opacity-70 hover:opacity-100`
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <div className="flex-shrink-0">
                      {getEventIcon(event)}
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white truncate">
                          #{index + 1} {event.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          {event.is_flagged && (
                            <span className="ml-1 text-xs text-red-400">🚩</span>
                          )}
                        </span>
                        <div className="text-xs text-gray-400 flex-shrink-0 ml-2 text-right font-mono">
                          <div>{formatTimestamp(event.timestamp)}</div>
                          <div className="text-blue-400">{formatRelativeTime(event.timestamp)}</div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {formatEventData(event)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Video Player */}
        {videoBlobUrl && (
          <div className="w-96 bg-[#111111] border border-gray-700 p-4 rounded-md flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center">
                <Video className="mr-2" size={20} />
                Synchronized Video
              </h3>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="syncVideo"
                  checked={syncWithVideo}
                  onChange={(e) => setSyncWithVideo(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="syncVideo" className="text-sm text-gray-200">
                  Sync
                </label>
              </div>
            </div>
            
            <div className="flex-1 flex flex-col">
              <video 
                ref={videoRef}
                controls 
                className="w-full h-auto max-h-64 rounded bg-black"
                src={videoBlobUrl}
              />
              
              <div className="mt-3 p-3 bg-black rounded border border-gray-700">
                <p className="text-gray-200 text-sm mb-2">
                  Video syncs to match event timestamps when enabled.
                </p>
                {currentEvent && examStartTime && (
                  <div className="text-xs text-gray-400 font-mono space-y-1">
                    <div>Current: {formatRelativeTime(currentEvent.timestamp)}</div>
                    <div>Video: {getVideoTimestamp(currentEvent.timestamp).toFixed(1)}s</div>
                    <div className="truncate">Start: {examStartTime}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
