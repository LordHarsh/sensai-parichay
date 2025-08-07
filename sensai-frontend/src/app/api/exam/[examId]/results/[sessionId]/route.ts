import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string; sessionId: string } }
) {
  try {
    const { examId, sessionId } = await params;

    const response = await fetch(
      `${API_BASE_URL}/api/exam/${examId}/results/${sessionId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...request.headers.get("authorization") && {
            Authorization: request.headers.get("authorization")!
          }
        }
      }
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ detail: "Failed to fetch exam results" }));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch exam results" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching exam results:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
