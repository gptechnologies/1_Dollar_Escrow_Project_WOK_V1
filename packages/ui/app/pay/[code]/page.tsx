import { redirect } from 'next/navigation';

// Base price-tag payment pages are hidden while Crow focuses on P2P escrow.
export default function PayPage() {
  redirect('/');
}
