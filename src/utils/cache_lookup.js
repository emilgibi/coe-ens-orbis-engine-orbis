import pool from '../config/db.js';

/**
 * Looks up a pre-fetched company record from orbis_master_data, keyed by
 * bvd_id (the true, stable identity for a company across any number of
 * screening sessions — unlike external_supplier_data, which is keyed per
 * (ens_id, session_id) and always represents a single session's fetch).
 *
 * orbis_master_data is populated by the standalone PythonProject batch
 * script (data_moodys.py + db_utils.py), pointed at this same DB, ahead
 * of the live Moody's Orbis API access being retired.
 *
 * Every log line here uses the "[DATA-SOURCE]" prefix — grep for that to
 * get a clean audit trail of every decision made, hit or miss, across
 * every function that uses this helper.
 */
export async function getCachedOrbisMasterData(bvdId) {
  if (!bvdId) {
    console.log('[DATA-SOURCE] ⚠️  no bvdId provided — cannot check cache, will require live API');
    return null;
  }
  try {
    const result = await pool.query(
      'SELECT * FROM orbis_master_data WHERE bvd_id = $1 LIMIT 1',
      [bvdId],
    );
    if (result.rows[0]) {
      console.log(`[DATA-SOURCE] ✅ CACHE HIT  — orbis_master_data — bvdId=${bvdId}`);
      return result.rows[0];
    }
    console.log(`[DATA-SOURCE] ❌ CACHE MISS — orbis_master_data — bvdId=${bvdId} — no pre-fetched row, will call live API`);
    return null;
  } catch (error) {
    console.error(`[DATA-SOURCE] 🛑 CACHE LOOKUP ERROR — orbis_master_data — bvdId=${bvdId} — falling back to live API:`, error);
    return null;
  }
}

/**
 * Looks up a pre-fetched personnel/Grid record from grid_management_master,
 * keyed by contact_id (globally, not session-scoped) — the personnel
 * equivalent of getCachedOrbisMasterData above.
 */
export async function getCachedGridManagementData(contactId) {
  if (!contactId) {
    console.log('[DATA-SOURCE] ⚠️  no contactId provided — cannot check cache, will require live API');
    return null;
  }
  try {
    const result = await pool.query(
      'SELECT * FROM grid_management_master WHERE contact_id = $1 LIMIT 1',
      [contactId],
    );
    if (result.rows[0]) {
      console.log(`[DATA-SOURCE] ✅ CACHE HIT  — grid_management_master — contactId=${contactId}`);
      return result.rows[0];
    }
    console.log(`[DATA-SOURCE] ❌ CACHE MISS — grid_management_master — contactId=${contactId} — no pre-fetched row, will call live API`);
    return null;
  } catch (error) {
    console.error(`[DATA-SOURCE] 🛑 CACHE LOOKUP ERROR — grid_management_master — contactId=${contactId} — falling back to live API:`, error);
    return null;
  }
}

/**
 * The live-API code paths in this controller store JSONB fields as
 * JSON.stringify()'d strings (e.g. JSON.stringify(management, null, 2)).
 * Reading the same JSONB column back from Postgres via node-postgres
 * auto-parses it into a JS object/array, not a string. To keep the
 * cache-hit path byte-for-byte consistent with what the live-API path
 * has always written (rather than introducing a second, inconsistent
 * representation for the same columns), re-stringify objects/arrays and
 * pass everything else through unchanged.
 */
export function matchLiveApiJsonFormat(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return value;
}
