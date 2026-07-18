import { NextResponse } from 'next/server';

// Price-tag APIs are disabled while Crow focuses on P2P escrow.
const GONE = () =>
  NextResponse.json({ error: 'Price tags are not available.' }, { status: 410 });

export const GET = GONE;
export const POST = GONE;
