import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/escrow/status/:code
 * Proxy to indexer API - keeps backend calls same-origin
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const INDEXER_API_URL = process.env.INDEXER_API_URL || process.env.ORACLE_API_URL;

  // Validate server-side config
  if (!INDEXER_API_URL) {
    console.error('Missing INDEXER_API_URL or ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  try {
    const { code } = await params;

    // Forward to indexer API (status endpoint doesn't require auth)
    const indexerResponse = await fetch(`${INDEXER_API_URL}/escrow/status/${code}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Get response data
    const data = await indexerResponse.json();

    // Return with same status code as indexer
    return NextResponse.json(data, { status: indexerResponse.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach indexer API' },
      { status: 502 }
    );
  }
}
