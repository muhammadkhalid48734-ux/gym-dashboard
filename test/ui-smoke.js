// Optional browser smoke test (not part of `npm test`; needs `npm i -D playwright-core` + a Chromium).
// Run: CHROMIUM_PATH=/path/to/chrome node test/ui-smoke.js
// The page loads Tailwind from its CDN; if that is unreachable set TW_CSS=/path/to/built.css to inject equivalent styles.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { start } = require('./devServer.js');

(async () => {
  const { server, fake, port } = await start(0, { seed: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  if (process.env.TW_CSS) {
    const css = require('node:fs').readFileSync(process.env.TW_CSS, 'utf8');
    await page.route('**/cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` }));
  }
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tailwind|ERR_|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.tabs');
  const txt = () => page.innerText('body');
  const step = (m) => console.log('✓', m);
  const tab = async (k) => { await page.click(`[data-tab=${k}]`); await page.waitForSelector(`[data-tab=${k}].on`); };
  const grid = () => fake.__grids.get('Leads');
  const rowOf = (name) => grid().find((r) => r[0] === name);
  const view = page.locator('#view');
  const rowCard = (name) => page.locator('.lead-list > .card', { hasText: name });

  // ---- header + tabs
  let t = await txt();
  assert.match(t, /DMs sent today\s+0 \/ 20/); assert.match(t, /days left until Nov 3, 2026/); step('header: DM counter + deadline');
  const tabNames = await page.locator('.tab').allInnerTexts();
  assert.deepEqual(tabNames.map((x) => x.replace(/\s+\d+$/, '').trim()), ['Today', 'Warming', 'Follow-ups', 'Replies', 'All leads', 'Scripts']); step('tab menu: Today / Warming / Follow-ups / Replies / All leads / Scripts');
  assert.match(await page.innerText('[data-tab=warming]'), /2/); assert.match(await page.innerText('[data-tab=followups]'), /2/); assert.match(await page.innerText('[data-tab=replies]'), /1/); assert.match(await page.innerText('[data-tab=all]'), /5/); step('tab counts');

  // ---- Today (default) with its own sub-tabs
  const sub = page.locator('.subtab');
  assert.deepEqual((await sub.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()), ['Warm-up 1', 'Follow-ups 2', 'Price sent 1']); step('Today: sub-tabs Warm-up / Follow-ups / Price sent with counts');
  assert.match(await page.getAttribute('[data-dtab=warmup]', 'class'), /\bon\b/);
  let tv = await view.innerText();
  assert.match(tv, /Warm Ready/); assert.doesNotMatch(tv, /Day3 Gym/); assert.doesNotMatch(tv, /Price Quiet/); step('Today: default sub-tab shows only warm-up leads');
  await page.click('[data-dtab=followups]'); await page.waitForSelector('[data-dtab=followups].on');
  tv = await view.innerText();
  assert.match(tv, /Hey Sam, just floating this back up/); assert.doesNotMatch(tv, /Warm Ready/); step('Today › Follow-ups: Day 3 follow-up due (other groups hidden)');
  assert.match(tv, /Mark Lost/); step('Today › Follow-ups: 11+ day lead shows Mark Lost');
  await page.locator('[data-action=copy]').first().click();
  await page.waitForSelector('#toasts :text("Copied")'); step('copy toast');
  await view.locator('.card', { hasText: 'Day3 Gym' }).locator('button:text("Mark Sent")').click();
  await page.waitForSelector('#toasts :text("Day 3 follow-up marked sent")');
  assert.ok(fake.__grids.get('Activity').some((r) => r[2] === 'Day3 Gym' && r[4] === 'Follow-up'));
  assert.doesNotMatch(await view.innerText(), /Day3 Gym/); step('Today › Follow-ups: Mark Sent persists + logs');
  assert.match(await page.getAttribute('[data-dtab=followups]', 'class'), /\bon\b/); step('Today: stays on the Follow-ups sub-tab after an action');
  await view.locator('.card', { hasText: 'Old Silent' }).locator('button:text("Mark Lost")').click();
  await page.waitForSelector('#toasts :text("Marked Lost")');
  assert.equal(rowOf('Old Silent')[14], 'Lost'); step('Today › Follow-ups: Mark Lost');
  await page.click('[data-dtab=price]'); await page.waitForSelector('[data-dtab=price].on');
  assert.match(await view.innerText(), /If \$300 isn't right for now/); step('Today › Price sent: add-on quiet wording');

  // ---- Warming tab
  await tab('warming');
  t = await view.innerText();
  assert.match(t, /Real comments only — something specific about the post, not an emoji\./); assert.match(t, /Ready for DM 1/); assert.match(t, /only 1 touch so far/); step('Warming: reminder, ready badge, soft warning');
  const ready = view.locator('.card', { hasText: 'Warm Ready' });
  const fresh = view.locator('.card', { hasText: 'Warm Fresh' });
  assert.ok((await view.locator('.card .entry-name').allInnerTexts())[0] === 'Warm Ready'); step('Warming: ready leads listed first');
  await ready.locator('button:text("Preview DM 1")').click();
  assert.match(await ready.innerText(), /Hey Sam! Saw Warm Ready's page/); assert.equal(rowOf('Warm Ready')[14], 'Warming'); step('Warming: Preview DM 1 shows the text without changing status');
  await fresh.locator('button:text("+1 Touch")').click();
  await page.waitForSelector('#toasts :text("Touch #2 saved")');
  assert.equal(rowOf('Warm Fresh')[18], 2); step('Warming: +1 Touch persisted');
  await ready.locator('button:text("Send DM 1")').click();
  await page.waitForSelector('#toasts :text("DM Sent")');
  assert.equal(rowOf('Warm Ready')[14], 'DM Sent');
  const dmText = await ready.innerText();
  assert.match(dmText, /Hey Sam! Saw Warm Ready's page/); assert.doesNotMatch(dmText, /Trial-to-Member/);
  assert.match(await page.innerText('#dm-counter'), /1 \/ 20/); step('Warming: Send DM 1 → DM Sent, plain text (no product name), counter = 1');
  await page.fill('#q', 'fresh');
  assert.deepEqual(await view.locator('.card .entry-name').allInnerTexts(), ['Warm Fresh']); step('Warming: search filters the list');
  await page.fill('#q', '');
  await page.dispatchEvent('#q', 'input');

  // ---- Follow-ups tab
  await tab('followups');
  t = await view.innerText();
  assert.match(t, /due now/i); assert.match(t, /waiting/i); assert.match(t, /Warm Ready/); assert.match(t, /Next: Day 3 follow-up in 3d/); step('Follow-ups: due now + waiting with next-follow-up countdown');

  // ---- Replies tab
  await tab('replies');
  t = await view.innerText();
  assert.match(t, /Price Quiet/); assert.match(t, /Quiet 3\+ days/); step('Replies: price-sent lead shown with quiet flag');
  await rowCard('Price Quiet').locator('button:text("Log Reply")').click();
  const modal = page.locator('[role=dialog]');
  await modal.locator('button', { hasText: 'Manually / no system' }).click();
  let m = await modal.innerText();
  assert.match(m, /Oh interesting/); assert.doesNotMatch(m, /Trial-to-Member System — mind if I send/); step('Reply handler: manual step 1 only');
  await modal.locator('button:text("Show Step 2")').click();
  assert.match(await modal.innerText(), /I built something for this called the Trial-to-Member System — mind if I send a 2-min video showing how it works\?/); step('Reply handler: step 2 with product name');
  await modal.locator('button', { hasText: 'Interested after the video — Follow-up Add-on' }).click();
  m = await modal.innerText();
  assert.match(m, /The Follow-up Add-on is \$300 one-time/); assert.match(m, /matches package/);
  await modal.locator('[data-action=applyReply]').click();
  await page.waitForSelector('#toasts :text("Status → Price Sent")');
  assert.equal(rowOf('Price Quiet')[14], 'Price Sent'); assert.equal(rowOf('Price Quiet')[19], 'Follow-up Add-on'); step('Reply handler: add-on price → Price Sent');
  await modal.locator('button:text("Close")').click();

  // ---- All leads tab
  await tab('all');
  await rowCard('Warm Fresh').locator('button:text("Log Reply")').click();
  assert.equal(await modal.locator('button', { hasText: 'Went quiet after price' }).isDisabled(), true); step('Reply handler: "Went quiet" disabled unless Price Sent + 3 days');
  await modal.locator('button', { hasText: 'Said yes, send the video' }).click();
  m = await modal.innerText();
  assert.match(m, /Walk through the Trial-to-Member System/); assert.match(m, /1% trial-booking rate is 42 leads/); assert.match(m, /Never mention price/); step('Reply handler: video → Loom checklist, [X]=42');
  await modal.locator('button:text("Close")').click();
  await rowCard('Warm Ready').locator('button:text("Log Reply")').click();
  await modal.locator('button', { hasText: 'They already use Mindbody' }).click();
  m = await modal.innerText();
  assert.match(m, /Instruction: Ask whether the booked person gets an automatic reminder/); assert.match(m, /Nice — does the person who books/);
  await modal.locator('button', { hasText: 'NO automatic follow-up' }).click();
  assert.match(await modal.innerText(), /I have a Follow-up Add-on that plugs into what you already use/);
  await modal.locator('[data-action=applyReply]').click();
  await page.waitForSelector('#toasts :text("Status → Replied")');
  assert.equal(rowOf('Warm Ready')[19], 'Follow-up Add-on'); step('Reply handler: platform branch sets Package = Follow-up Add-on');
  await modal.locator('button:text("Close")').click();
  await rowCard('Warm Ready').locator('[data-action=toggleRow]').click();
  assert.equal((await rowCard('Warm Ready').locator('.lbl').allInnerTexts()).length, 20); step('expanded row shows all 20 fields');
  await rowCard('Warm Ready').locator('select[data-field-select=Package]').selectOption('Skip');
  await page.waitForSelector('#toasts :text("Package saved")');
  assert.equal(rowOf('Warm Ready')[19], 'Skip'); step('Package override persisted');
  await rowCard('Warm Fresh').locator('button:text("Edit Notes")').click();
  await page.fill('#notes-text', 'uses Glofox for booking');
  await modal.locator('button:text("Save notes")').click();
  await page.waitForSelector('#toasts :text("Notes saved")');
  assert.equal(rowOf('Warm Fresh')[16], 'uses Glofox for booking'); step('Edit Notes persisted');
  await page.selectOption('[data-filter=city]', 'Dallas');
  const names = await page.locator('.lead-list > .card .entry-name').allInnerTexts();
  assert.ok(names.length && names.every((n) => /Warm Fresh|Price Quiet/.test(n)), names.join('|')); step('city filter');
  await page.selectOption('[data-filter=city]', '');
  await rowCard('Warm Fresh').locator('button:text("Copy follow-up")').click();
  await page.waitForSelector('#toasts :text("Copied: DM 1")'); step('Copy follow-up (warming → DM 1)');

  // ---- Scripts tab
  await tab('scripts');
  t = await view.innerText();
  assert.match(t, /Hey \[owner\]! Saw \[gym\]'s page, love the energy\. Quick question — when someone asks about your free trial/); assert.match(t, /day 3/i); assert.match(t, /The Follow-up Add-on is \$300 one-time/); assert.match(t, /Never mention price/); step('Scripts tab: DM 1 variants, follow-ups, replies, Loom');

  // ---- pipeline pills jump to the right tab
  await tab('today');
  await page.click('.pipe-pill:has-text("Warming")'); await page.waitForSelector('[data-tab=warming].on'); step('pipeline: Warming pill → Warming tab');
  await tab('today');
  await page.click('.pipe-pill:has-text("Price Sent")'); await page.waitForSelector('[data-tab=all].on');
  assert.equal(await page.inputValue('[data-filter=status]'), 'Price Sent'); step('pipeline: Price Sent pill → All leads filtered');
  await page.selectOption('[data-filter=status]', '');

  // ---- Add lead
  await page.click('.topbar [data-action=openAdd]');
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('[name="Gym Name"]', 'Brand New Fitness');
  await page.fill('[name="City"]', 'Houston');
  await page.fill('[name="Owner Name"]', 'Jo');
  await page.fill('[name="Instagram Link"]', '@brandnew');
  await page.fill('[name="Followers"]', '12.5k');
  await page.fill('[name="Last Post Date"]', today);
  await page.selectOption('[name="Current Offer"]', 'Paid Intro');
  await page.selectOption('[name="Website Quality"]', 'Modern');
  await page.selectOption('[name="Has Booking Form"]', 'Yes');
  await page.selectOption('[name="Has Follow-up Automation"]', 'No');
  assert.equal(await page.inputValue('[name=Priority]'), 'High');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on');
  assert.match(await page.innerText('#package-hint'), /Follow-up Add-on — \$250-300 \(confirmation \+ reminder \+ follow-up only\)/); step('add form: suggests High + Follow-up Add-on label');
  await page.fill('[name="Notes"]', 'they use Mindbody');
  assert.equal(await page.inputValue('[name=Priority]'), 'Low'); assert.equal(await page.inputValue('[name=Package]'), 'Skip'); step('notes mention Mindbody → Low + Skip');
  await page.selectOption('[name=Package]', 'Follow-up Add-on');
  await page.fill('[name="Notes"]', 'they use Mindbody!');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on'); step('manual override not clobbered');
  await page.click('#add-submit');
  await page.waitForSelector('#toasts :text("added to Sheet")');
  const nr = rowOf('Brand New Fitness');
  assert.equal(nr[2], 'https://instagram.com/brandnew'); assert.equal(nr[3], 12500); assert.equal(nr[14], 'Warming'); assert.equal(nr[17], today); assert.equal(nr[18], 0); assert.equal(nr[19], 'Follow-up Add-on'); step('lead appended: Warming, started today, touches 0, Package saved');

  // ---- misc
  await page.click('.topbar [data-action=openLoom]');
  assert.match(await modal.innerText(), /If the Trial-to-Member System looks useful, reply and I'll walk you through pricing\./); step('Loom panel');
  await modal.locator('button:text("Close")').click();
  await page.click('.topbar [data-action=openTest]');
  await page.waitForSelector('text=All good — read and write both work.'); step('Test Sheet button');
  await modal.locator('button:text("Close")').click();
  for (const k of ['today', 'warming', 'followups', 'replies', 'all', 'scripts']) {
    await tab(k);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 392, `horizontal overflow on ${k}: ${sw}`);
  }
  step('no horizontal scroll at 390px on any tab');
  await tab('warming');
  await page.reload(); await page.waitForSelector('[data-tab=warming].on'); step('tab survives reload (#warming)');
  const act = fake.__grids.get('Activity');
  for (let i = 0; i < 19; i++) act.push([new Date().toISOString(), today, `Fake ${i}`, 'X', 'DM Sent', '']);
  await page.click('.topbar [data-action=refresh]');
  await page.waitForSelector('#dm-counter:has-text("20 / 20")');
  assert.match(await txt(), /Daily cap reached/); step('cap warning at 20');
  // ---- desktop width: tabs must be visible AND clickable (real hit-testing), search box beside them
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const dp = await dctx.newPage();
  if (process.env.TW_CSS) {
    const css = require('node:fs').readFileSync(process.env.TW_CSS, 'utf8');
    await dp.route('**/cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` }));
  }
  await dp.goto(`http://localhost:${port}/`);
  await dp.waitForSelector('.tabs', { state: 'attached' });
  assert.ok((await dp.locator('.tabs').boundingBox()).width > 400, 'tab bar collapsed on desktop');
  for (const k of ['warming', 'followups', 'replies', 'all', 'scripts', 'today']) {
    await dp.click(`[data-tab=${k}]`); // fails if something covers the tab
    await dp.waitForSelector(`[data-tab=${k}].on`);
  }
  await dp.click('[data-tab=all]');
  assert.ok((await dp.locator('#q').boundingBox()).width > 150); step('desktop 1280px: tabs clickable, search box beside them');
  await dctx.close();
  assert.deepEqual(errs, [], 'console errors: ' + errs.join(' | '));
  await browser.close(); server.close();
  console.log('ALL UI CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
