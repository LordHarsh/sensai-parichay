"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useSchools } from "@/lib/api";
import { Brain, Sparkles, Settings, BookOpen } from "lucide-react";

interface Course {
  id: number;
  name: string;
  role: string;
  org?: {
    id: number;
    name: string;
    slug: string;
  };
}

export default function GenerateAIExamPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { schools } = useSchools();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [maxQuestions, setMaxQuestions] = useState(10);
  const [duration, setDuration] = useState<number | "">("");
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  
  // Course selection state
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  // Monitoring settings
  const [monitoringSettings] = useState({
    video_recording: true,
    audio_recording: true,
    screen_recording: false,
    keystroke_logging: true,
    mouse_tracking: true,
    face_detection: true,
    gaze_tracking: true,
    network_monitoring: true
  });

  // Exam behavior settings
  const [examSettings] = useState({
    allow_tab_switch: false,
    max_tab_switches: 2,
    allow_copy_paste: false,
    require_camera: true,
    require_microphone: false,
    fullscreen_required: true,
    auto_submit: true,
    shuffle_questions: false,
    show_timer: true
  });

  // Fetch user courses when component mounts
  useEffect(() => {
    if (user?.id) {
      fetchCourses();
    }
  }, [user?.id]);

  const fetchCourses = async () => {
    if (!user?.id) return;

    setIsLoadingCourses(true);
    setCourseError(null);

    try {
      const response = await fetch(`/api/users/${user.id}/courses`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch courses');
      }

      const data = await response.json();
      setCourses(data);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setCourseError('Failed to load courses');
    } finally {
      setIsLoadingCourses(false);
    }
  };

  const handleCourseSelection = (courseId: number | null) => {
    setSelectedCourseId(courseId);
    
    // If a course is selected, automatically set the organization
    if (courseId && courses) {
      const selectedCourse = courses.find(course => course.id === courseId);
      if (selectedCourse?.org?.id) {
        setSelectedOrgId(selectedCourse.org.id);
      }
    }
  };

  const generateCourseBasedExam = async () => {
    if (!selectedCourseId) {
      alert("Please select a course first.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress("Connecting to AI service...");

    try {
      setGenerationProgress("Generating course-based exam with AI...");
      
      const selectedCourse = courses.find(c => c.id === selectedCourseId);
      
      const examData = {
        title: `${selectedCourse?.name || 'Course'} Assessment`,
        description: `Comprehensive assessment for ${selectedCourse?.name || 'the selected course'}`,
        max_questions: maxQuestions,
        duration: duration || 60,
        settings: examSettings,
        monitoring: monitoringSettings,
        org_id: selectedOrgId,
        course_id: selectedCourseId
      };

      const response = await fetch('/api/exam/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || ''
        },
        body: JSON.stringify(examData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate exam');
      }

      setGenerationProgress("Exam generated successfully! Redirecting...");
      setTimeout(() => {
        router.push(`/exam/${result.id}/teacher`);
      }, 1500);

    } catch (error) {
      console.error('Error generating course-based exam:', error);
      alert(`Failed to generate exam: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
      setGenerationProgress("");
    }
  };

  const generateCustomExam = async () => {
    if (!title || !description) {
      alert("Please fill in all required fields.");
      return;
    }

    if (maxQuestions < 1 || maxQuestions > 50) {
      alert("Number of questions must be between 1 and 50.");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress("Connecting to AI service...");

    try {
      setGenerationProgress("Generating exam questions with AI...");
      
      const examData = {
        title,
        description,
        max_questions: maxQuestions,
        duration: duration || undefined,
        settings: examSettings,
        monitoring: monitoringSettings,
        org_id: selectedOrgId,
        course_id: selectedCourseId
      };

      const response = await fetch('/api/exam/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || ''
        },
        body: JSON.stringify(examData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate exam');
      }

      setGenerationProgress("Exam generated successfully! Redirecting...");
      setTimeout(() => {
        router.push(`/exam/${result.id}/teacher`);
      }, 1500);

    } catch (error) {
      console.error('Error generating exam:', error);
      alert(`Failed to generate exam: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
      setGenerationProgress("");
    }
  };

  const generateDescription = async () => {
    if (!title.trim()) {
      alert("Please enter an exam title first.");
      return;
    }

    if (title.length < 3) {
      alert("Exam title must be at least 3 characters long.");
      return;
    }

    setIsGeneratingDescription(true);

    try {
      const requestBody: any = { title };
      
      // Include course_id if a course is selected
      if (selectedCourseId) {
        requestBody.course_id = selectedCourseId;
      }

      const response = await fetch('/api/exam/generate-description', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || ''
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate description');
      }

      setDescription(result.description);
    } catch (error) {
      console.error('Error generating description:', error);
      alert(`Failed to generate description: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto py-8 px-6">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-3xl font-light">Generate AI Exam</h1>
          </div>
          <p className="text-gray-400 leading-relaxed">
            Create comprehensive exams automatically using AI. Choose from course-based generation 
            for structured curriculum content, or create custom exams with your own topics.
          </p>
        </div>

        <div className="space-y-8">
          {/* Course-Based Exam Generation */}
          <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-500/30 p-6 rounded-md">
            <h2 className="text-xl font-medium mb-4 flex items-center">
              Quick Course-Based Exam
            </h2>
            <p className="text-gray-200 text-sm mb-4">
              Generate an exam directly from course content including milestones, tasks, and learning outcomes.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Select Course <span className="text-red-400">*</span>
                </label>
                {isLoadingCourses ? (
                  <div className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 text-gray-400">
                    Loading courses...
                  </div>
                ) : courseError ? (
                  <div className="w-full bg-red-900/30 border border-red-500/50 rounded-md px-4 py-3 text-red-300">
                    {courseError}
                  </div>
                ) : (
                  <select
                    value={selectedCourseId || ""}
                    onChange={(e) => handleCourseSelection(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                    disabled={isGenerating}
                  >
                    <option value="">Select a course...</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name} ({course.org?.name || 'Personal'})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Questions</label>
                  <input
                    type="number"
                    value={maxQuestions}
                    onChange={(e) => setMaxQuestions(Number(e.target.value))}
                    min="1"
                    max="50"
                    className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                    disabled={isGenerating}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Duration (minutes)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : "")}
                    min="5"
                    max="300"
                    placeholder="60"
                    className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                    disabled={isGenerating}
                  />
                </div>
              </div>

              {isGenerating && (
                <div className="flex items-center space-x-2 text-blue-400">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">{generationProgress}</span>
                </div>
              )}

              <button
                onClick={generateCourseBasedExam}
                disabled={isGenerating || !selectedCourseId}
                className="w-full px-6 py-3 bg-white text-black  hover:opacity-90 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md font-medium transition-opacity flex items-center justify-center space-x-2"
              >
                <Brain size={20} />
                <span>{isGenerating ? "Generating..." : "Generate Course Exam"}</span>
                <Sparkles size={18} />
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center">
            <div className="flex-1 border-t border-gray-700"></div>
            <span className="px-4 text-gray-400 text-sm">OR</span>
            <div className="flex-1 border-t border-gray-700"></div>
          </div>

          {/* Custom Exam Generation */}
          <div className="bg-[#111111] border border-gray-700 p-6 rounded-md">
            <h2 className="text-xl font-medium mb-4 flex items-center">
              <Settings className="mr-2" size={20} />
              Custom Topic Exam
            </h2>
            <p className="text-gray-200 text-sm mb-4">
              Create an exam on any topic with custom title and description.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Exam Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., JavaScript Programming Assessment"
                  className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                  disabled={isGenerating}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium">
                    Description & Topic <span className="text-red-400">*</span>
                  </label>
                  <button
                    onClick={generateDescription}
                    disabled={isGeneratingDescription || !title.trim() || isGenerating}
                    className="flex items-center space-x-1 px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
                    title="Generate description based on exam title"
                  >
                    {isGeneratingDescription ? (
                      <>
                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        <span>Auto-complete</span>
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the topics, learning objectives, and scope of the exam. Be specific - this helps AI generate better questions. For example: 'A comprehensive assessment covering JavaScript fundamentals, ES6 features, DOM manipulation, asynchronous programming, and basic algorithms.'"
                  rows={4}
                  className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors resize-none"
                  disabled={isGenerating || isGeneratingDescription}
                />
                {title.trim() && !description.trim() && (
                  <p className="text-xs text-blue-400 mt-1 flex items-center">
                    <Sparkles size={12} className="mr-1" />
                    Tip: Click "Auto-complete" to generate a description based on your title
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Questions</label>
                  <input
                    type="number"
                    value={maxQuestions}
                    onChange={(e) => setMaxQuestions(Number(e.target.value))}
                    min="1"
                    max="50"
                    className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                    disabled={isGenerating}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Duration (minutes)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : "")}
                    min="5"
                    max="300"
                    placeholder="Optional"
                    className="w-full bg-[#1A1A1A] border border-gray-700 rounded-md px-4 py-3 focus:outline-none focus:border-gray-700 hover:border-gray-700 transition-colors"
                    disabled={isGenerating}
                  />
                </div>
              </div>

              {isGenerating && (
                <div className="flex items-center space-x-2 text-blue-400">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm">{generationProgress}</span>
                </div>
              )}

              <button
                onClick={generateCustomExam}
                disabled={isGenerating || !title || !description}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-md font-medium transition-all duration-200 flex items-center justify-center space-x-2"
              >
                <Brain size={20} />
                <span>{isGenerating ? "Generating..." : "Generate Custom Exam"}</span>
                <Sparkles size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
