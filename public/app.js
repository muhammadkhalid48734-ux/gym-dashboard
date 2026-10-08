(() => {
  const L = window.Logic;
  const { PKG } = L;

  // ---------------------------------------------------------------- state
  const state = {
    leads: [], activity: [], warnings: [],
    loaded: false, loading: false, loadError: null,
    filters: { city: '', priority: '', status: '' },
    sortDir: 'desc',                 // Last Contact: desc = most recent first
    expanded: new Set(),             // sheet rows with details open
    justSent: new Set(),             // rows whose DM 1 was just marked sent (keep the text + Copy visible)
    tab: (location.hash || '').replace('#', '') || 'today',
    query: '',                       // search box text
    preview: new Set(),              // warming rows with the DM 1 preview open (status unchanged)
    modal: null,                     // { type: 'add'|'reply'|'notes'|'loom'|'test', ... }
  };
  const inflight = new Set();
  const today = () => L.todayISO();

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);
  const findLead = (row) => state.leads.find((l) => l._row === Number(row));

  // Lucide-style 24px stroke icons
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H16"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10 5-3v10l-5-3"/>',
    plug: '<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    flame: '<path d="M12 3c.6 3.6 4.8 5 4.8 9.6a4.8 4.8 0 0 1-9.6 0c0-1.9.9-3.1 1.9-4 .1 1.7.8 2.6 1.9 2.8C11 9 10.6 6 12 3z"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.500 6 9zM10 20.500a2.200 2.200 0 0 0 4 0"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.500 6h.01M3.500 12h.01M3.500 18h.01"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.300 3.900 2.400 18a2 2 0 0 0 1.700 3h15.800a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    send: '<path d="m22 2-11 11M22 2l-7 20-4-9-9-4z"/>',
    note: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M9 13h6M9 17h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.500"/><path d="M12 12h.01"/>',
    users: '<path d="M16 20v-1.500a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.500 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM21 20v-1.500a4 4 0 0 0-3-3.800M15.500 4.200a3.500 3.500 0 0 1 0 6.600"/>',
    logo: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.600 7.100L3 21l1.900-6.400A8 8 0 1 1 21 12z"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const STATUS_TONE = { Warming: 'amber', 'DM Sent': 'blue', Replied: 'violet', 'Audit Sent': 'cyan', 'Price Sent': 'orange', Closed: 'green', Lost: 'gray' };
  const PRIORITY_TONE = { High: 'red', Medium: 'amber', Low: 'gray' };
  const PKG_TONE = { [PKG.FULL]: 'indigo', [PKG.ADDON]: 'teal', [PKG.SKIP]: 'gray' };
  const chip = (text, tone, dot) => (text ? `<span class="chip t-${tone || 'gray'}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>` : '');
  const statusChip = (s) => chip(s, STATUS_TONE[s], true);

  function initials(name) {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
  }
  function avatar(lead) {
    const name = lead['Gym Name'] || '';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `<div class="avatar" style="--h:${h}" aria-hidden="true">${esc(initials(name))}</div>`;
  }

  function igLink(lead) {
    const url = lead['Instagram Link'];
    if (!url) return '<span class="faint text-xs">no IG link</span>';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="pill-link">Instagram ${icon('ext')}</a>`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ago = (date) => {
    const d = L.daysSince(date, today());
    if (d === null) return '—';
    return d === 0 ? 'today' : `${d}d ago`;
  };

  function btn(label, action, data = {}, cls = '', ic = '') {
    const { title, ...rest } = data;
    const attrs = Object.entries(rest).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') + (title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '');
    return `<button type="button" class="btn ${cls}" data-action="${action}"${attrs}>${ic ? icon(ic) : ''}${label}</button>`;
  }
  const copyBtn = (text, label = 'Copy', extra = '') =>
    `<button type="button" class="btn btn-primary btn-copy ${extra}" data-action="copy" data-text="${esc(text)}">${icon('copy')}${esc(label)}</button>`;

  // ---------------------------------------------------------------- toasts + errors
  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}`;
    el.innerHTML = `${icon(kind === 'ok' ? 'check' : 'alert')}<span></span>`;
    el.lastChild.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 2200);
  }

  // Sticky red banner — stays until dismissed so a failed write can't be missed.
  function showError(msg) {
    toast('Not saved — see red banner', 'err');
    const el = document.createElement('div');
    el.className = 'err-banner';
    el.innerHTML = `<div style="margin-top:.1rem">${icon('alert')}</div><div class="flex-1 min-w-0"><b>Sheet write failed — your change was NOT saved.</b><div class="mt-0.5 break-words" style="opacity:.95"></div></div><button aria-label="Dismiss">${icon('x')}</button>`;
    el.querySelector('.break-words').textContent = msg;
    el.querySelector('button').onclick = () => el.remove();
    $('#errors').appendChild(el);
  }

  async function copyText(text, okMsg = 'Copied ✓') {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else throw new Error('no clipboard api');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      if (!ok) { toast('Copy failed — select the text and copy manually', 'err'); return; }
    }
    toast(okMsg);
  }

  // ---------------------------------------------------------------- API
  async function api(method, body, path = '/api/leads') {
    let res;
    try {
      res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error(`Network error: ${e.message}`);
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error((json && (json.error || (json.steps && json.steps.filter((s) => !s.ok).map((s) => s.detail).join(' '))))
      || `Server returned ${res.status}`);
    return json;
  }

  async function load() {
    state.loading = true; state.loadError = null; render();
    try {
      const d = await api('GET');
      state.leads = d.leads; state.activity = d.activity; state.warnings = d.warnings || [];
      state.loaded = true;
    } catch (e) {
      state.loadError = e.message;
    }
    state.loading = false; render();
  }

  // The one place that writes an existing lead. Awaits the Sheet, only then updates the UI.
  async function writeLead(lead, updates, logs = [], okMsg = 'Saved to Sheet ✓') {
    if (inflight.has(lead._row)) { toast('Still saving the previous change…', 'warn'); return false; }
    inflight.add(lead._row);
    try {
      const r = await api('PATCH', { row: lead._row, expectGym: lead['Gym Name'], updates, log: logs });
      Object.assign(lead, updates);
      logs.forEach((l) => state.activity.push({
        Timestamp: new Date().toISOString(), Date: l.date, Gym: lead['Gym Name'], City: lead.City, Event: l.event, Detail: l.detail || '',
      }));
      toast(okMsg);
      if (r.logError) showError(`Lead was saved, but the Activity log write failed (the DM counter / follow-up stage may be off): ${r.logError}`);
      render();
      return true;
    } catch (e) {
      showError(`${lead['Gym Name']}: ${e.message}`);
      return false;
    } finally {
      inflight.delete(lead._row);
    }
  }

  // ---------------------------------------------------------------- actions
  async function touch(row) {
    const lead = findLead(row);
    const n = (parseInt(lead['Engagement Touches'], 10) || 0) + 1;
    await writeLead(lead, { 'Engagement Touches': n, 'Last Contact Date': today() }, [], `Touch #${n} saved ✓`);
  }

  async function sendDm1(row) {
    const lead = findLead(row);
    const sent = L.dmsSentToday(state.activity, today());
    if (sent >= L.DAILY_DM_CAP && !confirm(`You've already sent ${sent} DMs today (cap ${L.DAILY_DM_CAP} on a new account). Send another anyway?`)) return;
    state.justSent.add(lead._row); // keep the card (with the DM text) visible after the status flips
    const ok = await writeLead(lead, { Status: 'DM Sent', 'Last Contact Date': today() },
      [{ date: today(), event: 'DM Sent', detail: 'DM 1' }], 'DM 1 → status set to DM Sent ✓');
    if (!ok) { state.justSent.delete(lead._row); render(); }
  }

  async function markFollowUp(row) {
    const lead = findLead(row);
    const item = L.dueToday([lead], state.activity, today()).followups[0];
    if (!item || item.type !== 'followup') { toast('Nothing due for this lead any more', 'warn'); return; }
    const logs = [];
    // Lead was set to "DM Sent" by hand in the Sheet: record DM 1's date so later stages count from it.
    if (!item.state.hasDmEvent) logs.push({ date: L.normalizeDate(item.state.dm1Date) || today(), event: 'DM Sent', detail: 'backfilled' });
    logs.push({ date: today(), event: 'Follow-up', detail: `Day ${item.day}` });
    await writeLead(lead, { 'Last Contact Date': today() }, logs, `Day ${item.day} follow-up marked sent ✓`);
  }

  async function markPriceFollowUp(row) {
    const lead = findLead(row);
    await writeLead(lead, { 'Last Contact Date': today() }, [{ date: today(), event: 'Price follow-up', detail: '' }], 'Price follow-up marked sent ✓');
  }

  async function markLost(row) {
    const lead = findLead(row);
    await writeLead(lead, { Status: 'Lost' }, [{ date: today(), event: 'Lost', detail: 'No reply' }], 'Marked Lost ✓');
  }

  function copyFollowUp(row) {
    const lead = findLead(row);
    const m = L.nextMessage(lead, state.activity, today());
    if (m.text) copyText(m.text, `Copied: ${m.label} ✓`);
    else toast(m.reason, 'warn');
  }

  async function applyReply() {
    const { row, key } = state.modal;
    const lead = findLead(row);
    const r = L.buildReply(key, lead, today());
    const updates = { 'Last Contact Date': today() };
    const logs = [];
    if (r.setStatus && r.setStatus !== lead.Status) { updates.Status = r.setStatus; logs.push({ date: today(), event: r.setStatus, detail: `Reply: ${key}` }); }
    if (r.setPackage && r.setPackage !== lead.Package) updates.Package = r.setPackage;
    if (r.logEvent) logs.push({ date: today(), event: r.logEvent, detail: '' });
    const ok = await writeLead(lead, updates, logs, r.setStatus ? `Status → ${r.setStatus} saved ✓` : 'Marked sent ✓');
    if (ok) { state.modal.saved = true; renderModal(); }
  }

  // ---------------------------------------------------------------- rendering: header + status strip
  const TABS = [
    { key: 'today', label: 'Today', icon: 'bell' },
    { key: 'warming', label: 'Warming', icon: 'flame' },
    { key: 'followups', label: 'Follow-ups', icon: 'send' },
    { key: 'replies', label: 'Replies', icon: 'msg' },
    { key: 'all', label: 'All leads', icon: 'list' },
    { key: 'scripts', label: 'Scripts', icon: 'note' },
  ];
  const SEARCH_TABS = ['warming', 'followups', 'replies', 'all'];
  if (!TABS.some((tb) => tb.key === state.tab)) state.tab = 'today';
  let dueCache = null; // recomputed once per render()

  const matchesQuery = (l) => {
    const q = state.query.trim().toLowerCase();
    return !q || `${l['Gym Name']} ${l.City} ${l['Owner Name']} ${l.Notes}`.toLowerCase().includes(q);
  };

  function renderHeader() {
    const t = today();
    const sent = L.dmsSentToday(state.activity, t);
    const cap = L.DAILY_DM_CAP;
    const daysLeft = L.daysBetween(t, L.DEADLINE);
    const capTone = sent >= cap ? 'kpi-danger' : sent >= cap - 3 ? 'kpi-warn' : 'kpi-ok';
    const pct = Math.min(100, Math.round((sent / cap) * 100));
    const dlValue = daysLeft === null ? '—' : String(Math.max(daysLeft, 0));
    const dlText = daysLeft === null ? 'Nov 3, 2026' : daysLeft > 0 ? 'days left until Nov 3, 2026' : daysLeft === 0 ? 'Deadline is today (Nov 3)' : `${-daysLeft} days past Nov 3 deadline`;
    return `
      <div class="topbar">
        <div class="logo">${icon('logo')}</div>
        <div><div class="brand-title">Lead Outreach</div><div class="brand-sub">Trial-to-Member System</div></div>
        <div class="topbar-actions">
          ${btn('+ Add Lead', 'openAdd', {}, 'btn-primary')}
          ${btn('<span class="hide-sm">Loom script</span>', 'openLoom', { title: 'Loom script' }, '', 'video')}
          ${btn(`<span class="hide-sm">${state.loading ? 'Loading' : 'Refresh'}</span>`, 'refresh', { title: 'Refresh' }, '', 'refresh')}
          ${btn('<span class="hide-sm">Test Sheet</span>', 'openTest', { title: 'Test Sheet connection' }, '', 'plug')}
        </div>
      </div>

      <div class="strip mt-3">
        <div class="card strip-dm ${capTone}" id="dm-counter">
          <div class="strip-label">DMs sent today</div>
          <div class="flex items-baseline gap-2"><span class="strip-num num">${sent}<span class="kpi-of"> / ${cap}</span></span>
            <span class="strip-sub">${sent >= cap ? 'cap reached — stop for today' : `${cap - sent} left`}</span></div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
        <div class="card strip-dl kpi-hero"><span class="strip-num num">${dlValue}</span><span class="strip-sub" style="color:rgba(255,255,255,.85)">${esc(dlText)}</span></div>
      </div>
      ${sent >= cap ? `<div class="alert alert-danger">${icon('alert')}<div>Daily cap reached (${cap}). Stop sending DMs from the new account today.</div></div>` : ''}
      ${state.warnings.map((w) => `<div class="alert alert-warn">${icon('alert')}<div>${esc(w)}</div></div>`).join('')}`;
  }

  function renderTabs(counts) {
    return `
      <nav class="tabs-wrap" aria-label="Sections">
        <div class="tabs" role="tablist">
          ${TABS.map((tb) => `<button type="button" role="tab" class="tab ${state.tab === tb.key ? 'on' : ''}" aria-selected="${state.tab === tb.key}" data-action="setTab" data-tab="${tb.key}">${icon(tb.icon)}<span>${tb.label}</span>${counts[tb.key] !== undefined ? `<span class="count ${tb.key === 'today' && counts.today ? 'count-alert' : ''}">${counts[tb.key]}</span>` : ''}</button>`).join('')}
        </div>
        <input id="q" class="field search ${SEARCH_TABS.includes(state.tab) ? '' : 'hidden md:block md:invisible'}" type="search" placeholder="Search gym, city, owner…" value="${esc(state.query)}" autocomplete="off" aria-label="Search leads">
      </nav>`;
  }

  // ---------------------------------------------------------------- rendering: Today overview tiles + pipeline
  function renderOverview() {
    const counts = L.statusCounts(state.leads);
    const due = dueCache;
    const dueTotal = due.warmup.length + due.followups.length + due.price.length;
    const open = state.leads.filter((l) => l.Status !== 'Closed' && l.Status !== 'Lost').length;
    const replies = counts.Replied + counts['Audit Sent'] + counts['Price Sent'];
    const segs = L.ENUMS.Status.filter((s) => counts[s]).map((s) => `<i class="t-${STATUS_TONE[s]}" style="flex:${counts[s]}" title="${esc(s)}: ${counts[s]}"></i>`);
    return `
      <div class="kpis">
        <div class="card kpi"><div class="kpi-label">Due today</div>
          <div class="kpi-value" style="${dueTotal ? '' : 'color:var(--ok)'}">${dueTotal}</div>
          <div class="kpi-sub">${plural(due.warmup.length, 'touch', 'touches')} · ${plural(due.followups.length, 'follow-up', 'follow-ups')} · ${due.price.length} price</div></div>
        <div class="card kpi"><div class="kpi-label">Active leads</div>
          <div class="kpi-value">${open}</div><div class="kpi-sub">${state.leads.length} total in Sheet</div></div>
        <div class="card kpi"><div class="kpi-label">Waiting on a reply</div>
          <div class="kpi-value">${counts['DM Sent']}</div><div class="kpi-sub">DM 1 sent, no answer yet</div></div>
        <div class="card kpi"><div class="kpi-label">In conversation</div>
          <div class="kpi-value">${replies}</div><div class="kpi-sub">replied · audit · price sent</div></div>
      </div>
      <div class="card pipeline mt-3">
        <div class="pipe-bar">${segs.join('')}</div>
        <div class="pipe-legend">
          ${L.ENUMS.Status.map((s) => `<button type="button" class="pipe-pill t-${STATUS_TONE[s]}" data-action="filterStatus" data-status="${esc(s)}" title="Open ${esc(s)} leads"><span class="dot"></span>${esc(s)} <b>${counts[s]}</b></button>`).join('')}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- rendering: entry cards (Today / Warming / Follow-ups / Replies)
  function dueEntry(lead, tag, body, buttons) {
    return `
      <div class="card entry fade-in">
        <div class="entry-head">
          ${avatar(lead)}
          <div class="min-w-0 flex-1">
            <div class="entry-name">${esc(lead['Gym Name'])}</div>
            <div class="entry-meta">${lead.City ? `<span>${esc(lead.City)}</span>` : ''}${igLink(lead)}</div>
          </div>
        </div>
        ${tag ? `<div class="entry-tags">${tag}</div>` : ''}
        ${body}
        <div class="entry-actions">${buttons}</div>
      </div>`;
  }

  const warmEntry = ({ lead }) => dueEntry(lead,
    chip(plural(parseInt(lead['Engagement Touches'], 10) || 0, 'touch', 'touches'), 'amber'),
    '<div class="muted text-sm mt-3" style="line-height:1.45">Leave a <b style="color:var(--text)">real comment</b> on a recent post — something specific, not an emoji — then log it.</div>',
    btn('+1 Touch', 'touch', { row: lead._row }, 'btn-ok'));

  function followupEntry(it) {
    const lead = it.lead;
    if (it.type === 'lost') {
      return dueEntry(lead, chip(`Day ${it.daysSinceDm} · no reply`, 'red'),
        it.text ? `<div class="msg-label">Day 10 message not sent yet</div><div class="msg">${esc(it.text)}</div>` : '<div class="muted text-sm mt-3">All follow-ups sent, still no reply.</div>',
        `${it.text ? copyBtn(it.text) : ''}${btn('Mark Lost', 'markLost', { row: lead._row }, 'btn-danger')}`);
    }
    return dueEntry(lead, chip(`Day ${it.day} follow-up`, 'blue'),
      `<div class="msg">${esc(it.text)}</div>`,
      `${copyBtn(it.text)}${btn('Mark Sent', 'markFollowUp', { row: lead._row }, 'btn-ok', 'send')}`);
  }

  const priceEntry = (it) => dueEntry(it.lead,
    chip(`Quiet ${it.daysQuiet}d`, 'orange') + chip(L.effectivePackage(it.lead), PKG_TONE[L.effectivePackage(it.lead)]),
    `<div class="msg">${esc(it.text)}</div>`,
    `${copyBtn(it.text)}${btn('Mark Sent', 'markPriceFollowUp', { row: it.lead._row }, 'btn-ok', 'send')}`);

  const group = (title, count, items, empty) => `
    <div>
      <div class="sub-title">${title} <span class="count">${count}</span></div>
      <div class="space-y-2.5">${items.join('') || `<div class="empty">${icon('check')}${empty}</div>`}</div>
    </div>`;

  const WARM_LIMIT = 5; // Today shows the first few; the Warming tab has the full list

  function renderDue() {
    const due = dueCache;
    const total = due.warmup.length + due.followups.length + due.price.length;
    return `
      <section>
        <h2 class="sec-title">${icon('bell')}Due today <span class="count ${total ? 'count-alert' : 'count-ok'}">${total}</span></h2>
        <div class="grid gap-5 lg:grid-cols-3 items-start">
          ${group('Warm-up touches', due.warmup.length, due.warmup.slice(0, WARM_LIMIT).map(warmEntry).concat(due.warmup.length > WARM_LIMIT ? [`<button type="button" class="btn btn-block" data-action="setTab" data-tab="warming">See all ${due.warmup.length} in the Warming tab →</button>`] : []), 'All warm-up leads touched today')}
          ${group('Follow-ups', due.followups.length, due.followups.map(followupEntry), 'No follow-ups due')}
          ${group('Price sent · quiet 3+ days', due.price.length, due.price.map(priceEntry), 'Nobody to nudge')}
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: Warming tab
  function renderWarming() {
    const warming = state.leads.filter((l) => (l.Status === 'Warming' || state.justSent.has(l._row)) && matchesQuery(l));
    const info = (lead) => {
      const touches = parseInt(lead['Engagement Touches'], 10) || 0;
      const days = L.daysSince(lead['Engagement Started'], today());
      return { touches, days, ready: touches >= 3 && days !== null && days >= 2 };
    };
    warming.sort((a, b) => (info(b).ready - info(a).ready) || (info(b).touches - info(a).touches));
    const readyCount = warming.filter((l) => info(l).ready && !state.justSent.has(l._row)).length;
    const cards = warming.map((lead) => {
      const { touches, days, ready } = info(lead);
      const sent = state.justSent.has(lead._row);
      const showDm = sent || state.preview.has(lead._row);
      const warn = [];
      if (touches < 3) warn.push(`only ${touches} touch${touches === 1 ? '' : 'es'} so far`);
      if (days === null || days < 2) warn.push(days === null ? 'no Engagement Started date' : `only ${days} day${days === 1 ? '' : 's'} since you started engaging`);
      const dm = L.dm1(lead);
      const pips = [0, 1, 2].map((i) => `<i class="${i < touches ? (touches >= 3 ? 'full' : 'on') : ''}"></i>`).join('');
      return `
        <div class="card entry fade-in ${ready && !sent ? 'ready-ring' : ''}">
          <div class="entry-head">
            ${avatar(lead)}
            <div class="min-w-0 flex-1">
              <div class="entry-name">${esc(lead['Gym Name'])}</div>
              <div class="entry-meta">${lead.City ? `<span>${esc(lead.City)}</span>` : ''}${igLink(lead)}</div>
            </div>
          </div>
          ${sent || ready ? `<div class="entry-tags">${sent ? chip('DM 1 sent', 'blue', true) : '<span class="chip chip-solid-ok">Ready for DM 1</span>'}</div>` : ''}
          <div class="meter"><span class="pips">${pips}</span><span class="num">${touches} touch${touches === 1 ? '' : 'es'} · ${days === null ? '—' : days} day${days === 1 ? '' : 's'} since started</span></div>
          ${!sent && !ready ? `<div class="note mt-3">${icon('info')}<div>Soft warning: ${esc(warn.join(' and '))}. You can still send.</div></div>` : ''}
          ${showDm ? `<div class="msg-label">DM 1${sent ? '' : ' (preview — status not changed)'}</div><div class="msg">${esc(dm)}</div>` : ''}
          <div class="entry-actions">
            ${sent
              ? `${copyBtn(dm)}${btn('Done', 'dismissSent', { row: lead._row })}`
              : `${showDm ? copyBtn(dm) : ''}${btn('+1 Touch', 'touch', { row: lead._row }, 'btn-ok')}${btn('Send DM 1', 'sendDm1', { row: lead._row }, ready ? 'btn-primary' : '', 'send')}${showDm ? btn('Hide', 'togglePreview', { row: lead._row }, 'btn-sm') : btn('Preview DM 1', 'togglePreview', { row: lead._row }, '', 'note')}`}
          </div>
        </div>`;
    });
    return `
      <section>
        <h2 class="sec-title">${icon('flame')}Warming <span class="count">${warming.length}</span>${readyCount ? `<span class="chip chip-solid-ok">${readyCount} ready for DM 1</span>` : ''}</h2>
        <div class="note mb-3" style="font-weight:600">${icon('info')}<div>Real comments only — something specific about the post, not an emoji.</div></div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${cards.join('') || `<div class="empty sm:col-span-2 lg:col-span-3">${icon('users')}${state.query ? 'No warming leads match your search.' : 'No leads warming up yet — tap + to add one.'}</div>`}</div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: lead rows (Follow-ups / Replies / All leads)
  const FIELDS = ['Gym Name', 'City', 'Instagram Link', 'Followers', 'Last Post Date', 'Owner Name', 'Website Link', 'Website Quality', 'Bio Link Type',
    'Has Booking Form', 'Has Follow-up Automation', 'Current Offer', 'Problem', 'Priority', 'Status', 'Last Contact Date', 'Notes',
    'Engagement Started', 'Engagement Touches', 'Package'];

  const lastContactMs = (l) => L.parseDate(l['Last Contact Date']);
  function sortByLastContact(list) {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = lastContactMs(a);
      const y = lastContactMs(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;        // never-contacted rows always last
      if (y === null) return -1;
      return (x - y) * dir;
    });
  }

  function visibleLeads() {
    const f = state.filters;
    return sortByLastContact(state.leads.filter((l) => (!f.city || l.City === f.city) && (!f.priority || l.Priority === f.priority) && (!f.status || l.Status === f.status) && matchesQuery(l)));
  }

  function detailValue(lead, field) {
    const v = lead[field];
    if (field === 'Priority' || field === 'Package') {
      const opts = ['', ...L.ENUMS[field]];
      return `<select class="field" data-field-select="${field}" data-row="${lead._row}">${opts.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`;
    }
    if ((field === 'Instagram Link' || field === 'Website Link') && v) return `<a href="${esc(v)}" target="_blank" rel="noopener" class="break-all" style="color:var(--accent);text-decoration:underline">${esc(v)}</a>`;
    return `<span class="break-words whitespace-pre-wrap">${esc(v) || '<span class="faint">—</span>'}</span>`;
  }

  function renderRow(lead, extra = '') {
    const open = state.expanded.has(lead._row);
    const pkg = lead.Package || '';
    return `
      <div class="card lead-row fade-in">
        <div class="lead-top" data-action="toggleRow" data-row="${lead._row}">
          ${avatar(lead)}
          <div class="flex-1 min-w-0">
            <div class="entry-name">${esc(lead['Gym Name'])}${lead.City ? ` <span class="muted" style="font-weight:500;font-size:.75rem">· ${esc(lead.City)}</span>` : ''}</div>
            <div class="entry-tags" style="margin-top:.4rem">${statusChip(lead.Status)}${chip(lead.Priority && `${lead.Priority} priority`, PRIORITY_TONE[lead.Priority])}${chip(pkg, PKG_TONE[pkg])}${extra}</div>
          </div>
          <div class="last-contact shrink-0">Last contact<b>${esc(ago(lead['Last Contact Date']))}</b></div>
          <span class="chev ${open ? 'open' : ''}">${icon('chev')}</span>
        </div>
        <div class="lead-actions">
          ${btn('Log Reply', 'openReply', { row: lead._row }, 'btn-primary btn-sm', 'send')}
          ${btn('Copy follow-up', 'copyFollowUp', { row: lead._row }, 'btn-sm', 'copy')}
          ${btn('+1 Touch', 'touch', { row: lead._row }, 'btn-sm')}
          ${btn('Edit Notes', 'openNotes', { row: lead._row }, 'btn-sm', 'note')}
        </div>
        ${open ? `<div class="lead-detail">
          ${FIELDS.map((f) => `<div class="${f === 'Problem' || f === 'Notes' ? 'span-2' : ''}"><span class="lbl">${f}${f === 'Package' ? ' (column 20)' : ''}</span><div class="text-sm">${detailValue(lead, f)}</div></div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- rendering: Follow-ups tab
  function renderFollowups() {
    const due = dueCache;
    const dueByRow = new Map(due.followups.map((it) => [it.lead._row, it]));
    const sentLeads = state.leads.filter((l) => l.Status === 'DM Sent');
    const dueItems = due.followups.filter((it) => matchesQuery(it.lead));
    const waiting = sentLeads.filter((l) => !dueByRow.has(l._row) && matchesQuery(l)).map((l) => ({ l, s: L.dmState(l, state.activity, today()) }))
      .sort((a, b) => (b.s.daysSinceDm || 0) - (a.s.daysSinceDm || 0));
    const rows = waiting.map(({ l, s }) => {
      const sentN = s.followUpsSent;
      const next = sentN < L.FOLLOW_UPS.length ? L.FOLLOW_UPS[sentN].day : null;
      const extra = chip(s.daysSinceDm === null ? 'DM date unknown' : `DM 1: ${s.daysSinceDm}d ago`, 'gray')
        + (next && s.daysSinceDm !== null ? chip(`Next: Day ${next} follow-up in ${Math.max(next - s.daysSinceDm, 0)}d`, 'blue') : '');
      return renderRow(l, extra);
    });
    return `
      <section>
        <h2 class="sec-title">${icon('send')}Follow-ups <span class="count">${sentLeads.length}</span></h2>
        <div class="muted text-sm mb-3" style="line-height:1.5">Everyone whose DM 1 went out and hasn't replied. Follow-ups are due on Day 3, 6 and 10 after DM 1; after Day 10 the lead can be marked Lost.</div>
        <div class="sub-title">Due now <span class="count ${dueItems.length ? 'count-alert' : 'count-ok'}">${dueItems.length}</span></div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start mb-6">${dueItems.map(followupEntry).join('') || `<div class="empty sm:col-span-2 lg:col-span-3">${icon('check')}No follow-ups due right now</div>`}</div>
        <div class="sub-title">Waiting <span class="count">${waiting.length}</span></div>
        <div class="space-y-2.5 lead-list">${rows.join('') || `<div class="empty">${icon('info')}${state.query ? 'No matches.' : 'Nobody waiting.'}</div>`}</div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: Replies tab (Replied / Audit Sent / Price Sent)
  function renderReplies() {
    const priceDue = dueCache.price.filter((it) => matchesQuery(it.lead));
    const dueRows = new Set(dueCache.price.map((it) => it.lead._row));
    const groups = ['Replied', 'Audit Sent', 'Price Sent'].map((st) => {
      const list = sortByLastContact(state.leads.filter((l) => l.Status === st && matchesQuery(l)));
      return `
        <div class="mb-6">
          <div class="sub-title">${statusChip(st)} <span class="count">${list.length}</span></div>
          <div class="space-y-2.5 lead-list">${list.map((l) => renderRow(l, dueRows.has(l._row) ? chip('Quiet 3+ days', 'orange') : '')).join('') || `<div class="empty">${icon('info')}None</div>`}</div>
        </div>`;
    });
    return `
      <section>
        <h2 class="sec-title">${icon('msg')}Replies <span class="count">${state.leads.filter((l) => ['Replied', 'Audit Sent', 'Price Sent'].includes(l.Status)).length}</span></h2>
        <div class="muted text-sm mb-3" style="line-height:1.5">Leads who answered. Tap <b>Log Reply</b> on a row to get the next message to send.</div>
        ${priceDue.length ? `<div class="sub-title">Price sent · quiet 3+ days <span class="count count-alert">${priceDue.length}</span></div><div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start mb-6">${priceDue.map(priceEntry).join('')}</div>` : ''}
        ${groups.join('')}
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: All leads tab
  function renderTable() {
    const cities = [...new Set(state.leads.map((l) => l.City).filter(Boolean))].sort();
    const opt = (v, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`;
    const list = visibleLeads();
    return `
      <section id="leads">
        <h2 class="sec-title">${icon('list')}All leads <span class="count">${list.length}${list.length !== state.leads.length ? ` / ${state.leads.length}` : ''}</span></h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <select class="field" data-filter="city"><option value="">All cities</option>${cities.map((c) => opt(c, state.filters.city)).join('')}</select>
          <select class="field" data-filter="priority"><option value="">All priorities</option>${L.ENUMS.Priority.map((c) => opt(c, state.filters.priority)).join('')}</select>
          <select class="field" data-filter="status"><option value="">All statuses</option>${L.ENUMS.Status.map((c) => opt(c, state.filters.status)).join('')}</select>
          ${btn(`Last contact: ${state.sortDir === 'desc' ? 'newest ↓' : 'oldest ↑'}`, 'toggleSort', {}, '!h-auto min-h-[2.6rem]')}
        </div>
        <div class="space-y-2.5 lead-list">${list.map((l) => renderRow(l)).join('') || `<div class="empty">${icon('info')}No leads match these filters.</div>`}</div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: Scripts tab (message library, read-only reference)
  function renderScripts() {
    const ph = { 'Owner Name': '[owner]', 'Gym Name': '[gym]' };
    const block = (label, text, note) => `
      <div class="card entry">
        <div class="msg-label" style="margin-top:0">${esc(label)}</div>
        ${note ? `<div class="muted text-xs mt-1">${esc(note)}</div>` : ''}
        <div class="msg">${esc(text)}</div>
        <div class="entry-actions">${copyBtn(text)}</div>
      </div>`;
    const M = L.MSG;
    return `
      <section>
        <h2 class="sec-title">${icon('note')}Scripts</h2>
        <div class="muted text-sm mb-4" style="line-height:1.5">Every message template in one place. <b>[owner]</b> and <b>[gym]</b> are filled in automatically when you use the buttons on a lead — copying from here gives the raw template.</div>

        <div class="sub-title">DM 1 — opening question (picked by Current Offer; never a pitch)</div>
        <div class="grid gap-3 lg:grid-cols-3 items-start mb-6">
          ${block('Current Offer = Free Trial', L.dm1({ ...ph, 'Current Offer': 'Free Trial' }))}
          ${block('Current Offer = Paid Intro', L.dm1({ ...ph, 'Current Offer': 'Paid Intro' }))}
          ${block('Current Offer = None', L.dm1({ ...ph, 'Current Offer': 'None' }))}
        </div>

        <div class="sub-title">Follow-ups when there's no reply</div>
        <div class="grid gap-3 lg:grid-cols-3 items-start mb-6">
          ${L.FOLLOW_UPS.map((f) => block(`Day ${f.day}`, f.text({ 'Owner Name': '[owner]' }))).join('')}
        </div>

        <div class="sub-title">When they reply — two-step rule: react first, ask about the video in the next message</div>
        <div class="grid gap-3 lg:grid-cols-2 items-start mb-6">
          ${block('"Manually / no system" — Step 1 (send now)', M.manualStep1)}
          ${block('"Manually / no system" — Step 2 (after they respond)', M.manualStep2, 'First place the product name appears')}
          ${block('Uses Mindbody / Glofox / Wodify — ready message', M.platformQuestion, M.platformInstruction)}
          ${block('Platform user with NO automatic follow-up', M.platformNoFollowUp)}
          ${block('Interested after the video — Trial-to-Member System', M.priceFull)}
          ${block('Interested after the video — Follow-up Add-on', M.priceAddon)}
          ${block('Went quiet after price (full package)', M.quietFull, 'Only when Status = Price Sent and 3+ days have passed')}
          ${block('Went quiet after price (Follow-up Add-on)', M.quietAddon)}
          ${block('Not interested', M.notInterested)}
        </div>

        <div class="sub-title">Loom video script</div>
        <div class="card entry">${loomHtml(null)}</div>
      </section>`;
  }

  function renderView() {
    switch (state.tab) {
      case 'warming': return renderWarming();
      case 'followups': return renderFollowups();
      case 'replies': return renderReplies();
      case 'all': return renderTable();
      case 'scripts': return renderScripts();
      default: return renderOverview() + renderDue();
    }
  }

  function render() {
    const app = $('#app');
    if (!state.loaded) {
      app.innerHTML = renderHeader() + (state.loadError
        ? `<div class="alert alert-danger" style="display:block"><b>Couldn't load leads from the Sheet.</b><div class="mt-1 break-words" style="font-weight:500">${esc(state.loadError)}</div><div class="mt-3 flex gap-2">${btn('Retry', 'refresh', {}, 'btn-primary', 'refresh')}${btn('Run connection test', 'openTest', {}, '', 'plug')}</div></div>`
        : '<div class="space-y-3 mt-5"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="height:8rem"></div></div>');
      return;
    }
    dueCache = L.dueToday(state.leads, state.activity, today());
    const c = L.statusCounts(state.leads);
    const counts = {
      today: dueCache.warmup.length + dueCache.followups.length + dueCache.price.length,
      warming: c.Warming, followups: c['DM Sent'], replies: c.Replied + c['Audit Sent'] + c['Price Sent'], all: state.leads.length,
    };
    app.innerHTML = renderHeader() + renderTabs(counts) + `<div id="view" class="pt-1">${renderView()}</div>`;
  }

  function setTab(key, { scroll = true } = {}) {
    state.tab = TABS.some((tb) => tb.key === key) ? key : 'today';
    try { history.replaceState(null, '', `#${state.tab}`); } catch { /* ignore */ }
    render();
    if (scroll) { const el = document.querySelector('.tabs-wrap'); if (el) window.scrollTo({ top: Math.max(el.offsetTop - 64, 0), behavior: 'smooth' }); }
  }

  // ---------------------------------------------------------------- modals
  function modalShell(title, inner) {
    return `
      <div class="overlay" data-action="modalBackdrop">
        <div class="sheet" role="dialog" aria-label="${esc(title)}">
          <div class="grab"></div>
          <div class="sheet-head">
            <h2>${title}</h2>
            <button class="btn btn-sm" data-action="closeModal">${icon('x')}Close</button>
          </div>
          <div class="sheet-body">${inner}</div>
        </div>
      </div>`;
  }

  function renderModal() {
    const root = $('#modal-root');
    const m = state.modal;
    if (!m) { root.innerHTML = ''; document.body.style.overflow = ''; return; }
    document.body.style.overflow = 'hidden';
    if (m.type === 'add') root.innerHTML = modalShell('Add lead', addFormHtml());
    else if (m.type === 'reply') root.innerHTML = modalShell(`Log reply — ${esc(findLead(m.row)['Gym Name'])}`, replyHtml());
    else if (m.type === 'notes') {
      const lead = findLead(m.row);
      root.innerHTML = modalShell(`Notes — ${esc(lead['Gym Name'])}`, `
        <textarea id="notes-text" class="field" rows="8">${esc(lead.Notes)}</textarea>
        <div class="mt-3 flex gap-2">${btn('Save notes', 'saveNotes', {}, 'btn-primary btn-lg', 'check')}${btn('Cancel', 'closeModal', {}, 'btn-lg')}</div>`);
      setTimeout(() => { const t = $('#notes-text'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0);
    } else if (m.type === 'loom') root.innerHTML = modalShell('Loom script', loomHtml(m.row ? findLead(m.row) : null));
    else if (m.type === 'test') root.innerHTML = modalShell('Sheet connection test', testHtml());
    if (m.type === 'add') updateSuggestions();
  }

  function closeModal() { state.modal = null; renderModal(); }

  // ----- Add lead
  function selectHtml(name, opts, { required = false, value = '', placeholder = 'Select…' } = {}) {
    return `<select class="field" name="${name}" ${required ? 'required' : ''}><option value="">${placeholder}</option>${opts.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  const inp = (name, type = 'text', extra = '') => `<input class="field" name="${name}" type="${type}" ${extra} autocomplete="off">`;
  const fld = (label, inner, cls = 'col-span-2 sm:col-span-1') => `<label class="block ${cls}"><span class="lbl">${label}</span>${inner}</label>`;

  function addFormHtml() {
    const E = L.ENUMS;
    return `
      <form id="add-form" class="grid grid-cols-2 items-end gap-3.5" novalidate>
        ${fld('Gym Name *', inp('Gym Name', 'text', 'required'))}
        ${fld('City', inp('City'))}
        ${fld('Instagram Link (or @handle)', inp('Instagram Link', 'text', 'inputmode="url"'))}
        ${fld('Followers', inp('Followers', 'text', 'inputmode="numeric" placeholder="e.g. 4200 or 4.2k"'), 'col-span-1')}
        ${fld('Last Post Date', inp('Last Post Date', 'date'), 'col-span-1')}
        ${fld('Owner Name', inp('Owner Name'))}
        ${fld('Website Link', inp('Website Link', 'text', 'inputmode="url"'))}
        ${fld('Website Quality *', selectHtml('Website Quality', E['Website Quality'], { required: true }), 'col-span-1')}
        ${fld('Bio Link Type', selectHtml('Bio Link Type', E['Bio Link Type']), 'col-span-1')}
        ${fld('Has Booking Form', selectHtml('Has Booking Form', E['Has Booking Form']), 'col-span-1')}
        ${fld('Has Follow-up Automation', selectHtml('Has Follow-up Automation', E['Has Follow-up Automation'], { value: 'Unknown' }), 'col-span-1')}
        ${fld('Current Offer * (picks the DM 1 wording)', selectHtml('Current Offer', E['Current Offer'], { required: true }))}
        ${fld('Problem', '<textarea class="field" name="Problem" rows="2"></textarea>', 'col-span-2')}
        <div class="col-span-2 grid gap-3.5 sm:grid-cols-2 suggest">
          <div>
            ${fld('Priority (suggested — override if you like)', selectHtml('Priority', E.Priority, { placeholder: '—' }))}
            <div id="priority-hint" class="hint"></div>
          </div>
          <div>
            ${fld('Package (suggested — override if you like)', selectHtml('Package', E.Package, { placeholder: '—' }))}
            <div id="package-hint" class="hint"></div>
          </div>
        </div>
        ${fld('Notes', '<textarea class="field" name="Notes" rows="2" placeholder="e.g. uses Mindbody → Low priority"></textarea>', 'col-span-2')}
        <div class="col-span-2 muted text-xs">On save: Status = Warming · Engagement Started = today · Touches = 0</div>
        <div class="col-span-2">
          <button type="submit" class="btn btn-primary btn-lg btn-block" id="add-submit">Add lead to Sheet</button>
        </div>
      </form>`;
  }

  function readForm() {
    const form = $('#add-form');
    const lead = {};
    new FormData(form).forEach((v, k) => { lead[k] = String(v).trim(); });
    return lead;
  }

  // Live priority/package suggestions. Once you change a select by hand it stops auto-updating.
  function updateSuggestions() {
    const form = $('#add-form');
    if (!form) return;
    const lead = readForm();
    const pri = L.suggestPriority(lead, today());
    const pkg = L.suggestPackage(lead);
    const pSel = form.elements.Priority;
    const kSel = form.elements.Package;
    if (pSel.dataset.manual !== '1') pSel.value = pri;
    if (kSel.dataset.manual !== '1') kSel.value = pkg;
    $('#priority-hint').textContent = `Suggested: ${pri}`;
    $('#package-hint').textContent = pkg ? `Suggested: ${L.PACKAGE_LABELS[pkg]}` : 'No automatic suggestion for this combination — pick one manually.';
  }

  function normalizeIg(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/instagram\.com/i.test(v)) return `https://${v.replace(/^\/+/, '')}`;
    return `https://instagram.com/${v.replace(/^@/, '')}`;
  }

  async function submitAdd() {
    const form = $('#add-form');
    if (!form.reportValidity()) return;
    const submit = $('#add-submit');
    const f = readForm();
    const lead = { ...f };
    lead['Instagram Link'] = normalizeIg(f['Instagram Link']);
    const fol = L.parseFollowers(f.Followers);
    lead.Followers = f.Followers && fol === null ? f.Followers : fol === null ? '' : fol;
    if (f.Followers && fol === null) { toast('Followers must be a number (e.g. 4200 or 4.2k)', 'warn'); return; }
    lead.Status = 'Warming';
    lead['Engagement Started'] = today();
    lead['Engagement Touches'] = 0;
    lead['Last Contact Date'] = '';
    submit.disabled = true; submit.textContent = 'Saving…';
    try {
      const r = await api('POST', { lead });
      state.leads.push({ ...Object.fromEntries(FIELDS.map((k) => [k, lead[k] === undefined ? '' : String(lead[k])])), _row: r.row });
      toast(`${lead['Gym Name']} added to Sheet ✓ (row ${r.row})`);
      state.modal = null; renderModal(); render();
    } catch (e) {
      showError(`Could not add "${lead['Gym Name']}": ${e.message}`);
      submit.disabled = false; submit.textContent = 'Add lead to Sheet';
    }
  }


  // ----- Reply handler
  function replyHtml() {
    const m = state.modal;
    const lead = findLead(m.row);
    const rec = L.recommendedPriceKey(lead);
    const pkg = L.effectivePackage(lead);
    const options = L.REPLY_OPTIONS.map((o) => {
      const av = L.replyAvailability(o.key, lead, today());
      const sel = m.key === o.key;
      const match = (o.key === 'priceFull' || o.key === 'priceAddon') && o.key === rec ? '<span class="match">✓ matches package</span>' : '';
      return `<button type="button" class="opt ${o.indent ? 'indent' : ''} ${sel ? 'sel' : ''}" ${av.ok ? '' : 'aria-disabled="true" disabled'} data-action="pickReply" data-key="${o.key}">
        <span class="radio"></span><span class="flex-1">${esc(o.label)}${match}${av.ok ? '' : `<small>${esc(av.reason)}</small>`}</span></button>`;
    }).join('');

    let result = '';
    if (m.key) {
      const r = L.buildReply(m.key, lead, today());
      const parts = [];
      if (r.instruction) parts.push(`<div class="note" style="font-weight:600">${icon('info')}<div>Instruction: ${esc(r.instruction)}</div></div>`);
      r.messages.forEach((msg) => parts.push(`<div><div class="lbl">${esc(msg.label)}</div><div class="msg" style="margin-top:0">${esc(msg.text)}</div><div class="mt-2.5">${copyBtn(msg.text, 'Copy message', 'btn-block sm:w-auto')}</div></div>`));
      if (r.laterMessage) {
        parts.push(m.step2
          ? `<div><div class="lbl">${esc(r.laterMessage.label)}</div><div class="msg" style="margin-top:0">${esc(r.laterMessage.text)}</div><div class="mt-2.5">${copyBtn(r.laterMessage.text, 'Copy Step 2', 'btn-block sm:w-auto')}</div></div>`
          : `<div class="empty" style="display:block">Send Step 1 first. Don't offer the video until they respond.<div class="mt-2.5">${btn('Show Step 2 (after they respond)', 'showStep2')}</div></div>`);
      }
      if (r.loom) {
        parts.push(`<div class="suggest"><div class="font-bold text-sm mb-2.5">Pre-record checklist · Loom, 1.5–2 min, face on camera</div>${loomHtml(lead, true)}</div>`);
      }
      const changes = [];
      if (r.setStatus && r.setStatus !== lead.Status) changes.push(`Status → ${r.setStatus}`);
      if (r.setPackage && r.setPackage !== lead.Package) changes.push(`Package → ${r.setPackage}`);
      if (r.logEvent) changes.push('mark price follow-up sent');
      changes.push('Last Contact → today');
      if (m.key === 'priceFull' || m.key === 'priceAddon') {
        if (rec && m.key !== rec) parts.push(`<div class="note">${icon('alert')}<div>This lead's package is <b>${esc(pkg)}</b>, but you picked the other price message. Saving will switch Package to match what you quote.</div></div>`);
        if (!rec) parts.push(`<div class="note">${icon('alert')}<div>This lead's package is ${esc(pkg || 'not set')} — double-check you're quoting the right tier.</div></div>`);
      }
      parts.push(m.saved
        ? `<div class="font-bold text-sm" style="color:var(--ok);display:flex;gap:.4rem;align-items:center">${icon('check')}Saved to Sheet. Copy the message above if you haven't yet.</div>`
        : `<div>${btn(`Save: ${esc(changes.join(' · '))}`, 'applyReply', {}, 'btn-ok btn-lg btn-block', 'check')}<div class="muted text-xs mt-1.5">Copy the message first, send it, then save.</div></div>`);
      result = `<div class="mt-5 space-y-4 pt-5" style="border-top:1px solid var(--border)">${parts.join('')}</div>`;
    }
    return `
      <div class="flex flex-wrap gap-1.5 mb-3.5">${statusChip(lead.Status)}${chip(pkg || 'Package not set', PKG_TONE[pkg])}</div>
      <div class="space-y-2">${options}</div>${result}`;
  }

  // ----- Loom script
  function loomHtml(lead, checklist = false) {
    const steps = L.loomStepsFor(lead);
    const addonNote = lead && L.effectivePackage(lead) === PKG.ADDON
      ? `<div class="note mb-3" style="--warn:#14b8a6">${icon('info')}<div>This lead is on the Follow-up Add-on — keep the demo on the confirmation, reminder and follow-ups; don't promise the booking page.</div></div>` : '';
    return `
      ${addonNote}
      <ol class="space-y-3" style="list-style:none;padding:0;margin:0">
        ${steps.map((s) => `<li class="step"><span class="step-n">${s.n}</span><div class="text-sm" style="line-height:1.45;padding-top:.1rem">${checklist ? '<input type="checkbox">' : ''}<b>${esc(s.name)}</b><span class="secs">${s.secs}s</span><div class="mt-0.5" style="color:var(--muted)">${esc(s.text)}</div></div></li>`).join('')}
      </ol>
      <div class="rule">${icon('x')}${esc(L.LOOM_RULE)}</div>`;
  }

  // ----- Connection test
  function testHtml() {
    const t = state.modal;
    if (t.running) return '<div class="space-y-2"><div class="skeleton" style="height:3rem"></div><div class="skeleton" style="height:3rem"></div><div class="muted text-sm">Testing read + write against your Sheet…</div></div>';
    const steps = (t.result && t.result.steps) || [];
    return `
      <div class="space-y-2.5">${steps.map((s) => `<div class="card" style="padding:.7rem .85rem;box-shadow:none"><div class="text-sm font-bold" style="color:${s.ok ? 'var(--ok)' : 'var(--danger)'};display:flex;gap:.45rem;align-items:center">${icon(s.ok ? 'check' : 'x')}${esc(s.name)}</div><div class="text-xs mt-1 break-words muted">${esc(s.detail)}</div></div>`).join('')}</div>
      ${t.error ? `<div class="alert alert-danger" style="display:block"><span class="break-words">${esc(t.error)}</span></div>` : ''}
      ${t.result && t.result.ok ? `<div class="mt-3 font-bold" style="color:var(--ok)">All good — read and write both work.</div>` : ''}
      <div class="mt-4">${btn('Run again', 'openTest', {}, '', 'refresh')}</div>`;
  }

  async function runTestModal() {
    state.modal = { type: 'test', running: true };
    renderModal();
    try {
      state.modal = { type: 'test', result: await api('GET', null, '/api/test') };
    } catch (e) {
      state.modal = { type: 'test', error: e.message };
    }
    renderModal();
  }

  // ---------------------------------------------------------------- events
  const handlers = {
    copy: (d) => copyText(d.text),
    refresh: () => load(),
    touch: (d) => touch(d.row),
    sendDm1: (d) => sendDm1(d.row),
    dismissSent: (d) => { state.justSent.delete(Number(d.row)); render(); },
    markFollowUp: (d) => markFollowUp(d.row),
    markPriceFollowUp: (d) => markPriceFollowUp(d.row),
    markLost: (d) => markLost(d.row),
    copyFollowUp: (d) => copyFollowUp(d.row),
    toggleRow: (d) => { const r = Number(d.row); state.expanded.has(r) ? state.expanded.delete(r) : state.expanded.add(r); render(); },
    setTab: (d) => setTab(d.tab),
    togglePreview: (d) => { const r = Number(d.row); state.preview.has(r) ? state.preview.delete(r) : state.preview.add(r); render(); },
    filterStatus: (d) => {
      // Warming / DM Sent have their own tabs; the other statuses open All leads pre-filtered.
      if (d.status === 'Warming') return setTab('warming');
      if (d.status === 'DM Sent') return setTab('followups');
      state.filters.status = d.status;
      return setTab('all');
    },
    toggleSort: () => { state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc'; render(); },
    openAdd: () => { state.modal = { type: 'add' }; renderModal(); },
    openLoom: () => { state.modal = { type: 'loom' }; renderModal(); },
    openTest: () => runTestModal(),
    openReply: (d) => { state.modal = { type: 'reply', row: Number(d.row), key: null, step2: false, saved: false }; renderModal(); },
    pickReply: (d) => { state.modal.key = d.key; state.modal.step2 = false; state.modal.saved = false; renderModal(); },
    showStep2: () => { state.modal.step2 = true; renderModal(); },
    applyReply: () => applyReply(),
    openNotes: (d) => { state.modal = { type: 'notes', row: Number(d.row) }; renderModal(); },
    saveNotes: async () => {
      const lead = findLead(state.modal.row);
      const ok = await writeLead(lead, { Notes: $('#notes-text').value }, [], 'Notes saved ✓');
      if (ok) closeModal();
    },
    closeModal: () => closeModal(),
    modalBackdrop: (d, el, e) => { if (e.target === el) closeModal(); },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const h = handlers[el.dataset.action];
    if (h) h(el.dataset, el, e);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.filter) { state.filters[t.dataset.filter] = t.value; render(); return; }
    if (t.dataset.fieldSelect) {
      const lead = findLead(t.dataset.row);
      const field = t.dataset.fieldSelect;
      writeLead(lead, { [field]: t.value }, [], `${field} saved ✓`).then((ok) => { if (!ok) render(); });
      return;
    }
    if (t.form && t.form.id === 'add-form') onAddFormEdit(t);
  });

  function onAddFormEdit(t) {
    if (t.name === 'Priority' || t.name === 'Package') t.dataset.manual = '1';
    updateSuggestions();
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { state.query = t.value; const v = $('#view'); if (v) v.innerHTML = renderView(); return; }
    if (t.form && t.form.id === 'add-form' && t.name !== 'Priority' && t.name !== 'Package') onAddFormEdit(t);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'add-form') { e.preventDefault(); submitAdd(); }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.modal) closeModal(); });

  // Day rolls over while the tab sits open on a phone — refresh when you come back to it.
  let lastDay = today();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && today() !== lastDay && !state.modal) { lastDay = today(); load(); }
  });

  window.addEventListener('hashchange', () => { const k = location.hash.replace('#', ''); if (state.loaded && k !== state.tab) setTab(k, { scroll: false }); });

  load();
})();
