import React, { useState, useEffect } from 'react';

interface SimpleEvaluationProps {
  examId: string;
  sessionId: string;
  userSession: any;
  examTitle: string;
  score: number;
}

interface SimpleEvaluation {
  success: boolean;
  evaluation_type: string;
  exam_summary: {
    exam_title: string;
    student_name: string;
    score: number;
    total_questions: number;
    correct_answers: number;
    accuracy_rate: number;
  };
  ai_feedback: string;
  question_breakdown: Array<{
    question_number: number;
    question_text: string;
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    status: string;
  }>;
  performance_metrics: {
    performance_level: string;
    time_taken: string;
    efficiency: string;
  };
  recommendations: string[];
  generated_at: string;
  model_used: string;
  note?: string;
}

export default function SimpleExamEvaluation({ examId, sessionId, userSession, examTitle, score }: SimpleEvaluationProps) {
  const [evaluation, setEvaluation] = useState<SimpleEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateEvaluation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/exam/${examId}/evaluate/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userSession?.user?.id || userSession?.user?.email || '',
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to generate evaluation: ${response.status} ${errorData}`);
      }

      const result = await response.json();
      setEvaluation(result.evaluation);
    } catch (err) {
      console.error('Error generating evaluation:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate evaluation');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStoredEvaluation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/exam/${examId}/evaluation/${sessionId}`, {
        headers: {
          'x-user-id': userSession?.user?.id || userSession?.user?.email || '',
        },
      });

      if (response.ok) {
        const result = await response.json();
        setEvaluation(result.evaluation);
      } else if (response.status === 404) {
        setError('No previous evaluation found. Generate a new one!');
      } else {
        throw new Error('Failed to load evaluation');
      }
    } catch (err) {
      console.error('Error loading evaluation:', err);
      setError('Failed to load stored evaluation');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Try to load existing evaluation on mount
    loadStoredEvaluation();
  }, [examId, sessionId]);

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-white">
            {evaluation ? 'Loading stored evaluation...' : 'Generating AI evaluation...'}
          </span>
        </div>
      </div>
    );
  }

  if (error && !evaluation) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-xl font-semibold text-white mb-4">🤖 AI-Powered Exam Evaluation</h3>
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
        <button
          onClick={generateEvaluation}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
        >
          Generate New Evaluation
        </button>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-xl font-semibold text-white mb-4">🤖 AI-Powered Exam Evaluation</h3>
        <p className="text-gray-300 mb-4">
          Get personalized feedback and recommendations for your exam performance.
        </p>
        <div className="flex gap-3">
          <button
            onClick={loadStoredEvaluation}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium"
          >
            Load Previous
          </button>
          <button
            onClick={generateEvaluation}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium"
          >
            Generate New Evaluation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-white">🤖 AI-Powered Exam Evaluation</h3>
          <div className="flex gap-3">
            <button
              onClick={loadStoredEvaluation}
              disabled={isLoading}
              className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium text-sm"
            >
              Refresh
            </button>
            <button
              onClick={generateEvaluation}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm"
            >
              Generate New
            </button>
          </div>
        </div>

        {/* Quick Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-2xl font-bold text-blue-400">{evaluation.exam_summary.score}%</div>
            <div className="text-gray-300 text-sm">Score</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-400">{evaluation.exam_summary.correct_answers}/{evaluation.exam_summary.total_questions}</div>
            <div className="text-gray-300 text-sm">Correct</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-lg font-bold text-purple-400">{evaluation.performance_metrics.performance_level}</div>
            <div className="text-gray-300 text-sm">Level</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-lg font-bold text-orange-400">{evaluation.performance_metrics.time_taken}</div>
            <div className="text-gray-300 text-sm">Time</div>
          </div>
        </div>
      </div>

      {/* AI Feedback */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h4 className="text-lg font-semibold text-white mb-3 flex items-center">
          🎯 AI Analysis & Feedback
          {evaluation.evaluation_type === 'ai_generated' && (
            <span className="ml-2 text-xs bg-green-600 text-white px-2 py-1 rounded">AI Generated</span>
          )}
          {evaluation.note && (
            <span className="ml-2 text-xs bg-yellow-600 text-white px-2 py-1 rounded">Basic Analysis</span>
          )}
        </h4>
        <div className="bg-gray-700 rounded-lg p-4">
          <p className="text-gray-200 leading-relaxed whitespace-pre-wrap">
            {evaluation.ai_feedback}
          </p>
        </div>
      </div>

      {/* Recommendations */}
      {evaluation.recommendations && evaluation.recommendations.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h4 className="text-lg font-semibold text-white mb-3">📚 Study Recommendations</h4>
          <ul className="space-y-2">
            {evaluation.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start">
                <span className="text-blue-400 mr-2">•</span>
                <span className="text-gray-300">{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Question Breakdown */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h4 className="text-lg font-semibold text-white mb-4">📝 Question by Question</h4>
        <div className="space-y-4">
          {evaluation.question_breakdown.map((q, index) => (
            <div key={index} className={`border-l-4 pl-4 py-3 ${
              q.is_correct ? 'border-green-500 bg-green-900/20' : 'border-red-500 bg-red-900/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-white">Question {q.question_number}</span>
                <span className="text-sm">{q.status}</span>
              </div>
              
              {q.question_text && (
                <p className="text-gray-300 text-sm mb-2 italic">{q.question_text}</p>
              )}
              
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-gray-400">Your answer: </span>
                  <span className="text-gray-200">{q.user_answer || 'No answer provided'}</span>
                </div>
                {q.correct_answer && (
                  <div>
                    <span className="text-gray-400">Correct answer: </span>
                    <span className="text-green-300">{q.correct_answer}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Info */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex justify-between items-center text-sm text-gray-400">
          <span>
            Evaluation generated: {new Date(evaluation.generated_at).toLocaleString()}
          </span>
          <span>
            Model: {evaluation.model_used}
          </span>
        </div>
      </div>
    </div>
  );
}
