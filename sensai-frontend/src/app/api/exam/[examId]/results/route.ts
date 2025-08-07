import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = params;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

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
      return NextResponse.json(
        { error: "Failed to fetch exam results" },
        { status: response.status }
      );
    }

    const results = await response.json();
    return NextResponse.json(results);
  } catch (error) {
    console.error("Error fetching exam results:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
