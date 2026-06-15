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
    if (!qrSigningKey) return secureJson({ error: 'QR_SIGNING_KEY not configured' }, 500);

    const body = await req.json();
    const qr_token = body?.qr_token;

    // Reject immediately if malformed
    if (!qr_token || typeof qr_token !== 'string') {
      return secureJson({ valid: false, error: 'qr_token required' }, 400);
    }

    // Enforce token length sanity (prevent DoS via huge strings)
    if (qr_token.length > 512) {
      return secureJson({ valid: false, error: 'Invalid token' }, 400);
    }

    const parts = qr_token.split('.');
    if (parts.length !== 3) {
      return secureJson({ valid: false, error: 'Invalid token format' });
    }

    const [session_id, expiresAtStr, signature] = parts;

    // Validate each part before processing
    if (!session_id || !expiresAtStr || !signature) {
      return secureJson({ valid: false, error: 'Malformed token' });
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || expiresAt <= 0) {
      return secureJson({ valid: false, error: 'Invalid token expiry' });
    }

    // Check expiry BEFORE computing HMAC (cheap check first)
    if (Date.now() > expiresAt) {
      return secureJson({ valid: false, error: 'Token expired' });
    }

    // Verify signature
    const payload = `${session_id}:${expiresAt}`;
    const expectedSig = await computeHmac(payload, qrSigningKey);
    if (!safeEqual(signature, expectedSig)) {
      return secureJson({ valid: false, error: 'Invalid signature' });
    }

    return secureJson({ valid: true, session_id });
  } catch (error) {
    console.error('verifyQRToken error:', error.message);
    return secureJson({ valid: false, error: 'Internal server error' }, 500);
  }
});