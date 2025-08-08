"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ExamWebSocket } from "@/lib/exam-websocket";

interface VideoRecorderWrapperProps {
  isRecording: boolean;
  examId: string;
  websocket: ExamWebSocket | null;
}

// Dynamically import VideoRecorder to prevent SSR hydration issues
const VideoRecorder = dynamic(() => import("./VideoRecorder"), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-black border-l border-gray-700 p-6">
      <div className="flex flex-col h-full">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-100 mb-2">Video Monitor</h3>
          <div className="h-px bg-gray-700"></div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-400 text-sm">Initializing camera...</p>
          </div>
        </div>
      </div>
    </div>
  ),
});

export default function VideoRecorderWrapper({ isRecording, examId, websocket }: VideoRecorderWrapperProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="h-full bg-black border-l border-gray-700 p-6">
        <div className="flex flex-col h-full">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Video Monitor</h3>
            <div className="h-px bg-gray-700"></div>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-400 text-sm">Loading video recorder...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <VideoRecorder isRecording={isRecording} examId={examId} websocket={websocket} />;
}
