// All escrow actions a share/tx link can target.
export type ShareAction =
  | 'fund'
  | 'sellerConfirm'
  | 'settle'
  | 'mutualSettle'
  | 'mutualRefund'
  | 'arbSettle'
  | 'arbRefund'
  | 'finalize'
  | 'refundUnderfunded'
  | 'recover'
  | 'sweepExcess';

export type ShareRole = 'buyer' | 'seller' | 'arbitrator';
export type WalletTarget = 'web' | 'metamask' | 'coinbase';

export const SHARE_ACTIONS: ShareAction[] = [
  'fund',
  'sellerConfirm',
  'settle',
  'mutualSettle',
  'mutualRefund',
  'arbSettle',
  'arbRefund',
  'finalize',
  'refundUnderfunded',
  'recover',
  'sweepExcess',
];

export function isShareAction(value: string | undefined): value is ShareAction {
  return !!value && (SHARE_ACTIONS as string[]).includes(value);
}

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

/**
 * Dashboard action URL. This is the primary one-page signing surface.
 */
export function buildDashboardActionHref(
  action: ShareAction,
  escrow: string,
  code: string,
  role?: ShareRole,
): string {
  const query = new URLSearchParams();
  query.set('action', action);
  query.set('escrow', escrow);
  if (code) {
    query.set('code', code);
    query.set('q', code);
  } else {
    query.set('q', escrow);
  }
  if (role) {
    query.set('role', role);
  }
  return `/?${query.toString()}#dashboard`;
}

/**
 * Fallback generic tx page. Dashboard actions should use buildDashboardActionHref().
 */
export function buildTxHref(
  action: ShareAction,
  escrow: string,
  code: string,
  role?: ShareRole,
): string {
  const query = new URLSearchParams();
  query.set('action', action);
  query.set('escrow', escrow);
  query.set('code', code);
  if (role) {
    query.set('role', role);
  }
  return `/tx/action?${query.toString()}`;
}
