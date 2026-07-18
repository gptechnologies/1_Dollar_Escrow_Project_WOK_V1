import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/escrow/list
 * Proxy to indexer API - keeps backend calls same-origin
 */
export async function GET(request: NextRequest) {
  const INDEXER_API_URL = process.env.INDEXER_API_URL || process.env.ORACLE_API_URL;

  if (!INDEXER_API_URL) {
    console.error('Missing INDEXER_API_URL or ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = searchParams.get('limit');
    const url = new URL(`${INDEXER_API_URL}/escrow/list`);

    if (query) {
      url.searchParams.set('query', query);
    }

    if (limit) {
      url.searchParams.set('limit', limit);
    }

    const indexerResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await indexerResponse.json();
    return NextResponse.json(data, { status: indexerResponse.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach indexer API' },
      { status: 502 }
    );
  }
}
