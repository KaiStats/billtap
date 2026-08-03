/**
 * Storing the receipt photograph, which a guest does before anything else.
 *
 * The upload moved from Base44 to Supabase Storage. The failure worth guarding
 * against is not a broken upload — that is loud, and the split is created
 * without an image anyway. It is the upload quietly acquiring a requirement
 * that a guest cannot meet, because the person it fails is at a restaurant
 * table, has no account, and will not report anything.
 *
 * The behavioural tests run against a stand-in for the storage client. What
 * matters here is which calls are made and with what, and a real bucket would
 * test Supabase rather than this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { uploadReceipt, receiptObjectKey } from './lib/uploadReceipt.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/**
 * Records what it was asked to do and answers the way supabase-js does.
 *
 * `calls` is the point of it: the assertions below are mostly about what was
 * sent, not what came back.
 */
function fakeStorage({ uploadError = null, publicUrl = 'https://cdn.example/receipts/x.webp' } = {}) {
  const calls = { buckets: [], uploads: [], publicUrls: [] };
  return {
    calls,
    from(bucket) {
      calls.buckets.push(bucket);
      return {
        upload(key, file, options) {
          calls.uploads.push({ key, file, options });
          return Promise.resolve({ data: uploadError ? null : { path: key }, error: uploadError });
        },
        getPublicUrl(key) {
          calls.publicUrls.push(key);
          return { data: { publicUrl } };
        },
      };
    },
  };
}

const file = (name = 'receipt.webp', type = 'image/webp') => ({ name, type, size: 1024 });

test('an upload with no session at all still succeeds', async () => {
  // The whole product in one assertion. A diner scanning a table tent has no
  // Supabase identity, so the storage client here is the anon one and there is
  // no token to attach. If this ever needs a session, photographing a receipt
  // needs an account.
  const storage = fakeStorage();
  const url = await uploadReceipt(file(), { storage, uuid: () => 'abc' });
  assert.equal(url, 'https://cdn.example/receipts/x.webp');
  assert.deepEqual(storage.calls.buckets, ['receipts']);
});

test('nothing in the upload path reads an auth session', () => {
  // Structural, because a behavioural test passes right up until somebody adds
  // the gate — the stand-in above would happily answer a getSession() that
  // should never have been asked.
  const source = read('src/lib/uploadReceipt.js');
  assert.ok(!/getSession|getUser|auth\./.test(source),
    'the upload must not consult auth — guests have none and are most of the traffic');
  assert.ok(!/accessToken/.test(source),
    'attaching a token here would make the anon path look optional, and it is not');
});

test('the receipt page does not import the auth client to upload', () => {
  // src/auth.test.mjs forbids this for every guest screen and would catch it
  // there too. Repeated here against the upload specifically, because
  // "the upload needs the supabase client" is the plausible-sounding reason
  // somebody would have for adding the import that breaks the rule.
  const page = read('src/pages/NewReceipt.jsx');
  assert.ok(!/from ["']@\/lib\/supabase["']/.test(page));
  assert.match(page, /from ["']@\/lib\/uploadReceipt["']/);
});

test('the key is random, so one receipt URL does not lead to another', () => {
  // The bucket is public — the diners who view the image have no account to
  // authorise a read with — so the key is the only access control there is.
  const keys = new Set();
  for (let i = 0; i < 200; i += 1) keys.add(receiptObjectKey(file(), crypto.randomUUID()));
  assert.equal(keys.size, 200);

  // And nothing in it comes from the file it belongs to, which is what would
  // make the objects guessable from something a diner can already see.
  const key = receiptObjectKey({ name: 'olive-garden-2026-08-03.webp', type: 'image/webp' }, 'u1');
  assert.equal(key, 'u1.webp');
});

test('an iPhone photo with no content type still gets a usable extension', () => {
  // iOS hands over HEIC with an empty type. validateAndSetFile already accepts
  // it on the strength of the name, so this must not be the place it falls over.
  assert.equal(receiptObjectKey({ name: 'IMG_0042.HEIC', type: '' }, 'u1'), 'u1.heic');
  assert.equal(receiptObjectKey({ name: '', type: 'image/png' }, 'u1'), 'u1.png');
  assert.equal(receiptObjectKey({ name: 'no-extension', type: '' }, 'u1'), 'u1.jpg');
});

test('a stored receipt is never overwritten by a later one', async () => {
  // Anyone may write to this bucket. upsert would turn that into the ability to
  // replace a receipt a split already points at.
  const storage = fakeStorage();
  await uploadReceipt(file(), { storage, uuid: () => 'abc' });
  assert.equal(storage.calls.uploads[0].options.upsert, false);
});

test('a file with no type is sent as bytes rather than as text', async () => {
  // The storage API defaults an absent content type to text/plain, and a
  // receipt served as text/plain renders as a download prompt instead of an
  // image on the one screen where the table is looking at it.
  const storage = fakeStorage();
  await uploadReceipt(file('IMG_0042.HEIC', ''), { storage, uuid: () => 'abc' });
  assert.equal(storage.calls.uploads[0].options.contentType, 'application/octet-stream');
});

test('a failed upload rejects, because the caller is counting on catching it', async () => {
  // NewReceipt attaches a .catch that turns this into a split with no image.
  // Resolving with null instead would put the string "null" where the image URL
  // goes and there would be nothing to catch.
  const storage = fakeStorage({ uploadError: new Error('bucket unavailable') });
  await assert.rejects(() => uploadReceipt(file(), { storage, uuid: () => 'abc' }), /bucket unavailable/);
});

test('the upload still starts when the photo is picked, not when parse is tapped', () => {
  // A measured latency win rather than an accident: on a restaurant's wifi the
  // upload is the longest phase of a scan, and it used to sit idle through the
  // seconds between choosing a photo and finding the button.
  const page = read('src/pages/NewReceipt.jsx');
  assert.match(page, /beginUpload\(file\);/, 'picking a photo must still kick off the upload');
  assert.match(page, /attempt\.stored = attempt\.compressed\.then/,
    'storing must still hang off compression rather than block the scan');
  assert.ok(!/await uploadReceipt/.test(page),
    'awaiting the upload inline would put it back on the critical path');
});

test('the upload adds no second opinion about which files are allowed', () => {
  // validateAndSetFile already refuses a non-image and anything over 10MB. A
  // second set of limits here would drift from those, and the direction it
  // drifts is a guest being refused for a file the page told them was fine.
  const source = read('src/lib/uploadReceipt.js');
  assert.ok(!/MAX_FILE_SIZE|ALLOWED_IMAGE_TYPES|file\.size >/.test(source));
});

test('the bucket lets an account-less guest write to it', () => {
  // The migration is the other half of this file. A policy requiring
  // authenticated would pass every test above and fail every real diner.
  const migration = read('supabase/migrations/0004_receipts_storage.sql');
  assert.match(migration, /for insert\s*\n\s*to anon, authenticated/);
  assert.match(migration, /with check \(bucket_id = 'receipts'\)/);
  assert.match(migration, /public/);
  // Insert only. An uploaded receipt must not be replaceable afterwards.
  assert.ok(!/for (update|delete)/.test(migration), 'anon must not be able to change what it uploaded');
});
