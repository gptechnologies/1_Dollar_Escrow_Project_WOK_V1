export type ShareAction = 'confirm' | 'fund' | 'finalize';
export type ShareRole = 'buyer' | 'seller';
export type WalletTarget = 'web' | 'metamask' | 'coinbase';

type ShareParams = {
  action: ShareAction;
  role?: ShareRole;
  wallet?: WalletTarget;
};

export function buildSharePath(code: string, params: ShareParams): string {
  const query = new URLSearchParams();
  query.set('action', params.action);
  if (params.role) {
    query.set('role', params.role);
  }
  if (params.wallet && params.wallet !== 'web') {
    query.set('wallet', params.wallet);
  }
  return `/s/${encodeURIComponent(code)}?${query.toString()}`;
}

export function resolveAppBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function buildShareUrl(code: string, params: ShareParams): string {
  return `${resolveAppBaseUrl()}${buildSharePath(code, params)}`;
}

/**
 * Build wallet-keyed URL map for ShareModal.
 * Returns { web, metamask, coinbase } URLs for a given share code + params.
 */
export function buildWalletShareUrls(
  code: string,
  params: Omit<ShareParams, 'wallet'>,
): Record<WalletTarget, string> {
  return {
    web: buildShareUrl(code, { ...params }),
    metamask: buildShareUrl(code, { ...params, wallet: 'metamask' }),
    coinbase: buildShareUrl(code, { ...params, wallet: 'coinbase' }),
  };
}

export function buildTxHref(
  action: ShareAction,
  escrow: string,
  code: string,
  role?: ShareRole,
): string {
  const query = new URLSearchParams();
  query.set('escrow', escrow);
  query.set('code', code);
  if (role) {
    query.set('role', role);
  }

  if (action === 'confirm') {
    return `/tx/confirm?${query.toString()}`;
  }
  if (action === 'fund') {
    return `/tx/fund?${query.toString()}`;
  }
  return `/tx/finalize?${query.toString()}`;
}
