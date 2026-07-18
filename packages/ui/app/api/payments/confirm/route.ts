import { NextResponse } from 'next/server';

// Payment APIs are disabled while Crow focuses on P2P escrow.
const GONE = () =>
  NextResponse.json({ error: 'Payments are not available.' }, { status: 410 });

export const POST = GONE;
