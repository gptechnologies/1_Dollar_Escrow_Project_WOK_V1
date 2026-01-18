import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/escrow/status/:code
 * Proxy to oracle API - keeps all oracle calls same-origin
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const ORACLE_API_URL = process.env.ORACLE_API_URL;

  // Validate server-side config
  if (!ORACLE_API_URL) {
    console.error('Missing ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  try {
    const { code } = await params;

    // Forward to oracle API (status endpoint doesn't require auth)
    const oracleResponse = await fetch(`${ORACLE_API_URL}/escrow/status/${code}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Get response data
    const data = await oracleResponse.json();

    // Return with same status code as oracle
    return NextResponse.json(data, { status: oracleResponse.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach oracle API' },
      { status: 502 }
    );
  }
}

