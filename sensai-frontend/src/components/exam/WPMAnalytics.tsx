import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Clock, TrendingUp, Activity, Target } from 'lucide-react';

interface WPMDataPoint {
  timestamp: number;
  wpm: number;
  accuracy: number;
  question_id?: string;
}

interface WPMAnalyticsProps {
  wpmData: WPMDataPoint[];
  sessionId: string;
}

export default function WPMAnalytics({ wpmData, sessionId }: WPMAnalyticsProps) {
  const analytics = useMemo(() => {
    if (!wpmData.length) return null;

    // Calculate statistics
    const wpmValues = wpmData.map(d => d.wpm).filter(wpm => wpm > 0);
    const accuracyValues = wpmData.map(d => d.accuracy).filter(acc => acc >= 0);
    
    const avgWPM = wpmValues.reduce((sum, wpm) => sum + wpm, 0) / wpmValues.length;
    const maxWPM = Math.max(...wpmValues);
    const minWPM = Math.min(...wpmValues);
    const avgAccuracy = accuracyValues.reduce((sum, acc) => sum + acc, 0) / accuracyValues.length;
    
    // Calculate WPM consistency (lower standard deviation = more consistent)
    const wpmVariance = wpmValues.reduce((sum, wpm) => sum + Math.pow(wpm - avgWPM, 2), 0) / wpmValues.length;
    const wpmStdDev = Math.sqrt(wpmVariance);
    const consistencyScore = Math.max(0, 100 - (wpmStdDev / avgWPM) * 100);
    
    // Detect anomalies (WPM spikes > 2 standard deviations)
    const anomalies = wpmData.filter(d => 
      d.wpm > 0 && Math.abs(d.wpm - avgWPM) > 2 * wpmStdDev
    );
    
        // Format data for charts
    const chartData = wpmData.map((point, index) => ({
      time: new Date(point.timestamp).toLocaleTimeString('en-US', { 
        hour12: false, 
        minute: '2-digit', 
        second: '2-digit' 
      }),
      wpm: point.wpm,
      accuracy: point.accuracy,
      index
    }));

    // WPM distribution data
    const wpmRanges = [
      { range: '0-20', count: 0, color: '#ef4444' },
      { range: '21-40', count: 0, color: '#f97316' },
      { range: '41-60', count: 0, color: '#eab308' },
      { range: '61-80', count: 0, color: '#22c55e' },
      { range: '81+', count: 0, color: '#3b82f6' }
    ];

    wpmValues.forEach(wpm => {
      if (wpm <= 20) wpmRanges[0].count++;
      else if (wpm <= 40) wpmRanges[1].count++;
      else if (wpm <= 60) wpmRanges[2].count++;
      else if (wpm <= 80) wpmRanges[3].count++;
      else wpmRanges[4].count++;
    });

    return {
      avgWPM: Math.round(avgWPM),
      maxWPM: Math.round(maxWPM),
      minWPM: Math.round(minWPM),
      avgAccuracy: Math.round(avgAccuracy * 100),
      consistencyScore: Math.round(consistencyScore),
      anomalies,
      chartData,
      wpmRanges,
      totalDataPoints: wpmData.length
    };
  }, [wpmData]);

  if (!analytics) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Activity className="mr-2" size={20} />
          WPM Analytics
        </h2>
        <div className="text-center py-8 text-gray-400">
          <Activity size={48} className="mx-auto mb-4 opacity-50" />
          <p>No typing data available for analysis.</p>
        </div>
      </div>
    );
  }

  const formatTooltip = (value: any, name: string) => {
    if (name === 'wpm') return [`${value} WPM`, 'Words per Minute'];
    if (name === 'accuracy') return [`${(value * 100).toFixed(1)}%`, 'Accuracy'];
    return [value, name];
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg space-y-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Activity className="mr-2" size={20} />
        WPM Analytics ({analytics.totalDataPoints} data points)
      </h2>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-400">{analytics.avgWPM}</div>
          <div className="text-xs text-gray-400">Avg WPM</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-400">{analytics.maxWPM}</div>
          <div className="text-xs text-gray-400">Max WPM</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-orange-400">{analytics.minWPM}</div>
          <div className="text-xs text-gray-400">Min WPM</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-purple-400">{analytics.avgAccuracy}%</div>
          <div className="text-xs text-gray-400">Avg Accuracy</div>
        </div>
        <div className="bg-gray-700 p-4 rounded-lg text-center">
          <div className="text-2xl font-bold text-cyan-400">{analytics.consistencyScore}%</div>
          <div className="text-xs text-gray-400">Consistency</div>
        </div>
      </div>

      {/* Anomaly Detection */}
      {analytics.anomalies.length > 0 && (
        <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-lg">
          <h3 className="font-semibold text-red-400 mb-2 flex items-center">
            <Target className="mr-2" size={16} />
            WPM Anomalies Detected ({analytics.anomalies.length})
          </h3>
          <div className="text-sm text-red-300">
            Significant typing speed variations that may indicate external assistance or copying behavior.
          </div>
          <div className="mt-2 space-y-1">
            {analytics.anomalies.slice(0, 3).map((anomaly, index) => (
              <div key={index} className="text-xs text-red-200">
                • {anomaly.wpm} WPM at {new Date(anomaly.timestamp).toLocaleTimeString()} 
                {anomaly.question_id && ` (Question ${anomaly.question_id})`}
              </div>
            ))}
            {analytics.anomalies.length > 3 && (
              <div className="text-xs text-red-300">
                ... and {analytics.anomalies.length - 3} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* WPM Timeline Chart */}
      <div className="space-y-2">
        <h3 className="font-semibold flex items-center">
          <TrendingUp className="mr-2" size={16} />
          Typing Speed Over Time
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
                dataKey="wpm" 
                stroke="#3b82f6" 
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 1, r: 3 }}
                activeDot={{ r: 5, stroke: '#3b82f6', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* WPM Distribution */}
      <div className="space-y-2">
        <h3 className="font-semibold flex items-center">
          <Clock className="mr-2" size={16} />
          WPM Distribution
        </h3>
        <div style={{ width: '100%', height: '200px' }}>
          <ResponsiveContainer>
            <BarChart data={analytics.wpmRanges}>
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
    </div>
  );
}
