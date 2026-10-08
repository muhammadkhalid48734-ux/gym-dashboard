const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSheets } = require('./fakeSheets');
const sheets = require('../api/_lib/sheets');
const { HEADERS, ACTIVITY_HEADERS } = require('../api/_lib/schema');
const leadsHandler = require('../api/leads');
const testHandler = require('../api/test');

process.env.GOOGLE_SHEET_ID = 'fake';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'x';

function call(handler, method, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(payload) { resolve({ status: this.statusCode, json: JSON.parse(payload) }); },
    };
    handler({ method, body }, res);
  });
}

const sample = (over = {}) => ({
  'Gym Name': 'Iron Haven', City: 'Austin', 'Instagram Link': 'https://instagram.com/ironhaven',
  Followers: 4200, 'Website Quality': 'Outdated', 'Current Offer': 'Free Trial', Status: 'Warming',
  'Engagement Started': '2026-10-08', 'Engagement Touches': 0, Package: 'Trial-to-Member System', 'Facebook Link': 'https://facebook.com/ironhaven', ...over,
});

function fresh(opts) {
  const fake = createFakeSheets({ tabs: ['Leads'], ...opts });
  sheets.__setSheetsForTests(fake);
  return fake;
}

const crypto = require('node:crypto');
const goodPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;

test('private key: every common way of mangling it in Vercel still yields a usable key', () => {
  const body = goodPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const variants = {
    'real newlines': goodPem,
    'literal \\n (what Vercel/.env stores)': goodPem.replace(/\n/g, '\\n'),
    'wrapping double quotes': `"${goodPem.replace(/\n/g, '\\n')}"`,
    'quotes + trailing comma (copied from the JSON line)': `"${goodPem.replace(/\n/g, '\\n')}",`,
    'double-escaped \\\\n': goodPem.replace(/\n/g, '\\\\n'),
    'spaces instead of newlines': goodPem.replace(/\n/g, ' '),
    'CRLF line endings': goodPem.replace(/\n/g, '\r\n'),
    'whole JSON key file pasted': JSON.stringify({ type: 'service_account', private_key: goodPem }),
    'surrounding whitespace': `\n  ${goodPem}  \n`,
  };
  Object.entries(variants).forEach(([name, raw]) => {
    const pem = sheets.preparePrivateKey(raw);
    assert.equal(pem, goodPem, name);
    crypto.createPrivateKey(pem); // really parses
  });
  assert.ok(body.length > 1000);
});

test('private key: broken values fail with a specific, secret-free diagnosis', () => {
  const lit = goodPem.replace(/\n/g, '\\n');
  const cases = [
    ['', /is empty/],
    ['MIIEvgIBADAN-not-a-key', /does not start with -----BEGIN PRIVATE KEY-----/],
    [lit.slice(0, 700), /cut off/],
    [lit.slice(0, 400) + lit.slice(900), /key body has \d+ characters/],
  ];
  cases.forEach(([raw, re]) => {
    assert.throws(() => sheets.preparePrivateKey(raw), (e) => {
      assert.match(e.message, re);
      assert.doesNotMatch(e.message, /MIIE[A-Za-z0-9+/]{40}/); // never echoes key material
      return e instanceof sheets.ConfigError;
    });
  });
});

test('first run: empty Leads tab gets the 20-column header; Activity tab is created with its header', async () => {
  const fake = createFakeSheets({ tabs: ['Leads'] });
  sheets.__setSheetsForTests(fake);
  const r = await call(leadsHandler, 'GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.leads, []);
  assert.deepEqual(fake.__grids.get('Leads')[0], HEADERS);
  assert.equal(HEADERS.length, 21);
  assert.equal(HEADERS[19], 'Package');
  assert.equal(HEADERS[20], 'Facebook Link');
  assert.deepEqual(fake.__grids.get('Activity')[0], ACTIVITY_HEADERS);
});

test('existing 19-column sheet gets the missing Package + Facebook Link headers added without touching data', async () => {
  const fake = fresh();
  fake.__grids.get('Leads')[0] = HEADERS.slice(0, 19);
  fake.__grids.get('Leads')[1] = ['Old Gym', 'Dallas'];
  await call(leadsHandler, 'GET');
  assert.equal(fake.__grids.get('Leads')[0][19], 'Package');
  assert.equal(fake.__grids.get('Leads')[0][20], 'Facebook Link');
  assert.equal(fake.__grids.get('Leads')[1][0], 'Old Gym');
});

test('existing 20-column sheet (Package already present) only gets the Facebook Link header', async () => {
  const fake = fresh();
  fake.__grids.get('Leads')[0] = HEADERS.slice(0, 20);
  fake.__grids.get('Leads')[1] = ['Old Gym', 'Dallas'];
  const r = await call(leadsHandler, 'GET');
  assert.equal(r.status, 200);
  assert.deepEqual(fake.__grids.get('Leads')[0], HEADERS);
  assert.deepEqual(r.json.warnings, []);
  assert.equal(r.json.leads[0]['Facebook Link'], '');
});

test('POST appends a row in column order and returns its row number', async () => {
  const fake = fresh();
  const a = await call(leadsHandler, 'POST', { lead: sample() });
  assert.equal(a.status, 200);
  assert.equal(a.json.row, 2);
  const b = await call(leadsHandler, 'POST', { lead: sample({ 'Gym Name': 'Second' }) });
  assert.equal(b.json.row, 3);
  const row = fake.__grids.get('Leads')[1];
  assert.equal(row[0], 'Iron Haven');
  assert.equal(row[3], 4200);
  assert.equal(row[19], 'Trial-to-Member System');
  assert.equal(row[20], 'https://facebook.com/ironhaven');
  const list = await call(leadsHandler, 'GET');
  assert.equal(list.json.leads.length, 2);
  assert.equal(list.json.leads[1]._row, 3);
  assert.equal(list.json.leads[0].Package, 'Trial-to-Member System');
  assert.equal(list.json.leads[0]['Facebook Link'], 'https://facebook.com/ironhaven');
});

test('POST rejects missing gym name and invalid enum values', async () => {
  fresh();
  assert.equal((await call(leadsHandler, 'POST', { lead: sample({ 'Gym Name': ' ' }) })).status, 400);
  const bad = await call(leadsHandler, 'POST', { lead: sample({ Package: 'Gold Plan' }) });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /not a valid Package/);
});

test('PATCH updates only the given cells and appends activity log rows', async () => {
  const fake = fresh();
  await call(leadsHandler, 'POST', { lead: sample() });
  const r = await call(leadsHandler, 'PATCH', {
    row: 2, expectGym: 'Iron Haven',
    updates: { Status: 'DM Sent', 'Last Contact Date': '2026-10-08' },
    log: [{ date: '2026-10-08', event: 'DM Sent', detail: 'DM 1' }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.logged, 1);
  const row = fake.__grids.get('Leads')[1];
  assert.equal(row[14], 'DM Sent');
  assert.equal(row[15], '2026-10-08');
  assert.equal(row[0], 'Iron Haven'); // untouched
  const act = fake.__grids.get('Activity')[1];
  assert.deepEqual(act.slice(1), ['2026-10-08', 'Iron Haven', 'Austin', 'DM Sent', 'DM 1']);
});

test('PATCH refuses to write when the row no longer matches (sheet re-sorted)', async () => {
  const fake = fresh();
  await call(leadsHandler, 'POST', { lead: sample() });
  const r = await call(leadsHandler, 'PATCH', { row: 2, expectGym: 'Someone Else', updates: { Status: 'Lost' } });
  assert.equal(r.status, 409);
  assert.equal(fake.__grids.get('Leads')[1][14], 'Warming');
});

test('write failures surface as errors (never a silent success) with a useful message', async () => {
  fresh({ failWrites: true });
  const r = await call(leadsHandler, 'POST', { lead: sample() });
  assert.equal(r.status, 500);
  assert.match(r.json.error, /permission denied/i);
  assert.match(r.json.error, /svc@example/);
});

test('/api/test: reads, writes and reads back; reports missing env vars', async () => {
  fresh();
  const ok = await call(testHandler, 'GET');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.deepEqual(ok.json.steps.map((s) => s.name), [
    'Environment variables present', 'Connect + prepare tabs/headers', 'Read leads', 'Write + read back',
  ]);
  const saved = process.env.GOOGLE_SHEET_ID;
  delete process.env.GOOGLE_SHEET_ID;
  const bad = await call(testHandler, 'GET');
  process.env.GOOGLE_SHEET_ID = saved;
  assert.equal(bad.status, 500);
  assert.match(bad.json.steps[0].detail, /GOOGLE_SHEET_ID/);
});
