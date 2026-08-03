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

  const key = receiptObjectKey(file, (deps.uuid ?? randomId)());
  const bucket = storage.from(BUCKET);

  const { error } = await bucket.upload(key, file, {
    cacheControl: CACHE_CONTROL,
    // A random key never collides, so an upsert could only ever overwrite
    // somebody else's receipt — which is the one write this endpoint must not
    // allow, given anyone may post to it.
    upsert: false,
    // Sent explicitly because the file may have come straight off an iPhone
    // with no type at all, and the storage API's own fallback for that is
    // text/plain — which the browser then refuses to render as an image.
    contentType: file?.type || 'application/octet-stream',
  });
  if (error) throw error;

  const { data } = bucket.getPublicUrl(key);
  const url = data?.publicUrl;
  if (!url) throw new Error('Receipt was stored but has no public URL');
  return url;
}

function randomId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Imported at call time rather than at the top of the file. src/lib/supabase.js
 * reads import.meta.env when it loads, which only exists in a bundle.
 */
async function defaultStorage() {
  const { supabase } = await import('./supabase.js');
  return supabase?.storage ?? null;
}
