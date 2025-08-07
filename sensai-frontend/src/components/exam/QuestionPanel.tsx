import { useState } from "react";
import { ExamQuestion } from "@/types/exam";
import { 
  CheckCircle2, 
  Edit3, 
  Code2, 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Check,
  Circle
} from "lucide-react";

interface QuestionPanelProps {
  questions: ExamQuestion[];
  currentIndex: number;
  answers: Record<string, string>;
  onAnswerChange: (questionId: string, answer: string) => void;
  onQuestionChange: (index: number) => void;
  onSubmitExam?: () => void;
  isSubmitting?: boolean;
}

export default function QuestionPanel({
  questions,
  currentIndex,
  answers,
  onAnswerChange,
  onQuestionChange,
  onSubmitExam,
  isSubmitting = false
}: QuestionPanelProps) {
  const currentQuestion = questions[currentIndex];

  if (!currentQuestion) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-gray-400">No questions available</div>
      </div>
    );
  }

  const renderQuestionContent = () => {
    switch (currentQuestion.type) {
      case 'multiple_choice':
        return (
          <div className="space-y-3">
            {currentQuestion.options?.map((option, index) => (
              <label
                key={index}
                className="flex items-start space-x-3 p-4 rounded-lg border border-gray-700 hover:border-gray-600 hover:bg-gray-800/50 cursor-pointer transition-all duration-200 group"
              >
                <div className="relative flex-shrink-0 mt-0.5">
                  <input
                    type="radio"
                    name={currentQuestion.id}
                    value={option}
                    checked={answers[currentQuestion.id] === option}
                    onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    answers[currentQuestion.id] === option 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-gray-500 group-hover:border-blue-400'
                  }`}>
                    {answers[currentQuestion.id] === option && (
                      <div className="w-2 h-2 rounded-full bg-white"></div>
                    )}
                  </div>
                </div>
                <span className="text-gray-100 leading-relaxed">{option}</span>
              </label>
            ))}
          </div>
        );

      case 'text':
        return (
          <textarea
            value={answers[currentQuestion.id] || ''}
            onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
            placeholder="Enter your answer here..."
            rows={6}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none shadow-sm"
          />
        );

      case 'code':
        return (
          <div className="space-y-4">
            <textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
              placeholder="Write your code here..."
              rows={12}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm resize-none shadow-sm"
            />
            <div className="text-xs text-gray-400">
              Language: {currentQuestion.metadata?.language || 'Plain text'}
            </div>
          </div>
        );

      case 'essay':
        return (
          <div className="space-y-4">
            <textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
              placeholder="Write your essay here..."
              rows={15}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none shadow-sm"
            />
            <div className="text-xs text-gray-400">
              Word count: {(answers[currentQuestion.id] || '').split(/\s+/).filter(word => word.length > 0).length}
            </div>
          </div>
        );

      default:
        return <div className="text-gray-400">Unsupported question type</div>;
    }
  };

  const getQuestionTypeIcon = (type: string) => {
    switch (type) {
      case 'multiple_choice':
        return <CheckCircle2 className="w-5 h-5" />;
      case 'text':
      case 'essay':
        return <Edit3 className="w-5 h-5" />;
      case 'code':
        return <Code2 className="w-5 h-5" />;
      default:
        return <FileText className="w-5 h-5" />;
    }
  };

  return (
    <div className="flex-1 flex bg-gray-900">
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <span className="bg-blue-600 text-white px-3 py-1.5 rounded-full text-sm font-medium">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                <div className="flex items-center space-x-2 text-gray-400">
                  {getQuestionTypeIcon(currentQuestion.type)}
                  <span className="text-sm capitalize">{currentQuestion.type.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="flex items-center space-x-2 text-sm">
                <Circle className="w-4 h-4 text-amber-400" />
                <span className="text-gray-300">
                  {currentQuestion.points} {currentQuestion.points === 1 ? 'point' : 'points'}
                </span>
              </div>
            </div>
            
            <h2 className="text-2xl font-medium text-gray-100 mb-6 leading-relaxed">
              {currentQuestion.question}
            </h2>
          </div>

          {renderQuestionContent()}

          <div className="flex justify-between mt-8">
            <button
              onClick={() => onQuestionChange(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 hover:bg-gray-800/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Previous</span>
            </button>

            {currentIndex === questions.length - 1 ? (
              <button
                onClick={onSubmitExam}
                disabled={isSubmitting}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    <span>Submit Exam</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => onQuestionChange(currentIndex + 1)}
                disabled={currentIndex === questions.length - 1}
                className="flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
              >
                <span>Next</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Question Navigation Sidebar */}
      <div className="w-64 bg-gray-800 border-l border-gray-700 p-4">
        <h3 className="text-lg font-semibold text-gray-100 mb-4">Questions</h3>
        <div className="space-y-2">
          {questions.map((question, index) => {
            const isAnswered = answers[question.id];
            const isCurrent = index === currentIndex;
            
            return (
              <button
                key={question.id}
                onClick={() => onQuestionChange(index)}
                className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
                  isCurrent
                    ? 'border-blue-500 bg-blue-900/50 text-white'
                    : isAnswered
                    ? 'border-emerald-500 bg-emerald-900/20 text-gray-100 hover:bg-emerald-900/30'
                    : 'border-gray-600 text-gray-300 hover:border-gray-500 hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Q{index + 1}</span>
                  <div className="flex items-center space-x-1">
                    {isAnswered && (
                      <Check className="w-4 h-4 text-emerald-400" />
                    )}
                    {isCurrent && (
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1 capitalize">
                  {question.type.replace('_', ' ')}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-gray-600">
          <div className="text-sm text-gray-400 mb-2">
            Progress: {Object.keys(answers).length} of {questions.length} answered
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
