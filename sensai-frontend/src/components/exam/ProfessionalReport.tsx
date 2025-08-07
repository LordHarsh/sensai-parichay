import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, RadialBarChart, RadialBar,
  Legend, Area, AreaChart
} from 'recharts';

interface ProfessionalEvaluationProps {
  examId: string;
  sessionId: string;
  userSession: any;
  examTitle: string;
  score: number;
}

interface EvaluationData {
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
  comprehensive_analysis?: {
    overall_summary: {
      performance_level: string;
      key_strengths: string[];
      key_weaknesses: string[];
      time_management: string;
      overall_feedback: string;
    };
    question_by_question_analysis: Array<{
      question_number: number;
      status: string;
      detailed_feedback: string;
      why_wrong?: string;
      better_approach?: string;
      related_concepts: string[];
      difficulty_level: string;
    }>;
    knowledge_gaps: Array<{
      topic: string;
      severity: string;
      description: string;
      improvement_suggestions: string;
    }>;
    learning_recommendations: {
      immediate_actions: string[];
      study_plan: {
        week_1: string[];
        week_2: string[];
        week_3: string[];
        week_4: string[];
      };
      external_resources: Array<{
        type: string;
        title: string;
        url: string;
        description: string;
      }>;
      practice_suggestions: string[];
    };
    comparative_analysis: {
      grade_interpretation: string;
      improvement_potential: string;
      benchmark_comparison: string;
      next_level_requirements: string;
    };
    visual_insights: {
      strength_areas: Array<{
        topic: string;
        score: number;
      }>;
      improvement_areas: Array<{
        topic: string;
        priority: string;
      }>;
      time_distribution: {
        estimated_per_question: Record<string, number>;
        efficiency_rating: string;
      };
    };
    teacher_insights: {
      teaching_recommendations: string[];
      classroom_interventions: string[];
      peer_collaboration: string;
      assessment_modifications: string;
    };
  };
  ai_feedback?: string;
  question_breakdown: Array<{
    question_number: number;
    question_text: string;
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    status: string;
  }>;
  performance_metrics?: {
    performance_level: string;
    time_taken: string;
    efficiency: string;
  };
  recommendations?: string[];
  generated_at: string;
  model_used: string;
  note?: string;
}

const COLORS = {
  correct: '#10B981',
  incorrect: '#EF4444',
  primary: '#3B82F6',
  secondary: '#8B5CF6',
  warning: '#F59E0B',
  background: '#1F2937',
  surface: '#374151'
};

export default function ProfessionalExamReport({ examId, sessionId, userSession, examTitle, score }: ProfessionalEvaluationProps) {
  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
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
        throw new Error(`Failed to generate evaluation: ${response.status}`);
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
        setError('No previous evaluation found');
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
    loadStoredEvaluation();
  }, [examId, sessionId]);

  const getPerformanceColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'excellent': return '#10B981';
      case 'good': return '#3B82F6';
      case 'average': return '#F59E0B';
      case 'below average': return '#EF4444';
      case 'poor': return '#DC2626';
      default: return '#6B7280';
    }
  };

  const getPerformanceLevel = (evaluation: EvaluationData): string => {
    if (evaluation.comprehensive_analysis?.overall_summary?.performance_level) {
      return evaluation.comprehensive_analysis.overall_summary.performance_level;
    }
    if (evaluation.performance_metrics?.performance_level) {
      return evaluation.performance_metrics.performance_level;
    }
    // Fallback based on score
    const score = evaluation.exam_summary.score;
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 70) return 'Average';
    if (score >= 60) return 'Below Average';
    return 'Poor';
  };

  const getTimeTaken = (evaluation: EvaluationData): string => {
    if (evaluation.performance_metrics?.time_taken) {
      return evaluation.performance_metrics.time_taken;
    }
    return 'Unknown';
  };

  const getScoreData = (evaluation: EvaluationData) => [
    {
      name: 'Score',
      value: evaluation.exam_summary.score,
      fill: getPerformanceColor(getPerformanceLevel(evaluation))
    },
    {
      name: 'Remaining',
      value: 100 - evaluation.exam_summary.score,
      fill: '#374151'
    }
  ];

  const getQuestionAnalysis = (evaluation: EvaluationData) => [
    {
      name: 'Correct',
      value: evaluation.exam_summary.correct_answers,
      fill: COLORS.correct
    },
    {
      name: 'Incorrect', 
      value: evaluation.exam_summary.total_questions - evaluation.exam_summary.correct_answers,
      fill: COLORS.incorrect
    }
  ];

  const getQuestionBreakdownData = (evaluation: EvaluationData) => 
    evaluation.question_breakdown.map(q => ({
      question: `Q${q.question_number}`,
      status: q.is_correct ? 100 : 0,
      fill: q.is_correct ? COLORS.correct : COLORS.incorrect
    }));

  const getPerformanceRadialData = (evaluation: EvaluationData) => [
    {
      name: 'Score',
      value: evaluation.exam_summary.score,
      fill: getPerformanceColor(getPerformanceLevel(evaluation))
    }
  ];

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
        <div className="flex items-center justify-center space-x-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="text-white text-lg">Generating Professional Report...</span>
        </div>
      </div>
    );
  }

  if (error && !evaluation) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-2xl font-bold text-white mb-4">📊 Professional Exam Report</h3>
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
          <p className="text-red-300">{error}</p>
        </div>
        <button
          onClick={generateEvaluation}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
        >
          Generate Report
        </button>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-2xl font-bold text-white mb-4">📊 Professional Exam Report</h3>
        <p className="text-gray-300 mb-6">
          Generate a comprehensive performance analysis with visual insights and actionable recommendations.
        </p>
        <div className="flex space-x-4">
          <button
            onClick={loadStoredEvaluation}
            className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            Load Previous Report
          </button>
          <button
            onClick={generateEvaluation}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            Generate New Report
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
          <div>
            <h3 className="text-2xl font-bold text-white">📊 Professional Exam Report</h3>
            <p className="text-gray-300">{evaluation.exam_summary.exam_title}</p>
            <p className="text-sm text-gray-400">Student: {evaluation.exam_summary.student_name}</p>
          </div>
          <div className="flex space-x-3">
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
              Regenerate
            </button>
          </div>
        </div>

        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-400">{evaluation.exam_summary.score}%</div>
            <div className="text-gray-300 text-sm">Overall Score</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-400">
              {evaluation.exam_summary.correct_answers}/{evaluation.exam_summary.total_questions}
            </div>
            <div className="text-gray-300 text-sm">Questions Correct</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div 
              className="text-lg font-bold"
              style={{ color: getPerformanceColor(getPerformanceLevel(evaluation)) }}
            >
              {getPerformanceLevel(evaluation)}
            </div>
            <div className="text-gray-300 text-sm">Performance Level</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <div className="text-lg font-bold text-orange-400">{getTimeTaken(evaluation)}</div>
            <div className="text-gray-300 text-sm">Time Taken</div>
          </div>
        </div>
      </div>

      {/* Visual Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score Visualization */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h4 className="text-lg font-semibold text-white mb-4">Score Breakdown</h4>
          <ResponsiveContainer width="100%" height={200}>
            <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={getPerformanceRadialData(evaluation)}>
              <RadialBar
                minAngle={15}
                label={{ position: 'insideStart', fill: '#fff', fontSize: 16, fontWeight: 'bold' }}
                background
                clockWise={true}
                dataKey="value"
              />
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-white text-2xl font-bold">
                {evaluation.exam_summary.score}%
              </text>
            </RadialBarChart>
          </ResponsiveContainer>
        </div>

        {/* Question Analysis */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h4 className="text-lg font-semibold text-white mb-4">Question Analysis</h4>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={getQuestionAnalysis(evaluation)}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                label={({ name, value }: any) => `${name}: ${value}`}
              >
                {getQuestionAnalysis(evaluation).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Question-by-Question Performance */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h4 className="text-lg font-semibold text-white mb-4">Question Performance</h4>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={getQuestionBreakdownData(evaluation)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="question" stroke="#9CA3AF" />
            <YAxis stroke="#9CA3AF" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#374151',
                border: '1px solid #4B5563',
                borderRadius: '8px',
                color: '#F9FAFB'
              }}
              formatter={(value: any) => [value === 100 ? 'Correct' : 'Incorrect', 'Status']}
            />
            <Bar dataKey="status" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* AI Analysis */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-white">Comprehensive Analysis</h4>
          <div className="flex space-x-2">
            {(evaluation.evaluation_type === 'ai_generated' || evaluation.evaluation_type === 'comprehensive_ai') && (
              <span className="text-xs bg-green-600 text-white px-2 py-1 rounded">AI Powered</span>
            )}
            <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">
              {evaluation.model_used}
            </span>
          </div>
        </div>
        
        <div className="space-y-6">
          {/* Comprehensive Analysis Sections */}
          {evaluation.comprehensive_analysis ? (
            <>
              {/* Overall Summary */}
              <div className="bg-gray-700 rounded-lg p-4">
                <h5 className="text-sm font-semibold text-blue-400 mb-3">📊 Overall Performance Summary</h5>
                <p className="text-gray-200 leading-relaxed mb-4">
                  {evaluation.comprehensive_analysis.overall_summary.overall_feedback}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="text-xs font-semibold text-green-400 mb-2">✅ Key Strengths</h6>
                    <ul className="space-y-1">
                      {evaluation.comprehensive_analysis.overall_summary.key_strengths.map((strength, index) => (
                        <li key={index} className="text-gray-300 text-sm flex items-start">
                          <span className="text-green-400 mr-2">•</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h6 className="text-xs font-semibold text-orange-400 mb-2">⚠️ Areas for Improvement</h6>
                    <ul className="space-y-1">
                      {evaluation.comprehensive_analysis.overall_summary.key_weaknesses.map((weakness, index) => (
                        <li key={index} className="text-gray-300 text-sm flex items-start">
                          <span className="text-orange-400 mr-2">•</span>
                          {weakness}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Knowledge Gaps */}
              {evaluation.comprehensive_analysis.knowledge_gaps.length > 0 && (
                <div className="bg-gray-700 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-red-400 mb-3">🎯 Knowledge Gaps Analysis</h5>
                  <div className="space-y-3">
                    {evaluation.comprehensive_analysis.knowledge_gaps.map((gap, index) => (
                      <div key={index} className="border-l-4 border-red-500 pl-4">
                        <div className="flex items-center space-x-2 mb-1">
                          <h6 className="text-sm font-medium text-white">{gap.topic}</h6>
                          <span className={`text-xs px-2 py-1 rounded ${
                            gap.severity === 'High' ? 'bg-red-600' : 
                            gap.severity === 'Medium' ? 'bg-orange-600' : 'bg-yellow-600'
                          } text-white`}>
                            {gap.severity}
                          </span>
                        </div>
                        <p className="text-gray-300 text-sm mb-2">{gap.description}</p>
                        <p className="text-blue-300 text-sm italic">{gap.improvement_suggestions}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learning Recommendations */}
              {evaluation.comprehensive_analysis.learning_recommendations && (
                <div className="bg-gray-700 rounded-lg p-4">
                  <h5 className="text-sm font-semibold text-purple-400 mb-3">📚 Personalized Learning Plan</h5>
                  
                  {/* Immediate Actions */}
                  <div className="mb-4">
                    <h6 className="text-xs font-semibold text-orange-400 mb-2">🚀 Immediate Actions</h6>
                    <ul className="space-y-1">
                      {evaluation.comprehensive_analysis.learning_recommendations.immediate_actions.map((action, index) => (
                        <li key={index} className="text-gray-300 text-sm flex items-start">
                          <span className="text-orange-400 mr-2">▶</span>
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Study Plan */}
                  <div className="mb-4">
                    <h6 className="text-xs font-semibold text-blue-400 mb-2">📅 4-Week Study Plan</h6>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.entries(evaluation.comprehensive_analysis.learning_recommendations.study_plan).map(([week, activities], index) => (
                        <div key={week} className="bg-gray-600 rounded p-3">
                          <div className="text-xs font-medium text-blue-300 capitalize mb-2">{week.replace('_', ' ')}</div>
                          <ul className="space-y-1">
                            {activities.slice(0, 3).map((activity, actIndex) => (
                              <li key={actIndex} className="text-gray-300 text-xs">
                                • {activity}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* External Resources */}
                  {evaluation.comprehensive_analysis.learning_recommendations.external_resources.length > 0 && (
                    <div>
                      <h6 className="text-xs font-semibold text-green-400 mb-2">🔗 Recommended Resources</h6>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {evaluation.comprehensive_analysis.learning_recommendations.external_resources.slice(0, 4).map((resource, index) => (
                          <a 
                            key={index} 
                            href={resource.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="bg-gray-600 rounded p-2 hover:bg-gray-500 transition-colors"
                          >
                            <div className="text-xs font-medium text-blue-300">{resource.type}</div>
                            <div className="text-xs text-white font-medium">{resource.title}</div>
                            <div className="text-xs text-gray-300 mt-1">{resource.description}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Fallback AI Feedback */
            <div className="bg-gray-700 rounded-lg p-4">
              <div className="text-gray-200 leading-relaxed whitespace-pre-wrap">
                {evaluation.ai_feedback}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recommendations */}
      {evaluation.recommendations && evaluation.recommendations.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h4 className="text-lg font-semibold text-white mb-4">📈 Improvement Recommendations</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {evaluation.recommendations.map((rec, index) => (
              <div key={index} className="bg-gray-700 rounded-lg p-4 border-l-4 border-blue-500">
                <div className="flex items-start">
                  <span className="text-blue-400 mr-3 text-xl">💡</span>
                  <span className="text-gray-200 text-sm">{rec}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Question Breakdown */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h4 className="text-lg font-semibold text-white mb-4">Detailed Question Review</h4>
        <div className="space-y-4">
          {evaluation.question_breakdown.map((q, index) => (
            <div key={index} className={`border-l-4 pl-4 py-3 rounded-r-lg ${
              q.is_correct 
                ? 'border-green-500 bg-green-900/20' 
                : 'border-red-500 bg-red-900/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  <span className="font-medium text-white mr-2">Question {q.question_number}</span>
                  <span className={`text-sm px-2 py-1 rounded ${
                    q.is_correct 
                      ? 'bg-green-600 text-white' 
                      : 'bg-red-600 text-white'
                  }`}>
                    {q.is_correct ? 'Correct' : 'Incorrect'}
                  </span>
                </div>
                <span className={`text-2xl ${
                  q.is_correct ? 'text-green-400' : 'text-red-400'
                }`}>
                  {q.is_correct ? '✓' : '✗'}
                </span>
              </div>
              
              {q.question_text && (
                <p className="text-gray-300 text-sm mb-2 italic bg-gray-700 p-2 rounded">
                  {q.question_text}
                </p>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-700 p-2 rounded">
                  <span className="text-gray-400 block mb-1">Your Answer:</span>
                  <span className="text-gray-200">{q.user_answer || 'No answer provided'}</span>
                </div>
                {q.correct_answer && (
                  <div className="bg-gray-700 p-2 rounded">
                    <span className="text-gray-400 block mb-1">Correct Answer:</span>
                    <span className="text-green-300">{q.correct_answer}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Report Footer */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex justify-between items-center text-sm text-gray-400">
          <span>Report generated: {new Date(evaluation.generated_at).toLocaleString()}</span>
          <span>Analysis powered by {evaluation.model_used}</span>
        </div>
        {evaluation.note && (
          <p className="text-xs text-yellow-400 mt-2">Note: {evaluation.note}</p>
        )}
      </div>
    </div>
  );
}
