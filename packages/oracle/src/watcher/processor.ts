/**
 * Event processor logic - P2P Escrow Model (EscrowV2)
 *
 * In the P2P model there is no bond and no oracle confirmation. Funding is
 * derived from the on-chain balance via isFunded(), and the seller activates
 * the escrow themselves via sellerConfirm(). Token transfers to an escrow
 * therefore require NO oracle action - they are simply reflected in the
 * balance/isFunded view.
 *
 * This processor is retained for compatibility with the per-escrow job queue
 * but is effectively a no-op for Transfer events.
 */

import { EscrowJobData } from "./queue.js";

export async function processEscrowJob(data: EscrowJobData) {
  const { escrow, eventType } = data;

  if (eventType === "Transfer") {
    // Funding is derived from balance (isFunded()). No oracle action needed.
    console.log(`ℹ️ Transfer to ${escrow} noted; funding is derived from balance. No action.`);
    return;
  }
}
