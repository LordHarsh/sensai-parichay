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
  const { examId } = useParams();
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

    fetchResults();
  }, [examId, session, status]);

  const fetchResults = async () => {
    try {
      setIsLoading(true);
      
      const sessionId = localStorage.getItem(`exam_session_${examId}`);
      if (!sessionId) {
        setError("No exam session found");
        return;
      }

      const response = await fetch(`/api/exam/${examId}/results?sessionId=${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${session?.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch results');
      }

      const data = await response.json();
      setResults(data);
      
    } catch (error) {
      console.error('Failed to fetch exam results:', error);
      setError('Failed to load exam results');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading results...</div>
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">{error || 'No results found'}</div>
          <button
            onClick={() => router.push('/')}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto py-8 px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{results.exam_title}</h1>
          <p className="text-gray-400">Exam Results</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800 p-6 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Score</h3>
              <div className={`text-2xl font-bold ${getScoreColor(results.score)}`}>
                {results.score}%
              </div>
            </div>
            <div className="text-sm text-gray-400">
              {results.answers ? Object.keys(results.answers).length : 0} of {results.questions.length} answered
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Duration</h3>
            <div className="text-2xl font-bold text-blue-400">
              {formatDuration(results.start_time, results.end_time || results.start_time)}
            </div>
            <div className="text-sm text-gray-400">Time taken</div>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Status</h3>
            <div className={`text-2xl font-bold ${
              results.status === 'completed' ? 'text-green-400' : 'text-orange-400'
            }`}>
              {results.status.charAt(0).toUpperCase() + results.status.slice(1)}
            </div>
            <div className="text-sm text-gray-400">
              {new Date(results.end_time || results.start_time).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Monitoring Summary</h3>
            <div className="space-y-3">
              {Object.entries(results.events_summary).map(([eventType, count]) => (
                <div key={eventType} className="flex justify-between items-center">
                  <span className="capitalize text-gray-300">
                    {eventType.replace('_', ' ')}
                  </span>
                  <span className={`font-semibold ${
                    eventType.includes('switch') || eventType.includes('paste') ? 'text-yellow-400' : 'text-gray-400'
                  }`}>
                    {count}
                  </span>
                </div>
              ))}
              
              {Object.keys(results.events_summary).length === 0 && (
                <div className="text-gray-400 text-center py-4">
                  No monitoring events recorded
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Recording Info</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Video chunks</span>
                <span className="font-semibold text-blue-400">
                  {results.video_info.chunk_count}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Total size</span>
                <span className="font-semibold text-blue-400">
                  {formatBytes(results.video_info.total_size)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Recording status</span>
                <span className="font-semibold text-green-400">
                  {results.video_info.chunk_count > 0 ? 'Recorded' : 'Not recorded'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg mt-8">
          <h3 className="text-xl font-semibold mb-4">Question Summary</h3>
          <div className="space-y-4">
            {results.questions.map((question, index) => {
              const userAnswer = results.answers[question.id] || '';
              const isCorrect = question.correct_answer && userAnswer === question.correct_answer;
              
              return (
                <div key={question.id} className="border border-gray-700 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-gray-200">
                      Question {index + 1}
                    </h4>
                    <div className="flex items-center space-x-2">
                      {question.type === 'multiple_choice' && (
                        <span className={`text-sm px-2 py-1 rounded ${
                          isCorrect ? 'bg-green-900 text-green-300' : 
                          userAnswer ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'
                        }`}>
                          {isCorrect ? 'Correct' : userAnswer ? 'Incorrect' : 'Not answered'}
                        </span>
                      )}
                      <span className="text-sm text-gray-400">
                        {question.points} {question.points === 1 ? 'point' : 'points'}
                      </span>
                    </div>
                  </div>
                  
                  <p className="text-gray-300 mb-3">{question.question}</p>
                  
                  {userAnswer && (
                    <div className="bg-gray-700 p-3 rounded">
                      <div className="text-sm text-gray-400 mb-1">Your answer:</div>
                      <div className="text-gray-200">{userAnswer}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-center mt-8">
          <button
            onClick={() => router.push('/')}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
