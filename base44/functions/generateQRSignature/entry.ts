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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const qrSigningKey = Deno.env.get('QR_SIGNING_KEY');
    if (!qrSigningKey) return Response.json({ error: 'QR_SIGNING_KEY not configured' }, { status: 500 });

    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 });

    // Verify ownership
    const sessions = await base44.entities.Session.filter({ id: session_id });
    const session = sessions[0];
    if (!session || session.created_by_id !== user.id) {
      return Response.json({ error: 'Session not found or unauthorized' }, { status: 403 });
    }

    // 30-minute expiry
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const payload = `${session_id}:${expiresAt}`;
    const signature = await computeHmac(payload, qrSigningKey);
    const qrToken = `${session_id}.${expiresAt}.${signature}`;

    return Response.json({
      success: true,
      qr_token: qrToken,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    console.error('generateQRSignature error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});