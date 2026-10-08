/**
 * Financial Intelligence handlers, served at /api/fn/<name> beside the rest.
 *
 * Built as a factory because the ownership lookup and the paged reader live in
 * functions.js, and importing them from there would make the two modules import
 * each other. functions.js passes them in and spreads the result into HANDLERS.
 *
 * Every handler:
 *   - resolves the restaurant from the signed-in user, never from the body;
 *   - refuses unless the restaurant has the 'finance' module switched on;
 *   - answers 404 for anything that is not the caller's, so ids cannot be probed.
 *
 * The flow an owner sees:
 *   1. uploadFinancialDocument  file in → stored privately → Claude drafts the
 *                               month's figures → draft back to the screen.
 *   2. saveMonthlySnapshot      owner corrects and confirms → one row per month.
 *   3. generateCombinedInsights facts computed from confirmed months and guest
 *                               ratings → Claude writes them up, citing facts.
 *   getFinanceData loads all of it for the dashboard.
 */
import { json } from '../lib/email.js';
import { serviceRole, currentUser, backendName } from '../lib/data.js';
import { uploadObject, deleteObject } from '../lib/db.js';
import { isEntitled } from '../../shared/entitlement.js';
import { readFinancialDocument, writeCombinedInsights, claudeConfigured, ClaudeError } from '../lib/claude.js';
import {
  hasModule, isUploadKind, UPLOAD_MEDIA_TYPES, MAX_UPLOAD_BYTES, MONEY_FIELDS,
  normalizeMonth, validateSnapshot, combinedFacts, validateInsights,
} from '../../shared/finance.js';

const BUCKET = 'finance-uploads';
const CLAUDE_STATUS = { not_configured: 503, rate_limited: 429, refused: 422, truncated: 502, bad_output: 502, bad_request: 400, upstream: 502 };

/** What travels to the browser: never the storage key. */
const uploadView = (u) => ({
  id: u.id, file_name: u.file_name, kind: u.kind, status: u.status,
  extracted: u.extracted ?? null, error: u.error ?? null, created_at: u.created_at,
  has_file: Boolean(u.storage_key),
});

const SNAPSHOT_COLUMNS = ['month', ...MONEY_FIELDS.map((f) => f.id), 'covers', 'notes'];
const snapshotView = (s) => ({
  ...Object.fromEntries(SNAPSHOT_COLUMNS.map((c) => [c, s[c] ?? null])),
  // numeric comes back from PostgREST as a string or number; the browser gets numbers.
  ...Object.fromEntries(MONEY_FIELDS.map((f) => [f.id, s[f.id] == null ? null : Number(s[f.id])])),
  month: String(s.month).slice(0, 10),
  source_upload_ids: s.source_upload_ids || [],
  confirmed_at: s.confirmed_at,
});

function decodeBase64(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function financeHandlers({ findOrAdoptRestaurant, readAll, ownerView }) {
  /** Owner + module check shared by every handler. Returns { error } or { user, svc, restaurant }. */
  async function owner(env, request) {
    if (backendName(env) !== 'supabase') return { error: json({ error: 'Finance needs the Supabase backend', code: 'unavailable' }, 503) };
    const user = await currentUser(env, request);
    if (!user) return { error: json({ error: 'Unauthorized' }, 401) };
    const svc = serviceRole(env);
    const restaurant = await findOrAdoptRestaurant(svc, user);
    if (!restaurant) return { error: json({ error: 'No restaurant' }, 404) };
    if (!hasModule(restaurant, 'finance')) {
      return { error: json({ error: 'Financial Intelligence is not switched on for this restaurant', code: 'module_off' }, 403) };
    }
    // The same entitlement every other paid feature reads: trial, active, or
    // inside the past-due grace period. A lapsed restaurant keeps its rows but
    // cannot add to them or read them until it resubscribes.
    if (!isEntitled(restaurant)) {
      return { error: json({ error: 'Your plan has ended. Resubscribe to see your finances.', code: 'plan_inactive' }, 402) };
    }
    return { user, svc, restaurant };
  }

  const claudeFailure = (err) => {
    if (err instanceof ClaudeError) {
      return json({ error: err.message, code: err.code }, CLAUDE_STATUS[err.code] || 502);
    }
    throw err;
  };

  return {
    /**
     * A restaurant still on its free trial switches Finance on for the rest of
     * that trial. Paid restaurants change plan through checkout instead, so a
     * $149 subscriber cannot unlock the $249 module from here.
     */
    async startFinanceTrial({ env, request }) {
      if (backendName(env) !== 'supabase') return json({ error: 'Finance needs the Supabase backend', code: 'unavailable' }, 503);
      const user = await currentUser(env, request);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const svc = serviceRole(env);
      const restaurant = await findOrAdoptRestaurant(svc, user);
      if (!restaurant) return json({ error: 'No restaurant' }, 404);
      if (hasModule(restaurant, 'finance')) return json({ ok: true, modules: restaurant.modules });
      if ((restaurant.plan ?? 'trial') !== 'trial' || !isEntitled(restaurant)) {
        return json({ error: 'Choose the Financial Intelligence or Full platform plan to add Finance.', code: 'upgrade_needed' }, 402);
      }
      const modules = [...new Set([...(Array.isArray(restaurant.modules) ? restaurant.modules : ['guest_recovery']), 'finance'])];
      await svc.entity('Restaurant').update(restaurant.id, { modules });
      return json({ ok: true, modules });
    },

    /**
     * Delete an uploaded file. The original is removed from storage; the row
     * stays as a record that it existed, marked discarded with no key. A
     * confirmed month built from it is the owner's own figures and is kept.
     */
    async removeFinancialUpload({ env, request, body }) {
      const o = await owner(env, request);
      if (o.error) return o.error;
      const { svc, restaurant } = o;
      const id = typeof body?.upload_id === 'string' ? body.upload_id : '';
      const row = id ? (await svc.entity('FinancialUpload').filter({ id }))[0] : null;
      if (!row || row.restaurant_id !== restaurant.id) return json({ error: 'Upload not found' }, 404);
      if (row.storage_key) await deleteObject(env, BUCKET, row.storage_key);
      await svc.entity('FinancialUpload').update(row.id, {
        storage_key: null,
        status: row.status === 'confirmed' ? 'confirmed' : 'discarded',
      });
      return json({ ok: true, upload_id: row.id });
    },

    async getFinanceData({ env, request }) {
      const o = await owner(env, request);
      if (o.error) return o.error;
      const { svc, restaurant } = o;
      const [snapshots, uploads, insights] = await Promise.all([
        svc.entity('MonthlySnapshot').filter({ restaurant_id: restaurant.id }, { order: '-month', limit: 24 }),
        svc.entity('FinancialUpload').filter({ restaurant_id: restaurant.id }, { order: '-created_at', limit: 20 }),
        svc.entity('CombinedInsight').filter({ restaurant_id: restaurant.id }, { order: '-created_at', limit: 1 }),
      ]);
      return json({
        restaurant: ownerView(restaurant),
        snapshots: snapshots.map(snapshotView),
        uploads: uploads.map(uploadView),
        latest_insight: insights[0]
          ? { month: String(insights[0].month).slice(0, 10), facts: insights[0].facts, insights: insights[0].insights, created_at: insights[0].created_at }
          : null,
        claude_configured: claudeConfigured(env),
      });
    },

    async uploadFinancialDocument({ env, request, body }) {
      const o = await owner(env, request);
      if (o.error) return o.error;
      const { user, svc, restaurant } = o;

      const fileName = typeof body?.file_name === 'string' ? body.file_name.trim().slice(0, 200) : '';
      const mediaType = body?.media_type;
      const kind = body?.kind;
      if (!fileName) return json({ error: 'file_name is required' }, 400);
      if (!UPLOAD_MEDIA_TYPES.includes(mediaType)) return json({ error: 'Upload a PDF or CSV file' }, 400);
      if (!isUploadKind(kind)) return json({ error: 'Unknown document kind' }, 400);
      const bytes = decodeBase64(body?.base64);
      if (!bytes || bytes.length === 0) return json({ error: 'The file could not be read' }, 400);
      if (bytes.length > MAX_UPLOAD_BYTES) return json({ error: 'Files are limited to 8 MB' }, 413);
      if (!claudeConfigured(env)) return json({ error: 'Document reading is not set up yet', code: 'not_configured' }, 503);

      const now = Date.now();
      // Stored first, and a storage failure does not stop the read: the owner
      // still gets their figures, the row just has no original attached.
      let storageKey = null;
      try {
        const ext = mediaType === 'application/pdf' ? 'pdf' : 'csv';
        storageKey = await uploadObject(env, BUCKET, `${restaurant.id}/${now}-${crypto.randomUUID()}.${ext}`, bytes, mediaType);
      } catch (err) {
        console.error('finance upload store failed:', err?.message);
      }

      let extracted = null;
      let failure = null;
      try {
        const { result, model } = await readFinancialDocument(env, { base64: body.base64, mediaType, kind, fileName });
        extracted = { ...result, period_month: normalizeMonth(result.period_month), model };
      } catch (err) {
        if (!(err instanceof ClaudeError)) throw err;
        failure = err;
      }

      const row = await svc.entity('FinancialUpload').create({
        restaurant_id: restaurant.id,
        storage_key: storageKey,
        file_name: fileName,
        media_type: mediaType,
        size_bytes: bytes.length,
        kind,
        status: failure ? 'failed' : 'extracted',
        extracted,
        error: failure ? failure.code : null,
        created_by: user.id,
        created_at: now,
      });
      if (failure) return claudeFailure(failure);
      return json({ upload: uploadView(row) });
    },

    async saveMonthlySnapshot({ env, request, body }) {
      const o = await owner(env, request);
      if (o.error) return o.error;
      const { user, svc, restaurant } = o;

      const checked = validateSnapshot(body?.snapshot);
      if (!checked.ok) return json({ error: 'Some figures need fixing', fields: checked.errors }, 400);

      // Only this restaurant's uploads can be attached.
      const requested = Array.isArray(body?.upload_ids) ? body.upload_ids.filter((id) => typeof id === 'string').slice(0, 20) : [];
      const uploads = requested.length
        ? (await svc.entity('FinancialUpload').filter({ restaurant_id: restaurant.id }, { order: '-created_at', limit: 100 }))
          .filter((u) => requested.includes(u.id))
        : [];

      const now = Date.now();
      const fields = {
        ...checked.snapshot,
        source_upload_ids: uploads.map((u) => u.id),
        confirmed_by: user.id,
        confirmed_at: now,
        updated_date: new Date(now).toISOString(),
      };
      const existing = (await svc.entity('MonthlySnapshot').filter({ restaurant_id: restaurant.id, month: checked.snapshot.month }))[0];
      const saved = existing
        ? await svc.entity('MonthlySnapshot').update(existing.id, fields)
        : await svc.entity('MonthlySnapshot').create({ restaurant_id: restaurant.id, ...fields });
      await Promise.all(uploads.map((u) => svc.entity('FinancialUpload').update(u.id, { status: 'confirmed' })));
      return json({ snapshot: snapshotView(saved || { ...existing, ...fields }) });
    },

    async generateCombinedInsights({ env, request }) {
      const o = await owner(env, request);
      if (o.error) return o.error;
      const { svc, restaurant } = o;

      const [snapshots, ratings] = await Promise.all([
        svc.entity('MonthlySnapshot').filter({ restaurant_id: restaurant.id }, { order: '-month', limit: 2 }),
        readAll(svc, 'GuestRating', restaurant.id),
      ]);
      const view = ownerView(restaurant);
      const { month, facts } = combinedFacts({
        snapshots: snapshots.map(snapshotView),
        ratings: ratings.rows,
        threshold: view.rating_threshold,
      });
      if (!month) return json({ error: 'Confirm at least one month of figures first', code: 'no_snapshots' }, 400);

      let written;
      try {
        written = await writeCombinedInsights(env, { restaurantName: view.name, month, facts });
      } catch (err) {
        return claudeFailure(err);
      }
      const insights = validateInsights(written.result?.insights, facts);
      const now = Date.now();
      await svc.entity('CombinedInsight').create({
        restaurant_id: restaurant.id, month, facts, insights, model: written.model, created_at: now,
      });
      return json({ month, facts, insights, created_at: now });
    },
  };
}

/**
 * Nightly: delete original finance files older than FINANCE_FILE_RETENTION_DAYS.
 *
 * The figures an owner confirmed live in monthly_snapshots and stay. The files
 * themselves can carry employee names and pay, which nothing here needs once
 * the month is confirmed, so they are not kept indefinitely. Rows keep their
 * extracted draft and lose only the storage key.
 */
export const FINANCE_FILE_RETENTION_DAYS = 90;

export async function purgeFinanceOriginals(env, svc, { now = Date.now(), limit = 100 } = {}) {
  const cutoff = now - FINANCE_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const due = await svc.entity('FinancialUpload').filter(
    { created_at: { lt: cutoff }, storage_key: { not: 'is.null' } },
    { select: 'id,storage_key', order: 'created_at', limit },
  );
  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await deleteObject(env, BUCKET, row.storage_key);
      await svc.entity('FinancialUpload').update(row.id, { storage_key: null });
      deleted += 1;
    } catch (error) {
      console.error('finance retention: could not delete', row.id, error?.message);
      failed += 1;
    }
  }
  return { considered: due.length, deleted, failed };
}

/** Every stored original for one restaurant, before its rows are deleted. */
export async function removeFinanceFiles(env, svc, restaurantId) {
  const rows = await svc.entity('FinancialUpload').filter(
    { restaurant_id: restaurantId, storage_key: { not: 'is.null' } },
    { select: 'id,storage_key', limit: 500 },
  );
  for (const row of rows) await deleteObject(env, BUCKET, row.storage_key);
  return rows.length;
}
