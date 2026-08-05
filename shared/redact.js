/**
 * The one list of things that must never be shown to a stranger.
 *
 * ── Why this is in shared/ and enforced twice ───────────────────────────────
 *
 * worker/lib/errors.js runs it before a message leaves the server, which is the
 * layer that matters and the one that catches a developer interpolating a
 * hostname into an AppError. That was the whole of the protection, and a
 * browser test found the hole in it: the client renders `data.error` verbatim,
 * so anything that puts a string in that field reaches the screen regardless of
 * what the Worker would have sent.
 *
 * The Worker is not the only thing that answers on this origin. A Cloudflare
 * error page, a proxy in front of it, a future handler that forgets to go
 * through errorResponse — any of those can produce a body the client will
 * happily display. Measured, not theorised: with the boundary stubbed to return
 * a leaky 500, the receipt screen printed a live connection string.
 *
 * So both ends run the same list. Not because either is redundant, but because
 * they defend against different mistakes: the server against what this codebase
 * writes, the client against what arrives.
 *
 * Kept beside shared/receipt-math.js for the same reason that file exists — one
 * implementation, imported by both halves, so the two cannot drift.
 */

const LEAKS = [
  // Connection strings, with or without credentials in them.
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|s3):\/\//i,
  // Any URL carrying userinfo — https://user:pass@host.
  /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@/i,
  // The hostnames of everything this app depends on.
  /\b[\w-]+\.(?:supabase\.(?:co|in)|workers\.dev|ingest\.sentry\.io|r2\.cloudflarestorage\.com)\b/i,
  /\bgeneratelanguage\.googleapis\.com\b|\bapi\.twilio\.com\b|\bapi\.resend\.com\b|\bapi\.postmarkapp\.com\b/i,
  // A stack frame, in either of the shapes a runtime writes one.
  /\n\s*at\s|\bat\s+\w[\w.<>]*\s+\(/,
  // Filesystem and module paths.
  /\bfile:\/\//i,
  /(?:^|[\s('"`])\/(?:workspace|home|usr|var|opt|root|tmp|app|src|node_modules)\//,
  /\b[\w-]+\.(?:js|mjs|jsx|ts|tsx|sql):\d+/,
  // Credentials and tokens. A JWT is three base64url segments; a service key is
  // a long opaque run of hex or base64.
  /\beyJ[\w-]{10,}\.[\w-]{10,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[\w]{8,}/i,
  /\b[0-9a-f]{32,}\b/i,
  /\bSUPABASE_[A-Z_]+\b|\bSTRIPE_[A-Z_]+\b|\bGEMINI_[A-Z_]+\b|\bTWILIO_[A-Z_]+\b/,
  // Framework and runtime versions.
  /\b(?:node|deno|bun|react|vite|wrangler|postgrest|postgresql|nginx|cloudflare)[/ ]v?\d+\.\d+/i,
  /\bv\d+\.\d+\.\d+\b/,
  // Bare IPv4, which is a host by another name.
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  // SQL and schema shapes, which name tables and columns.
  /\b(?:relation|column|constraint|duplicate key value|violates .* constraint)\b/i,
  /\bselect\s+.*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b/i,
];

/** What a caller is told when their real message could not be shown. */
export const GENERIC = 'Something went wrong on our end. Nothing was charged or changed.';

/**
 * Returns the message when it is safe to publish, or null when it is not.
 *
 * Null rather than a partially-scrubbed string, deliberately. Patching leaves
 * the shape of what was removed, and "could not reach [redacted]" still tells a
 * stranger there is something to reach — while a caller that gets null can
 * substitute a sentence written to be read.
 */
export function redactPublic(message) {
  if (typeof message !== 'string' || !message) return null;
  // A message long enough to be a dump is one, whatever it happens to match.
  if (message.length > 300) return null;
  for (const pattern of LEAKS) {
    if (pattern.test(message)) return null;
  }
  return message;
}
