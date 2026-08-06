export function safeAck(candidate) {
  return typeof candidate === 'function' ? candidate : () => {};
}

export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const clients = new Map();

  return {
    allow(identity) {
      const timestamp = now();
      const current = clients.get(identity);
      if (!current || timestamp - current.startedAt >= windowMs) {
        clients.set(identity, { startedAt: timestamp, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    },
    forget(identity) {
      clients.delete(identity);
    },
  };
}

export function isAllowedOrigin({ origin, host }) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host === host;
  } catch {
    return false;
  }
}

export function cacheControlForPath(filePath) {
  return /(?:index\.html|client\.js|sw\.js|manifest\.webmanifest)$/.test(filePath)
    ? 'no-cache'
    : 'public, max-age=3600';
}

export function securityHeaders() {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}
