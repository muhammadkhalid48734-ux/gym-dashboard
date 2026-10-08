// Local mock server: serves public/ and the real /api handlers on top of an in-memory fake Sheet.
// `npm run dev:mock` (add SEED=1 for sample leads). Used by the browser smoke test; also handy for
// poking at the UI without Google credentials.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSheets } = require('./fakeSheets');
const sheets = require('../api/_lib/sheets');
const { HEADERS } = require('../api/_lib/schema');
const leads = require('../api/leads');
const testApi = require('../api/test');
const L = require('../public/logic');

process.env.GOOGLE_SHEET_ID = 'mock';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'mock@example.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'mock';

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return L.todayISO(d);
}

function seed(fake) {
  fake.__grids.get('Leads')[0] = HEADERS;
  const row = (o) => HEADERS.map((h) => (o[h] === undefined ? '' : o[h]));
  const base = { City: 'Austin', 'Owner Name': 'Sam', Followers: 4200, 'Website Quality': 'Outdated', 'Has Booking Form': 'Yes',
    'Has Follow-up Automation': 'No', 'Current Offer': 'Free Trial', Priority: 'High', 'Instagram Link': 'https://instagram.com/x' };
  base['Facebook Link'] = '';
  const add = (o) => fake.__grids.get('Leads').push(row({ ...base, ...o }));
  add({ 'Gym Name': 'Warm Ready', 'Facebook Link': 'https://facebook.com/warmready', Status: 'Warming', 'Engagement Started': daysAgo(3), 'Engagement Touches': 3, 'Last Contact Date': daysAgo(1), Package: 'Trial-to-Member System' });
  add({ 'Gym Name': 'Warm Fresh', City: 'Dallas', Status: 'Warming', 'Engagement Started': daysAgo(0), 'Engagement Touches': 1, 'Last Contact Date': L.todayISO(), Package: 'Trial-to-Member System' });
  add({ 'Gym Name': 'Day3 Gym', Status: 'DM Sent', 'Last Contact Date': daysAgo(3), 'Website Quality': 'Modern', Package: 'Follow-up Add-on' });
  add({ 'Gym Name': 'Price Quiet', City: 'Dallas', Status: 'Price Sent', 'Last Contact Date': daysAgo(4), Package: 'Follow-up Add-on', 'Website Quality': 'Modern' });
  add({ 'Gym Name': 'Old Silent', Status: 'DM Sent', 'Last Contact Date': daysAgo(12), Priority: 'Low' });
  const act = fake.__grids.get('Activity');
  act[0] = ['Timestamp', 'Date', 'Gym', 'City', 'Event', 'Detail'];
  act.push([new Date().toISOString(), daysAgo(3), 'Day3 Gym', 'Austin', 'DM Sent', 'DM 1']);
  act.push([new Date().toISOString(), daysAgo(12), 'Old Silent', 'Austin', 'DM Sent', 'DM 1']);
}

function start(port = Number(process.env.PORT) || 3000, opts = {}) {
  const fake = createFakeSheets({ tabs: ['Leads', 'Activity'], failWrites: !!opts.failWrites });
  if (process.env.SEED === '1' || opts.seed) seed(fake);
  sheets.__setSheetsForTests(fake);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString();
      req.body = raw ? JSON.parse(raw) : undefined;
      if (url.pathname === '/api/leads') return leads(req, res);
      if (url.pathname === '/api/test') return testApi(req, res);
      res.statusCode = 404; return res.end('{}');
    }
    const file = path.join(__dirname, '..', 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('not found'); }
      const ext = path.extname(file);
      res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript' }[ext] || 'text/plain');
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, fake, port: server.address().port })));
}

if (require.main === module) start().then(({ port }) => console.log(`Mock dashboard on http://localhost:${port}`));
module.exports = { start };
