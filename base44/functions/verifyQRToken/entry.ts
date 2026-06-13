import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function computeHmac(data, keyHex) {
  const enc = new TextEncoder();
  const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison to prevent timing attacks
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const qrSigningKey = Deno.env.get('QR_SIGNING_KEY');
    if (!qrSigningKey) return Response.json({ error: 'QR_SIGNING_KEY not configured' }, { status: 500 });

    const { qr_token } = await req.json();
    if (!qr_token) return Response.json({ valid: false, error: 'qr_token required' }, { status: 400 });

    // Parse token: session_id.expiresAt.signature
    const parts = qr_token.split('.');
    if (parts.length !== 3) return Response.json({ valid: false, error: 'Invalid token format' });

    const [session_id, expiresAtStr, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    // Check expiry
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return Response.json({ valid: false, error: 'Token expired' });
    }

    // Verify signature
    const payload = `${session_id}:${expiresAt}`;
    const expectedSig = await computeHmac(payload, qrSigningKey);
    if (!safeEqual(signature, expectedSig)) {
      return Response.json({ valid: false, error: 'Invalid signature' });
    }

    return Response.json({ valid: true, session_id });
  } catch (error) {
    console.error('verifyQRToken error:', error);
    return Response.json({ valid: false, error: error.message }, { status: 500 });
  }
});