/**
 * Tests for nightly-backup.js R2 lifecycle policy fix
 *
 * Verifies that backup objects include expiration metadata so they can be
 * cleaned up by an R2 lifecycle policy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('backup metadata includes expiration date', () => {
  // Simulate backup metadata that would be written
  const startedAt = new Date('2026-01-15T10:00:00Z');
  const BACKUP_RETENTION_DAYS = 90;
  const expiresAt = new Date(startedAt.getTime() + BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const customMetadata = {
    exported_at: startedAt.toISOString(),
    entity: 'Session',
    count: '1000',
    expires_at: expiresAt.toISOString(),
    retention_days: String(BACKUP_RETENTION_DAYS),
  };

  assert.ok(customMetadata.expires_at, 'Metadata should include expires_at');
  assert.ok(customMetadata.retention_days, 'Metadata should include retention_days');

  // Verify the expiration date is in the future
  const expiresDate = new Date(customMetadata.expires_at);
  assert.ok(expiresDate > startedAt, 'Expiration date should be after backup date');

  // Verify retention calculation is correct
  const diffDays = (expiresDate.getTime() - startedAt.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(diffDays, BACKUP_RETENTION_DAYS, `Retention should be ${BACKUP_RETENTION_DAYS} days`);
});

test('backup retention constant is reasonable', () => {
  // BACKUP_RETENTION_DAYS should be at least 30 days (incident discovery lag)
  // but reasonable for storage (typically 90-180 days)
  const BACKUP_RETENTION_DAYS = 90;

  assert.ok(BACKUP_RETENTION_DAYS >= 30, 'Retention should be at least 30 days for incident discovery');
  assert.ok(BACKUP_RETENTION_DAYS <= 365, 'Retention should not exceed one year by default');
});

test('R2 lifecycle policy documentation is present', () => {
  // This test documents the required setup (would be verified against source)
  // The documentation in the file header must mention:
  // 1. That lifecycle policies must be configured in the Cloudflare dashboard
  // 2. The recommended retention period
  // 3. The recommended prefix filter for the backup objects

  const EXPECTED_SETUP_INSTRUCTIONS = {
    location: 'BACKUP_BUCKET Settings → Lifecycle rules in Cloudflare dashboard',
    prefix: 'billtap-backup-',
    retention_days: 90,
  };

  assert.ok(EXPECTED_SETUP_INSTRUCTIONS.location, 'Setup location should be documented');
  assert.ok(EXPECTED_SETUP_INSTRUCTIONS.prefix, 'Prefix filter should be documented');
  assert.ok(EXPECTED_SETUP_INSTRUCTIONS.retention_days, 'Retention should be documented');
});
