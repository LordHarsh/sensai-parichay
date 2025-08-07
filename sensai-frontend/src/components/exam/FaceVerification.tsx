"use client";

import { useState, useRef, useCallback } from "react";

interface FaceVerificationProps {
  examId: string;
  referenceImageKey: string;
  onVerificationComplete: (success: boolean, message: string) => void;
  onVerificationStart?: () => void;
}

export default function FaceVerification({
  examId,
  referenceImageKey,
  onVerificationComplete,
  onVerificationStart
}: FaceVerificationProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      setError(null);
      setIsCapturing(true); // Set this first to render the video element
      
      // Wait a brief moment for the video element to render
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access not supported in this browser');
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      
      // Wait for video element to be available
      let attempts = 0;
      while (!videoRef.current && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
        attempts++;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        // Ensure video plays automatically
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(console.error);
          }
        };
      } else {
        // If still no video element, clean up the stream
        stream.getTracks().forEach(track => track.stop());
        setIsCapturing(false);
        throw new Error('Video element not found after multiple attempts');
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown camera error';
      setError(`Unable to access camera: ${errorMessage}. Please ensure camera permissions are granted.`);
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setCapturedImage(url);
        stopCamera();
      }
    }, 'image/jpeg', 0.9);
  }, []);

  const retakePhoto = () => {
    if (capturedImage) {
      URL.revokeObjectURL(capturedImage);
      setCapturedImage(null);
    }
    setError(null);
    startCamera();
  };

  const uploadAndVerify = async () => {
    if (!capturedImage || !canvasRef.current) return;

    try {
      setIsUploading(true);
      setError(null);
      onVerificationStart?.();

      // Convert canvas to base64
      const canvas = canvasRef.current;
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);

      // Upload directly via backend (bypasses CORS)
      const uploadResponse = await fetch('/api/face/upload-verification-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: imageDataUrl,
          exam_id: examId
        })
      });

      const uploadData = await uploadResponse.json();
      
      if (!uploadData.success) {
        throw new Error(uploadData.error || 'Failed to upload image');
      }

      setIsUploading(false);
      setIsVerifying(true);

      // Verify identity
      const verifyResponse = await fetch('/api/face/verify-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verification_s3_key: uploadData.s3_key,
          reference_s3_key: referenceImageKey,
          exam_id: examId
        })
      });

      const verifyData = await verifyResponse.json();
      
      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Verification request failed');
      }

      const message = verifyData.verified 
        ? `Verification successful! Confidence: ${verifyData.confidence_score?.toFixed(1)}%`
        : verifyData.error_message || 'Verification failed';

      onVerificationComplete(verifyData.verified, message);

    } catch (error) {
      console.error('Verification error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Verification failed';
      setError(errorMessage);
      onVerificationComplete(false, errorMessage);
    } finally {
      setIsUploading(false);
      setIsVerifying(false);
    }
  };


  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-center mb-4">
        <div className="flex items-center justify-center space-x-2 mb-3">
          <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-100">Identity Verification</h3>
        </div>
        <p className="text-gray-400 text-xs">
          Capture a photo to verify your identity
        </p>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/50 rounded p-3 mb-3">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <div className="relative">
        {!isCapturing && !capturedImage && (
          <div className="text-center">
            <button
              onClick={startCamera}
              type="button"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Start Camera
            </button>
          </div>
        )}

        {isCapturing && (
          <div className="space-y-3">
            <div className="relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-w-sm mx-auto rounded bg-gray-700"
                style={{ aspectRatio: '4/3' }}
              />
              <div className="absolute inset-0 border-2 border-dashed border-blue-400/50 rounded pointer-events-none"></div>
            </div>
            <div className="text-center space-x-2">
              <button
                onClick={capturePhoto}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                Capture Photo
              </button>
              <button
                onClick={stopCamera}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {capturedImage && (
          <div className="space-y-3">
            <div className="text-center">
              <img
                src={capturedImage}
                alt="Captured photo"
                className="w-full max-w-sm mx-auto rounded"
                style={{ aspectRatio: '4/3' }}
              />
            </div>
            <div className="text-center space-x-2">
              <button
                onClick={uploadAndVerify}
                disabled={isUploading || isVerifying}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-medium transition-colors inline-flex items-center space-x-1"
              >
                {(isUploading || isVerifying) && (
                  <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                <span>
                  {isUploading ? 'Uploading...' : isVerifying ? 'Verifying...' : 'Verify Identity'}
                </span>
              </button>
              <button
                onClick={retakePhoto}
                disabled={isUploading || isVerifying}
                className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                Retake Photo
              </button>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}