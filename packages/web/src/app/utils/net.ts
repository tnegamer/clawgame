export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const mergedHeaders = new Headers(init?.headers);
  if (!mergedHeaders.has('content-type')) {
    mergedHeaders.set('content-type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers: mergedHeaders,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json() as Promise<T>;
}

export function authHeaders(token?: string): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }
  return { authorization: `Bearer ${token}` };
}

export function apiUrl(path: string): string {
  return path;
}

export function wsUrl(pathAndQuery: string): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${pathAndQuery}`;
}
