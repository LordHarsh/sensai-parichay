"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface ExamSummary {
  id: string;
  title: string;
  description: string;
  duration: number;
  questions: any[];
  created_at: string;
}

export default function ExamListPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    
    if (!session) {
      router.push("/login");
      return;
    }

    fetchExams();
  }, [session, status]);

  const fetchExams = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/exams', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch exams');
      }

      const data = await response.json();
      setExams(data.exams || []);
    } catch (err) {
      console.error('Error fetching exams:', err);
      setError('Failed to load exams. Please try again.');
      
      // Fallback to mock data for now
      const mockExams: ExamSummary[] = [
        {
          id: "de7de30c-bcb0-4664-870a-b20006bb984f",
          title: "JavaScript Programming Assessment", 
          description: "A comprehensive assessment covering JavaScript fundamentals, ES6 features, and problem-solving skills.",
          duration: 45,
          questions: Array(5).fill(null),
          created_at: new Date().toISOString()
        },
        {
          id: "exam2",
          title: "General Knowledge Assessment",
          description: "A quick assessment covering various topics including science, history, and current affairs.",
          duration: 20,
          questions: Array(5).fill(null),
          created_at: new Date().toISOString()
        },
        {
          id: "exam3",
          title: "Mathematics Problem Solving",
          description: "Advanced mathematical problems testing analytical and problem-solving skills.",
          duration: 60,
          questions: Array(5).fill(null),
          created_at: new Date().toISOString()
        }
      ];
      setExams(mockExams);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading exams...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="bg-white text-black px-4 py-2 rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto py-8 px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light mb-2">Available Exams</h1>
            <p className="text-gray-400">Select an exam to begin your assessment</p>
          </div>
          
          <Link
            href="/exam/create"
            className="bg-white text-black px-6 py-2 rounded-md font-medium hover:opacity-90 transition-opacity"
          >
            Create New Exam
          </Link>
        </div>

        {exams.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-xl mb-4">No exams available</div>
            <Link
              href="/exam/create"
              className="inline-block bg-white text-black px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              Create Your First Exam
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <div
                key={exam.id}
                className="bg-[#111111] border border-gray-700 rounded-md p-6 hover:border-gray-700 transition-colors shadow-sm flex flex-col h-full"
              >
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xl font-medium text-white">
                      {exam.title}
                    </h3>
                  </div>                
                  <p className="text-gray-200 text-sm mb-4 line-clamp-3">
                    {exam.description}
                  </p>
                </div>
                
                <div className="flex items-center space-x-4 text-sm text-gray-400 mb-4">
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{exam.questions.length} questions</span>
                  </div>
                  
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Monitored</span>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <Link
                    href={`/exam/${exam.id}`}
                    className="flex-1 bg-white text-black text-center py-2 px-4 rounded-md font-medium hover:opacity-90 transition-opacity"
                  >
                    Start Exam
                  </Link>
                  
                  <button className="px-4 py-2 border border-gray-600 text-gray-200 hover:border-gray-500 hover:text-white hover:bg-[#1A1A1A] rounded-md transition-all duration-200">
                    Preview
                  </button>
                </div>
                
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Created {new Date(exam.created_at).toLocaleDateString()}</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#1A1A1A] text-gray-200">
                      {exam.duration} min
                    </span>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 bg-green-400 rounded-md"></div>
                      <span>Available</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div className="mt-12 bg-[#111111] border border-gray-700 rounded-md p-6">
          <h2 className="text-xl font-light mb-4">Exam Guidelines</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h3 className="font-medium text-gray-200 mb-2">Before Starting:</h3>
              <ul className="space-y-1 text-gray-400">
                <li>Ensure stable internet connection</li>
                <li>Close unnecessary applications</li>
                <li>Allow camera and microphone access</li>
                <li>Find a quiet, well-lit environment</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-200 mb-2">During the Exam:</h3>
              <ul className="space-y-1 text-gray-400">
                <li>Stay in full-screen mode</li>
                <li>Keep your face visible to the camera</li>
                <li>Avoid excessive tab switching</li>
                <li>Do not use external resources unless permitted</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
