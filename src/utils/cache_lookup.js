import pool from '../config/db.js';

/**
 * Looks up a pre-fetched company record from orbis_master_data, keyed by
 * bvd_id (the true, stable identity for a company across any number of
 * screening sessions — unlike external_supplier_data, which is keyed per
 * (ens_id, session_id) and always represents a single session's fetch).
 *
 * orbis_master_data is populated by the standalone PythonProject batch
 * script (data_moodys.py + db_utils.py), pointed at this same DB, ahead
 * of the live Moody's Orbis API access being retired. Its columns are a
 * near-exact field-for-field match to what getOrbisCompanyData /
 * getOrbisNews / getOrbisGridData / getGridData / getGridDataOrganizationWithId
 * build from the live API, by design — the Python script mirrors this
 * controller's own output field names.
 *
 * Returns null if no row is found (or on any DB error) — every caller
 * treats that as "no cache, fall through to the live API call", so a
 * missing cache entry can never block normal live-API operation.
 */
export async function getCachedOrbisMasterData(bvdId) {
  if (!bvdId) return null;
  try {
    const result = await pool.query(
      'SELECT * FROM orbis_master_data WHERE bvd_id = $1 LIMIT 1',
      [bvdId],
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('cache_lookup: failed to query orbis_master_data:', error);
    return null;
  }
}

/**
 * Looks up a pre-fetched personnel/Grid record from grid_management_master,
 * keyed by contact_id (globally, not session-scoped) — the personnel
 * equivalent of getCachedOrbisMasterData above.
 */
export async function getCachedGridManagementData(contactId) {
  if (!contactId) return null;
  try {
    const result = await pool.query(
      'SELECT * FROM grid_management_master WHERE contact_id = $1 LIMIT 1',
      [contactId],
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('cache_lookup: failed to query grid_management_master:', error);
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
