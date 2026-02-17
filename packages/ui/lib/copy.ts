// Copy guardrails:
// Keep language simple and action-first.
// Prefer: confirm, fund, release funds, share link, buyer, seller.
// Avoid internal protocol jargon in UI-facing labels.
export const SIMPLE_COPY = {
  nextPrefix: 'Next:',
  cannotExecute: 'Cannot continue yet. Check the steps above.',
  mobileWalletHint: 'Open this page in your wallet app to continue.',
  shareConfirm: 'Share confirm link',
  shareFunding: 'Share funding link',
  shareFinalize: 'Share finalize link',
} as const;

