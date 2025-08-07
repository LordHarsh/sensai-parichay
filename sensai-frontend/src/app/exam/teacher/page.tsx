"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { Eye, Users, Calendar, Clock, AlertTriangle, TrendingUp, Copy, Check } from "lucide-react";

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  questions: any[];
  created_at: string;
  org_id?: number;
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

export default function TeacherDashboardPage() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [examSessions, setExamSessions] = useState<ExamSession[]>([]);
  const [copiedExamId, setCopiedExamId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    
    fetchTeacherExams();
  }, [user?.id]);

  const fetchTeacherExams = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/exam/teacher/${user.id}`, {
        headers: {
          'x-user-id': user.id,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch exams');
      }

      const data = await response.json();
      setExams(data);
    } catch (error) {
      console.error('Error fetching exams:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExamSessions = async (examId: string) => {
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
      setExamSessions(data);
      setSelectedExam(examId);
    } catch (error) {
      console.error('Error fetching sessions:', error);
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

  const copyExamLink = async (examId: string) => {
    try {
      const examUrl = `${window.location.origin}/exam/${examId}`;
      await navigator.clipboard.writeText(examUrl);
      setCopiedExamId(examId);
      setTimeout(() => setCopiedExamId(null), 2000);
    } catch (error) {
      console.error('Failed to copy exam link:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto py-8 px-6">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Teacher Dashboard</h1>
              <p className="text-gray-400">
                Create and manage exams. Share exam links with students - anyone who isn't the creator can take the exam.
              </p>
            </div>
            <Link
              href="/exam/create"
              className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Create New Exam
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Exams List */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <Calendar className="mr-2" size={20} />
              Your Exams ({exams.length})
            </h2>
            
            {exams.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Calendar size={48} className="mx-auto mb-4 opacity-50" />
                <p>No exams created yet.</p>
                <Link
                  href="/exam/create"
                  className="text-blue-400 hover:text-blue-300 underline mt-2 inline-block"
                >
                  Create your first exam
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {exams.map((exam) => (
                  <div
                    key={exam.id}
                    className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-lg">{exam.title}</h3>
                      <div className="flex items-center space-x-2">
                        <Clock size={16} className="text-gray-400" />
                        <span className="text-sm text-gray-400">{exam.duration}min</span>
                      </div>
                    </div>
                    
                    <p className="text-gray-400 text-sm mb-3 line-clamp-2">
                      {exam.description}
                    </p>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 text-sm text-gray-400">
                        <span className="flex items-center">
                          <TrendingUp size={16} className="mr-1" />
                          {exam.questions.length} questions
                        </span>
                        <span>{formatDate(exam.created_at)}</span>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => copyExamLink(exam.id)}
                          className={`hover:bg-gray-600 px-3 py-1 rounded text-sm transition-colors flex items-center ${
                            copiedExamId === exam.id ? 'bg-green-700' : 'bg-gray-700'
                          }`}
                          title="Share exam link"
                        >
                          {copiedExamId === exam.id ? (
                            <>
                              <Check size={16} className="mr-1" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy size={16} className="mr-1" />
                              Share
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => fetchExamSessions(exam.id)}
                          className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm transition-colors flex items-center"
                        >
                          <Users size={16} className="mr-1" />
                          Sessions
                        </button>
                        <Link
                          href={`/exam/${exam.id}/teacher`}
                          className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm transition-colors flex items-center"
                        >
                          <Eye size={16} className="mr-1" />
                          View
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Exam Sessions */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <Users className="mr-2" size={20} />
              Exam Sessions
            </h2>
            
            {selectedExam ? (
              <div>
                <div className="mb-4">
                  <h3 className="text-lg font-medium">
                    {exams.find(e => e.id === selectedExam)?.title}
                  </h3>
                  <p className="text-sm text-gray-400">
                    {examSessions.length} session(s) found
                  </p>
                </div>
                
                {examSessions.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Users size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No students have taken this exam yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {examSessions.map((session) => (
                      <div
                        key={session.id}
                        className="border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{session.user_display || session.user_email || `User ${session.user_id}`}</span>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(session.status)}`}>
                            {session.status}
                          </span>
                        </div>
                        
                        <div className="text-sm text-gray-400 space-y-1">
                          <div>Started: {formatDate(session.start_time)}</div>
                          {session.end_time && (
                            <div>Completed: {formatDate(session.end_time)}</div>
                          )}
                          {session.score !== undefined && (
                            <div className="flex items-center">
                              Score: <span className="ml-1 font-medium text-white">{session.score}%</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-2 pt-2 border-t border-gray-700 flex justify-end">
                          <Link
                            href={`/exam/${session.exam_id}/analytics/${session.id}`}
                            className="text-blue-400 hover:text-blue-300 text-sm flex items-center"
                          >
                            <AlertTriangle size={16} className="mr-1" />
                            View Analytics
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Users size={48} className="mx-auto mb-4 opacity-50" />
                <p>Select an exam to view its sessions.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
