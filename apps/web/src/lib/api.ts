import { PinkasError, type ErrorCode } from '@pinkas/shared';

/** Fired on any 401 outside /auth so the auth gate can drop to the login screen. */
export const UNAUTHORIZED_EVENT = 'pinkas:unauthorized';

/** All calls go through here so the CSRF header and credentials are never forgotten. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('x-pinkas-request', '1');
  if (json !== undefined) headers.set('content-type', 'application/json');
  const req: RequestInit = { ...rest, credentials: 'same-origin', headers };
  if (json !== undefined) req.body = JSON.stringify(json);
  const res = await fetch(`/api${path}`, req);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: ErrorCode;
      message?: string;
      details?: Record<string, unknown>;
    };
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new PinkasError(body.code ?? 'INTERNAL', body.message ?? res.statusText, {
      status: res.status,
      ...(body.details === undefined ? {} : { details: body.details }),
    });
  }
  return (await res.json()) as T;
}

/** Builds `?a=1&b=2`, skipping undefined/empty values. */
export function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, unknown][]) {
    if (v === undefined || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof PinkasError) return err.messageHe;
  return 'אירעה שגיאה';
}
