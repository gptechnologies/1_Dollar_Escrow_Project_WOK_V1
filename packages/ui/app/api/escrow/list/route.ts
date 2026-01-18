import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/escrow/list
 * Proxy to oracle API - keeps all oracle calls same-origin
 */
export async function GET(request: NextRequest) {
  const ORACLE_API_URL = process.env.ORACLE_API_URL;

  if (!ORACLE_API_URL) {
    console.error('Missing ORACLE_API_URL env var');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = searchParams.get('limit');
    const url = new URL(`${ORACLE_API_URL}/escrow/list`);

    if (query) {
      url.searchParams.set('query', query);
    }

    if (limit) {
      url.searchParams.set('limit', limit);
    }

    const oracleResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await oracleResponse.json();
    return NextResponse.json(data, { status: oracleResponse.status });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to reach oracle API' },
      { status: 502 }
    );
  }
}
