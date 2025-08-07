"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AnswerAnalytics from "@/components/exam/AnswerAnalytics";
import EventReplay from "@/components/exam/EventReplay";

interface ExamResults {
  session_id: string;
  exam_title: string;
  start_time: string;
  end_time: string;
  status: string;
  score: number;
  answers: Record<string, string>;
  questions: any[];
  events_summary: Record<string, number>;
  video_info: {
    chunk_count: number;
    total_size: number;
  };
}

interface ExamAnalytics {
  session_id: string;
  total_events: number;
  flagged_events: number;
  high_priority_events: number;
  average_confidence_score: number;
  suspicious_activity_score: number;
  timeline_events: any[];
  step_timeline: any[];
}

export default function ExamResultsPage() {
  const { examId, sessionId } = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  
  const [results, setResults] = useState<ExamResults | null>(null);
  const [analytics, setAnalytics] = useState<ExamAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'replay' | 'video'>('overview');
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    
    if (!session) {
      router.push("/login");
      return;
    }

    if (sessionId) {
      fetchResults();
      fetchAnalytics();
    } else {
      setError("No session ID provided");
      setIsLoading(false);
    }
  }, [examId, sessionId, session, status]);

  // Cleanup blob URL when component unmounts or video changes
  useEffect(() => {
    return () => {
      if (videoBlobUrl) {
        URL.revokeObjectURL(videoBlobUrl);
      }
    };
  }, [videoBlobUrl]);

  // Fetch video when video tab is selected
  useEffect(() => {
    if (activeTab === 'video' && !videoBlobUrl && !videoError && results?.video_info && results.video_info.chunk_count > 0) {
      fetchVideoBlob();
    }
  }, [activeTab, videoBlobUrl, videoError, results]);

  const fetchResults = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`/api/exam/${examId}/results/${sessionId}`, {
        headers: {
          'x-user-id': session?.user?.id || session?.user?.email || '',
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          setError("Exam results not found");
        } else {
          setError("Failed to fetch exam results");
        }
        return;
      }

      const data = await response.json();
      setResults(data);
      
    } catch (err) {
      console.error('Error fetching exam results:', err);
      setError("Failed to load exam results");
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`/api/exam/${examId}/analytics/${sessionId}`, {
        headers: {
          'x-user-id': session?.user?.id || session?.user?.email || '',
        }
      });
      
      if (response.ok) {
        const analyticsData = await response.json();
        setAnalytics(analyticsData);
      } else {
        console.log('Analytics not available - user might not be teacher');
      }
    } catch (err) {
      console.error('Error fetching analytics:', err);
      // Don't set error for analytics since it might not be available for students
    } finally {
      setIsLoading(false);
    }
  };

  const fetchVideoBlob = async () => {
    if (!session?.user?.id && !session?.user?.email) {
      setVideoError(true);
      setVideoLoading(false);
      return;
    }

    try {
      setVideoLoading(true);
      setVideoError(false);

      // Fetch directly from backend
      const response = await fetch(`http://localhost:8000/api/exam/${examId}/video/${sessionId}`, {
        headers: {
          'x-user-id': session?.user?.id || session?.user?.email || '',
        }
      });

      if (!response.ok) {
        console.error(`Backend returned ${response.status}: ${response.statusText}`);
        setVideoError(true);
        setVideoLoading(false);
        return;
      }

      // Convert response to blob
      const videoBlob = await response.blob();
      
      // Create blob URL
      const blobUrl = URL.createObjectURL(videoBlob);
      setVideoBlobUrl(blobUrl);
      setVideoLoading(false);

    } catch (error) {
      console.error('Error fetching video:', error);
      setVideoError(true);
      setVideoLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-300">Loading exam results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-white mb-2">Error</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-300">No results found</p>
        </div>
      </div>
    );
  }

  const timeTaken = results.start_time && results.end_time 
    ? Math.floor((new Date(results.end_time).getTime() - new Date(results.start_time).getTime()) / 1000)
    : 0;

  return (
    <div className="min-h-screen bg-gray-900 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Exam Results</h1>
          <h2 className="text-xl text-gray-300">{results.exam_title}</h2>
        </div>

        {/* Score Card */}
        <div className="bg-gray-800 rounded-xl p-6 mb-8 border border-gray-700">
          <div className="text-center">
            <div className="text-6xl font-bold mb-2">
              <span className={`${results.score >= 80 ? 'text-emerald-400' : results.score >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                {results.score}%
              </span>
            </div>
            <p className="text-gray-300 text-lg">Final Score</p>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-2">Duration</h3>
            <p className="text-2xl font-bold text-blue-400">{formatTime(timeTaken)}</p>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-2">Questions</h3>
            <p className="text-2xl font-bold text-green-400">{results.questions?.length || 0}</p>
          </div>
          
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-2">Status</h3>
            <p className={`text-2xl font-bold capitalize ${
              results.status === 'completed' ? 'text-emerald-400' : 'text-yellow-400'
            }`}>
              {results.status}
            </p>
          </div>
        </div>

        {/* Session Details */}
        <div className="bg-gray-800 rounded-xl p-6 mb-8 border border-gray-700">
          <h3 className="text-xl font-semibold text-white mb-4">Session Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-gray-400">Session ID</p>
              <p className="text-white font-mono text-sm">{results.session_id}</p>
            </div>
            <div>
              <p className="text-gray-400">Started</p>
              <p className="text-white">{formatDate(results.start_time)}</p>
            </div>
            <div>
              <p className="text-gray-400">Completed</p>
              <p className="text-white">{formatDate(results.end_time)}</p>
            </div>
            <div>
              <p className="text-gray-400">Video Recording</p>
              <p className={`${results.video_info?.chunk_count > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                {results.video_info?.chunk_count > 0 ? 'Available' : 'Not available'}
              </p>
            </div>
          </div>
        </div>

        {/* Events Summary */}
        {results.events_summary && Object.keys(results.events_summary).length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 mb-8 border border-gray-700">
            <h3 className="text-xl font-semibold text-white mb-4">Activity Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(results.events_summary).map(([event, count]) => (
                <div key={event} className="text-center">
                  <p className="text-2xl font-bold text-blue-400">{count}</p>
                  <p className="text-gray-400 text-sm capitalize">{event.replace('_', ' ')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Advanced Analytics Tabs (for teachers) */}
        {analytics && (
          <div className="mb-8">
            <div className="flex border-b border-gray-700 mb-6">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'overview'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Analytics Overview
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'analytics'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                WPM Analytics
              </button>
              <button
                onClick={() => setActiveTab('replay')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'replay'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Event Replay
              </button>
              <button
                onClick={() => {
                  setActiveTab('video');
                  // Reset video state
                  if (videoBlobUrl) {
                    URL.revokeObjectURL(videoBlobUrl);
                    setVideoBlobUrl(null);
                  }
                  setVideoLoading(true);
                  setVideoError(false);
                }}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'video'
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Video Recording
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && (
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">Advanced Analytics Overview</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-700 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-400">{analytics.total_events}</div>
                    <div className="text-xs text-gray-400">Total Events</div>
                  </div>
                  <div className="bg-gray-700 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-yellow-400">{analytics.flagged_events}</div>
                    <div className="text-xs text-gray-400">Flagged Events</div>
                  </div>
                  <div className="bg-gray-700 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-400">{analytics.high_priority_events}</div>
                    <div className="text-xs text-gray-400">High Priority</div>
                  </div>
                  <div className="bg-gray-700 p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-purple-400">{Math.round(analytics.suspicious_activity_score * 100)}%</div>
                    <div className="text-xs text-gray-400">Suspicion Score</div>
                  </div>
                </div>
                
                {/* Detailed Analytics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <h4 className="font-semibold text-white mb-3">Behavioral Analysis</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Confidence Score:</span>
                        <span className="text-green-400">{Math.round(analytics.average_confidence_score * 100)}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Risk Level:</span>
                        <span className={analytics.suspicious_activity_score > 0.7 ? 'text-red-400' : analytics.suspicious_activity_score > 0.3 ? 'text-yellow-400' : 'text-green-400'}>
                          {analytics.suspicious_activity_score > 0.7 ? 'High' : analytics.suspicious_activity_score > 0.3 ? 'Medium' : 'Low'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <h4 className="font-semibold text-white mb-3">Event Distribution</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Normal Events:</span>
                        <span className="text-blue-400">{analytics.total_events - analytics.flagged_events}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Suspicious Events:</span>
                        <span className="text-orange-400">{analytics.flagged_events - analytics.high_priority_events}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Critical Events:</span>
                        <span className="text-red-400">{analytics.high_priority_events}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-sm text-gray-300">
                  <p>This student's session has been analyzed for suspicious behavior patterns using advanced machine learning algorithms.</p>
                  <p className="mt-2">
                    <strong>Analysis Summary:</strong> The system monitors typing patterns, content similarity, paste behavior, and writing style changes to detect potential cheating attempts.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'analytics' && (
            <AnswerAnalytics 
              answerEvents={analytics.timeline_events
                .filter(event => event.event_type === 'answer_changed')
                .map((event, index) => ({
                  timestamp: event.timestamp,
                  question_id: event.event_data?.question_id || 'unknown',
                  answer_length: event.event_data?.answer?.length || 0,
                  time_since_start: event.timestamp - (analytics.timeline_events[0]?.timestamp || event.timestamp),
                  changes_count: index + 1
                }))
              }
              sessionId={analytics.session_id}
            />            )}

            {activeTab === 'replay' && (
              <EventReplay
                sessionId={analytics.session_id}
                events={analytics.timeline_events.map(event => ({
                  type: event.event_type,
                  timestamp: event.timestamp,
                  data: event.event_data
                }))}
                examId={examId as string}
              />
            )}

            {activeTab === 'video' && (
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">Exam Video Recording</h3>
                {results.video_info?.chunk_count > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="bg-gray-700 p-4 rounded-lg text-center">
                        <div className="text-2xl font-bold text-blue-400">{results.video_info.chunk_count}</div>
                        <div className="text-xs text-gray-400">Video Chunks</div>
                      </div>
                      <div className="bg-gray-700 p-4 rounded-lg text-center">
                        <div className="text-2xl font-bold text-green-400">{Math.round(results.video_info.total_size / 1024 / 1024)}MB</div>
                        <div className="text-xs text-gray-400">Total Size</div>
                      </div>
                      <div className="bg-gray-700 p-4 rounded-lg text-center">
                        <div className="text-2xl font-bold text-purple-400">Available</div>
                        <div className="text-xs text-gray-400">Status</div>
                      </div>
                    </div>
                    
                    <div className="bg-gray-900 rounded-lg p-4 relative">
                      {videoLoading && !videoError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded-lg">
                          <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                            <p className="text-gray-400 text-sm">Loading video...</p>
                          </div>
                        </div>
                      )}
                      
                      {videoError ? (
                        <div className="text-center py-8 text-red-400">
                          <svg className="w-16 h-16 mx-auto mb-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-lg font-semibold mb-2">Video Playback Error</p>
                          <p className="text-sm mb-4">Unable to load video file. The video may be corrupted or the server is not accessible.</p>
                          <a 
                            href={`http://localhost:8000/api/exam/${examId}/video/${sessionId}?download=true`}
                            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                          >
                            Try Download Instead
                          </a>
                        </div>
                      ) : (
                        <video 
                          key={videoBlobUrl} // Force re-render when blob URL changes
                          controls 
                          className="w-full h-auto max-h-96 rounded-lg"
                          preload="metadata"
                          style={{ backgroundColor: '#1f2937' }}
                          src={videoBlobUrl || undefined}
                          onError={(e) => {
                            console.error('Video error:', e);
                            setVideoError(true);
                            setVideoLoading(false);
                          }}
                          onLoadStart={() => {
                            console.log('Video loading started');
                            setVideoLoading(true);
                            setVideoError(false);
                          }}
                          onCanPlay={() => {
                            console.log('Video can start playing');
                            setVideoLoading(false);
                          }}
                          onLoadedData={() => {
                            setVideoLoading(false);
                          }}
                        >
                          <div className="text-center py-8 text-red-400">
                            <p className="text-lg font-semibold mb-2">Browser Not Supported</p>
                            <p className="text-sm">Your browser does not support WebM video playback.</p>
                            <a 
                              href={`http://localhost:8000/api/exam/${examId}/video/${sessionId}?download=true`}
                              className="inline-block mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                            >
                              Download Video
                            </a>
                          </div>
                        </video>
                      )}
                      
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button 
                          onClick={() => {
                            const video = document.querySelector('video') as HTMLVideoElement;
                            if (video) video.currentTime = 0;
                          }}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition"
                        >
                          Restart
                        </button>
                        <a 
                          href={`http://localhost:8000/api/exam/${examId}/video/${sessionId}?download=true`}
                          download
                          className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition"
                        >
                          Download Video
                        </a>
                        <button 
                          onClick={() => {
                            const video = document.querySelector('video') as HTMLVideoElement;
                            if (video) {
                              let newSpeed = 1;
                              if (videoSpeed === 1) newSpeed = 1.25;
                              else if (videoSpeed === 1.25) newSpeed = 1.5;
                              else if (videoSpeed === 1.5) newSpeed = 2;
                              else newSpeed = 1;
                              
                              video.playbackRate = newSpeed;
                              setVideoSpeed(newSpeed);
                            }
                          }}
                          className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 transition"
                        >
                          Speed: {videoSpeed}x
                        </button>
                      </div>
                      
                      <p className="text-gray-400 text-sm mt-3">
                        This video recording captures the entire exam session for proctoring purposes. 
                        The video is in WebM format and should play in most modern browsers.
                        Use the controls above to navigate through the video.
                      </p>
                      
                      <div className="mt-2 text-xs text-gray-500">
                        <p>• WebM format with VP8/VP9 video codec</p>
                        <p>• Compatible with Chrome, Firefox, Safari (14+), Edge</p>
                        <p>• Use download option if playback issues occur</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <h4 className="text-lg font-semibold text-gray-300 mb-2">No Video Recording Available</h4>
                    <p className="text-gray-400">
                      No video was recorded for this exam session. This could be due to:
                    </p>
                    <ul className="text-gray-400 text-sm mt-2 space-y-1">
                      <li>• Camera access was not granted</li>
                      <li>• Technical issues during the exam</li>
                      <li>• Video recording was disabled for this exam</li>
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Question Review */}
        {results.questions && results.questions.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 mb-8 border border-gray-700">
            <h3 className="text-xl font-semibold text-white mb-6">Question Review</h3>
            <div className="space-y-6">
              {results.questions.map((question: any, index: number) => {
                const userAnswer = results.answers[question.id] || '';
                const isCorrect = question.type === 'multiple_choice' && userAnswer === question.correct_answer;
                
                return (
                  <div key={question.id} className="border border-gray-700 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="text-white font-medium">Question {index + 1}</h4>
                      {question.type === 'multiple_choice' && (
                        <span className={`px-2 py-1 rounded text-sm font-medium ${
                          isCorrect ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                        }`}>
                          {isCorrect ? 'Correct' : 'Incorrect'}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-gray-300 mb-3">{question.question}</p>
                    
                    {question.options && (
                      <div className="mb-3">
                        <p className="text-gray-400 text-sm mb-2">Options:</p>
                        <div className="space-y-1">
                          {question.options.map((option: any, optIndex: number) => {
                            const optionLabel = String.fromCharCode(65 + optIndex);
                            const optionText = typeof option === 'string' ? option : option.text;
                            const optionId = typeof option === 'string' ? optionLabel : option.id;
                            return (
                              <div key={optIndex} className={`p-2 rounded text-sm ${
                                userAnswer === optionId ? 'bg-blue-900/30 border border-blue-700' : 'bg-gray-700'
                              } ${
                                question.correct_answer === optionId ? 'border-emerald-600 bg-emerald-900/20' : ''
                              }`}>
                                <span className="font-medium">{optionLabel}.</span> {optionText}
                                {question.correct_answer === optionId && (
                                  <span className="text-emerald-400 ml-2">(Correct)</span>
                                )}
                                {userAnswer === optionId && userAnswer !== question.correct_answer && (
                                  <span className="text-blue-400 ml-2">(Your answer)</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {userAnswer && question.type !== 'multiple_choice' && (
                      <div className="mt-3">
                        <p className="text-gray-400 text-sm mb-2">Your Answer:</p>
                        <div className="bg-gray-700 p-3 rounded">
                          <p className="text-white whitespace-pre-wrap">{userAnswer}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="text-center">
          <button
            onClick={() => router.push('/exam')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
