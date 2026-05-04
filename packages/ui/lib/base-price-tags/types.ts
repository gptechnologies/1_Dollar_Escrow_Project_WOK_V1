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

export type PriceTagPayment = {
  id: string;
  priceTagCode: string;
  txHash: `0x${string}` | null;
  expectedAmountRaw: string;
  expectedAmountDisplay: string;
  recipientAddress: `0x${string}`;
  chainId: number;
  tokenAddress: `0x${string}`;
  payerAddress: `0x${string}` | null;
  status: PaymentStatus;
  failureReason: string | null;
  explorerUrl: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

export type PriceTagPaymentWithTag = PriceTagPayment & {
  priceTagDescription: string;
};
