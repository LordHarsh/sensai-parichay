"use client";

import { useState } from "react";

interface EvaluationProps {
  examId: string;
  sessionId: string;
  userSession: any;
  examTitle: string;
  score: number;
}

interface ExamEvaluation {
  overall_summary: {
    performance_level: string;
    key_strengths: string[];
    key_weaknesses: string[];
    time_management: string;
    overall_feedback: string;
  };
  question_by_question_analysis: {
    question_number: number;
    status: string;
    detailed_feedback: string;
    why_wrong?: string;
    better_approach?: string;
    related_concepts: string[];
    difficulty_level: string;
  }[];
  knowledge_gaps: {
    topic: string;
    severity: string;
    description: string;
    improvement_suggestions: string;
  }[];
  learning_recommendations: {
    immediate_actions: string[];
    study_plan: {
      week_1: string[];
      week_2: string[];
      week_3: string[];
      week_4: string[];
    };
    external_resources: {
      type: string;
      title: string;
      url: string;
      description: string;
    }[];
    practice_suggestions: string[];
  };
  comparative_analysis: {
    grade_interpretation: string;
    improvement_potential: string;
    benchmark_comparison: string;
    next_level_requirements: string;
  };
  visual_insights: {
    strength_areas: {
      topic: string;
      score: number;
    }[];
    improvement_areas: {
      topic: string;
      priority: string;
    }[];
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
}

export default function ComprehensiveEvaluation({ examId, sessionId, userSession, examTitle, score }: EvaluationProps) {
  const [evaluation, setEvaluation] = useState<ExamEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'student' | 'teacher'>('student');

  const generateEvaluation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/exam/${examId}/evaluate/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userSession?.user?.id || userSession?.user?.email || '',
        }
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

  const fetchStoredEvaluation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/exam/${examId}/evaluation/${sessionId}`, {
        headers: {
          'x-user-id': userSession?.user?.id || userSession?.user?.email || '',
        }
      });

      if (response.ok) {
        const result = await response.json();
        setEvaluation(result.evaluation);
      } else if (response.status === 404) {
        setError('No previous evaluation found. Generate a new one.');
      } else {
        throw new Error('Failed to fetch stored evaluation');
      }
    } catch (err) {
      console.error('Error fetching evaluation:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch evaluation');
    } finally {
      setIsLoading(false);
    }
  };

  const renderPerformanceBadge = (level: string) => {
    const colors = {
      'Excellent': 'bg-emerald-900/30 text-emerald-400 border-emerald-500',
      'Good': 'bg-blue-900/30 text-blue-400 border-blue-500',
      'Average': 'bg-yellow-900/30 text-yellow-400 border-yellow-500',
      'Below Average': 'bg-orange-900/30 text-orange-400 border-orange-500',
      'Poor': 'bg-red-900/30 text-red-400 border-red-500'
    };
    
    return (
      <span className={`px-3 py-1 rounded-lg text-sm font-medium border ${colors[level as keyof typeof colors] || colors['Average']}`}>
        {level}
      </span>
    );
  };

  const renderPriorityBadge = (priority: string) => {
    const colors = {
      'High': 'bg-red-900/30 text-red-400',
      'Medium': 'bg-yellow-900/30 text-yellow-400',
      'Low': 'bg-green-900/30 text-green-400'
    };
    
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[priority as keyof typeof colors] || colors['Medium']}`}>
        {priority} Priority
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with action buttons */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold text-white">🤖 AI-Powered Comprehensive Evaluation</h3>
          <div className="flex gap-3">
            <button
              onClick={fetchStoredEvaluation}
              disabled={isLoading}
              className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm"
            >
              {isLoading ? 'Loading...' : 'Load Previous'}
            </button>
            <button
              onClick={generateEvaluation}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm"
            >
              {isLoading ? 'Generating...' : 'Generate New'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-4">
            <div className="flex items-center">
              <span className="mr-2">⚠️</span>
              {error}
            </div>
          </div>
        )}

        {!evaluation && !error && !isLoading && (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🎓</div>
            <h4 className="text-lg font-semibold text-white mb-2">Get AI-Powered Insights</h4>
            <p className="text-gray-300 mb-6">
              Generate a comprehensive analysis of this exam performance with personalized feedback, 
              learning recommendations, and study plans powered by advanced AI.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-blue-400 text-2xl mb-2">📝</div>
                <h5 className="font-semibold text-white mb-1">Detailed Feedback</h5>
                <p className="text-gray-400">Question-by-question analysis with explanations</p>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-green-400 text-2xl mb-2">📚</div>
                <h5 className="font-semibold text-white mb-1">Study Plan</h5>
                <p className="text-gray-400">Personalized 4-week learning roadmap</p>
              </div>
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="text-purple-400 text-2xl mb-2">🎯</div>
                <h5 className="font-semibold text-white mb-1">Smart Resources</h5>
                <p className="text-gray-400">Curated YouTube videos and learning materials</p>
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-300 mb-2">Analyzing performance with AI...</p>
            <p className="text-gray-500 text-sm">This may take 15-30 seconds</p>
          </div>
        )}
      </div>

      {/* Evaluation Results */}
      {evaluation && (
        <>
          {/* View Toggle */}
          <div className="flex justify-center mb-6">
            <div className="bg-gray-800 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setActiveSection('student')}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  activeSection === 'student'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                👨‍🎓 Student View
              </button>
              <button
                onClick={() => setActiveSection('teacher')}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  activeSection === 'teacher'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                👨‍🏫 Teacher View
              </button>
            </div>
          </div>

          {/* Student View */}
          {activeSection === 'student' && (
            <div className="space-y-6">
              {/* Overall Summary */}
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold text-white">📊 Your Performance Overview</h3>
                  {renderPerformanceBadge(evaluation.overall_summary.performance_level)}
                </div>
                
                <p className="text-gray-300 mb-6 leading-relaxed">
                  {evaluation.overall_summary.overall_feedback}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold text-green-400 mb-3 flex items-center">
                      💪 Your Strengths
                    </h4>
                    <ul className="space-y-2">
                      {evaluation.overall_summary.key_strengths.map((strength, index) => (
                        <li key={index} className="text-gray-300 flex items-start">
                          <span className="text-green-400 mr-2 mt-1">•</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold text-yellow-400 mb-3 flex items-center">
                      🎯 Areas to Improve
                    </h4>
                    <ul className="space-y-2">
                      {evaluation.overall_summary.key_weaknesses.map((weakness, index) => (
                        <li key={index} className="text-gray-300 flex items-start">
                          <span className="text-yellow-400 mr-2 mt-1">•</span>
                          {weakness}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                  <h4 className="font-semibold text-blue-400 mb-2 flex items-center">
                    ⏱️ Time Management Analysis
                  </h4>
                  <p className="text-gray-300">{evaluation.overall_summary.time_management}</p>
                </div>
              </div>

              {/* Question Analysis */}
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">📝 Question-by-Question Analysis</h3>
                <div className="space-y-4">
                  {evaluation.question_by_question_analysis.map((qa) => (
                    <div key={qa.question_number} className="border border-gray-600 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-white">Question {qa.question_number}</h4>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            qa.status === 'correct' ? 'bg-emerald-900/30 text-emerald-400' :
                            qa.status === 'partial' ? 'bg-yellow-900/30 text-yellow-400' :
                            'bg-red-900/30 text-red-400'
                          }`}>
                            {qa.status.charAt(0).toUpperCase() + qa.status.slice(1)}
                          </span>
                          <span className="text-xs text-gray-400 px-2 py-1 bg-gray-700 rounded">
                            {qa.difficulty_level}
                          </span>
                        </div>
                      </div>
                      
                      <p className="text-gray-300 mb-3">{qa.detailed_feedback}</p>
                      
                      {qa.why_wrong && (
                        <div className="mb-3 p-3 bg-red-900/20 border-l-4 border-red-500 rounded">
                          <h5 className="font-semibold text-red-400 mb-1">Why this was incorrect:</h5>
                          <p className="text-gray-300 text-sm">{qa.why_wrong}</p>
                        </div>
                      )}
                      
                      {qa.better_approach && (
                        <div className="mb-3 p-3 bg-blue-900/20 border-l-4 border-blue-500 rounded">
                          <h5 className="font-semibold text-blue-400 mb-1">Better approach:</h5>
                          <p className="text-gray-300 text-sm">{qa.better_approach}</p>
                        </div>
                      )}
                      
                      {qa.related_concepts.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-sm text-gray-400">Related concepts:</span>
                          {qa.related_concepts.map((concept, idx) => (
                            <span key={idx} className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs">
                              {concept}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Learning Recommendations */}
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">📚 Your Learning Path</h3>
                
                {/* Immediate Actions */}
                <div className="mb-6">
                  <h4 className="font-semibold text-red-400 mb-3 flex items-center">
                    🚨 Do This Now
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {evaluation.learning_recommendations.immediate_actions.map((action, index) => (
                      <div key={index} className="bg-gray-700 p-3 rounded-lg border-l-4 border-red-400">
                        <p className="text-gray-300">{action}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4-Week Study Plan */}
                <div className="mb-6">
                  <h4 className="font-semibold text-blue-400 mb-3 flex items-center">
                    📅 Your 4-Week Study Plan
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(evaluation.learning_recommendations.study_plan).map(([week, topics]) => (
                      <div key={week} className="bg-gray-700 p-4 rounded-lg">
                        <h5 className="font-semibold text-white mb-2 capitalize">
                          {week.replace('_', ' ')}
                        </h5>
                        <ul className="space-y-1">
                          {topics.map((topic, idx) => (
                            <li key={idx} className="text-gray-300 text-sm flex items-start">
                              <span className="text-blue-400 mr-2 mt-1 text-xs">•</span>
                              {topic}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                {/* External Resources */}
                <div className="mb-6">
                  <h4 className="font-semibold text-purple-400 mb-3 flex items-center">
                    🔗 Recommended Resources
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {evaluation.learning_recommendations.external_resources.map((resource, index) => (
                      <div key={index} className="bg-gray-700 p-4 rounded-lg border border-gray-600">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-sm font-medium text-purple-400">{resource.type}</span>
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 text-sm"
                          >
                            Open ↗
                          </a>
                        </div>
                        <h5 className="font-semibold text-white mb-2">{resource.title}</h5>
                        <p className="text-gray-300 text-sm">{resource.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Practice Suggestions */}
                <div>
                  <h4 className="font-semibold text-green-400 mb-3 flex items-center">
                    🎯 Practice Activities
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {evaluation.learning_recommendations.practice_suggestions.map((suggestion, index) => (
                      <div key={index} className="bg-gray-700 p-3 rounded-lg">
                        <p className="text-gray-300">{suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Performance Analytics */}
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">📊 Your Performance Analytics</h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Strength Areas */}
                  <div>
                    <h4 className="font-semibold text-green-400 mb-3">Strong Areas</h4>
                    <div className="space-y-2">
                      {evaluation.visual_insights.strength_areas.map((area, index) => (
                        <div key={index} className="flex justify-between items-center bg-gray-700 p-3 rounded">
                          <span className="text-gray-300">{area.topic}</span>
                          <span className="text-green-400 font-semibold">{Math.round(area.score)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Improvement Areas */}
                  <div>
                    <h4 className="font-semibold text-yellow-400 mb-3">Focus Areas</h4>
                    <div className="space-y-2">
                      {evaluation.visual_insights.improvement_areas.map((area, index) => (
                        <div key={index} className="flex justify-between items-center bg-gray-700 p-3 rounded">
                          <span className="text-gray-300">{area.topic}</span>
                          {renderPriorityBadge(area.priority)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Time Efficiency */}
                <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                  <div className="flex justify-between items-center">
                    <h4 className="font-semibold text-blue-400">Time Management Efficiency</h4>
                    <span className={`px-3 py-1 rounded text-sm font-medium ${
                      evaluation.visual_insights.time_distribution.efficiency_rating === 'Excellent' ? 'bg-emerald-900/30 text-emerald-400' :
                      evaluation.visual_insights.time_distribution.efficiency_rating === 'Good' ? 'bg-blue-900/30 text-blue-400' :
                      evaluation.visual_insights.time_distribution.efficiency_rating === 'Average' ? 'bg-yellow-900/30 text-yellow-400' :
                      'bg-red-900/30 text-red-400'
                    }`}>
                      {evaluation.visual_insights.time_distribution.efficiency_rating}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Teacher View */}
          {activeSection === 'teacher' && (
            <div className="space-y-6">
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <h3 className="text-xl font-semibold text-white mb-4">👨‍🏫 Teacher Insights & Recommendations</h3>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Teaching Focus Areas */}
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <h4 className="font-semibold text-blue-400 mb-3">📚 Teaching Focus Areas</h4>
                    <ul className="space-y-2">
                      {evaluation.teacher_insights.teaching_recommendations.map((rec, index) => (
                        <li key={index} className="text-gray-300 flex items-start">
                          <span className="text-blue-400 mr-2 mt-1">•</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Classroom Interventions */}
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <h4 className="font-semibold text-yellow-400 mb-3">🎯 Suggested Interventions</h4>
                    <ul className="space-y-2">
                      {evaluation.teacher_insights.classroom_interventions.map((intervention, index) => (
                        <li key={index} className="text-gray-300 flex items-start">
                          <span className="text-yellow-400 mr-2 mt-1">•</span>
                          {intervention}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Peer Collaboration */}
                <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                  <h4 className="font-semibold text-purple-400 mb-2">👥 Peer Learning Opportunities</h4>
                  <p className="text-gray-300">{evaluation.teacher_insights.peer_collaboration}</p>
                </div>

                {/* Assessment Modifications */}
                <div className="mt-6 p-4 bg-gray-700 rounded-lg">
                  <h4 className="font-semibold text-green-400 mb-2">📝 Assessment Modifications</h4>
                  <p className="text-gray-300">{evaluation.teacher_insights.assessment_modifications}</p>
                </div>

                {/* Knowledge Gaps Analysis */}
                <div className="mt-6">
                  <h4 className="font-semibold text-red-400 mb-3">🔍 Knowledge Gaps Analysis</h4>
                  <div className="space-y-3">
                    {evaluation.knowledge_gaps.map((gap, index) => (
                      <div key={index} className="bg-gray-700 p-4 rounded-lg border-l-4 border-red-400">
                        <div className="flex justify-between items-start mb-2">
                          <h5 className="font-semibold text-white">{gap.topic}</h5>
                          {renderPriorityBadge(gap.severity)}
                        </div>
                        <p className="text-gray-300 text-sm mb-2">{gap.description}</p>
                        <p className="text-gray-400 text-sm"><strong>Suggestions:</strong> {gap.improvement_suggestions}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Comparative Analysis */}
                <div className="mt-6 bg-gray-700 p-4 rounded-lg">
                  <h4 className="font-semibold text-indigo-400 mb-3">📊 Performance Context</h4>
                  <div className="space-y-3">
                    <div>
                      <span className="text-sm text-gray-400">Grade Interpretation:</span>
                      <p className="text-gray-300">{evaluation.comparative_analysis.grade_interpretation}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Improvement Potential:</span>
                      <p className="text-gray-300">{evaluation.comparative_analysis.improvement_potential}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Benchmark Comparison:</span>
                      <p className="text-gray-300">{evaluation.comparative_analysis.benchmark_comparison}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-400">Next Level Requirements:</span>
                      <p className="text-gray-300">{evaluation.comparative_analysis.next_level_requirements}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
