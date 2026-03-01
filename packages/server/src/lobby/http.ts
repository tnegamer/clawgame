export function randomId(): string {
  return crypto.randomUUID();
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  const parts = auth.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

export function corsHeaders(contentType?: string): HeadersInit {
  const headers: Record<string, string> = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  if (contentType) {
    headers['content-type'] = contentType;
  }
  return headers;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders('application/json; charset=utf-8'),
  });
}

export function text(body: string, contentType: string): Response {
  return new Response(body, {
    headers: corsHeaders(contentType),
  });
}

export function optionsResponse(): Response {
  return new Response(null, { headers: corsHeaders() });
}

export async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
