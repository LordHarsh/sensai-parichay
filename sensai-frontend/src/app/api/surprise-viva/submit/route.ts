import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session_id, answers } = body;
    const userId = req.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 401 });
    }

    if (!session_id || !answers) {
      return NextResponse.json({ error: 'Session ID and answers are required' }, { status: 400 });
    }

    // Forward to backend API
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    
    const response = await fetch(`${backendUrl}/api/surprise-viva/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({
        session_id,
        answers
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Backend error:', errorData);
      return NextResponse.json({ error: 'Failed to submit viva answers' }, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
