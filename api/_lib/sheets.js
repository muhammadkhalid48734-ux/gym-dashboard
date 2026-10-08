const crypto = require('crypto');
const { google } = require('googleapis');
const {
  LEADS_TAB, ACTIVITY_TAB, HEADERS, ACTIVITY_HEADERS, ENUMS, NUMERIC, colLetter, LAST_COL,
} = require('./schema');

class ConfigError extends Error {}
class ValidationError extends Error {}
class ConflictError extends Error {}

const REQUIRED_ENV = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'];

let sheetsClient = null;
let setupPromise = null;

// The private key is the thing people most often paste slightly wrong into Vercel, so be forgiving:
// real newlines, literal "\n", double-escaped "\\n", spaces instead of newlines, wrapping quotes,
// a trailing comma, or even the whole JSON key file. We pull out the base64 body between the
// BEGIN/END markers and rebuild a canonical PEM from it.
function normalizePrivateKey(raw) {
  let key = String(raw || '').trim();
  if (key.startsWith('{')) {
    try { key = JSON.parse(key).private_key || key; } catch { /* fall through */ }
  }
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(key);
  if (!m) return key.replace(/\\n/g, '\n'); // no markers found: validation below reports it
  const body = m[2]
    .replace(/\\+[nr]/g, '')        // literal \n / \\n / \r sequences
    .replace(/[^A-Za-z0-9+/=]/g, ''); // whitespace, quotes, commas, stray characters
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`;
}

// Normalise + prove the key parses, with a diagnosis that never reveals key material.
function preparePrivateKey(raw) {
  const pem = normalizePrivateKey(raw);
  try {
    crypto.createPrivateKey(pem);
    return pem;
  } catch (err) {
    const text = String(raw || '');
    const hasBegin = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);
    const hasEnd = /-----END [A-Z ]*PRIVATE KEY-----/.test(text);
    let why;
    if (!text.trim()) why = 'it is empty';
    else if (!hasBegin) why = 'it does not start with -----BEGIN PRIVATE KEY----- (you may have pasted the wrong field, e.g. private_key_id)';
    else if (!hasEnd) why = 'it is cut off — the -----END PRIVATE KEY----- line is missing (the value was truncated when pasting)';
    else {
      const body = (/-----BEGIN [A-Z ]*PRIVATE KEY-----([\s\S]*?)-----END/.exec(pem) || [])[1] || '';
      const chars = body.replace(/\s/g, '').length;
      why = `the key body has ${chars} characters but a valid Google key has about 1600 — part of it is missing or was altered while pasting`;
    }
    throw new ConfigError(`GOOGLE_PRIVATE_KEY is not a valid key: ${why}. Re-copy the whole "private_key" value from the JSON file. (${err.message})`);
  }
}

function checkEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new ConfigError(`Missing environment variable(s): ${missing.join(', ')}. Set them in Vercel → Settings → Environment Variables.`);
  }
}

function getSheets() {
  if (sheetsClient) return sheetsClient;
  checkEnv();
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: preparePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

// Test hook: lets tests inject an in-memory fake instead of the real API.
function __setSheetsForTests(fake) {
  sheetsClient = fake;
  setupPromise = null;
}

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

// Make sure both tabs exist and have headers. Runs once per cold start.
// Never overwrites existing data: an empty header row is filled in, a missing 20th
// column (Package) is added, anything else non-matching is reported as a warning.
function ensureSetup() {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const s = getSheets();
    const id = spreadsheetId();
    const warnings = [];
    const actions = [];

    const meta = await s.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
    const titles = (meta.data.sheets || []).map((x) => x.properties.title);
    const missingTabs = [LEADS_TAB, ACTIVITY_TAB].filter((t) => !titles.includes(t));
    if (missingTabs.length) {
      await s.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: { requests: missingTabs.map((title) => ({ addSheet: { properties: { title } } })) },
      });
      actions.push(`Created tab(s): ${missingTabs.join(', ')}`);
    }

    const lead = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${LEADS_TAB}!A1:${LAST_COL}1` });
    const row = (lead.data.values && lead.data.values[0]) || [];
    if (row.every(isBlank)) {
      await s.spreadsheets.values.update({
        spreadsheetId: id, range: `${LEADS_TAB}!A1:${LAST_COL}1`, valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
      actions.push('Wrote Leads header row');
    } else {
      const first19Match = HEADERS.slice(0, 19).every((h, i) => String(row[i] || '').trim() === h);
      if (first19Match && isBlank(row[19])) {
        await s.spreadsheets.values.update({
          spreadsheetId: id, range: `${LEADS_TAB}!${LAST_COL}1`, valueInputOption: 'RAW',
          requestBody: { values: [['Package']] },
        });
        actions.push('Added "Package" column header (column T) to existing Leads sheet');
      } else {
        const bad = HEADERS.filter((h, i) => String(row[i] || '').trim() !== h);
        if (bad.length) warnings.push(`Leads header row doesn't match the expected columns (${bad.join(', ')}). Reads/writes assume the documented column order.`);
      }
    }

    const act = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${ACTIVITY_TAB}!A1:F1` });
    const actRow = (act.data.values && act.data.values[0]) || [];
    if (actRow.every(isBlank)) {
      await s.spreadsheets.values.update({
        spreadsheetId: id, range: `${ACTIVITY_TAB}!A1:F1`, valueInputOption: 'RAW',
        requestBody: { values: [ACTIVITY_HEADERS] },
      });
      actions.push('Wrote Activity header row');
    }

    return { actions, warnings };
  })();
  setupPromise.catch(() => { setupPromise = null; });
  return setupPromise;
}

function rowToLead(cells, rowNumber) {
  const lead = { _row: rowNumber };
  HEADERS.forEach((h, i) => { lead[h] = cells[i] === undefined ? '' : String(cells[i]); });
  return lead;
}

async function listAll() {
  const setup = await ensureSetup();
  const res = await getSheets().spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: [`${LEADS_TAB}!A2:${LAST_COL}`, `${ACTIVITY_TAB}!A2:F`],
  });
  const [leadRange, actRange] = res.data.valueRanges;
  const leads = (leadRange.values || [])
    .map((cells, i) => rowToLead(cells, i + 2)) // sheet row = index + 2 (header is row 1)
    .filter((l) => !isBlank(l['Gym Name']));
  const activity = (actRange.values || []).map((c) => ({
    Timestamp: c[0] || '', Date: c[1] || '', Gym: c[2] || '', City: c[3] || '', Event: c[4] || '', Detail: c[5] || '',
  }));
  return { leads, activity, warnings: setup.warnings };
}

function coerce(field, value) {
  if (value === undefined || value === null) return '';
  if (ENUMS[field] && value !== '' && !ENUMS[field].includes(value)) {
    throw new ValidationError(`"${value}" is not a valid ${field}. Allowed: ${ENUMS[field].join(' | ')}`);
  }
  if (NUMERIC.includes(field)) {
    if (String(value).trim() === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
    return n;
  }
  return String(value);
}

async function appendLead(lead) {
  if (!lead || typeof lead !== 'object') throw new ValidationError('Missing lead');
  if (isBlank(lead['Gym Name'])) throw new ValidationError('Gym Name is required');
  const values = HEADERS.map((h) => coerce(h, lead[h]));
  await ensureSetup();
  const res = await getSheets().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${LEADS_TAB}!A:${LAST_COL}`,
    valueInputOption: 'RAW', // RAW: keeps text as text (no formula injection, no date auto-conversion)
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
  const updatedRange = (res.data.updates && res.data.updates.updatedRange) || '';
  const m = /!A(\d+):/.exec(updatedRange);
  if (!m) throw new Error(`Sheet accepted the row but returned an unexpected range: "${updatedRange}"`);
  return { row: Number(m[1]) };
}

async function appendActivity(entries, gym, city) {
  const now = new Date().toISOString();
  const values = entries.map((e) => [now, String(e.date || now.slice(0, 10)), gym, city, String(e.event || ''), String(e.detail || '')]);
  await getSheets().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${ACTIVITY_TAB}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

async function updateLead({ row, expectGym, updates, log }) {
  if (!Number.isInteger(row) || row < 2) throw new ValidationError('Invalid row number');
  if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) throw new ValidationError('No updates given');
  const data = Object.entries(updates).map(([field, value]) => {
    const idx = HEADERS.indexOf(field);
    if (idx === -1) throw new ValidationError(`Unknown field "${field}"`);
    return { range: `${LEADS_TAB}!${colLetter(idx)}${row}`, values: [[coerce(field, value)]] };
  });

  await ensureSetup();
  const s = getSheets();
  const id = spreadsheetId();

  // Guard against the Sheet having been re-sorted / rows deleted since the page loaded.
  const cur = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${LEADS_TAB}!A${row}:B${row}` });
  const [gym, city] = (cur.data.values && cur.data.values[0]) || [];
  if (isBlank(gym) || (expectGym !== undefined && String(gym).trim() !== String(expectGym).trim())) {
    throw new ConflictError(`Row ${row} no longer matches "${expectGym}" — the Sheet changed. Hit Refresh and try again. Nothing was written.`);
  }

  await s.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: 'RAW', data },
  });

  const result = { ok: true, row, logged: 0 };
  const entries = Array.isArray(log) ? log : (log ? [log] : []);
  if (entries.length) {
    try {
      await appendActivity(entries, String(gym), String(city || ''));
      result.logged = entries.length;
    } catch (err) {
      result.logError = explain(err);
    }
  }
  return result;
}

// Turn the googleapis errors people actually hit into something actionable.
function explain(err) {
  const msg = (err && err.message) || String(err);
  const code = err && (err.code || (err.response && err.response.status));
  if (err instanceof ConfigError || err instanceof ValidationError || err instanceof ConflictError) return msg;
  if (code === 403 || /permission/i.test(msg)) {
    return `Google says permission denied. Share the Sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the service account email'} as Editor, and make sure the Google Sheets API is enabled. (${msg})`;
  }
  if (code === 404 || /not found/i.test(msg)) {
    return `Sheet not found — check GOOGLE_SHEET_ID (it's the long id between /d/ and /edit in the Sheet URL). (${msg})`;
  }
  if (/DECODER|PEM|private key|invalid_grant|error:1E08010C|no start line/i.test(msg)) {
    return `The private key could not be used — re-copy GOOGLE_PRIVATE_KEY from the JSON key file exactly (the whole "-----BEGIN PRIVATE KEY-----…-----END PRIVATE KEY-----" value). (${msg})`;
  }
  return msg;
}

// Step-1 connection test: env → auth/tabs/header → read → write → read-back.
async function runTest() {
  const steps = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail });
      return true;
    } catch (err) {
      steps.push({ name, ok: false, detail: explain(err) });
      return false;
    }
  };

  let ok = await step('Environment variables present', async () => { checkEnv(); return 'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID are set'; });
  if (ok) ok = await step('Connect + prepare tabs/headers', async () => {
    const r = await ensureSetup();
    const parts = r.actions.length ? r.actions : ['Tabs and headers already in place'];
    return parts.concat(r.warnings.map((w) => `⚠ ${w}`)).join('; ');
  });
  if (ok) ok = await step('Read leads', async () => {
    const d = await listAll();
    return `${d.leads.length} lead row(s), ${d.activity.length} activity row(s)`;
  });
  if (ok) ok = await step('Write + read back', async () => {
    // Idempotent write: re-writes the existing A1 header value, proving Editor access without touching data.
    const s = getSheets();
    const id = spreadsheetId();
    await s.spreadsheets.values.update({
      spreadsheetId: id, range: `${LEADS_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [[HEADERS[0]]] },
    });
    const back = await s.spreadsheets.values.get({ spreadsheetId: id, range: `${LEADS_TAB}!A1` });
    const v = back.data.values && back.data.values[0] && back.data.values[0][0];
    if (v !== HEADERS[0]) throw new Error(`Read back "${v}" instead of "${HEADERS[0]}"`);
    return 'Write access confirmed (A1 rewritten with the same header value)';
  });
  return { ok: steps.every((x) => x.ok), steps };
}

module.exports = {
  ConfigError, ValidationError, ConflictError,
  normalizePrivateKey, preparePrivateKey, ensureSetup, listAll, appendLead, updateLead, runTest, explain, __setSheetsForTests,
};
