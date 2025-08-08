"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AlertTriangle, Clock, Eye, Flag, TrendingUp, User } from "lucide-react";

interface TimelineEvent {
  id: string;
  session_id: string;
  event_type: string;
  event_data: any;
  timestamp: number;
  priority: number;
  confidence_score: number;
  is_flagged: boolean;
  created_at: string;
}

interface StepTimelineEvent {
  step: string;
  title: string;
  description: string;
  timestamp: number;
  status: 'completed' | 'in_progress' | 'flagged';
  priority?: number;
  confidence?: number;
  details?: any;
}

interface ExamAnalytics {
  session_id: string;
  total_events: number;
  flagged_events: number;
  high_priority_events: number;
  average_confidence_score: number;
  suspicious_activity_score: number;
  timeline_events: TimelineEvent[];
  step_timeline?: StepTimelineEvent[];  // Add step timeline
}

export default function ExamAnalyticsPage() {
  const { examId, sessionId } = useParams();
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<ExamAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'high_priority'>('all');
  const [activeTab, setActiveTab] = useState<'events' | 'steps'>('steps');

  useEffect(() => {
    if (!examId || !sessionId || !user?.id) return;
    
    fetchAnalytics();
  }, [examId, sessionId, user?.id]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/exam/${examId}/analytics/${sessionId}`, {
        headers: {
          'x-user-id': user.id,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }

      const data = await response.json();
      setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
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

  const getEventColor = (event: TimelineEvent) => {
    if (event.is_flagged) {
      if (event.priority === 3) return 'border-red-500 bg-red-900/20 text-red-300';
      if (event.priority === 2) return 'border-yellow-500 bg-yellow-900/20 text-yellow-300';
    }
    return 'border-gray-700 bg-[#111111] text-gray-200';
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'tab_switch': return '🚫';
      case 'copy_paste': return '📋';
      case 'keystroke_anomaly': return '⌨️';
      case 'window_focus_lost': return '👁️';
      case 'face_not_detected': return '👤';
      case 'mouse_movement': return '🖱️';
      case 'video_start': return '🎥';
      case 'video_stop': return '⏹️';
      default: return '📝';
    }
  };

  const getEventDescription = (event: TimelineEvent) => {
    const { event_type, event_data } = event;
    
    switch (event_type) {
      case 'tab_switch':
        return `Student switched to another tab/window`;
      case 'copy_paste':
        return `Copy/paste activity detected`;
      case 'keystroke_anomaly':
        return `Unusual typing pattern detected (confidence: ${(event.confidence_score * 100).toFixed(0)}%)`;
      case 'window_focus_lost':
        return `Browser window lost focus`;
      case 'face_not_detected':
        return `Student's face not detected in video`;
      case 'mouse_movement':
        return `Unusual mouse movement pattern`;
      case 'video_start':
        return `Video recording started`;
      case 'video_stop':
        return `Video recording stopped`;
      case 'exam_start':
        return `Exam session started`;
      case 'exam_submit':
        return `Exam submitted`;
      case 'question_view':
        return `Viewed question ${event_data?.question_id || 'unknown'}`;
      default:
        return `${event_type} event`;
    }
  };

  const filteredEvents = analytics?.timeline_events.filter(event => {
    if (filter === 'flagged') return event.is_flagged;
    if (filter === 'high_priority') return event.priority >= 2;
    return true;
  }) || [];

  const getSuspiciousScoreColor = (score: number) => {
    if (score >= 0.7) return 'text-red-400';
    if (score >= 0.4) return 'text-yellow-400';
    return 'text-green-400';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-4 border-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-red-400" />
          <h2 className="text-2xl font-medium mb-2">Analytics Not Found</h2>
          <p className="text-gray-400">Unable to load analytics for this exam session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto py-8 px-6">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-light mb-2">Exam Analytics</h1>
            <p className="text-gray-400">Session ID: {analytics.session_id}</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => window.location.href = `/exam/${examId}/results/${sessionId}`}
              className="px-6 py-3 bg-white text-black hover:opacity-90 rounded-md font-medium transition-colors flex items-center space-x-2"
            >
              <Eye size={20} />
              <span>View Results & Video</span>
            </button>
          </div>
        </div>

        {/* Analytics Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-[#111111] p-6 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">Total Events</p>
                <p className="text-2xl font-light">{analytics.total_events}</p>
              </div>
              <TrendingUp className="text-blue-400" size={24} />
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">Flagged Events</p>
                <p className="text-2xl font-light text-red-400">{analytics.flagged_events}</p>
              </div>
              <Flag className="text-red-400" size={24} />
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">High Priority</p>
                <p className="text-2xl font-light text-yellow-400">{analytics.high_priority_events}</p>
              </div>
              <AlertTriangle className="text-yellow-400" size={24} />
            </div>
          </div>

          <div className="bg-[#111111] p-6 rounded-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">Suspicious Score</p>
                <p className={`text-2xl font-light ${getSuspiciousScoreColor(analytics.suspicious_activity_score)}`}>
                  {(analytics.suspicious_activity_score * 100).toFixed(0)}%
                </p>
              </div>
              <Eye className={getSuspiciousScoreColor(analytics.suspicious_activity_score)} size={24} />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-gray-700">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('steps')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'steps'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Step-by-Step Progress
              </button>
              <button
                onClick={() => setActiveTab('events')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'events'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Detailed Events
              </button>
            </nav>
          </div>
        </div>

        {/* Step Timeline */}
        {activeTab === 'steps' && (
          <div className="bg-[#111111] p-6 rounded-md mb-8">
            <h2 className="text-xl font-medium mb-4 flex items-center">
              <User className="mr-2" size={20} />
              Student Progress Timeline
            </h2>
            
            {analytics.step_timeline && analytics.step_timeline.length > 0 ? (
              <div className="space-y-4">
                {analytics.step_timeline.map((step, index) => (
                  <div
                    key={step.step}
                    className={`flex items-start p-4 rounded-md border-l-4 ${
                      step.status === 'flagged' 
                        ? 'border-red-500 bg-red-900/20'
                        : step.status === 'completed'
                        ? 'border-green-500 bg-green-900/20'
                        : 'border-yellow-500 bg-yellow-900/20'
                    }`}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-md bg-[#1A1A1A] flex items-center justify-center mr-4">
                      <span className="text-sm font-light">
                        {step.status === 'flagged' ? '⚠️' : index + 1}
                      </span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">{step.title}</h3>
                        <span className="text-sm text-gray-400">
                          {formatTimestamp(step.timestamp)}
                        </span>
                      </div>
                      
                      <p className="text-gray-200 mt-1">{step.description}</p>
                      
                      {step.status === 'flagged' && step.priority && (
                        <div className="mt-2 flex items-center space-x-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            step.priority === 3 ? 'bg-red-600' : 
                            step.priority === 2 ? 'bg-yellow-600' : 'bg-blue-600'
                          }`}>
                            Priority {step.priority}
                          </span>
                          {step.confidence && (
                            <span className="text-sm text-gray-400">
                              Confidence: {(step.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      )}
                      
                      {step.details && Object.keys(step.details).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-sm text-blue-400 cursor-pointer hover:text-blue-300">
                            View Details
                          </summary>
                          <pre className="text-xs text-gray-200 bg-black p-2 rounded mt-2 overflow-x-auto">
                            {JSON.stringify(step.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <User size={48} className="mx-auto mb-4 opacity-50" />
                <p>No step timeline data available.</p>
              </div>
            )}
          </div>
        )}

        {/* Event Filter - Only for events tab */}
        {activeTab === 'events' && (
        <div className="bg-[#111111] p-4 rounded-md mb-6">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium">Filter Events:</span>
            <div className="flex space-x-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  filter === 'all' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-[#1A1A1A] text-gray-200 hover:bg-gray-600'
                }`}
              >
                All ({analytics.total_events})
              </button>
              <button
                onClick={() => setFilter('flagged')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  filter === 'flagged' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-[#1A1A1A] text-gray-200 hover:bg-gray-600'
                }`}
              >
                Flagged ({analytics.flagged_events})
              </button>
              <button
                onClick={() => setFilter('high_priority')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  filter === 'high_priority' 
                    ? 'bg-yellow-600 text-white' 
                    : 'bg-[#1A1A1A] text-gray-200 hover:bg-gray-600'
                }`}
              >
                High Priority ({analytics.high_priority_events})
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Detailed Timeline - Only for events tab */}
        {activeTab === 'events' && (
        <div className="bg-[#111111] p-6 rounded-md">
          <h2 className="text-xl font-medium mb-4 flex items-center">
            <Clock className="mr-2" size={20} />
            Event Timeline ({filteredEvents.length})
          </h2>
          
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Clock size={48} className="mx-auto mb-4 opacity-50" />
              <p>No events match the current filter.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredEvents.map((event, index) => (
                <div
                  key={event.id}
                  className={`border rounded-md p-4 ${getEventColor(event)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <span className="text-2xl">{getEventIcon(event.event_type)}</span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium capitalize">
                            {event.event_type.replace(/_/g, ' ')}
                          </h3>
                          {event.is_flagged && (
                            <Flag size={16} className="text-red-400" />
                          )}
                        </div>
                        <p className="text-sm opacity-90 mt-1">
                          {getEventDescription(event)}
                        </p>
                        {event.event_data && Object.keys(event.event_data).length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-200">
                              View raw data
                            </summary>
                            <pre className="text-xs bg-black/20 p-2 rounded mt-1 overflow-x-auto">
                              {JSON.stringify(event.event_data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-right text-sm">
                      <div className="font-mono">
                        {formatTimestamp(event.timestamp)}
                      </div>
                      {event.is_flagged && (
                        <div className="text-xs mt-1 space-y-1">
                          <div>Priority: {event.priority}/3</div>
                          <div>Confidence: {(event.confidence_score * 100).toFixed(0)}%</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
