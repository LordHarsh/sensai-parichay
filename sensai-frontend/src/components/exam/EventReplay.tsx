import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, FastForward, Clock, Activity, AlertTriangle } from 'lucide-react';

interface ExamEvent {
  type: string;
  timestamp: number;
  data: any;
}

interface EventReplayProps {
  sessionId: string;
  events: ExamEvent[];
  examId: string;
}

export default function EventReplay({ sessionId, events, examId }: EventReplayProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  const [filteredEvents, setFilteredEvents] = useState<ExamEvent[]>([]);

  // Filter events based on selected type
  useEffect(() => {
    if (selectedEventType === 'all') {
      setFilteredEvents(events);
    } else {
      setFilteredEvents(events.filter(event => event.type === selectedEventType));
    }
    setCurrentEventIndex(0);
  }, [events, selectedEventType]);

  // Auto-play functionality
  useEffect(() => {
    if (isPlaying && currentEventIndex < filteredEvents.length - 1) {
      const currentEvent = filteredEvents[currentEventIndex];
      const nextEvent = filteredEvents[currentEventIndex + 1];
      
      if (currentEvent && nextEvent) {
        const timeDiff = nextEvent.timestamp - currentEvent.timestamp;
        const playbackDelay = Math.max(100, timeDiff / playbackSpeed);
        
        const timeout = setTimeout(() => {
          setCurrentEventIndex(prev => prev + 1);
        }, playbackDelay);
        
        return () => clearTimeout(timeout);
      }
    } else if (currentEventIndex >= filteredEvents.length - 1) {
      setIsPlaying(false);
    }
  }, [isPlaying, currentEventIndex, filteredEvents, playbackSpeed]);

  const handlePlay = () => {
    if (currentEventIndex >= filteredEvents.length - 1) {
      setCurrentEventIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleRestart = () => {
    setCurrentEventIndex(0);
    setIsPlaying(false);
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'clipboard_paste':
        return <Activity className="w-4 h-4 text-blue-400" />;
      case 'rapid_paste_burst':
        return <FastForward className="w-4 h-4 text-orange-400" />;
      case 'writing_style_drift':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'content_similarity':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'typing_pattern_anomaly':
        return <Activity className="w-4 h-4 text-purple-400" />;
      case 'wpm_tracking':
        return <Clock className="w-4 h-4 text-green-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'clipboard_paste':
        return 'border-blue-500 bg-blue-900/20';
      case 'rapid_paste_burst':
        return 'border-orange-500 bg-orange-900/20';
      case 'writing_style_drift':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'content_similarity':
        return 'border-red-500 bg-red-900/20';
      case 'typing_pattern_anomaly':
        return 'border-purple-500 bg-purple-900/20';
      case 'wpm_tracking':
        return 'border-green-500 bg-green-900/20';
      default:
        return 'border-gray-500 bg-gray-900/20';
    }
  };

  const formatEventData = (event: ExamEvent) => {
    switch (event.type) {
      case 'clipboard_paste':
        return `Pasted ${event.data.length} characters`;
      case 'rapid_paste_burst':
        return `${event.data.paste_count} pastes, ${event.data.total_chars} chars in ${event.data.time_window/1000}s`;
      case 'writing_style_drift':
        return `Style drift: ${(event.data.drift_score * 100).toFixed(1)}% change`;
      case 'content_similarity':
        return `Content similarity: ${(event.data.similarity_score * 100).toFixed(1)}% match`;
      case 'typing_pattern_anomaly':
        return `WPM anomaly: ${event.data.current_wpm} vs ${event.data.baseline_wpm}`;
      case 'wpm_tracking':
        return `WPM: ${event.data.wpm}, ${event.data.chars_typed} chars`;
      default:
        return 'Event data';
    }
  };

  const eventTypes = [...new Set(events.map(event => event.type))];

  if (!events.length) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Play className="mr-2" size={20} />
          Event Replay
        </h2>
        <div className="text-center py-8 text-gray-400">
          <Play size={48} className="mx-auto mb-4 opacity-50" />
          <p>No events recorded for this session.</p>
        </div>
      </div>
    );
  }

  const currentEvent = filteredEvents[currentEventIndex];

  return (
    <div className="bg-gray-800 p-6 rounded-lg space-y-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Play className="mr-2" size={20} />
        Event Replay ({filteredEvents.length} events)
      </h2>

      {/* Controls */}
      <div className="flex items-center justify-between bg-gray-700 p-4 rounded-lg">
        <div className="flex items-center space-x-4">
          <button
            onClick={handlePlay}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white transition-colors"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          
          <button
            onClick={handleRestart}
            className="flex items-center space-x-2 bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-white transition-colors"
          >
            <RotateCcw size={16} />
            <span>Restart</span>
          </button>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-300">Speed:</label>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="bg-gray-600 text-white px-2 py-1 rounded text-sm"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-300">Filter:</label>
            <select
              value={selectedEventType}
              onChange={(e) => setSelectedEventType(e.target.value)}
              className="bg-gray-600 text-white px-2 py-1 rounded text-sm"
            >
              <option value="all">All Events</option>
              {eventTypes.map(type => (
                <option key={type} value={type}>
                  {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-400">
          <span>Event {currentEventIndex + 1} of {filteredEvents.length}</span>
          <span>
            {currentEvent && new Date(currentEvent.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentEventIndex + 1) / filteredEvents.length) * 100}%` }}
          ></div>
        </div>
        <input
          type="range"
          min="0"
          max={filteredEvents.length - 1}
          value={currentEventIndex}
          onChange={(e) => {
            setCurrentEventIndex(Number(e.target.value));
            setIsPlaying(false);
          }}
          className="w-full"
        />
      </div>

      {/* Current Event Display */}
      {currentEvent && (
        <div className={`border rounded-lg p-4 ${getEventColor(currentEvent.type)}`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center space-x-3">
              {getEventIcon(currentEvent.type)}
              <div>
                <h3 className="font-semibold text-white">
                  {currentEvent.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </h3>
                <p className="text-sm text-gray-300">
                  {formatEventData(currentEvent)}
                </p>
              </div>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(currentEvent.timestamp).toLocaleTimeString()}
            </span>
          </div>
          
          {/* Detailed Event Data */}
          <details className="mt-3">
            <summary className="text-sm text-gray-300 cursor-pointer hover:text-white">
              View Raw Data
            </summary>
            <pre className="mt-2 bg-gray-900 p-3 rounded text-xs text-gray-300 overflow-auto">
              {JSON.stringify(currentEvent.data, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Event Timeline */}
      <div className="space-y-2">
        <h3 className="font-semibold">Event Timeline</h3>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filteredEvents.map((event, index) => (
            <div
              key={index}
              onClick={() => {
                setCurrentEventIndex(index);
                setIsPlaying(false);
              }}
              className={`flex items-center space-x-3 p-2 rounded cursor-pointer transition-colors ${
                index === currentEventIndex
                  ? 'bg-blue-900/50 border border-blue-500'
                  : 'bg-gray-700/50 hover:bg-gray-700'
              }`}
            >
              {getEventIcon(event.type)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {event.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {formatEventData(event)}
                </div>
              </div>
              <span className="text-xs text-gray-400">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
