import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Clock, TrendingUp, Activity, Target, Edit3 } from 'lucide-react';

interface AnswerChangeEvent {
  timestamp: number;
  question_id: string;
  answer_length: number;
  time_since_start: number;
  changes_count: number;
}

interface AnswerAnalyticsProps {
  answerEvents: AnswerChangeEvent[];
  sessionId: string;
}

export default function AnswerAnalytics({ answerEvents, sessionId }: AnswerAnalyticsProps) {
  const analytics = useMemo(() => {
    if (!answerEvents.length) return null;

    // Group events by question
    const eventsByQuestion = answerEvents.reduce((acc, event) => {
      if (!acc[event.question_id]) {
        acc[event.question_id] = [];
      }
      acc[event.question_id].push(event);
      return acc;
    }, {} as Record<string, AnswerChangeEvent[]>);

    // Calculate statistics
    const totalChanges = answerEvents.length;
    const questionsModified = Object.keys(eventsByQuestion).length;
    const avgChangesPerQuestion = questionsModified > 0 ? totalChanges / questionsModified : 0;
    
    // Calculate time patterns
    const timeIntervals = answerEvents.slice(1).map((event, index) => 
      event.timestamp - answerEvents[index].timestamp
    );
    const avgTimeBetweenChanges = timeIntervals.length > 0 
      ? timeIntervals.reduce((sum, interval) => sum + interval, 0) / timeIntervals.length / 1000 // in seconds
      : 0;

    // Detect rapid answer changes (multiple changes within short time)
    const rapidChanges = answerEvents.filter((event, index) => {
      if (index === 0) return false;
      const timeDiff = event.timestamp - answerEvents[index - 1].timestamp;
      return timeDiff < 2000; // Less than 2 seconds between changes
    });

    // Detect questions with excessive modifications
    const excessiveModifications = Object.entries(eventsByQuestion)
      .filter(([_, events]) => events.length > 10)
      .map(([questionId, events]) => ({
        question_id: questionId,
        changes: events.length,
        first_change: events[0].timestamp,
        last_change: events[events.length - 1].timestamp
      }));

    // Format data for timeline chart
    const chartData = answerEvents.map((event, index) => ({
      time: new Date(event.timestamp).toLocaleTimeString('en-US', { 
        hour12: false, 
        minute: '2-digit', 
        second: '2-digit' 
      }),
      changes: index + 1, // Cumulative changes
      answer_length: event.answer_length,
      question: `Q${event.question_id}`,
      index
    }));

    // Answer length distribution
    const lengthRanges = [
      { range: '0-50', count: 0, color: '#ef4444' },
      { range: '51-200', count: 0, color: '#f97316' },
      { range: '201-500', count: 0, color: '#eab308' },
      { range: '501-1000', count: 0, color: '#22c55e' },
      { range: '1000+', count: 0, color: '#3b82f6' }
    ];

    answerEvents.forEach(event => {
      const len = event.answer_length;
      if (len <= 50) lengthRanges[0].count++;
      else if (len <= 200) lengthRanges[1].count++;
      else if (len <= 500) lengthRanges[2].count++;
      else if (len <= 1000) lengthRanges[3].count++;
      else lengthRanges[4].count++;
    });

    return {
      totalChanges,
      questionsModified,
      avgChangesPerQuestion: Math.round(avgChangesPerQuestion * 10) / 10,
      avgTimeBetweenChanges: Math.round(avgTimeBetweenChanges),
      rapidChanges: rapidChanges.length,
      excessiveModifications,
      chartData,
      lengthRanges,
      totalDataPoints: answerEvents.length
    };
  }, [answerEvents]);

  if (!analytics) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Edit3 className="mr-2" size={20} />
          Answer Change Analytics
        </h2>
        <div className="text-center py-8 text-gray-400">
          <Edit3 size={48} className="mx-auto mb-4 opacity-50" />
          <p>No answer changes recorded for analysis.</p>
        </div>
      </div>
    );
  }

  const formatTooltip = (value: any, name: string) => {
    if (name === 'changes') return [`${value} changes`, 'Total Changes'];
    if (name === 'answer_length') return [`${value} chars`, 'Answer Length'];
    return [value, name];
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg space-y-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Edit3 className="mr-2" size={20} />
        Answer Change Analytics ({analytics.totalDataPoints} changes)
      </h2>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-400">{analytics.totalChanges}</div>
          <div className="text-xs text-gray-400">Total Changes</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-400">{analytics.questionsModified}</div>
          <div className="text-xs text-gray-400">Questions Modified</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-orange-400">{analytics.avgChangesPerQuestion}</div>
          <div className="text-xs text-gray-400">Avg Changes/Question</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-purple-400">{analytics.avgTimeBetweenChanges}s</div>
          <div className="text-xs text-gray-400">Avg Time Between</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-red-400">{analytics.rapidChanges}</div>
          <div className="text-xs text-gray-400">Rapid Changes</div>
        </div>
      </div>

      {/* Anomaly Detection */}
      {(analytics.rapidChanges > 5 || analytics.excessiveModifications.length > 0) && (
        <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-lg">
          <h3 className="font-semibold text-red-400 mb-2 flex items-center">
            <Target className="mr-2" size={16} />
            Suspicious Answer Patterns Detected
          </h3>
          
          {analytics.rapidChanges > 5 && (
            <div className="text-sm text-red-300 mb-2">
              <strong>{analytics.rapidChanges} rapid changes</strong> detected (changes within 2 seconds), which may indicate copy-paste behavior.
            </div>
          )}
          
          {analytics.excessiveModifications.length > 0 && (
            <div className="text-sm text-red-300">
              <strong>Excessive modifications</strong> detected on {analytics.excessiveModifications.length} question(s):
              <div className="mt-2 space-y-1">
                {analytics.excessiveModifications.slice(0, 3).map((mod, index) => (
                  <div key={index} className="text-xs text-red-200">
                    • Question {mod.question_id}: {mod.changes} changes over {Math.round((mod.last_change - mod.first_change) / 1000 / 60)} minutes
                  </div>
                ))}
                {analytics.excessiveModifications.length > 3 && (
                  <div className="text-xs text-red-300">
                    ... and {analytics.excessiveModifications.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Answer Changes Timeline Chart */}
      <div className="space-y-2">
        <h3 className="font-semibold flex items-center">
          <TrendingUp className="mr-2" size={16} />
          Answer Changes Over Time
        </h3>
        <div style={{ width: '100%', height: '300px' }}>
          <ResponsiveContainer>
            <LineChart data={analytics.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="time" 
                stroke="#9ca3af"
                fontSize={12}
                interval="preserveStartEnd"
              />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: '1px solid #374151',
                  borderRadius: '8px'
                }}
                formatter={formatTooltip}
                labelStyle={{ color: '#d1d5db' }}
              />
              <Line 
                type="monotone" 
                dataKey="changes" 
                stroke="#3b82f6" 
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 1, r: 3 }}
                activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Answer Length Distribution */}
      <div className="space-y-2">
        <h3 className="font-semibold flex items-center">
          <Clock className="mr-2" size={16} />
          Answer Length Distribution
        </h3>
        <div style={{ width: '100%', height: '200px' }}>
          <ResponsiveContainer>
            <BarChart data={analytics.lengthRanges}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="range" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#1f2937', 
                  border: '1px solid #374151',
                  borderRadius: '8px'
                }}
                labelStyle={{ color: '#d1d5db' }}
              />
              <Bar 
                dataKey="count" 
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Editing Behavior Insights */}
      <div className="bg-gray-700 p-4 rounded-lg">
        <h3 className="font-semibold text-white mb-3">Editing Behavior Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="text-gray-300 font-medium mb-2">Modification Patterns:</h4>
            <ul className="text-gray-400 space-y-1">
              <li>• Questions modified: {analytics.questionsModified}</li>
              <li>• Average modifications per question: {analytics.avgChangesPerQuestion}</li>
              <li>• Rapid changes (suspicious): {analytics.rapidChanges}</li>
            </ul>
          </div>
          <div>
            <h4 className="text-gray-300 font-medium mb-2">Time Analysis:</h4>
            <ul className="text-gray-400 space-y-1">
              <li>• Average time between changes: {analytics.avgTimeBetweenChanges}s</li>
              <li>• Total editing session: {analytics.totalChanges} changes</li>
              <li>• Behavior consistency: {analytics.rapidChanges < 5 ? 'Normal' : 'Suspicious'}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
