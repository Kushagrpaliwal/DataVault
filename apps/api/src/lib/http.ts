export function success<T>(data: T) {
  return { success: true as const, data };
}

export function requestMetadata(request: Request) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}

export function copyResponseHeaders(target: Record<string, string | number>, headers: Headers) {
  for (const [key, value] of headers.entries()) target[key] = value;
}
