import { useState } from "react";
import { Clock, Power, CheckCircle } from "lucide-react";

interface ExamHeaderProps {
  examTitle: string;
  timeRemaining: number;
  formatTime: (seconds: number) => string;
  onEndExam: () => void;
  examStarted: boolean;
  examEnded: boolean;
  isSubmitting: boolean;
}

export default function ExamHeader({
  examTitle,
  timeRemaining,
  formatTime,
  onEndExam,
  examStarted,
  examEnded,
  isSubmitting
}: ExamHeaderProps) {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const handleEndExam = () => {
    if (isSubmitting) return;
    setShowEndConfirm(true);
  };

  const confirmEndExam = () => {
    setShowEndConfirm(false);
    onEndExam();
  };

  const getTimeColor = () => {
    if (timeRemaining <= 300) return 'text-red-500'; // 5 minutes
    if (timeRemaining <= 900) return 'text-amber-500'; // 15 minutes
    return 'text-emerald-500';
  };

  const getTimeBackground = () => {
    if (timeRemaining <= 300) return 'bg-red-500/10 border-red-500/20'; // 5 minutes
    if (timeRemaining <= 900) return 'bg-amber-500/10 border-amber-500/20'; // 15 minutes
    return 'bg-emerald-500/10 border-emerald-500/20';
  };

  return (
    <>
      <header className="bg-gray-900 border-b border-gray-700 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between max-w-none">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
              <span className="text-sm font-medium text-gray-300">LIVE EXAM</span>
            </div>
            <div className="h-4 w-px bg-gray-600"></div>
            <h1 className="text-xl font-semibold text-white">{examTitle}</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {examStarted && !examEnded && (
              <>
                <div className={`flex items-center space-x-2 px-3 py-2 rounded-lg border ${getTimeBackground()}`}>
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className={`text-sm font-mono font-semibold ${getTimeColor()}`}>
                    {formatTime(timeRemaining)}
                  </span>
                </div>
                
                <button
                  onClick={handleEndExam}
                  disabled={isSubmitting}
                  className="inline-flex items-center space-x-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium text-white transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  <Power className="w-4 h-4" />
                  <span>{isSubmitting ? 'Submitting...' : 'End Exam'}</span>
                </button>
              </>
            )}
            
            {examEnded && (
              <div className="flex items-center space-x-2 px-3 py-2 bg-emerald-900/20 border border-emerald-700/40 rounded-lg">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">Exam Completed</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 transform transition-all border border-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 bg-red-900/20 rounded-lg flex items-center justify-center border border-red-700/30">
                <Power className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">End Exam?</h3>
            </div>
            
            <p className="text-gray-300 mb-6 leading-relaxed">
              Are you sure you want to end the exam? This action cannot be undone and your current answers will be submitted for grading.
            </p>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2.5 rounded-lg font-medium transition-colors border border-gray-600"
              >
                Continue Exam
              </button>
              <button
                onClick={confirmEndExam}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
              >
                End Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
