import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = await params;
    const body = await request.json();

    const response = await fetch(
      `${API_BASE_URL}/api/exam/${examId}/submit?user_id=current_user`,
      {
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
      }
    );

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
