import {
  getPayment,
  updateOnrampPaymentStatus,
  updatePaymentStatus,
} from './repository';
import { getCoinbaseTransactionMetadata, verifyCoinbaseOnrampPayment } from './coinbase-onramp';
import { verifyPayment } from './verify';
import type { PriceTagPayment } from './types';

export type ConfirmPaymentResponse = {
  payment: PriceTagPayment;
  verification?: {
    status: 'confirmed' | 'pending' | 'failed' | 'cancelled';
    reason?: string;
  };
};

export async function confirmPaymentAttempt(paymentId: string): Promise<ConfirmPaymentResponse> {
  const payment = await getPayment(paymentId);

  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.status === 'confirmed') {
    return { payment };
  }

  if (payment.method === 'COINBASE_ONRAMP_HOSTED') {
    const verification = await verifyCoinbaseOnrampPayment(payment);

    if (verification.status === 'pending') {
      return {
        payment,
        verification: { status: 'pending', reason: verification.reason },
      };
    }

    const metadata = verification.transaction
      ? getCoinbaseTransactionMetadata(verification.transaction)
      : {
          providerPaymentId: null,
          providerStatus: null,
          paymentCurrency: null,
          paymentTotal: null,
          paymentSubtotal: null,
        };

    const updated = await updateOnrampPaymentStatus({
      id: payment.id,
      status: verification.status,
      providerStatus: metadata.providerStatus,
      providerPaymentId: metadata.providerPaymentId,
      txHash: verification.status === 'confirmed' ? verification.txHash : null,
      paymentCurrency: metadata.paymentCurrency,
      paymentTotal: metadata.paymentTotal,
      paymentSubtotal: metadata.paymentSubtotal,
      failureReason: verification.status === 'confirmed' ? null : verification.reason,
      providerResponse: verification.transaction,
    });

    return {
      payment: updated,
      verification: {
        status: verification.status,
        reason: verification.status === 'confirmed' ? undefined : verification.reason,
      },
    };
  }

  const verification = await verifyPayment(payment);

  if (verification.status === 'pending') {
    return { payment, verification };
  }

  const updated = await updatePaymentStatus({
    id: payment.id,
    status: verification.status,
    payerAddress: verification.status === 'confirmed' ? verification.payerAddress : null,
    failureReason: verification.status === 'failed' ? verification.reason : null,
  });

  return { payment: updated, verification };
}
