import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function secureJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS },
  });
}

async function computeHmac(data, keyHex) {
  const enc = new TextEncoder();
  const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return secureJson({ error: 'Unauthorized' }, 401);

    const qrSigningKey = Deno.env.get('QR_SIGNING_KEY');
    if (!qrSigningKey) return secureJson({ error: 'QR_SIGNING_KEY not configured' }, 500);

    const { session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return secureJson({ error: 'session_id required' }, 400);
    }

    // Verify ownership — never issue tokens for sessions the user doesn't own
    const sessions = await base44.entities.Session.filter({ id: session_id });
    const session = sessions[0];
    if (!session || session.created_by_id !== user.id) {
      return secureJson({ error: 'Session not found or unauthorized' }, 403);
    }

    // Check session not expired
    if (session.expires_at && session.expires_at < Date.now()) {
      return secureJson({ error: 'Session has expired' }, 410);
    }

    const expiresAt = Date.now() + 30 * 60 * 1000;
    const payload = `${session_id}:${expiresAt}`;
    const signature = await computeHmac(payload, qrSigningKey);
    const qrToken = `${session_id}.${expiresAt}.${signature}`;

    return secureJson({
      success: true,
      qr_token: qrToken,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    console.error('generateQRSignature error:', error.message);
    return secureJson({ error: 'Internal server error' }, 500);
  }
});