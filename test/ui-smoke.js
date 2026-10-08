// Optional browser smoke test (not part of `npm test`; needs `npm i -D playwright-core` + a Chromium).
// Run: CHROMIUM_PATH=/path/to/chrome node test/ui-smoke.js
// The page loads Tailwind from its CDN; offline the checks still pass, the page is just unstyled.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { start } = require('./devServer.js');

(async () => {
  const { server, fake, port } = await start(0, { seed: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tailwind|ERR_|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
  const url = `http://localhost:${port}/`;
  await page.goto(url);
  await page.waitForSelector('text=Due today');
  const txt = () => page.innerText('body');
  const step = (m) => console.log('✓', m);

  // header
  let t = await txt();
  assert.match(t, /DMs sent today: 0 \/ 20/); assert.match(t, /days left until Nov 3, 2026/); step('header counter + deadline');
  // Due today
  assert.match(t, /Hey Sam, just floating this back up/); step('Day 3 follow-up due');
  assert.match(t, /If \$300 isn't right for now/); step('price-quiet uses add-on wording for add-on lead');
  assert.match(t, /Mark Lost/); step('11+ day lead shows Mark Lost');
  assert.match(t, /Real comments only — something specific about the post, not an emoji\./); step('warm-up reminder');
  assert.match(t, /Ready for DM 1/); step('ready badge');
  assert.match(t, /only 1 touch so far/); step('soft warning');

  // copy
  await page.locator('[data-action=copy]').first().click();
  await page.waitForSelector('#toasts :text("Copied")'); step('copy toast');

  // +1 Touch on Warm Fresh (Warming panel)
  const card = page.locator('section:has(h2:text("Warming")) div.bg-white', { hasText: 'Warm Fresh' });
  await card.locator('button:text("+1 Touch")').click();
  await page.waitForSelector('#toasts :text("Touch #2 saved")');
  const grid = () => fake.__grids.get('Leads');
  const rowOf = (name) => grid().find((r) => r[0] === name);
  assert.equal(rowOf('Warm Fresh')[18], 2); step('+1 Touch persisted to Sheet (touches=2)');

  // Send DM 1 on Warm Ready -> status DM Sent, text + copy shown, counter 1
  const ready = page.locator('section:has(h2:text("Warming")) div.bg-white', { hasText: 'Warm Ready' });
  await ready.locator('button:text("Send DM 1")').click();
  await page.waitForSelector('#toasts :text("DM Sent")');
  assert.equal(rowOf('Warm Ready')[14], 'DM Sent');
  assert.match(await ready.innerText(), /Hey Sam! Saw Warm Ready's page/);
  assert.match(await page.innerText('#dm-counter'), /1 \/ 20/);
  assert.doesNotMatch(await ready.innerText(), /Trial-to-Member/); step('Send DM 1 → DM Sent, plain DM text (no product name), counter = 1');

  // Mark Sent Day 3 follow-up
  const due = page.locator('section:has(h2:text("Due today"))');
  await due.locator('div.bg-white', { hasText: 'Day3 Gym' }).locator('button:text("Mark Sent")').click();
  await page.waitForSelector('#toasts :text("Day 3 follow-up marked sent")');
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(fake.__grids.get('Activity').some((r) => r[2] === 'Day3 Gym' && r[4] === 'Follow-up'));
  assert.doesNotMatch(await due.innerText(), /Day3 Gym/); step('follow-up marked sent, leaves Due Today, logged');

  // Mark Lost
  await due.locator('div.bg-white', { hasText: 'Old Silent' }).locator('button:text("Mark Lost")').click();
  await page.waitForSelector('#toasts :text("Marked Lost")');
  assert.equal(rowOf('Old Silent')[14], 'Lost'); step('Mark Lost');

  // Reply handler: manual (two-step)
  const rowCard = (name) => page.locator('section:has(h2:text("All leads")) > div.space-y-2 > div', { hasText: name });
  await rowCard('Price Quiet').locator('button:text("Log Reply")').click();
  const modal = page.locator('[role=dialog]');
  await modal.locator('button', { hasText: 'Manually / no system' }).click();
  let m = await modal.innerText();
  assert.match(m, /Oh interesting/); assert.doesNotMatch(m, /Trial-to-Member System — mind if I send/); step('manual: step 1 only, step 2 hidden');
  await modal.locator('button:text("Show Step 2")').click();
  m = await modal.innerText();
  assert.match(m, /I built something for this called the Trial-to-Member System — mind if I send a 2-min video showing how it works\?/); step('manual: step 2 revealed with product name');
  // price options: add-on lead -> addon matches
  await modal.locator('button', { hasText: 'Interested after the video — Follow-up Add-on' }).click();
  m = await modal.innerText();
  assert.match(m, /The Follow-up Add-on is \$300 one-time/); assert.match(m, /matches package/);
  await modal.locator('[data-action=applyReply]').click();
  await page.waitForSelector('#toasts :text("Status → Price Sent")');
  assert.equal(rowOf('Price Quiet')[14], 'Price Sent'); assert.equal(rowOf('Price Quiet')[19], 'Follow-up Add-on'); step('add-on price message → Price Sent, package unchanged');
  await modal.locator('button:text("Close")').click();

  // quiet option disabled when not 3 days
  await rowCard('Warm Fresh').locator('button:text("Log Reply")').click();
  assert.equal(await modal.locator('button', { hasText: 'Went quiet after price' }).isDisabled(), true); step('"Went quiet" disabled unless Price Sent + 3 days');
  await modal.locator('button', { hasText: 'Said yes, send the video' }).click();
  m = await modal.innerText();
  assert.match(m, /Walk through the Trial-to-Member System/); assert.match(m, /1% trial-booking rate is 42 leads/); assert.match(m, /Never mention price/); step('video → Loom checklist with [X]=42');
  await modal.locator('button:text("Close")').click();

  // Platform branch
  await rowCard('Warm Ready').locator('button:text("Log Reply")').click();
  await modal.locator('button', { hasText: 'They already use Mindbody' }).click();
  m = await modal.innerText();
  assert.match(m, /Instruction: Ask whether the booked person gets an automatic reminder/); assert.match(m, /Nice — does the person who books/);
  await modal.locator('button', { hasText: 'NO automatic follow-up' }).click();
  assert.match(await modal.innerText(), /I have a Follow-up Add-on that plugs into what you already use/);
  await modal.locator('[data-action=applyReply]').click();
  await page.waitForSelector('#toasts :text("Status → Replied")');
  assert.equal(rowOf('Warm Ready')[19], 'Follow-up Add-on'); step('platform branch: Add-on message, sets Package = Follow-up Add-on');
  await modal.locator('button:text("Close")').click();

  // Table: expand shows 20 fields; edit package select
  await rowCard('Warm Ready').locator('[data-action=toggleRow]').click();
  const labels = await rowCard('Warm Ready').locator('.lbl').allInnerTexts();
  assert.equal(labels.length, 20); step('expanded row shows all 20 fields');
  await rowCard('Warm Ready').locator('select[data-field-select=Package]').selectOption('Skip');
  await page.waitForSelector('#toasts :text("Package saved")');
  assert.equal(rowOf('Warm Ready')[19], 'Skip'); step('Package override from table persisted');

  // Edit notes
  await rowCard('Warm Fresh').locator('button:text("Edit Notes")').click();
  await page.fill('#notes-text', 'uses Glofox for booking');
  await modal.locator('button:text("Save notes")').click();
  await page.waitForSelector('#toasts :text("Notes saved")');
  assert.equal(rowOf('Warm Fresh')[16], 'uses Glofox for booking'); step('Edit Notes persisted');

  // Filters
  await page.selectOption('[data-filter=city]', 'Dallas');
  let names = await page.locator('section:has(h2:text("All leads")) > div.space-y-2 > div .font-bold').allInnerTexts();
  assert.ok(names.length && names.every((n) => /Warm Fresh|Price Quiet/.test(n)), names.join('|')); step('city filter');
  await page.selectOption('[data-filter=city]', '');

  // Copy follow-up
  await rowCard('Warm Fresh').locator('button:text("Copy follow-up")').click();
  await page.waitForSelector('#toasts :text("Copied: DM 1")'); step('Copy follow-up (warming → DM 1)');

  // Add lead
  await page.click('button:text("+ Add Lead")');
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
  assert.equal(await page.inputValue('[name=Priority]'), 'Low');
  assert.equal(await page.inputValue('[name=Package]'), 'Skip');
  assert.match(await page.innerText('#package-hint'), /Skip or deprioritize/); step('notes mention Mindbody → Low + Skip');
  await page.selectOption('[name=Package]', 'Follow-up Add-on'); // manual override sticks
  await page.fill('[name="Notes"]', 'they use Mindbody!');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on'); step('manual override is not clobbered');
  await page.selectOption('[name="Website Quality"]', 'None');
  assert.equal(await page.inputValue('[name=Package]'), 'Follow-up Add-on');
  await page.click('#add-submit');
  await page.waitForSelector('#toasts :text("added to Sheet")');
  const nr = rowOf('Brand New Fitness');
  assert.equal(nr[2], 'https://instagram.com/brandnew'); assert.equal(nr[3], 12500); assert.equal(nr[14], 'Warming');
  assert.equal(nr[17], today); assert.equal(nr[18], 0); assert.equal(nr[19], 'Follow-up Add-on'); step('lead appended: Warming, started today, touches 0, Package saved');

  // Loom panel
  await page.click('button:text("🎥 Loom script")');
  m = await modal.innerText();
  assert.match(m, /If the Trial-to-Member System looks useful, reply and I'll walk you through pricing\./); assert.match(m, /\[X\] leads/); step('static Loom panel');
  await modal.locator('button:text("Close")').click();

  // Test connection button
  await page.click('button:text("Test Sheet")');
  await page.waitForSelector('text=All good — read and write both work.'); step('Test Sheet button');
  await modal.locator('button:text("Close")').click();

  // overflow check on mobile
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 392, `horizontal overflow: ${sw}`); step('no horizontal scroll at 390px');
  await page.screenshot({ path: process.env.SHOT || '/tmp/shot.png', fullPage: false });

  // cap warning: 20 DMs
  const act = fake.__grids.get('Activity');
  for (let i = 0; i < 19; i++) act.push([new Date().toISOString(), today, `Fake ${i}`, 'X', 'DM Sent', '']);
  await page.click('button:text("↻ Refresh")');
  await page.waitForSelector('#dm-counter:has-text("20 / 20")');
  assert.match(await txt(), /Daily cap reached/); step('cap warning at 20');

  // failed write → visible error
  fake.__failWrites = true;
  assert.deepEqual(errs, [], 'console errors: ' + errs.join(' | '));
  await browser.close(); server.close();
  console.log('ALL UI CHECKS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
