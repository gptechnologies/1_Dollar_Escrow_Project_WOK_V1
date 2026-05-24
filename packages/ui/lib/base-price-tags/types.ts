export type PriceTag = {
  code: string;
  amountRaw: string;
  amountDisplay: string;
  description: string;
  recipientAddress: `0x${string}`;
  chainId: number;
  chainName: string;
  tokenAddress: `0x${string}`;
  tokenSymbol: 'USDC';
  isActive: boolean;
  paymentUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentStatus = 'created' | 'pending' | 'confirmed' | 'failed' | 'cancelled';
export type PaymentMethod = 'BASE_PAY' | 'COINBASE_ONRAMP_HOSTED';
export type PaymentProvider = 'base' | 'coinbase_onramp';

export type PriceTagPayment = {
  id: string;
  priceTagCode: string;
  method: PaymentMethod;
  provider: PaymentProvider;
  providerPaymentId: string | null;
  txHash: `0x${string}` | null;
  expectedAmountRaw: string;
  expectedAmountDisplay: string;
  recipientAddress: `0x${string}`;
  chainId: number;
  tokenAddress: `0x${string}`;
  payerAddress: `0x${string}` | null;
  status: PaymentStatus;
  providerStatus: string | null;
  partnerUserRef: string | null;
  onrampUrl: string | null;
  paymentCurrency: string | null;
  paymentTotal: string | null;
  paymentSubtotal: string | null;
  failureReason: string | null;
  explorerUrl: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type PriceTagPaymentWithTag = PriceTagPayment & {
  priceTagDescription: string;
};
