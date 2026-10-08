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
  const rowCard = (name) => page.locator('.lead-list > .row', { hasText: name });

  // ---- header + tabs
  let t = await txt();
  assert.match(t, /DMs sent today\s+0 \/ 20/); assert.match(t, /days left until Nov 3, 2026/); step('header: DM counter + deadline');
  const tabNames = await page.locator('.tab').allInnerTexts();
  assert.deepEqual(tabNames.map((x) => x.replace(/\s+\d+$/, '').trim()), ['Today', 'DM Queue', 'Warming', 'Follow-ups', 'Replies', 'All leads', 'Scripts']); step('tab menu: Today / DM Queue / Warming / Follow-ups / Replies / All leads / Scripts');
  assert.match(await page.innerText('[data-tab=queue]'), /1/); assert.match(await page.innerText('[data-tab=warming]'), /2/); assert.match(await page.innerText('[data-tab=followups]'), /2/); assert.match(await page.innerText('[data-tab=replies]'), /1/); assert.match(await page.innerText('[data-tab=all]'), /5/); step('tab counts');

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
  assert.match(await view.locator('.card', { hasText: 'Day3 Gym' }).locator('.acct-flag').innerText(), /Account 1/); step('Today › Follow-ups: card shows which account to send from');
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
  assert.equal(await ready.locator('a.pill-link').count(), 2);
  assert.equal(await ready.locator('a.pill-link', { hasText: 'Facebook' }).getAttribute('href'), 'https://facebook.com/warmready');
  assert.equal(await view.locator('.card', { hasText: 'Warm Fresh' }).locator('a.pill-link', { hasText: 'Facebook' }).count(), 0); step('Warming: Instagram + Facebook buttons side by side (Facebook only when a link exists)');
  const fresh = view.locator('.card', { hasText: 'Warm Fresh' });
  assert.ok((await view.locator('.card .entry-name').allInnerTexts())[0] === 'Warm Ready'); step('Warming: ready leads listed first');
  assert.match(await ready.locator('.acct-flag').innerText(), /Account 1/); assert.match(await view.locator('.card', { hasText: 'Warm Fresh' }).locator('.acct-flag').innerText(), /Account 2/);
  assert.match(await ready.getAttribute('class'), /acct-1/); step('Warming: every card shows its account on top (Account 1 / Account 2)');
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
  assert.equal(rowOf('Warm Ready')[21], 'Account 1');
  assert.ok(fake.__grids.get('Activity').some((r) => r[2] === 'Warm Ready' && r[4] === 'DM Sent' && /Account 1/.test(r[5])));
  assert.match(await page.innerText('#dm-counter'), /Account 1\s+1\/10/); assert.match(await page.innerText('#dm-counter'), /Account 2\s+0\/10/); step('Warming: first DM is assigned to Account 1 (Sheet + log + header counters)');
  await page.fill('#q', 'fresh');
  assert.deepEqual(await view.locator('.card .entry-name').allInnerTexts(), ['Warm Fresh']); step('Warming: search filters the list');
  await page.fill('#q', '');
  await page.dispatchEvent('#q', 'input');

  // ---- Follow-ups tab
  await tab('followups');
  t = await view.innerText();
  assert.match(t, /due now/i); assert.match(t, /waiting/i); assert.match(t, /Warm Ready/); assert.match(t, /Account 1/); assert.match(t, /Day 3 follow-up in 3d/); step('Follow-ups: due now + waiting with next-follow-up countdown');

  // ---- Replies tab
  await tab('replies');
  t = await view.innerText();
  assert.match(t, /Price Quiet/); assert.match(t, /Quiet for 3\+ days/); step('Replies: price-sent lead shown with quiet flag');
  await rowCard('Price Quiet').locator('button:text("Log Reply")').click();
  const modal = page.locator('[role=dialog]');
  await modal.locator('button', { hasText: 'Manually / no system' }).click();
  let m = await modal.innerText();
  assert.match(m, /Oh interesting/); assert.doesNotMatch(m, /Trial-to-Member System — mind if I send/); step('Reply handler: manual step 1 only');
  await modal.locator('button:text("Show Step 2")').click();
  assert.match(await modal.innerText(), /I built something for this called the Trial-to-Member System — mind if I send a 2-min video showing how it works\?/); step('Reply handler: step 2 with product name');
  await modal.locator('button', { hasText: 'Interested after the video: Follow-up Add-on' }).click();
  m = await modal.innerText();
  assert.match(m, /The Follow-up Add-on is \$300 one-time/); assert.match(m, /matches the package/);
  await modal.locator('[data-action=applyReply]').click();
  await page.waitForSelector('#toasts :text("Status set to Price Sent")');
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
  await page.waitForSelector('#toasts :text("Status set to Replied")');
  assert.equal(rowOf('Warm Ready')[19], 'Follow-up Add-on'); step('Reply handler: platform branch sets Package = Follow-up Add-on');
  await modal.locator('button:text("Close")').click();
  await rowCard('Warm Ready').locator('[data-action=toggleRow]').click();
  assert.equal((await rowCard('Warm Ready').locator('.lbl').allInnerTexts()).length, 22); step('expanded row shows all 22 fields (incl. Facebook Link, DM Account)');
  await rowCard('Warm Ready').locator('select[data-field-select=Package]').selectOption('Skip');
  await page.waitForSelector('#toasts :text("Package saved")');
  assert.equal(rowOf('Warm Ready')[19], 'Skip'); step('Package override persisted');
  await rowCard('Warm Fresh').locator('button:text("Edit Notes")').click();
  await page.fill('#notes-text', 'uses Glofox for booking');
  await modal.locator('button:text("Save notes")').click();
  await page.waitForSelector('#toasts :text("Notes saved")');
  assert.equal(rowOf('Warm Fresh')[16], 'uses Glofox for booking'); step('Edit Notes persisted');
  await page.selectOption('[data-filter=city]', 'Dallas');
  const names = await page.locator('.lead-list > .row .entry-name').allInnerTexts();
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
  await page.fill('[name="Facebook Link"]', 'brandnewfitness');
  await page.fill('[name="Followers"]', '12.5k');
  await page.fill('[name="Last Post Date"]', today);
  await page.selectOption('[name="Current Offer"]', 'Paid Intro');
  await page.selectOption('[name="Website Quality"]', 'Modern');
  await page.selectOption('[name="Has Booking Form"]', 'Yes');
  await page.selectOption('[name="Has Follow-up Automation"]', 'No');
  assert.equal(await page.inputValue('[name=Priority]'), 'High');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on');
  assert.match(await page.innerText('#package-hint'), /Follow-up Add-on — \$250-300 \(confirmation \+ reminder \+ follow-up only\)/); step('add form: suggests High + Follow-up Add-on label');
  assert.equal(await page.inputValue('[name="DM Account"]'), 'Account 1'); step('add form: Account prefilled (continues the 10 / 10 pattern)');
  await page.fill('[name="Notes"]', 'they use Mindbody');
  assert.equal(await page.inputValue('[name=Priority]'), 'Low'); assert.equal(await page.inputValue('[name=Package]'), 'Skip'); step('notes mention Mindbody → Low + Skip');
  await page.selectOption('[name=Package]', 'Follow-up Add-on');
  await page.fill('[name="Notes"]', 'they use Mindbody!');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on'); step('manual override not clobbered');
  await page.click('#add-submit');
  await page.waitForSelector('#toasts :text("added to Sheet")');
  const nr = rowOf('Brand New Fitness');
  assert.equal(nr[2], 'https://instagram.com/brandnew'); assert.equal(nr[20], 'https://facebook.com/brandnewfitness'); assert.equal(nr[21], 'Account 1'); assert.equal(nr[3], 12500); assert.equal(nr[14], 'Warming'); assert.equal(nr[17], today); assert.equal(nr[18], 0); assert.equal(nr[19], 'Follow-up Add-on'); step('lead appended: Warming, started today, touches 0, Package saved');

  // ---- misc
  assert.equal(await page.locator('.topbar [data-action=openLoom]').isVisible(), false); step('phone: Loom button is hidden to save room (the script lives in the Scripts tab)');
  await page.click('.topbar [data-action=openTest]');
  await page.waitForSelector('text=All good: read and write both work.'); step('Test Sheet button');
  await modal.locator('button:text("Close")').click();
  for (const k of ['today', 'queue', 'warming', 'followups', 'replies', 'all', 'scripts']) {
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
  // ---- DM Queue: 25 ready leads split 10 / 10 across the two accounts
  {
    const q = await start(0, { seedQueue: 25 });
    const qp = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    if (process.env.TW_CSS) {
      const css = require('node:fs').readFileSync(process.env.TW_CSS, 'utf8');
      await qp.route('**/cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` }));
    }
    await qp.goto(`http://localhost:${q.port}/#queue`);
    await qp.waitForSelector('[data-tab=queue].on');
    const panels = qp.locator('.qpanel');
    assert.equal(await panels.count(), 2);
    const nm = async (i) => (await panels.nth(i).locator('.entry-name').allInnerTexts());
    const a1 = await nm(0); const a2 = await nm(1);
    assert.equal(a1.length, 10); assert.equal(a2.length, 10);
    assert.equal(a1[0], 'Queue 01'); assert.equal(a1[9], 'Queue 10'); assert.equal(a2[0], 'Queue 11'); assert.equal(a2[9], 'Queue 20');
    assert.match(await qp.innerText('#view'), /5 more wait for tomorrow/); step('DM Queue: first 10 → Account 1, next 10 → Account 2, 5 wait for tomorrow');
    assert.equal(await panels.nth(0).locator('a.pill-link').count(), 20); step('DM Queue: Instagram + Facebook buttons on every entry');
    await panels.nth(0).locator('.card', { hasText: 'Queue 01' }).locator('button:text("Mark sent")').click();
    await qp.waitForSelector('#toasts :text("sent from Account 1")');
    const g = q.fake.__grids.get('Leads');
    assert.equal(g.find((r) => r[0] === 'Queue 01')[21], 'Account 1'); assert.equal(g.find((r) => r[0] === 'Queue 01')[14], 'DM Sent');
    assert.deepEqual(await nm(0), a1.slice(1)); assert.deepEqual(await nm(1), a2); step('DM Queue: sending from Account 1 shifts only that list; Account 2 is untouched');
    await panels.nth(1).locator('.card', { hasText: 'Queue 11' }).locator('button:text("Mark sent")').click();
    await qp.waitForSelector('#toasts :text("sent from Account 2")');
    assert.equal(g.find((r) => r[0] === 'Queue 11')[21], 'Account 2');
    assert.deepEqual(await nm(1), a2.slice(1));
    let hc = await qp.innerText('#dm-counter');
    assert.match(hc, /2 \/ 20/); assert.match(hc, /Account 1\s+1\/10/); assert.match(hc, /Account 2\s+1\/10/); step('Header counters: 2 / 20 with Account 1 1/10 and Account 2 1/10');
    for (let i = 0; i < 9; i++) { // finish Account 1's ten
      await panels.nth(0).locator('button:text("Mark sent")').first().click();
      await qp.waitForFunction((n) => document.querySelectorAll('.qpanel')[0].querySelectorAll('.entry-name').length === n, 8 - i);
    }
    await qp.waitForFunction(() => /Account 1 is done for today/.test(document.querySelector('#view').innerText));
    assert.equal((await nm(0)).length, 0); assert.equal((await nm(1)).length, 9); step('DM Queue: Account 1 done at 10/10 → its list is replaced by "done for today"; Account 2 keeps its list');
    hc = await qp.innerText('#dm-counter');
    assert.match(hc, /Account 1\s+10\/10/);
    await qp.click('[data-tab=followups]');
    assert.match(await qp.innerText('#view'), /Account 1/); step('Follow-ups show which account sent DM 1');
    await qp.close(); q.server.close();
  }

  // ---- DM Queue with accounts already assigned in the Sheet (blocks of 10): each list holds that account's own leads
  {
    const q = await start(0, { seedQueue: 30, assign: true });
    const qp = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await qp.goto(`http://localhost:${q.port}/#queue`);
    await qp.waitForSelector('[data-tab=queue].on');
    const panels = qp.locator('.qpanel');
    const nm = async (i) => (await panels.nth(i).locator('.entry-name').allInnerTexts());
    const a1 = await nm(0); const a2 = await nm(1);
    assert.equal(a1[0], 'Queue 01'); assert.equal(a1[9], 'Queue 10'); assert.equal(a2[0], 'Queue 11'); assert.equal(a2[9], 'Queue 20');
    assert.match(await qp.innerText('#view'), /10 more wait for tomorrow/); step('DM Queue (assigned): Queue 01-10 → Account 1, 11-20 → Account 2, 21-30 wait for tomorrow');
    assert.equal(await panels.nth(0).locator('.acct-flag.a1').count(), 10); assert.equal(await panels.nth(1).locator('.acct-flag.a2').count(), 10); step('DM Queue: every card carries its account flag');
    await qp.click('[data-tab=all]');
    assert.equal(await qp.locator('.lead-list > .row').count(), 20); assert.equal(await qp.locator('.lead-list > .row.acct-1').count(), 10); assert.equal(await qp.locator('.lead-list > .row.acct-2').count(), 10); step('All leads: rows show their account; first page is 20 rows');
    await qp.click('[data-action=showMore][data-key=all]');
    assert.equal(await qp.locator('.lead-list > .row').count(), 30); assert.equal(await qp.locator('[data-action=showMore]').count(), 0); step('All leads: "Show more" reveals the rest (30 rows) and then goes away');
    await qp.close(); q.server.close();
  }

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
  for (const k of ['queue', 'warming', 'followups', 'replies', 'all', 'scripts', 'today']) {
    await dp.click(`[data-tab=${k}]`); // fails if something covers the tab
    await dp.waitForSelector(`[data-tab=${k}].on`);
  }
  await dp.click('.topbar [data-action=openLoom]');
  assert.match(await dp.innerText('.sheet'), /If the Trial-to-Member System looks useful, reply and I'll walk you through pricing\./); step('desktop: Loom script modal');
  await dp.keyboard.press('Escape');
  await dp.click('[data-tab=all]');
  assert.ok((await dp.locator('#q').boundingBox()).width > 150); step('desktop 1280px: tabs clickable, search box under them');
  await dctx.close();
  assert.deepEqual(errs, [], 'console errors: ' + errs.join(' | '));
  await browser.close(); server.close();
  console.log('ALL UI CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
