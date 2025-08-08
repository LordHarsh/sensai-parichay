import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

export async function GET(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = await params.userId;

    if (!userId) {
      return Response.json({ error: "User ID is required" }, { status: 400 });
    }

    // Forward the request to the backend API (note: no /api prefix for users endpoint)
    const backendResponse = await fetch(
      `${API_BASE_URL}/users/${userId}/courses`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(
        `Backend API error: ${backendResponse.status} - ${errorText}`
      );
      return Response.json(
        { error: "Failed to fetch user courses" },
        { status: backendResponse.status }
      );
    }

    const courses = await backendResponse.json();
    return Response.json(courses);
  } catch (error) {
    console.error("Error fetching user courses:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
