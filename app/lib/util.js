// Shared request helpers.

// The client IP, derived from PLATFORM-set headers rather than the spoofable
// left-most x-forwarded-for entry (#24 M3). On Vercel, `x-real-ip` is the true
// client IP (the platform overwrites any client-sent value); if it is absent we
// take the RIGHT-most x-forwarded-for entry, since the platform appends the real
// edge IP last. A client can prepend arbitrary XFF values, but cannot forge the
// right-most/real-ip the proxy adds. Used as a rate-limit key, so this matters.
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const parts = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'unknown';
}

module.exports = { clientIp };
