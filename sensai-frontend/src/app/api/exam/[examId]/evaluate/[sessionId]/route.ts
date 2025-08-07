import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string; sessionId: string } }
) {
  try {
    const { examId, sessionId } = await params;
    const userId = request.headers.get('x-user-id');
    
    console.log(`[FRONTEND-API] POST /api/exam/${examId}/evaluate/${sessionId}`);
    console.log(`[FRONTEND-API] User ID: ${userId}`);
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }

    // Forward to backend API - USING NEW SIMPLE EVAL ENDPOINT
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const targetUrl = `${backendUrl}/api/simple-eval/${examId}/${sessionId}`;
    
    console.log(`[FRONTEND-API] Forwarding to: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
    });

    console.log(`[FRONTEND-API] Backend response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[FRONTEND-API] Backend evaluation error:', response.status, errorText);
      return NextResponse.json(
        { error: `Evaluation failed: ${errorText}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log(`[FRONTEND-API] Backend response successful`);
    return NextResponse.json(result);

  } catch (error) {
    console.error('[FRONTEND-API] API route error:', error);
    return NextResponse.json(
      { error: 'Internal server error during evaluation' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string; sessionId: string } }
) {
  try {
    const { examId, sessionId } = await params;
    const userId = request.headers.get('x-user-id');
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 401 }
      );
    }

    // Forward to backend API
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${backendUrl}/api/exam/${examId}/evaluation/${sessionId}`, {
      method: 'GET',
      headers: {
        'x-user-id': userId,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'No evaluation found for this session' },
          { status: 404 }
        );
      }
      
      const errorText = await response.text();
      console.error('Backend evaluation fetch error:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to fetch evaluation: ${errorText}` },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Internal server error while fetching evaluation' },
      { status: 500 }
    );
  }
}
