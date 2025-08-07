"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ExamQuestion } from "@/types/exam";
import { useAuth } from "@/lib/auth";
import { useSchools } from "@/lib/api";

export default function CreateExamPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { user } = useAuth();
  const { schools } = useSchools();
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(60); // minutes
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  
  // Cheating detection settings
  const [monitoringSettings, setMonitoringSettings] = useState({
    video_recording: true,
    audio_recording: true,
    screen_recording: false,
    keystroke_logging: true,
    mouse_tracking: true,
    face_detection: true,
    gaze_tracking: false,
    network_monitoring: true
  });
  
  // Exam behavior settings
  const [examSettings, setExamSettings] = useState({
    allow_tab_switch: false,
    max_tab_switches: 3,
    allow_copy_paste: false,
    require_camera: true,
    require_microphone: true,
    fullscreen_required: true,
    auto_submit: true,
    shuffle_questions: false,
    show_timer: true
  });

  const addQuestion = (type: ExamQuestion['type']) => {
    const newQuestion: ExamQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      question: "",
      points: 1,
      ...(type === 'multiple_choice' ? { 
        options: [
          { id: `opt_${Date.now()}_1`, text: "", is_correct: false },
          { id: `opt_${Date.now()}_2`, text: "", is_correct: false },
          { id: `opt_${Date.now()}_3`, text: "", is_correct: false },
          { id: `opt_${Date.now()}_4`, text: "", is_correct: false }
        ], 
        correct_answer: "" 
      } : {})
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
        newOptions[optionIndex] = { ...newOptions[optionIndex], text: value };
        return { ...q, options: newOptions };
      }
      return q;
    }));
  };

  const setCorrectAnswer = (questionIndex: number, optionId: string) => {
    setQuestions(prev => prev.map((q, i) => {
      if (i === questionIndex && q.type === 'multiple_choice' && q.options) {
        const newOptions = q.options.map(opt => ({
          ...opt,
          is_correct: opt.id === optionId
        }));
        return { ...q, options: newOptions, correct_answer: optionId };
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
        settings: examSettings,
        monitoring: monitoringSettings,
        org_id: selectedOrgId,
        role: "teacher"
      };

      const response = await fetch('/api/exam/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.id || '',
        },
        body: JSON.stringify(examData),
      });

      if (!response.ok) {
        throw new Error('Failed to create exam');
      }

      const result = await response.json();
      router.push(`/exam/${result.id}/teacher`);
      
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
                              <div key={option.id} className="flex items-center space-x-3">
                                <input
                                  type="radio"
                                  name={`correct_${question.id}`}
                                  checked={question.correct_answer === option.id}
                                  onChange={() => setCorrectAnswer(index, option.id)}
                                  className="text-blue-600"
                                />
                                <input
                                  type="text"
                                  value={option.text}
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

          {/* Organization Selection */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Organization</h2>
            <div>
              <label className="block text-sm font-medium mb-2">Select Organization (Optional)</label>
              <select
                value={selectedOrgId || ""}
                onChange={(e) => setSelectedOrgId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="">Personal Exam (No Organization)</option>
                {schools?.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Exam Settings */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Exam Behavior Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Allow Tab Switching</label>
                  <input
                    type="checkbox"
                    checked={examSettings.allow_tab_switch}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      allow_tab_switch: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Allow Copy/Paste</label>
                  <input
                    type="checkbox"
                    checked={examSettings.allow_copy_paste}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      allow_copy_paste: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Require Camera</label>
                  <input
                    type="checkbox"
                    checked={examSettings.require_camera}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      require_camera: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Require Microphone</label>
                  <input
                    type="checkbox"
                    checked={examSettings.require_microphone}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      require_microphone: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Fullscreen Required</label>
                  <input
                    type="checkbox"
                    checked={examSettings.fullscreen_required}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      fullscreen_required: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Auto Submit</label>
                  <input
                    type="checkbox"
                    checked={examSettings.auto_submit}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      auto_submit: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Shuffle Questions</label>
                  <input
                    type="checkbox"
                    checked={examSettings.shuffle_questions}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      shuffle_questions: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Show Timer</label>
                  <input
                    type="checkbox"
                    checked={examSettings.show_timer}
                    onChange={(e) => setExamSettings(prev => ({
                      ...prev,
                      show_timer: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
              </div>
            </div>
            
            {examSettings.allow_tab_switch && (
              <div className="mt-4">
                <label className="block text-sm font-medium mb-2">Maximum Tab Switches</label>
                <input
                  type="number"
                  value={examSettings.max_tab_switches}
                  onChange={(e) => setExamSettings(prev => ({
                    ...prev,
                    max_tab_switches: Number(e.target.value)
                  }))}
                  min="1"
                  max="10"
                  className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Monitoring Settings */}
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Cheating Detection & Monitoring</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Video Recording</label>
                    <p className="text-xs text-gray-400">Record student's video feed</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.video_recording}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      video_recording: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Audio Recording</label>
                    <p className="text-xs text-gray-400">Record ambient audio</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.audio_recording}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      audio_recording: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Screen Recording</label>
                    <p className="text-xs text-gray-400">Record screen activity</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.screen_recording}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      screen_recording: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Keystroke Logging</label>
                    <p className="text-xs text-gray-400">Detect typing anomalies</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.keystroke_logging}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      keystroke_logging: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Mouse Tracking</label>
                    <p className="text-xs text-gray-400">Monitor mouse movements</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.mouse_tracking}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      mouse_tracking: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Face Detection</label>
                    <p className="text-xs text-gray-400">Ensure student presence</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.face_detection}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      face_detection: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Gaze Tracking</label>
                    <p className="text-xs text-gray-400">Monitor eye movement</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.gaze_tracking}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      gaze_tracking: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Network Monitoring</label>
                    <p className="text-xs text-gray-400">Detect suspicious requests</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={monitoringSettings.network_monitoring}
                    onChange={(e) => setMonitoringSettings(prev => ({
                      ...prev,
                      network_monitoring: e.target.checked
                    }))}
                    className="rounded"
                  />
                </div>
              </div>
            </div>
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
