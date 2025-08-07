import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = await params;
    const userId = request.headers.get("x-user-id");

    const response = await fetch(`${API_BASE_URL}/api/exam/${examId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...userId && { "x-user-id": userId }
      }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch exam" },
        { status: response.status }
      );
    }

    const exam = await response.json();
    return NextResponse.json(exam);
  } catch (error) {
    console.error("Error fetching exam:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = params;
    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/exam`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...request.headers.get("authorization") && {
          Authorization: request.headers.get("authorization")!
        }
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to create exam" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error creating exam:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
