"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ExamQuestion } from "@/types/exam";

export default function CreateExamPage() {
  const router = useRouter();
  const { data: session } = useSession();
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(60); // minutes
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const addQuestion = (type: ExamQuestion['type']) => {
    const newQuestion: ExamQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      question: "",
      points: 1,
      ...(type === 'multiple_choice' ? { options: ["", "", "", ""], correct_answer: "" } : {})
    };
    
    setQuestions(prev => [...prev, newQuestion]);
  };

  const updateQuestion = (index: number, updates: Partial<ExamQuestion>) => {
    setQuestions(prev => prev.map((q, i) => i === index ? { ...q, ...updates } : q));
  };

  const removeQuestion = (index: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i === questionIndex && q.type === 'multiple_choice' && q.options) {
        const newOptions = [...q.options];
        newOptions[optionIndex] = value;
        return { ...q, options: newOptions };
      }
      return q;
    }));
  };

  const createExam = async () => {
    if (!title || !description || questions.length === 0) {
      alert("Please fill in all required fields and add at least one question.");
      return;
    }

    setIsCreating(true);
    
    try {
      const examData = {
        title,
        description,
        duration,
        questions,
        settings: {
          allow_tab_switch: false,
          max_tab_switches: 3,
          allow_copy_paste: false,
          require_camera: true,
          require_microphone: true,
          fullscreen_required: true,
          auto_submit: true,
          shuffle_questions: false,
          show_timer: true
        },
        monitoring: {
          video_recording: true,
          audio_recording: true,
          screen_recording: false,
          keystroke_logging: true,
          mouse_tracking: true,
          face_detection: true,
          gaze_tracking: true,
          network_monitoring: true
        }
      };

      const response = await fetch('/api/exam/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify(examData),
      });

      if (!response.ok) {
        throw new Error('Failed to create exam');
      }

      const result = await response.json();
      router.push(`/exam/${result.id}`);
      
    } catch (error) {
      console.error('Error creating exam:', error);
      alert('Failed to create exam. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto py-8 px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Create New Exam</h1>
          <p className="text-gray-400">Design a comprehensive exam with monitoring features</p>
        </div>

        <div className="space-y-8">
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Basic Information</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter exam title"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Description *</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter exam description"
                  rows={3}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Duration (minutes) *</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  min="1"
                  max="300"
                  className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Questions ({questions.length})</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => addQuestion('multiple_choice')}
                  className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-sm transition-colors"
                >
                  + Multiple Choice
                </button>
                <button
                  onClick={() => addQuestion('text')}
                  className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded text-sm transition-colors"
                >
                  + Short Answer
                </button>
                <button
                  onClick={() => addQuestion('essay')}
                  className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded text-sm transition-colors"
                >
                  + Essay
                </button>
                <button
                  onClick={() => addQuestion('code')}
                  className="bg-orange-600 hover:bg-orange-700 px-3 py-2 rounded text-sm transition-colors"
                >
                  + Code
                </button>
              </div>
            </div>

            {questions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No questions added yet. Click the buttons above to add questions.
              </div>
            ) : (
              <div className="space-y-6">
                {questions.map((question, index) => (
                  <div key={question.id} className="border border-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold">Question {index + 1}</h3>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-400 capitalize">
                          {question.type.replace('_', ' ')}
                        </span>
                        <button
                          onClick={() => removeQuestion(index)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Question *</label>
                        <textarea
                          value={question.question}
                          onChange={(e) => updateQuestion(index, { question: e.target.value })}
                          placeholder="Enter your question"
                          rows={2}
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500 resize-none"
                        />
                      </div>
                      
                      {question.type === 'multiple_choice' && question.options && (
                        <div>
                          <label className="block text-sm font-medium mb-2">Options *</label>
                          <div className="space-y-2">
                            {question.options.map((option, optionIndex) => (
                              <div key={optionIndex} className="flex items-center space-x-3">
                                <input
                                  type="radio"
                                  name={`correct_${question.id}`}
                                  checked={question.correct_answer === option}
                                  onChange={() => updateQuestion(index, { correct_answer: option })}
                                  className="text-blue-600"
                                />
                                <input
                                  type="text"
                                  value={option}
                                  onChange={(e) => updateOption(index, optionIndex, e.target.value)}
                                  placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Select the radio button next to the correct answer
                          </div>
                        </div>
                      )}
                      
                      <div className="flex items-center space-x-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Points</label>
                          <input
                            type="number"
                            value={question.points}
                            onChange={(e) => updateQuestion(index, { points: Number(e.target.value) })}
                            min="1"
                            max="100"
                            className="w-20 bg-gray-700 border border-gray-600 rounded px-3 py-1 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        {question.type === 'code' && (
                          <div>
                            <label className="block text-sm font-medium mb-1">Language</label>
                            <select
                              value={question.metadata?.language || 'javascript'}
                              onChange={(e) => updateQuestion(index, { 
                                metadata: { ...question.metadata, language: e.target.value }
                              })}
                              className="bg-gray-700 border border-gray-600 rounded px-3 py-1 focus:outline-none focus:border-blue-500"
                            >
                              <option value="javascript">JavaScript</option>
                              <option value="python">Python</option>
                              <option value="java">Java</option>
                              <option value="cpp">C++</option>
                              <option value="html">HTML</option>
                              <option value="css">CSS</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-center space-x-4">
            <button
              onClick={() => router.push('/')}
              className="px-6 py-3 border border-gray-600 rounded-lg hover:border-gray-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={createExam}
              disabled={isCreating || !title || !description || questions.length === 0}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? 'Creating...' : 'Create Exam'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
