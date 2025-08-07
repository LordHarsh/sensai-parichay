"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { 
  ArrowLeft, 
  Users, 
  Clock, 
  TrendingUp, 
  AlertTriangle, 
  Calendar,
  Eye,
  Share2,
  Settings 
} from "lucide-react";

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  questions: any[];
  settings: any;
  monitoring: any;
  created_at: string;
  org_id?: number;
  user_role: string;
}

interface ExamSession {
  id: string;
  exam_id: string;
  user_id: string;
  status: string;
  start_time: string;
  end_time?: string;
  score?: number;
}

export default function TeacherExamViewPage() {
  const { examId } = useParams();
  const { user } = useAuth();
  const [exam, setExam] = useState<Exam | null>(null);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'settings'>('overview');

  useEffect(() => {
    if (!examId || !user?.id) return;
    
    fetchExamData();
    fetchExamSessions();
  }, [examId, user?.id]);

  const fetchExamData = async () => {
    try {
      const response = await fetch(`/api/exam/${examId}`, {
        headers: {
          'x-user-id': user.id,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch exam');
      }

      const data = await response.json();
      setExam(data);
    } catch (error) {
      console.error('Error fetching exam:', error);
    }
  };

  const fetchExamSessions = async () => {
    try {
      const response = await fetch(`/api/exam/${examId}/sessions`, {
        headers: {
          'x-user-id': user.id,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }

      const data = await response.json();
      setSessions(data);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400 bg-green-900/20';
      case 'active': return 'text-yellow-400 bg-yellow-900/20';
      case 'terminated': return 'text-red-400 bg-red-900/20';
      default: return 'text-gray-400 bg-gray-800';
    }
  };

  const getCompletionRate = () => {
    const completed = sessions.filter(s => s.status === 'completed').length;
    const total = sessions.length;
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  const getAverageScore = () => {
    const completedWithScores = sessions.filter(s => s.status === 'completed' && s.score !== undefined);
    if (completedWithScores.length === 0) return 0;
    
    const sum = completedWithScores.reduce((acc, s) => acc + (s.score || 0), 0);
    return Math.round(sum / completedWithScores.length);
  };

  const copyExamUrl = () => {
    const url = `${window.location.origin}/exam/${examId}`;
    navigator.clipboard.writeText(url);
    // You could add a toast notification here
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-red-400" />
          <h2 className="text-2xl font-semibold mb-2">Exam Not Found</h2>
          <p className="text-gray-400">The exam you're looking for doesn't exist or you don't have permission to view it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto py-8 px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <Link
              href="/exam/teacher"
              className="flex items-center text-gray-400 hover:text-white transition-colors mr-4"
            >
              <ArrowLeft size={20} className="mr-1" />
              Back to Dashboard
            </Link>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">{exam.title}</h1>
              <p className="text-gray-400 mb-4">{exam.description}</p>
              <div className="flex items-center space-x-6 text-sm text-gray-400">
                <span className="flex items-center">
                  <Clock size={16} className="mr-1" />
                  {exam.duration} minutes
                </span>
                <span className="flex items-center">
                  <TrendingUp size={16} className="mr-1" />
                  {exam.questions.length} questions
                </span>
                <span className="flex items-center">
                  <Calendar size={16} className="mr-1" />
                  Created {formatDate(exam.created_at)}
                </span>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={copyExamUrl}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors flex items-center"
              >
                <Share2 size={16} className="mr-2" />
                Share Exam
              </button>
              <Link
                href={`/exam/${examId}`}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors flex items-center"
              >
                <Eye size={16} className="mr-2" />
                Preview Exam
              </Link>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-8">
          <div className="flex space-x-8 border-b border-gray-700">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'sessions'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              Sessions ({sessions.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              Settings
            </button>
          </div>
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Stats */}
            <div className="lg:col-span-2 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-800 p-6 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400">Total Attempts</p>
                      <p className="text-2xl font-bold">{sessions.length}</p>
                    </div>
                    <Users className="text-blue-400" size={24} />
                  </div>
                </div>

                <div className="bg-gray-800 p-6 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400">Completion Rate</p>
                      <p className="text-2xl font-bold">{getCompletionRate()}%</p>
                    </div>
                    <TrendingUp className="text-green-400" size={24} />
                  </div>
                </div>

                <div className="bg-gray-800 p-6 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400">Average Score</p>
                      <p className="text-2xl font-bold">{getAverageScore()}%</p>
                    </div>
                    <TrendingUp className="text-yellow-400" size={24} />
                  </div>
                </div>
              </div>

              {/* Recent Sessions */}
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Recent Sessions</h3>
                {sessions.slice(0, 5).length === 0 ? (
                  <p className="text-gray-400 text-center py-4">No sessions yet.</p>
                ) : (
                  <div className="space-y-3">
                    {sessions.slice(0, 5).map((session) => (
                      <div key={session.id} className="flex items-center justify-between p-3 bg-gray-700 rounded">
                        <div>
                          <p className="font-medium">{session.user_display || session.user_email || `User ${session.user_id}`}</p>
                          <p className="text-sm text-gray-400">{formatDate(session.start_time)}</p>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                            {session.status}
                          </span>
                          {session.score !== undefined && (
                            <span className="font-medium">{session.score}%</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-6">
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Link
                    href={`/exam/${examId}`}
                    className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded transition-colors flex items-center"
                  >
                    <Eye size={16} className="mr-2" />
                    Preview Exam
                  </Link>
                  <button
                    onClick={copyExamUrl}
                    className="w-full bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded transition-colors flex items-center"
                  >
                    <Share2 size={16} className="mr-2" />
                    Copy Exam Link
                  </button>
                </div>
              </div>

              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Exam Information</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Duration:</span>
                    <span>{exam.duration} minutes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Questions:</span>
                    <span>{exam.questions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Created:</span>
                    <span>{formatDate(exam.created_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Organization:</span>
                    <span>{exam.org_id ? `Org ${exam.org_id}` : 'Personal'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">All Sessions ({sessions.length})</h3>
            {sessions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Users size={48} className="mx-auto mb-4 opacity-50" />
                <p>No students have taken this exam yet.</p>
                <p className="text-sm mt-2">Share the exam link to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-3 px-4">Student</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Started</th>
                      <th className="text-left py-3 px-4">Duration</th>
                      <th className="text-left py-3 px-4">Score</th>
                      <th className="text-left py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id} className="border-b border-gray-700/50">
                        <td className="py-3 px-4">{session.user_display || session.user_email || `User ${session.user_id}`}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                            {session.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">
                          {formatDate(session.start_time)}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">
                          {session.end_time ? (
                            `${Math.round((new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / 60000)} min`
                          ) : (
                            'In progress'
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {session.score !== undefined ? (
                            <span className="font-medium">{session.score}%</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-3">
                            <Link
                              href={`/exam/${examId}/analytics/${session.id}`}
                              className="text-blue-400 hover:text-blue-300 text-sm flex items-center"
                            >
                              <AlertTriangle size={16} className="mr-1" />
                              Analytics
                            </Link>
                            {session.event_count > 0 && (
                              <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded">
                                {session.event_count} events
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Settings size={20} className="mr-2" />
                Exam Settings
              </h3>
              
              {exam.settings && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-3">Behavior Settings</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Tab Switching:</span>
                        <span>{exam.settings.allow_tab_switch ? '✅ Allowed' : '❌ Blocked'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Copy/Paste:</span>
                        <span>{exam.settings.allow_copy_paste ? '✅ Allowed' : '❌ Blocked'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Camera Required:</span>
                        <span>{exam.settings.require_camera ? '✅ Yes' : '❌ No'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Microphone Required:</span>
                        <span>{exam.settings.require_microphone ? '✅ Yes' : '❌ No'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Fullscreen:</span>
                        <span>{exam.settings.fullscreen_required ? '✅ Required' : '❌ Optional'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-3">Monitoring Settings</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Video Recording:</span>
                        <span>{exam.monitoring?.video_recording ? '✅ Enabled' : '❌ Disabled'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Audio Recording:</span>
                        <span>{exam.monitoring?.audio_recording ? '✅ Enabled' : '❌ Disabled'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Keystroke Logging:</span>
                        <span>{exam.monitoring?.keystroke_logging ? '✅ Enabled' : '❌ Disabled'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Face Detection:</span>
                        <span>{exam.monitoring?.face_detection ? '✅ Enabled' : '❌ Disabled'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Mouse Tracking:</span>
                        <span>{exam.monitoring?.mouse_tracking ? '✅ Enabled' : '❌ Disabled'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
