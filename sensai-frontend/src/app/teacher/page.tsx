"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TeacherRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the main teacher dashboard
    router.push('/exam/teacher');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
        <p>Redirecting to teacher dashboard...</p>
      </div>
    </div>
  );
}
