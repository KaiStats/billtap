/**
 * Store the photographed receipt, and hand back a URL anyone at the table can
 * open.
 *
 * This replaces base44.integrations.Core.UploadFile, the last Base44
 * integration the app made. The bucket and the policy that lets a guest write
 * to it are in supabase/migrations/0004_receipts_storage.sql.
 *
 * ── The thing that must not change ──────────────────────────────────────────
 *
 * This runs for someone with no account. A diner scanning a table tent has no
 * Supabase identity, so every call here goes out under the anon key with no
 * session attached, and the storage policy grants anon for exactly that reason.
 * Nothing in this file reads a session, and nothing in it may start to: the
 * moment an upload needs a signed-in user, photographing a receipt needs an
 * account, and that is the product gone. src/upload.test.mjs holds that line.
 *
 * ── Why the client is resolved here rather than imported ────────────────────
 *
 * The storage client is a parameter with a default, looked up when an upload
 * actually starts. That is what lets the guest path above be tested against a
 * stand-in — the alternative is a module that cannot be loaded outside a
 * browser, and an untested upload path is how this one broke the first time.
 */

/** The bucket in 0004_receipts_storage.sql. */
const BUCKET = 'receipts';

/**
 * Immutable under a random key, so it can be cached for as long as anything
 * caches. The image is fetched by every diner at the table.
 */
const CACHE_CONTROL = '31536000';

/**
 * A name nobody can guess.
 *
 * The bucket is public — it has to be, because the diners who view the receipt
 * have no account to authorise a read with — so the key is the only thing
 * standing between one table's bill and anyone who fancies looking at it. It is
 * a uuid and nothing else: deriving any part of it from the session id, the
 * restaurant or the time would make the objects enumerable by someone who has
 * seen a single URL.
 *
 * The extension is carried over so the object is served with a sensible name
 * and so `getPublicUrl` produces something a browser will display inline.
 */
export function receiptObjectKey(file, uuid) {
  const name = typeof file?.name === 'string' ? file.name : '';
  const fromName = name.match(/\.([a-z0-9]+)$/i)?.[1];
  const fromType = String(file?.type || '').match(/^image\/([a-z0-9]+)$/i)?.[1];
  const extension = (fromName || fromType || 'jpg').toLowerCase();
  return `${uuid}.${extension}`;
}

/**
 * @param file  what compressImage produced, or the original when it declined
 * @param deps  the storage client, injected by the tests
 * @returns the public URL of the stored image
 * @throws  when the upload fails, so the caller's existing catch still runs —
 *          NewReceipt swallows it and creates the split without an image, which
 *          is a missing thumbnail rather than a lost bill
 */
export async function uploadReceipt(file, deps = {}) {
  const storage = deps.storage ?? (await defaultStorage());
  if (!storage) throw new Error('Receipt storage is not configured');

  const bucket = storage.from(BUCKET);

  const uploadOptions = {
    cacheControl: CACHE_CONTROL,
    // A random key never collides, so an upsert could only ever overwrite
    // somebody else's receipt — which is the one write this endpoint must not
    // allow, given anyone may post to it.
    upsert: false,
    // Sent explicitly because the file may have come straight off an iPhone
    // with no type at all, and the storage API's own fallback for that is
    // text/plain — which the browser then refuses to render as an image.
    contentType: file?.type || 'application/octet-stream',
  };

  /**
   * Ask the Worker for a ticket first.
   *
   * This upload used to go straight to storage under the anon key, which meant
   * it never touched the Worker and the rate limiter never saw it — nothing
   * anywhere bounded how many objects an anonymous caller could create. The
   * ticket moves that decision back to the Worker without moving the bytes: the
   * file still goes directly to storage, it just needs permission first.
   *
   * Still no session read, and there must never be one. The ticket endpoint is
   * anonymous by design; requiring an account to photograph a receipt is the
   * product gone, and src/upload.test.mjs holds that line.
   */
  const ticket = await (deps.ticket ?? requestTicket)(file);

  if (ticket) {
    const { error } = await bucket.uploadToSignedUrl(ticket.path, ticket.token, file, uploadOptions);
    if (!error) return publicUrlFor(bucket, ticket.path);
    // Fall through. A rejected ticket is a signing or storage problem, not a
    // reason to lose the photograph — see the fallback note below.
  }

  /**
   * The direct write, still here on purpose.
   *
   * Migration 0004's anon insert policy is what makes this work, and it is what
   * 0007 removes — but only after the signed path has been seen to work against
   * a real project, because nothing in this repo can test it: every suite stubs
   * the storage client, so a mismatch with Supabase's actual API would surface
   * at a restaurant table rather than in CI.
   *
   * Until 0007 is applied this is a live fallback and the hole is still open.
   * After it, this path fails closed and the throw below is what NewReceipt
   * already handles by creating the split without an image.
   */
  const key = receiptObjectKey(file, (deps.uuid ?? randomId)());
  const { error } = await bucket.upload(key, file, uploadOptions);
  if (error) throw error;
  return publicUrlFor(bucket, key);
}

function publicUrlFor(bucket, key) {
  const { data } = bucket.getPublicUrl(key);
  const url = data?.publicUrl;
  if (!url) throw new Error('Receipt was stored but has no public URL');
  return url;
}

/**
 * The Worker's answer, or null when it cannot give one.
 *
 * Never throws. Every failure here — offline, a 503 because the backend has no
 * signed uploads, a 429 because somebody is minting tickets in a loop — has to
 * leave the caller with a working upload path while the direct write still
 * exists, and afterwards has to fail at the upload rather than here, so the
 * error the caller sees is about storing the photograph.
 */
async function requestTicket(file) {
  try {
    const name = typeof file?.name === 'string' ? file.name : '';
    const extension = (
      name.match(/\.([a-z0-9]+)$/i)?.[1] ||
      String(file?.type || '').match(/^image\/([a-z0-9]+)$/i)?.[1] ||
      'jpg'
    ).toLowerCase();

    // Imported at call time for the same reason the storage client is: this
    // module must not drag the API layer into the page's first chunk.
    const { invoke } = await import('../api/functions.js');
    const res = await invoke('createReceiptUpload', { extension });
    const { path, token } = res?.data || {};
    return path && token ? { path, token } : null;
  } catch {
    return null;
  }
}

function randomId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Imported at call time rather than at the top of the file, so the auth client
 * is not pulled into this page's first chunk to store a photograph.
 */
async function defaultStorage() {
  const { getSupabase } = await import('./supabase.js');
  const client = await getSupabase();
  return client?.storage ?? null;
}
