import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = await params;
    const userId = request.headers.get("x-user-id");
    console.log("Submitting exam with examId:", examId);
    console.log("User ID from headers:", userId);

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 401 });
    }

    const body = await request.json();

    // Extract session_id from URL if present
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session_id");

    // Build backend URL
    let backendUrl = `${API_BASE_URL}/api/exam/${examId}/submit?user_id=${userId}`;
    if (sessionId) {
      backendUrl += `&session_id=${sessionId}`;
    }

    console.log("Forwarding to backend with URL:", backendUrl);

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...request.headers.get("authorization") && {
          Authorization: request.headers.get("authorization")!
        }
      },
      body: JSON.stringify({
        answers: body.answers,
        time_taken: body.time_taken
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.detail || "Failed to submit exam" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error submitting exam:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
