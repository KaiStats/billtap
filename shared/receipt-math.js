/**
 * Does the arithmetic on a scanned receipt add up?
 *
 * Shared, because it runs in both places and the two must not drift. The
 * browser runs it during a scan; the /api/fn/validateReceiptParse endpoint runs
 * the same code for any caller that wants the check server-side.
 *
 * It used to run ONLY on the server, and the scan awaited it before showing the
 * diner anything. That is a network round trip — on a restaurant's wifi, several
 * hundred milliseconds — spent asking a server to add up a column of numbers
 * that the phone was already holding. It touches no database and needs no
 * credentials: the entire body is a reduce and a comparison. Every one of those
 * milliseconds was in front of a person waiting to see their receipt.
 */

/** Cents, not floats. 0.1 + 0.2 must not surface as 0.30000000000000004. */
const round = (n) => Math.round(n * 100) / 100;

export function validateReceiptParse({ items, tax, tip, total }) {
  if (!Array.isArray(items)) return { error: 'Invalid items array' };

  const itemSum = items.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
    0,
  );
  const calculated = itemSum + (Number(tax) || 0) + (Number(tip) || 0);
  const difference = Math.abs(calculated - (Number(total) || 0));

  const warnings = [];
  if (Number(total) && difference > 0.05) {
    warnings.push(
      `Items add up to $${calculated.toFixed(2)} but the total reads $${Number(total).toFixed(2)}.`,
    );
  }
  for (const item of items) {
    if (!item.name || !String(item.name).trim()) warnings.push('An item has no name.');
    if (!Number.isFinite(Number(item.price)) || Number(item.price) < 0) {
      warnings.push(`"${String(item.name || 'An item')}" has an unreadable price.`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings: warnings.slice(0, 5),
    item_sum: round(itemSum),
    calculated_total: round(calculated),
  };
}

/**
 * How much to trust this parse, in the terms the review screen uses.
 *
 * 'low' opens the editor by itself, so it is reserved for a receipt whose
 * numbers genuinely do not reconcile — being wrong in this direction asks
 * someone to check nineteen fields that were already right.
 */
export function parseConfidence(result) {
  if (!result || result.error) return null;

  const sumMismatch = result.warnings.some((w) => w.startsWith('Items add up to'));
  const unreadable = result.warnings.some((w) => w.includes('unreadable price'));

  if (sumMismatch || unreadable) {
    return {
      confidence: 'low',
      issues: {
        sumMismatch,
        calculatedTotal: result.calculated_total?.toFixed(2),
        expectedTotal: null,
      },
      warnings: result.warnings,
    };
  }
  if (result.warnings.length) {
    return { confidence: 'medium', issues: {}, warnings: result.warnings };
  }
  return { confidence: 'high', issues: {}, warnings: [] };
}
