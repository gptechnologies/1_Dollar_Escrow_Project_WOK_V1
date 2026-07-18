import { redirect } from 'next/navigation';

// Arbitrum payment-link pages are hidden while Crow focuses on P2P escrow.
export default function PaymentLinkPage() {
  redirect('/');
}
