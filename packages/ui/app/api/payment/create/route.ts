import { NextResponse } from 'next/server';

// Payment-link APIs are disabled while Crow focuses on P2P escrow.
const GONE = () =>
  NextResponse.json({ error: 'Payment links are not available.' }, { status: 410 });

export const POST = GONE;
