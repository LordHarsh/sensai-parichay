"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

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

export default function ExamResultsPage() {
  const { examId, sessionId } = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  
  const [results, setResults] = useState<ExamResults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    
    if (!session) {
      router.push("/login");
      return;
    }

    if (sessionId) {
      fetchResults();
    } else {
      setError("No session ID provided");
      setIsLoading(false);
    }
  }, [examId, sessionId, session, status]);

  const fetchResults = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch(`/api/exam/${examId}/results/${sessionId}`);
      
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
    } finally {
      setIsLoading(false);
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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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
                          {question.options.map((option: string, optIndex: number) => {
                            const optionLabel = String.fromCharCode(65 + optIndex);
                            return (
                              <div key={optIndex} className={`p-2 rounded text-sm ${
                                userAnswer === optionLabel ? 'bg-blue-900/30 border border-blue-700' : 'bg-gray-700'
                              } ${
                                question.correct_answer === optionLabel ? 'border-emerald-600 bg-emerald-900/20' : ''
                              }`}>
                                <span className="font-medium">{optionLabel}.</span> {option}
                                {question.correct_answer === optionLabel && (
                                  <span className="text-emerald-400 ml-2">(Correct)</span>
                                )}
                                {userAnswer === optionLabel && userAnswer !== question.correct_answer && (
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
