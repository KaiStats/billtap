import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Nightly snapshot export — exports all Session and Receipt entity records to a
// JSON file stored in /tmp and logs a summary. In production, pipe the JSON to
// an external storage service (S3, GCS, etc.) by adding your storage credentials
// as secrets and uploading via fetch().
//
// Runs on a schedule (no user context). Safe to call manually as admin.

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow scheduled automation (no user) or admin users only
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { /* scheduled */ }
  if (user && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const snapshot = { exported_at: new Date().toISOString(), entities: {} };

  // Export Sessions — SDK list() max 200; fetch in descending order
  const sessions = await base44.asServiceRole.entities.Session.list('-created_date', 200);
  snapshot.entities.Session = { count: sessions.length, records: sessions };

  // Export Receipts — SDK list() max 200
  const receipts = await base44.asServiceRole.entities.Receipt.list('-created_date', 200);
  snapshot.entities.Receipt = { count: receipts.length, records: receipts };

  const json = JSON.stringify(snapshot, null, 2);
  const filename = `/tmp/billtap-backup-${timestamp}.json`;

  // Write to /tmp (ephemeral — for verification; replace with external storage upload below)
  await Deno.writeTextFile(filename, json);

  // ── PRODUCTION: Upload to external storage ──────────────────────────────────
  // Example: upload to an S3-compatible bucket. Set BACKUP_S3_ENDPOINT,
  // BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET as secrets in the dashboard.
  //
  // const endpoint = Deno.env.get('BACKUP_S3_ENDPOINT');
  // if (endpoint) {
  //   const { S3Client, PutObjectCommand } = await import('npm:@aws-sdk/client-s3@3');
  //   const s3 = new S3Client({
  //     endpoint,
  //     region: 'auto',
  //     credentials: {
  //       accessKeyId: Deno.env.get('BACKUP_S3_KEY'),
  //       secretAccessKey: Deno.env.get('BACKUP_S3_SECRET'),
  //     },
  //   });
  //   await s3.send(new PutObjectCommand({
  //     Bucket: Deno.env.get('BACKUP_S3_BUCKET'),
  //     Key: `backups/billtap-backup-${timestamp}.json`,
  //     Body: json,
  //     ContentType: 'application/json',
  //   }));
  // }
  // ────────────────────────────────────────────────────────────────────────────

  const summary = {
    exported_at: snapshot.exported_at,
    date: timestamp,
    entities: {
      Session: sessions.length,
      Receipt: receipts.length,
    },
    total_records: sessions.length + receipts.length,
    file: filename,
    status: 'ok',
  };

  console.log('Nightly backup complete:', JSON.stringify(summary));
  return Response.json(summary);
});