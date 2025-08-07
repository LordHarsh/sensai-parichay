import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string; sessionId: string } }
) {
  try {
    const { examId, sessionId } = params;
    
    // Get user ID from headers (should be passed from frontend)
    const userIdHeader = request.headers.get('x-user-id');
    
    if (!userIdHeader) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 401 }
      );
    }

    // Get query parameters (like download=true)
    const { searchParams } = new URL(request.url);
    const download = searchParams.get('download') === 'true';

    // Construct backend API URL
    const backendUrl = `http://localhost:8000/api/exam/${examId}/video/${sessionId}${download ? '?download=true' : ''}`;
    
    console.log(`Proxying video request to: ${backendUrl}`);
    
    // Make request to backend API
    const backendResponse = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'x-user-id': userIdHeader,
      },
    });

    if (!backendResponse.ok) {
      console.error(`Backend returned ${backendResponse.status}: ${backendResponse.statusText}`);
      return NextResponse.json(
        { error: 'Video not found or access denied' },
        { status: backendResponse.status }
      );
    }

    // Get the content type from backend response
    const contentType = backendResponse.headers.get('content-type') || 'video/webm';
    
    // Create headers for the response
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');

    // Copy relevant headers from backend response
    if (backendResponse.headers.get('content-length')) {
      headers.set('Content-Length', backendResponse.headers.get('content-length')!);
    }
    if (backendResponse.headers.get('accept-ranges')) {
      headers.set('Accept-Ranges', backendResponse.headers.get('accept-ranges')!);
    }

    // If it's a download request, set the appropriate headers
    if (download) {
      headers.set('Content-Disposition', `attachment; filename="exam_${examId}_session_${sessionId}.webm"`);
    }

    // Stream the response from backend to frontend
    const reader = backendResponse.body?.getReader();
    
    if (!reader) {
      return NextResponse.json(
        { error: 'No video data available' },
        { status: 500 }
      );
    }

    // Create a readable stream to pipe the data
    const stream = new ReadableStream({
      start(controller) {
        function pump(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
            return pump();
          });
        }
        return pump();
      }
    });

    return new NextResponse(stream, {
      status: 200,
      headers: headers,
    });

  } catch (error) {
    console.error('Error proxying video request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
