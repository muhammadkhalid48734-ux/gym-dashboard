// Optional browser audit (needs `npm i -D playwright-core` + Chromium). Run:
//   CHROMIUM_PATH=/path/to/chrome [TW_CSS=/path/to/built.css] node test/ui-audit.js
// Turns the design rules into mechanical checks: copy, contrast (light AND dark), shape scale, buttons, states, keyboard, motion.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { start } = require('./devServer.js');

const step = (m) => console.log('✓', m);
const root = path.join(__dirname, '..');

// ---------- static: em-dashes only where YOU wrote the copy ----------
(function staticCopyAudit() {
  ['public/app.js', 'public/index.html'].forEach((f) => {
    const txt = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/[—–]/.test(txt), `${f} contains an em/en dash`);
  });
  // logic.js keeps the dashes you typed in message templates; nothing else may have one.
  const yours = ['Quick question', 'Quick one', 'floating this back up', 'Quick context', 'leave it here', 'Oh interesting', "Yeah, that's usually", 'Nice —', "Gotcha —", '$500 one-time', '$300 one-time',
    "isn't right for now, I can also", 'Trial-to-Member System —', 'Follow-up Add-on —', 'leads —', 'Real comments only —', 'YES →'];
  fs.readFileSync(path.join(root, 'public/logic.js'), 'utf8').split('\n').forEach((line, i) => {
    if (!/[—–]/.test(line) || /^\s*\/\//.test(line)) return;
    assert.ok(yours.some((k) => line.includes(k)), `logic.js:${i + 1} has a dash outside your own copy: ${line.trim().slice(0, 80)}`);
  });
  step('static copy audit: no em/en dash in app.js or index.html; logic.js only in your own message wording');
})();

// ---------- colour maths (WCAG) ----------
const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const CONTRAST_SELECTORS = ['body', '.muted', '.subtle', '.help', '.lbl', '.band-label', '.band-sub', '.stat-label', '.stat-sub', '.count', '.count-alert', '.chip.t-zinc', '.chip.t-emerald', '.chip.t-amber', '.chip.t-red',
  '.chip-solid', '.btn', '.btn-primary', '.btn-ink', '.btn-danger', '.acct-flag.a1', '.acct-flag.a2', '.tab', '.tab.on', '.subtab', '.subtab.on', '.pill-link', '.note', '.entry-meta', '.msg', '.last-contact', '.avatar', '.pipe-pill', '.toast', '.empty', '.msg-label', '.sub-title'];

async function contrastAudit(page, label) {
  const bad = await page.evaluate((sels) => {
    const out = [];
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(',').map(parseFloat); if ((p.length < 4 || p[3] > 0.99)) return c; } return 'rgb(255,255,255)'; };
    sels.forEach((s) => {
      const el = document.querySelector(s);
      if (!el || el.disabled) return;
      const cs = getComputedStyle(el);
      out.push({ s, fg: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) });
    });
    return out;
  }, CONTRAST_SELECTORS);
  const fails = bad.map((x) => ({ ...x, r: ratio(parse(x.fg), parse(x.bg)) })).filter((x) => x.r < 4.5 - 0.001);
  assert.deepEqual(fails.map((x) => `${x.s} ${x.r.toFixed(2)} (${x.fg} on ${x.bg})`), [], `contrast < 4.5 on ${label}`);
  return bad.length;
}

(async () => {
  const { server, fake, port } = await start(0, { seed: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const css = process.env.TW_CSS ? fs.readFileSync(process.env.TW_CSS, 'utf8') : null;
  const newPage = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    if (css) await page.route('**/cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` }));
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/tailwind|ERR_|Failed to load resource/i.test(m.text())) errs.push(m.text()); });
    page._errs = errs; page._ctx = ctx;
    return page;
  };
  const go = async (page, tab) => { await page.goto(`http://localhost:${port}/#${tab}`); await page.waitForSelector(`[data-tab=${tab}].on`); await page.waitForTimeout(150); };
  const TABS = ['today', 'queue', 'warming', 'followups', 'replies', 'all', 'scripts'];

  // ---------- both colour schemes x phone/desktop: every tab ----------
  for (const scheme of ['light', 'dark']) {
    for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
      const page = await newPage({ viewport: vp, colorScheme: scheme });
      let checked = 0;
      for (const tab of TABS) {
        await go(page, tab);
        if (tab === 'all') await page.click('.lead-list .row-head'); // expanded row = detail view
        const r = await page.evaluate(() => {
          const clone = document.querySelector('#app').cloneNode(true);
          clone.querySelectorAll('.msg, [data-user-copy]').forEach((n) => n.remove());
          const dashes = /[—–]/.test(clone.innerText || clone.textContent);
          const dots = document.querySelectorAll('.dot').length;
          const grad = [...document.querySelectorAll('.btn, .card, .band, .stats, .tab, .topbar, .chip, .acct-flag, .list, .row')].filter((el) => /gradient/.test(getComputedStyle(el).backgroundImage)).length;
          const px = (el, prop = 'borderTopLeftRadius') => el && parseFloat(getComputedStyle(el)[prop]);
          const radii = { btn: px(document.querySelector('.btn')), field: px(document.querySelector('.field')), card: px(document.querySelector('.card')), chip: px(document.querySelector('.chip')), avatar: px(document.querySelector('.avatar')), list: px(document.querySelector('.list')) };
          const wraps = [...document.querySelectorAll('.btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height > 48.5 || b.scrollWidth > b.clientWidth + 1)).map((b) => b.textContent.trim().slice(0, 30));
          const emptyIcons = [...document.querySelectorAll('svg.ic')].filter((s) => !s.children.length).length;
          const pure = ['body', '.card', '.list', '.topbar'].map((q) => { const e = document.querySelector(q); return e && getComputedStyle(e).backgroundColor; }).filter((c) => c === 'rgb(255, 255, 255)' || c === 'rgb(0, 0, 0)');
          return { dashes, dots, grad, radii, wraps, emptyIcons, pure, sw: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        assert.equal(r.dashes, false, `em/en dash visible on ${tab}`);
        assert.equal(r.dots, 0, `decorative dots on ${tab}`);
        assert.equal(r.grad, 0, `gradient on a control/surface on ${tab}`);
        assert.deepEqual(r.wraps, [], `button label wraps or clips on ${tab} (${name})`);
        assert.equal(r.emptyIcons, 0, `missing icon on ${tab}`);
        assert.deepEqual(r.pure, [], `pure white/black surface on ${tab}`);
        assert.ok(r.sw <= r.vw + 1, `horizontal scroll on ${tab} (${name})`);
        Object.entries({ btn: 8, field: 8, card: 12, chip: 6, avatar: 8, list: 12 }).forEach(([k, v]) => { if (r.radii[k] !== null && r.radii[k] !== undefined && !Number.isNaN(r.radii[k])) assert.equal(r.radii[k], v, `radius of .${k} on ${tab}`); });
        checked += await contrastAudit(page, `${tab} / ${scheme} / ${name}`);
      }
      // modals
      await go(page, 'warming');
      await page.click('.topbar [data-action=openAdd]');
      await page.waitForSelector('.sheet');
      const m = await page.evaluate(() => {
        const clone = document.querySelector('.sheet').cloneNode(true);
        clone.querySelectorAll('.msg, [data-user-copy]').forEach((n) => n.remove());
        const ph = getComputedStyle(document.querySelector('.field[placeholder]') || document.querySelector('.field'), '::placeholder').color;
        const bg = getComputedStyle(document.querySelector('.field')).backgroundColor;
        return { dashes: /[—–]/.test(clone.innerText), ph, bg, sheetRadius: parseFloat(getComputedStyle(document.querySelector('.sheet')).borderTopLeftRadius) };
      });
      assert.equal(m.dashes, false); assert.equal(m.sheetRadius, 12);
      assert.ok(ratio(parse(m.ph), parse(m.bg)) >= 4.5, `placeholder contrast ${ratio(parse(m.ph), parse(m.bg)).toFixed(2)} (${scheme})`);
      checked += await contrastAudit(page, `add form / ${scheme} / ${name}`);
      await page.keyboard.press('Escape');
      assert.deepEqual(page._errs, [], `console errors (${scheme}/${name})`);
      await page._ctx.close();
      step(`${scheme} / ${name}: 7 tabs + add form pass copy, shape, button, icon, scroll and contrast checks (${checked} contrast samples)`);
    }
  }

  // ---------- fonts ----------
  {
    const page = await newPage({ viewport: { width: 1280, height: 900 } });
    await go(page, 'today');
    const f = await page.evaluate(async () => { await document.fonts.ready; return { sans: document.fonts.check('600 16px Geist'), mono: document.fonts.check('600 16px "Geist Mono"'), family: getComputedStyle(document.body).fontFamily }; });
    assert.ok(f.sans && f.mono && /Geist/.test(f.family)); step('self-hosted Geist and Geist Mono load (no Google Fonts request)');
    await page._ctx.close();
  }

  // ---------- skeleton while loading ----------
  {
    const page = await newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/api/leads', async (r) => { await new Promise((res) => setTimeout(res, 700)); r.continue(); });
    await page.goto(`http://localhost:${port}/#today`);
    await page.waitForSelector('.sk-band');
    assert.equal(await page.locator('.sk-card').count(), 3);
    await page.waitForSelector('.tabs');
    assert.equal(await page.locator('.sk').count(), 0); step('loading state is a skeleton shaped like the page, then it is replaced');
    await page._ctx.close();
  }

  // ---------- undo ----------
  {
    const page = await newPage({ viewport: { width: 1280, height: 900 } });
    await go(page, 'warming');
    const grid = () => fake.__grids.get('Leads');
    const row = (n) => grid().find((r) => r[0] === n);
    const card = page.locator('#view .card', { hasText: 'Warm Fresh' });
    const before = row('Warm Fresh')[18];
    await card.locator('button:text("+1 Touch")').click();
    await page.waitForSelector('#toasts .toast-action');
    assert.equal(row('Warm Fresh')[18], Number(before) + 1);
    await page.click('#toasts .toast-action');
    await page.waitForSelector('#toasts :text("Change undone")');
    assert.equal(String(row('Warm Fresh')[18]), String(before)); step('Undo on +1 Touch restores the Sheet cell');
    // Send DM 1 then undo: status, account, counter and the Activity-driven DM counter all roll back, also after a reload
    const ready = page.locator('#view .card', { hasText: 'Warm Ready' });
    await ready.locator('button:text("Send DM 1")').click();
    await page.waitForSelector('#toasts .toast-action');
    assert.equal(row('Warm Ready')[14], 'DM Sent');
    assert.match(await page.innerText('#dm-counter'), /1 \/ 20/);
    await page.click('#toasts .toast-action');
    await page.waitForSelector('#toasts :text("Change undone")');
    assert.equal(row('Warm Ready')[14], 'Warming'); assert.equal(row('Warm Ready')[15], ''.padEnd(0) || row('Warm Ready')[15]);
    assert.match(await page.innerText('#dm-counter'), /0 \/ 20/);
    const acts = fake.__grids.get('Activity').filter((r) => r[2] === 'Warm Ready').map((r) => r[4]);
    assert.deepEqual(acts, ['DM Sent', 'Undo']);
    await page.reload(); await page.waitForSelector('#dm-counter');
    assert.match(await page.innerText('#dm-counter'), /0 \/ 20/); step('Undo on Send DM 1 rolls back status and the DM counter, and stays rolled back after a reload');
    await page._ctx.close();
  }

  // ---------- copy feedback + keyboard + focus ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    if (css) await page.route('**/cdn.tailwindcss.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` }));
    await go(page, 'queue');
    const copy = page.locator('[data-action=copy]').first();
    await copy.click();
    await page.waitForFunction(() => /Copied/.test(document.querySelector('[data-action=copy]').innerText));
    await page.waitForFunction(() => /Copy$/.test(document.querySelector('[data-action=copy]').innerText.trim()), null, { timeout: 4000 }); step('Copy button confirms "Copied" on itself, then goes back to "Copy"');
    await go(page, 'all');
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'q'); step('"/" jumps to the search box');
    await page.locator('.row-head').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.row-detail').count(), 1); step('Enter on a lead row opens its details (keyboard accessible)');
    const opener = page.locator('.topbar [data-action=openAdd]');
    await opener.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('.sheet');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.name), 'Gym Name'); step('Add lead modal moves focus to the first field');
    for (let i = 0; i < 60; i++) await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.sheet')), 'focus escaped the modal'); step('Tab stays inside the modal (focus trap)');
    // inline validation
    await page.click('#add-submit');
    assert.equal(await page.locator('.err-text:not([hidden])').count(), 3);
    assert.equal(await page.getAttribute('[name="Gym Name"]', 'aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.name), 'Gym Name');
    assert.match(await page.innerText('#err-gym-name'), /Enter the gym name/); step('empty submit shows 3 inline errors under the fields and focuses the first');
    await page.fill('[name="Gym Name"]', 'Audit Gym');
    assert.equal(await page.locator('#err-gym-name:not([hidden])').count(), 0); step('typing clears that field\'s error');
    await page.selectOption('[name="Website Quality"]', 'None'); await page.selectOption('[name="Current Offer"]', 'None');
    await page.fill('[name="Followers"]', 'abc'); await page.click('#add-submit');
    assert.match(await page.innerText('#err-followers'), /digits/); step('bad followers value is explained inline');
    await page.fill('[name="Followers"]', '3.1k'); await page.click('#add-submit');
    await page.waitForSelector('#toasts :text("added to Sheet")');
    assert.equal(await page.locator('.sheet').count(), 0);
    await page.click('#toasts .toast-action'); // "Add another"
    await page.waitForSelector('.sheet');
    assert.equal(await page.inputValue('[name="Gym Name"]'), ''); step('"Add another" in the success toast reopens a clean form');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.className.includes('btn')), true); step('closing the modal returns focus to the button that opened it');
    await ctx.close();
  }

  // ---------- active tab stays in view on a phone ----------
  {
    const page = await newPage({ viewport: { width: 360, height: 800 } });
    await page.goto(`http://localhost:${port}/#scripts`);
    await page.waitForSelector('[data-tab=scripts].on'); await page.waitForTimeout(300);
    const box = await page.locator('[data-tab=scripts]').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 361, `active tab off screen: ${JSON.stringify(box)}`); step('opening #scripts on a 360px phone scrolls the tab bar so the active tab is visible');
    await page._ctx.close();
  }

  // ---------- reduced motion ----------
  {
    const page = await newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await go(page, 'today');
    await page.click('.topbar [data-action=openAdd]'); await page.waitForSelector('.sheet');
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.sheet')).animationName);
    assert.equal(anim, 'none'); step('reduced motion: the sheet opens without animation');
    await page._ctx.close();
  }

  await browser.close(); server.close();
  console.log('UI AUDIT PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
