import { PinkasError, type ErrorCode } from '@pinkas/shared';

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
    const body = (await res.json().catch(() => ({}))) as { code?: ErrorCode; message?: string };
    throw new PinkasError(body.code ?? 'INTERNAL', body.message ?? res.statusText, {
      status: res.status,
    });
  }
  return (await res.json()) as T;
}
