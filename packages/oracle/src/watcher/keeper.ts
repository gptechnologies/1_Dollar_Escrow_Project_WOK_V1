/**
 * Keeper intentionally disabled for the manual-transaction escrow flow.
 *
 * The indexer records webhook/WSS events and exposes state, but it does not
 * submit convenience transactions such as settle, refundUnderfunded, finalize,
 * sweep, or recovery. Those actions are performed manually by users.
 */

export async function keeperRound(): Promise<void> {
  console.log("Keeper disabled: manual transactions only");
}

export function startKeeper(): void {
  console.log("Keeper disabled: manual transactions only");
}
