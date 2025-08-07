"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useAuth } from "@/lib/auth";
import ExamHeader from "@/components/exam/ExamHeader";
import QuestionPanel from "@/components/exam/QuestionPanel";
import VideoRecorder from "@/components/exam/VideoRecorder";
import EventTracker from "@/components/exam/EventTracker";
import MediaPipeGazeTracker from "@/components/exam/MediaPipeGazeTracker";
import ExamNotification from "@/components/exam/ExamNotification";
import { ExamWebSocket } from "@/lib/exam-websocket";
import { ExamQuestion, ExamEvent, ExamNotification as NotificationType } from "@/types/exam";

export default function ExamPage() {
  const { examId } = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { user } = useAuth();
  
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [examStarted, setExamStarted] = useState(false);
  const [examEnded, setExamEnded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [examData, setExamData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const wsRef = useRef<ExamWebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const eventTrackerRef = useRef<any>(null);

  useEffect(() => {
    if (status === "loading") return;
    
    console.log("Session status:", status);
    console.log("Session data:", session);
    console.log("User data:", user);
    
    if (!session) {
      console.log("No session found, redirecting to login");
      router.push("/login");
      return;
    }

    if (!examId) {
      console.log("No examId found, redirecting to home");
      router.push("/");
      return;
    }

    initializeExam();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [examId, session, status]);

  const initializeExam = async () => {
    try {
      setIsLoading(true);
      
      // Ensure we have a user ID before proceeding
      // Priority: user.id > session.user.id > session.user.email (as fallback)
      const userId = user?.id || session?.user?.id || session?.user?.email;
      console.log("Available user data - user:", user);
      console.log("Available session user data:", session?.user);
      console.log("Final userId being used:", userId);
      
      if (!userId) {
        console.error('No valid user identifier available');
        showNotification('Authentication required. Please log in again.', 'error');
        router.push('/login');
        return;
      }
      
      const response = await fetch(`/api/exam/${examId}`, {
        headers: {
          'x-user-id': userId,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch exam data');
      }

      const data = await response.json();
      console.log("Exam data:", data);
      
      // If user is the teacher/creator, redirect to teacher dashboard
      if (data.is_creator === true) {
        router.push(`/teacher`);
        return;
      }
      
      // Everyone else can take the exam as a student
      setExamData(data);
      setQuestions(data.questions || []);
      setTimeRemaining(data.duration * 60);
      
      // Initialize WebSocket with proper user ID and token
      const token = (session as any)?.accessToken;
      console.log("Initializing WebSocket with user ID:", userId);
      console.log("Using access token:", token ? 'Token available' : 'No token');
      wsRef.current = new ExamWebSocket(examId as string, userId, token);
      wsRef.current.onNotification = handleNotification;
      wsRef.current.onExamUpdate = handleExamUpdate;
      wsRef.current.onSessionEstablished = (sessionId: string) => {
        console.log("Session established with ID:", sessionId);
        setSessionId(sessionId);
      };
      await wsRef.current.connect();
      
    } catch (error) {
      console.error('Failed to initialize exam:', error);
      showNotification('Failed to load exam. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotification = (notification: NotificationType) => {
    setNotifications(prev => [...prev, { ...notification, id: Date.now().toString() }]);
  };

  const handleExamUpdate = (data: any) => {
    if (data.type === 'exam_ended') {
      setExamEnded(true);
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const startExam = async () => {
    try {
      setExamStarted(true);
      setIsRecording(true);
      
      const event: ExamEvent = {
        type: 'exam_started',
        timestamp: Date.now(),
        data: {
          exam_id: examId as string,
          start_time: new Date().toISOString()
        }
      };
      
      wsRef.current?.sendEvent(event);
      
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            endExam();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
    } catch (error) {
      console.error('Failed to start exam:', error);
      showNotification('Failed to start exam. Please try again.', 'error');
    }
  };

  const endExam = async () => {
    if (isSubmitting) return;
    
    try {
      setIsSubmitting(true);
      
      // Stop video recording first
      setIsRecording(false);
      
      // Send explicit video stop signal to ensure proper finalization
      if (wsRef.current?.isConnected()) {
        wsRef.current.sendVideoControl('stop', Date.now());
        
        // Wait a moment for video finalization
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      const event: ExamEvent = {
        type: 'exam_ended',
        timestamp: Date.now(),
        data: {
          exam_id: examId as string,
          end_time: new Date().toISOString(),
          answers: answers,
          time_taken: (examData?.duration * 60) - timeRemaining
        }
      };
      
      wsRef.current?.sendEvent(event);
      
      // Use consistent user ID (same logic as initialization)
      const userId = user?.id || session?.user?.id || session?.user?.email;
      console.log("Submitting exam with userId:", userId);
      console.log("Using sessionId:", sessionId);
      
      if (!userId) {
        throw new Error('User ID not available for submission');
      }
      
      // Build URL with session_id if available
      let submitUrl = `/api/exam/${examId}/submit?user_id=${userId}`;
      if (sessionId) {
        submitUrl += `&session_id=${sessionId}`;
      }
      
      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({ answers, time_taken: (examData?.duration * 60) - timeRemaining }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit exam');
      }

      const result = await response.json();
      setExamEnded(true);
      showNotification('Exam submitted successfully!', 'success');
      
      setTimeout(() => {
        const sessionId = result.session_id;
        if (sessionId) {
          router.push(`/exam/${examId}/results/${sessionId}`);
        } else {
          router.push(`/exam/${examId}/results`);
        }
      }, 2000);
      
    } catch (error) {
      console.error('Failed to end exam:', error);
      showNotification('Failed to submit exam. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
    
    const event: ExamEvent = {
      type: 'answer_changed',
      timestamp: Date.now(),
      data: {
        question_id: questionId,
        answer: answer,
        time_spent: Date.now()
      }
    };
    
    wsRef.current?.sendEvent(event);
  };

  const handleQuestionChange = (index: number) => {
    const prevIndex = currentQuestionIndex;
    setCurrentQuestionIndex(index);
    
    const event: ExamEvent = {
      type: 'question_navigation',
      timestamp: Date.now(),
      data: {
        from_question: prevIndex,
        to_question: index,
        navigation_time: Date.now()
      }
    };
    
    wsRef.current?.sendEvent(event);
  };

  const showNotification = (message: string, type: 'info' | 'warning' | 'error' | 'success') => {
    const notification: NotificationType = {
      id: Date.now().toString(),
      message,
      type,
      timestamp: Date.now()
    };
    setNotifications(prev => [...prev, notification]);
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading exam...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <ExamHeader 
        examTitle={examData?.title || 'Exam'}
        timeRemaining={timeRemaining}
        formatTime={formatTime}
        onEndExam={endExam}
        examStarted={examStarted}
        examEnded={examEnded}
        isSubmitting={isSubmitting}
      />
      
      <div className="flex h-[calc(100vh-80px)]">
        <div className="flex-1 flex flex-col bg-gray-900">
          {!examStarted && !examEnded ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-2xl mx-auto">
                <div className="w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                
                <h2 className="text-3xl font-bold text-gray-100 mb-4">{examData?.title}</h2>
                <p className="text-lg text-gray-300 mb-8 leading-relaxed">{examData?.description}</p>
                
                <div className="flex items-center justify-center space-x-8 text-sm text-gray-400 mb-8">
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{examData?.duration} minutes</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{questions.length} questions</span>
                  </div>
                </div>
                
                <div className="bg-amber-900/20 border border-amber-500/50 rounded-lg p-4 mb-8">
                  <div className="flex items-center space-x-2 text-amber-300">
                  <p className="text-sm text-amber-400 mt-1">
                    This exam will be recorded for monitoring purposes. Please ensure you have a stable internet connection and camera access.
                  </p>
                  </div>
                </div>
                
                <button
                  onClick={startExam}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-semibold transition-all duration-200 shadow-sm hover:shadow-md inline-flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1.01M15 10h1.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Start Exam</span>
                </button>
              </div>
            </div>
          ) : examEnded ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md mx-auto">
                <div className="w-16 h-16 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-100 mb-4">Exam Completed!</h2>
                <p className="text-gray-300 leading-relaxed">Your answers have been submitted successfully and are being processed for grading.</p>
              </div>
            </div>
          ) : (
            <QuestionPanel
              questions={questions}
              currentIndex={currentQuestionIndex}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              onQuestionChange={handleQuestionChange}
              onSubmitExam={endExam}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
        
        <div className="w-80 bg-gray-800 border-l border-gray-700">
          <VideoRecorder
            isRecording={isRecording}
            examId={examId as string}
            websocket={wsRef.current}
          />
        </div>
      </div>
      
      {examStarted && !examEnded && (
        <>
          <EventTracker
            ref={eventTrackerRef}
            websocket={wsRef.current}
            examId={examId as string}
          />
          <MediaPipeGazeTracker
            websocket={wsRef.current}
            enabled={examData?.monitoring?.gaze_tracking || false}
          />
        </>
      )}
      
      {notifications.map(notification => (
        <ExamNotification
          key={notification.id}
          notification={notification}
          onRemove={removeNotification}
        />
      ))}
    </div>
  );
}
