import { useState } from "react";
import { ExamQuestion } from "@/types/exam";
import { ExamWebSocket } from "@/lib/exam-websocket";
import AdvancedCheatingDetector from "./AdvancedCheatingDetector";
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
  websocket?: ExamWebSocket | null;
  examId?: string;
}

export default function QuestionPanel({
  questions,
  currentIndex,
  answers,
  onAnswerChange,
  onQuestionChange,
  onSubmitExam,
  isSubmitting = false,
  websocket,
  examId
}: QuestionPanelProps) {
  const currentQuestion = questions[currentIndex];

  if (!currentQuestion) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black">
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
                key={option.id}
                className="flex items-start space-x-3 p-4 rounded-md border border-gray-700 hover:border-gray-500 hover:bg-[#1A1A1A] cursor-pointer transition-all duration-200 group"
              >
                <div className="relative flex-shrink-0 mt-0.5">
                  <input
                    type="radio"
                    name={currentQuestion.id}
                    value={option.id}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    answers[currentQuestion.id] === option.id
                      ? 'border-white bg-white' 
                      : 'border-gray-400 group-hover:border-gray-200'
                  }`}>
                    {answers[currentQuestion.id] === option.id && (
                      <div className="w-2 h-2 rounded-full bg-black"></div>
                    )}
                  </div>
                </div>
                <span className="text-white leading-relaxed">{option.text}</span>
              </label>
            ))}
          </div>
        );

      case 'text':
        return (
          <div>
            <textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
              placeholder="Enter your answer here..."
              rows={6}
              className="w-full bg-[#111111] border border-gray-700 rounded-md p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent resize-none shadow-sm"
            />
            {websocket && examId && (
              <AdvancedCheatingDetector
                websocket={websocket}
                examId={examId}
                questionId={currentQuestion.id}
                onTypingMetricsUpdate={(metrics) => {
                  // Handle typing metrics updates if needed
                  console.log('Typing metrics:', metrics);
                }}
              />
            )}
          </div>
        );

      case 'code':
        return (
          <div className="space-y-4">
            <textarea
              value={answers[currentQuestion.id] || ''}
              onChange={(e) => onAnswerChange(currentQuestion.id, e.target.value)}
              placeholder="Write your code here..."
              rows={12}
              className="w-full bg-black border border-gray-700 rounded-md p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent font-mono text-sm resize-none shadow-sm"
            />
            <div className="text-xs text-gray-400">
              Language: {currentQuestion.metadata?.language || 'Plain text'}
            </div>
            {websocket && examId && (
              <AdvancedCheatingDetector
                websocket={websocket}
                examId={examId}
                questionId={currentQuestion.id}
                onTypingMetricsUpdate={(metrics) => {
                  console.log('Code typing metrics:', metrics);
                }}
              />
            )}
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
              className="w-full bg-[#111111] border border-gray-700 rounded-md p-4 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent resize-none shadow-sm"
            />
            <div className="text-xs text-gray-400">
              Word count: {(answers[currentQuestion.id] || '').split(/\s+/).filter(word => word.length > 0).length}
            </div>
            {websocket && examId && (
              <AdvancedCheatingDetector
                websocket={websocket}
                examId={examId}
                questionId={currentQuestion.id}
                onTypingMetricsUpdate={(metrics) => {
                  console.log('Essay typing metrics:', metrics);
                }}
              />
            )}
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
    <div className="flex-1 flex bg-black">
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <span className="bg-white text-black px-3 py-1.5 rounded-md text-sm font-medium">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                <div className="flex items-center space-x-2 text-gray-400">
                  {getQuestionTypeIcon(currentQuestion.type)}
                  <span className="text-sm capitalize">{currentQuestion.type.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="flex items-center space-x-2 text-sm">
                <Circle className="w-4 h-4 text-amber-400" />
                <span className="text-gray-200">
                  {currentQuestion.points} {currentQuestion.points === 1 ? 'point' : 'points'}
                </span>
              </div>
            </div>
            
            <h2 className="text-2xl font-light text-gray-100 mb-6 leading-relaxed">
              {currentQuestion.question}
            </h2>
          </div>

          {renderQuestionContent()}

          <div className="flex justify-between mt-8">
            <button
              onClick={() => onQuestionChange(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-md border border-gray-700 text-gray-200 hover:text-white hover:border-gray-700 hover:bg-[#222222] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Previous</span>
            </button>

            {currentIndex === questions.length - 1 ? (
              <button
                onClick={onSubmitExam}
                disabled={isSubmitting}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-md bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm font-medium"
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
                className="flex items-center space-x-2 px-4 py-2.5 rounded-md bg-white text-black hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm font-medium"
              >
                <span>Next</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Question Navigation Sidebar */}
      <div className="w-64 bg-[#111111] border-l border-gray-700 p-4">
        <h3 className="text-lg font-light text-white mb-4">Questions</h3>
        <div className="space-y-2">
          {questions.map((question, index) => {
            const isAnswered = answers[question.id];
            const isCurrent = index === currentIndex;
            
            return (
              <button
                key={question.id}
                onClick={() => onQuestionChange(index)}
                className={`w-full text-left p-3 rounded-md border transition-all duration-200 ${
                  isCurrent
                    ? 'border-white bg-white/15 text-white'
                    : isAnswered
                    ? 'border-emerald-400 bg-emerald-900/25 text-white hover:bg-emerald-900/35'
                    : 'border-gray-700 text-gray-200 hover:border-gray-600 hover:bg-[#1A1A1A] hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Q{index + 1}</span>
                  <div className="flex items-center space-x-1">
                    {isAnswered && (
                      <Check className="w-4 h-4 text-emerald-400" />
                    )}
                    {isCurrent && (
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
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

        <div className="mt-6 pt-4 border-t border-gray-700">
          <div className="text-sm text-gray-200 mb-2">
            Progress: {Object.keys(answers).length} of {questions.length} answered
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className="bg-white h-2 rounded-full transition-all duration-300"
              style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}
