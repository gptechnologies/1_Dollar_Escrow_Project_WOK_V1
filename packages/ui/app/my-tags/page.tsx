import { redirect } from 'next/navigation';

// Price-tag surfaces are hidden while Crow focuses on P2P escrow.
export default function MyTagsPage() {
  redirect('/');
}
