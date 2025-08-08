"use client";

import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Brain, Clock } from 'lucide-react';

interface SurpriseVivaQuestion {
  viva_id?: number;
  id?: string;
  question: string;
  expected_answer?: string;
  answer?: string;
  time_limit?: number;
}

interface SurpriseVivaPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (answers: Record<string, string>) => void;
  questions: SurpriseVivaQuestion[];
  timeLimit?: number; // in seconds
}

export default function SurpriseVivaPopup({
  isOpen,
  onClose,
  onComplete,
  questions = [],
  timeLimit = 300 // 5 minutes default
}: SurpriseVivaPopupProps) {
  console.log('📋 SurpriseVivaPopup rendered with:', { isOpen, questionsCount: questions?.length, timeLimit, questions });
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Timer effect
  useEffect(() => {
    if (!isOpen || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Auto-submit when time runs out
          handleComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, timeRemaining]);

  // Reset state when popup opens
  useEffect(() => {
    if (isOpen) {
      setCurrentQuestionIndex(0);
      setAnswers({});
      setTimeRemaining(timeLimit);
      setIsSubmitting(false);
    }
  }, [isOpen, timeLimit]);

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  
  // Get unique ID for current question - handle both formats
  const questionId = currentQuestion?.viva_id?.toString() || currentQuestion?.id || `question_${currentQuestionIndex}`;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAnswerChange = (value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleComplete = async () => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onComplete(answers);
    } catch (error) {
      console.error('Error submitting viva answers:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTimeColor = () => {
    if (timeRemaining > 120) return 'text-green-400'; // > 2 minutes
    if (timeRemaining > 60) return 'text-yellow-400';  // > 1 minute
    return 'text-red-400'; // < 1 minute
  };

  if (!isOpen || questions.length === 0) {
    console.log('🚫 SurpriseVivaPopup not rendering:', { isOpen, questionsLength: questions.length, questions });
    return null;
  }

  console.log('✅ SurpriseVivaPopup rendering popup with questions:', questions);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-[#111111] rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-red-500/30">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-red-900/20 rounded-full">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center">
                <Brain className="mr-2" size={20} />
                Surprise Viva
              </h2>
              <p className="text-sm text-gray-400">
                Answer these questions to proceed with your exam
              </p>
            </div>
          </div>

          {/* Timer */}
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className={`text-lg font-mono ${getTimeColor()}`}>
              {formatTime(timeRemaining)}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-3 bg-gray-800/50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">
              Question {currentQuestionIndex + 1} of {questions.length}
            </span>
            <span className="text-sm text-gray-400">
              {Math.round(((currentQuestionIndex + 1) / questions.length) * 100)}% Complete
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-red-500 to-orange-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Question Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {currentQuestion && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-white mb-4">
                  {currentQuestion.question}
                </h3>
                
                <textarea
                  value={answers[questionId] || ''}
                  onChange={(e) => handleAnswerChange(e.target.value)}
                  placeholder="Type your answer here..."
                  className="w-full h-32 p-4 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700">
          <div className="flex space-x-3">
            <button
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
              className="px-4 py-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
          </div>

          <div className="flex space-x-3">
            {!isLastQuestion ? (
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isSubmitting}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Submitting...
                  </>
                ) : (
                  'Submit Viva'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
