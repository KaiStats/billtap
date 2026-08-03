-- Somewhere to put the photograph of the receipt.
--
-- This replaces Base44's Core.UploadFile, which was the last integration call
-- left in the app. src/lib/uploadReceipt.js is the only thing that writes here.
--
-- ── Why anyone may write to it ──────────────────────────────────────────────
--
-- The person photographing the receipt is usually a guest. They scanned a table
-- tent, they have no account, and they never will — auth.uid() is null for them
-- and that is the product working as intended, not a gap to be closed. So the
-- insert policy grants anon, and it has to: a policy that required a session
-- would fail exactly the people this app exists for, and it would fail them at
-- a restaurant table with the bill in front of them.
--
-- That is a public write endpoint, and it is worth being explicit rather than
-- discovering it later. What keeps it small:
--
--   * Insert only. No update, no delete, no select for anon — see below. An
--     uploaded object cannot be replaced or removed by whoever uploaded it, so
--     a receipt cannot be swapped for something else after a split links to it.
--   * A size limit on the bucket, so the endpoint cannot be used as free
--     unbounded storage.
--   * Keys are random uuids, generated client-side. Nothing about a key is
--     derived from the session, the restaurant or the time, so the objects
--     cannot be enumerated by someone who has seen one URL.
--
-- ── Why public, and what that costs ─────────────────────────────────────────
--
-- Public means /storage/v1/object/public/receipts/<key> is readable with no
-- credential. It has to be: the URL is stored on the split and displayed to
-- every diner at the table, none of whom have an account to authorise the read
-- with. A signed URL would expire while a bill was still open.
--
-- So the key is the secret. It is a uuid v4, which is not guessable, and that
-- is the whole of the access control on reading a receipt image. Worth knowing
-- when deciding what else could ever go in this bucket: nothing that is not
-- already shown to everyone holding the claim link belongs here.

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'receipts',
  'receipts',
  true,
  -- 10 MB, the same ceiling validateAndSetFile enforces in the browser. Stated
  -- here as well because the browser check is a courtesy to the person taking
  -- the photo, not a control — anyone can post to this bucket directly.
  10485760
)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Deliberately no allowed_mime_types.
--
-- The browser accepts a file whose type is empty when the *name* ends in an
-- image extension, which is not a loose check — it is there because iOS hands
-- over HEIC photos with no content type at all. A mime allow-list on the bucket
-- would reject exactly those uploads, and it would do it after the browser had
-- already accepted the file, so the failure would land on a guest who had done
-- nothing wrong and had no way to tell what happened. The size limit above is
-- the abuse control; the type is not what makes this endpoint safe.

-- Row level security on storage.objects is already enabled by Supabase. The
-- policies are dropped first so this file is re-runnable to its last line.

drop policy if exists "receipt images are insertable by anyone" on storage.objects;

create policy "receipt images are insertable by anyone"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'receipts');

-- No select policy, on purpose. Reads go through the public object path, which
-- does not consult row level security, so granting select here would add
-- nothing except the ability to *list* the bucket — which is the one thing the
-- random keys above are there to prevent.
--
-- No update or delete policy either. Absent is the same as denied for anon, and
-- writing them out as explicit denials would only invite someone to "fix" the
-- policy that appears to do nothing.
