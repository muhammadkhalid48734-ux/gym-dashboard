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
    modal: null,                     // { type: 'add'|'reply'|'notes'|'loom'|'test', ... }
  };
  const inflight = new Set();
  const today = () => L.todayISO();

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => document.querySelector(sel);
  const findLead = (row) => state.leads.find((l) => l._row === Number(row));

  const STATUS_CLS = {
    Warming: 'bg-amber-100 text-amber-800', 'DM Sent': 'bg-blue-100 text-blue-800', Replied: 'bg-violet-100 text-violet-800',
    'Audit Sent': 'bg-cyan-100 text-cyan-800', 'Price Sent': 'bg-orange-100 text-orange-800', Closed: 'bg-green-100 text-green-800', Lost: 'bg-gray-200 text-gray-600',
  };
  const PRIORITY_CLS = { High: 'bg-red-100 text-red-700', Medium: 'bg-yellow-100 text-yellow-800', Low: 'bg-gray-100 text-gray-600' };
  const PKG_CLS = { [PKG.FULL]: 'bg-indigo-100 text-indigo-800', [PKG.ADDON]: 'bg-teal-100 text-teal-800', [PKG.SKIP]: 'bg-gray-200 text-gray-600' };
  const chip = (text, cls) => (text ? `<span class="chip ${cls || 'bg-gray-100 text-gray-600'}">${esc(text)}</span>` : '');

  function igLink(lead) {
    const url = lead['Instagram Link'];
    if (!url) return '<span class="text-xs text-gray-400">no IG link</span>';
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="text-indigo-600 underline text-sm font-medium">Instagram ↗</a>`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const ago = (date) => {
    const d = L.daysSince(date, today());
    if (d === null) return '—';
    return d === 0 ? 'today' : `${d}d ago`;
  };

  function btn(label, action, data = {}, cls = '') {
    const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button type="button" class="btn ${cls}" data-action="${action}"${attrs}>${label}</button>`;
  }
  const copyBtn = (text, label = 'Copy', extra = '') =>
    `<button type="button" class="btn btn-copy ${extra}" data-action="copy" data-text="${esc(text)}">📋 ${esc(label)}</button>`;

  // ---------------------------------------------------------------- toasts + errors
  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    const colors = kind === 'err' ? 'bg-red-600' : kind === 'warn' ? 'bg-amber-600' : 'bg-gray-900';
    el.className = `${colors} text-white text-sm font-medium rounded-lg shadow-lg px-4 py-2.5 max-w-md pointer-events-auto`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 2200);
  }

  // Sticky red banner — stays until dismissed so a failed write can't be missed.
  function showError(msg) {
    toast('⚠ Not saved — see red banner', 'err');
    const el = document.createElement('div');
    el.className = 'pointer-events-auto max-w-3xl mx-auto bg-red-600 text-white rounded-lg shadow-lg px-4 py-3 text-sm flex gap-3 items-start';
    el.innerHTML = `<div class="flex-1"><b>⚠ Sheet write failed — your change was NOT saved.</b><div class="mt-0.5 break-words">${esc(msg)}</div></div><button class="font-bold text-lg leading-none px-1" aria-label="Dismiss">×</button>`;
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

  // ---------------------------------------------------------------- rendering: header
  function renderHeader() {
    const t = today();
    const sent = L.dmsSentToday(state.activity, t);
    const cap = L.DAILY_DM_CAP;
    const daysLeft = L.daysBetween(t, L.DEADLINE);
    const counts = L.statusCounts(state.leads);
    const capCls = sent >= cap ? 'bg-red-600 text-white' : sent >= cap - 3 ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white';
    const deadlineTxt = daysLeft === null ? '' : daysLeft > 0 ? `${daysLeft} days left until Nov 3, 2026` : daysLeft === 0 ? 'Deadline is TODAY (Nov 3)' : `${-daysLeft} days past Nov 3 deadline`;
    return `
      <header class="mb-3">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-lg font-bold mr-auto">💪 Lead Outreach</h1>
          ${btn('+ Add Lead', 'openAdd', {}, 'btn-primary')}
          ${btn('🎥 Loom script', 'openLoom')}
          ${btn(state.loading ? '…' : '↻ Refresh', 'refresh')}
          ${btn('Test Sheet', 'openTest')}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <div class="rounded-lg px-3 py-1.5 font-bold text-sm ${capCls}" id="dm-counter">DMs sent today: ${sent} / ${cap}</div>
          ${deadlineTxt ? `<div class="rounded-lg px-3 py-1.5 bg-gray-900 text-white text-sm font-semibold">${esc(deadlineTxt)}</div>` : ''}
        </div>
        ${sent >= cap ? `<div class="mt-2 rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm font-semibold px-3 py-2">⚠ Daily cap reached (${cap}). Stop sending DMs from the new account today.</div>` : ''}
        <div class="mt-2 flex flex-wrap gap-1.5">
          ${L.ENUMS.Status.map((s) => `<span class="chip ${STATUS_CLS[s]} text-xs">${esc(s)}: <b>${counts[s]}</b></span>`).join('')}
        </div>
        ${state.warnings.map((w) => `<div class="mt-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm px-3 py-2">⚠ ${esc(w)}</div>`).join('')}
      </header>`;
  }

  // ---------------------------------------------------------------- rendering: Due Today
  function dueEntry(lead, tag, body, buttons) {
    return `
      <div class="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-bold">${esc(lead['Gym Name'])}</span>
          <span class="text-xs text-gray-500">${esc(lead.City)}</span>
          ${igLink(lead)}
          ${tag}
        </div>
        ${body}
        <div class="mt-2 flex flex-wrap gap-2">${buttons}</div>
      </div>`;
  }

  function renderDue() {
    const due = L.dueToday(state.leads, state.activity, today());
    const section = (title, count, items, empty) => `
      <div>
        <h3 class="text-sm font-bold text-gray-700 mb-1.5">${title} <span class="chip bg-gray-900 text-white ml-1">${count}</span></h3>
        <div class="space-y-2">${items.join('') || `<div class="text-sm text-gray-400 px-1">${empty}</div>`}</div>
      </div>`;

    const warm = due.warmup.map(({ lead }) => dueEntry(lead,
      chip(`${plural(parseInt(lead['Engagement Touches'], 10) || 0, 'touch', 'touches')}`, 'bg-amber-100 text-amber-800'),
      '<div class="mt-2 text-sm text-gray-600">Leave a <b>real comment</b> on a recent post (something specific, not an emoji), then log it.</div>',
      btn('+1 Touch', 'touch', { row: lead._row }, 'btn-green')));

    const fu = due.followups.map((it) => {
      const lead = it.lead;
      if (it.type === 'lost') {
        return dueEntry(lead, chip(`Day ${it.daysSinceDm} — no reply`, 'bg-red-100 text-red-700'),
          it.text ? `<div class="mt-2 text-xs font-bold text-gray-500">Day 10 message not sent yet:</div><div class="msg">${esc(it.text)}</div>` : '<div class="mt-2 text-sm text-gray-600">All follow-ups sent, still no reply.</div>',
          `${it.text ? copyBtn(it.text) : ''}${btn('Mark Lost', 'markLost', { row: lead._row }, 'btn-red')}`);
      }
      return dueEntry(lead, chip(`Day ${it.day} follow-up`, 'bg-blue-100 text-blue-800'),
        `<div class="msg mt-2">${esc(it.text)}</div>`,
        `${copyBtn(it.text)}${btn('Mark Sent', 'markFollowUp', { row: lead._row }, 'btn-green')}`);
    });

    const pr = due.price.map((it) => dueEntry(it.lead, chip(`Quiet ${it.daysQuiet}d after price`, 'bg-orange-100 text-orange-800') + chip(L.effectivePackage(it.lead), PKG_CLS[L.effectivePackage(it.lead)]),
      `<div class="msg mt-2">${esc(it.text)}</div>`,
      `${copyBtn(it.text)}${btn('Mark Sent', 'markPriceFollowUp', { row: it.lead._row }, 'btn-green')}`));

    const total = due.warmup.length + due.followups.length + due.price.length;
    return `
      <section class="mb-5">
        <h2 class="text-base font-bold mb-2">📌 Due today <span class="chip ${total ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}">${total}</span></h2>
        <div class="grid gap-4 lg:grid-cols-3 items-start">
          ${section('a) Warm-up touches', due.warmup.length, warm, 'All warm-up leads touched today ✓')}
          ${section('b) Follow-ups', due.followups.length, fu, 'No follow-ups due ✓')}
          ${section('c) Price-sent, quiet 3+ days', due.price.length, pr, 'Nobody to nudge ✓')}
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: Warming panel
  function renderWarming() {
    const warming = state.leads.filter((l) => l.Status === 'Warming' || state.justSent.has(l._row));
    const cards = warming.map((lead) => {
      const touches = parseInt(lead['Engagement Touches'], 10) || 0;
      const days = L.daysSince(lead['Engagement Started'], today());
      const ready = touches >= 3 && days !== null && days >= 2;
      const sent = state.justSent.has(lead._row);
      const warn = [];
      if (touches < 3) warn.push(`only ${touches} touch${touches === 1 ? '' : 'es'} so far`);
      if (days === null || days < 2) warn.push(days === null ? 'no Engagement Started date' : `only ${days} day${days === 1 ? '' : 's'} since you started engaging`);
      const dm = L.dm1(lead);
      return `
        <div class="bg-white border ${ready && !sent ? 'border-emerald-400' : 'border-gray-200'} rounded-xl p-3 shadow-sm">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-bold">${esc(lead['Gym Name'])}</span>
            <span class="text-xs text-gray-500">${esc(lead.City)}</span>
            ${igLink(lead)}
            ${sent ? chip('DM 1 sent ✓', 'bg-blue-100 text-blue-800') : ready ? chip('Ready for DM 1', 'bg-emerald-600 text-white') : ''}
          </div>
          <div class="mt-1 text-sm text-gray-600"><b>${touches}</b> touch${touches === 1 ? '' : 'es'} · <b>${days === null ? '—' : days}</b> day${days === 1 ? '' : 's'} since started</div>
          ${sent
            ? `<div class="msg mt-2">${esc(dm)}</div><div class="mt-2 flex flex-wrap gap-2">${copyBtn(dm)}${btn('Done', 'dismissSent', { row: lead._row })}</div>`
            : `${!ready ? `<div class="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠ Soft warning: ${esc(warn.join(' and '))}. You can still send.</div>` : ''}
               <div class="mt-2 flex flex-wrap gap-2">${btn('+1 Touch', 'touch', { row: lead._row }, 'btn-green')}${btn('Send DM 1', 'sendDm1', { row: lead._row }, ready ? 'btn-primary' : '')}</div>`}
        </div>`;
    });
    return `
      <section class="mb-5">
        <h2 class="text-base font-bold mb-1">🔥 Warming <span class="chip bg-gray-900 text-white">${warming.length}</span></h2>
        <div class="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">Real comments only — something specific about the post, not an emoji.</div>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">${cards.join('') || '<div class="text-sm text-gray-400 px-1">No leads warming up. Add one →</div>'}</div>
      </section>`;
  }

  // ---------------------------------------------------------------- rendering: Lead table
  const FIELDS = ['Gym Name', 'City', 'Instagram Link', 'Followers', 'Last Post Date', 'Owner Name', 'Website Link', 'Website Quality', 'Bio Link Type',
    'Has Booking Form', 'Has Follow-up Automation', 'Current Offer', 'Problem', 'Priority', 'Status', 'Last Contact Date', 'Notes',
    'Engagement Started', 'Engagement Touches', 'Package'];

  function visibleLeads() {
    const f = state.filters;
    const list = state.leads.filter((l) => (!f.city || l.City === f.city) && (!f.priority || l.Priority === f.priority) && (!f.status || l.Status === f.status));
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = L.parseDate(a['Last Contact Date']);
      const y = L.parseDate(b['Last Contact Date']);
      if (x === null && y === null) return 0;
      if (x === null) return 1;        // never-contacted rows always last
      if (y === null) return -1;
      return (x - y) * dir;
    });
  }

  function detailValue(lead, field) {
    const v = lead[field];
    if (field === 'Priority' || field === 'Package') {
      const opts = ['', ...L.ENUMS[field]];
      return `<select class="field" data-field-select="${field}" data-row="${lead._row}">${opts.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`;
    }
    if ((field === 'Instagram Link' || field === 'Website Link') && v) return `<a href="${esc(v)}" target="_blank" rel="noopener" class="text-indigo-600 underline break-all">${esc(v)}</a>`;
    return `<span class="break-words whitespace-pre-wrap">${esc(v) || '<span class="text-gray-300">—</span>'}</span>`;
  }

  function renderRow(lead) {
    const open = state.expanded.has(lead._row);
    const pkg = lead.Package || '';
    return `
      <div class="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div class="p-3 cursor-pointer" data-action="toggleRow" data-row="${lead._row}">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="font-bold truncate">${esc(lead['Gym Name'])} <span class="font-normal text-xs text-gray-500">${esc(lead.City)}</span></div>
              <div class="mt-1 flex flex-wrap gap-1">${chip(lead.Status, STATUS_CLS[lead.Status])}${chip(lead.Priority && `${lead.Priority} priority`, PRIORITY_CLS[lead.Priority])}${chip(pkg, PKG_CLS[pkg])}</div>
            </div>
            <div class="text-right text-xs text-gray-500 shrink-0">Last contact<br><b class="text-gray-800">${esc(ago(lead['Last Contact Date']))}</b></div>
            <div class="text-gray-400 select-none">${open ? '▾' : '▸'}</div>
          </div>
        </div>
        <div class="px-3 pb-3 flex flex-wrap gap-2" data-stop>
          ${btn('Log Reply', 'openReply', { row: lead._row }, 'btn-primary')}
          ${btn('Copy follow-up', 'copyFollowUp', { row: lead._row })}
          ${btn('+1 Touch', 'touch', { row: lead._row })}
          ${btn('Edit Notes', 'openNotes', { row: lead._row })}
        </div>
        ${open ? `<div class="border-t border-gray-100 px-3 py-3 grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
          ${FIELDS.map((f) => `<div class="${f === 'Problem' || f === 'Notes' ? 'sm:col-span-2' : ''}"><span class="lbl">${f}${f === 'Package' ? ' (sheet col 20)' : ''}</span><div class="text-sm">${detailValue(lead, f)}</div></div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  function renderTable() {
    const cities = [...new Set(state.leads.map((l) => l.City).filter(Boolean))].sort();
    const opt = (v, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`;
    const list = visibleLeads();
    return `
      <section>
        <h2 class="text-base font-bold mb-2">📋 All leads <span class="chip bg-gray-900 text-white">${list.length}${list.length !== state.leads.length ? ` / ${state.leads.length}` : ''}</span></h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <select class="field" data-filter="city"><option value="">All cities</option>${cities.map((c) => opt(c, state.filters.city)).join('')}</select>
          <select class="field" data-filter="priority"><option value="">All priorities</option>${L.ENUMS.Priority.map((c) => opt(c, state.filters.priority)).join('')}</select>
          <select class="field" data-filter="status"><option value="">All statuses</option>${L.ENUMS.Status.map((c) => opt(c, state.filters.status)).join('')}</select>
          ${btn(`Last contact: ${state.sortDir === 'desc' ? 'newest first ↓' : 'oldest first ↑'}`, 'toggleSort')}
        </div>
        <div class="space-y-2">${list.map(renderRow).join('') || '<div class="text-sm text-gray-400 px-1">No leads match.</div>'}</div>
      </section>`;
  }

  function render() {
    const app = $('#app');
    if (!state.loaded) {
      app.innerHTML = renderHeader() + (state.loadError
        ? `<div class="rounded-xl bg-red-50 border border-red-300 text-red-800 p-4 text-sm"><b>Couldn't load leads from the Sheet.</b><div class="mt-1 break-words">${esc(state.loadError)}</div><div class="mt-3 flex gap-2">${btn('Retry', 'refresh', {}, 'btn-primary')}${btn('Run connection test', 'openTest')}</div></div>`
        : '<div class="text-sm text-gray-500 p-4">Loading from Google Sheets…</div>');
      return;
    }
    // Keep scroll + focus when re-rendering after a write.
    app.innerHTML = renderHeader() + renderDue() + renderWarming() + renderTable();
  }

  // ---------------------------------------------------------------- modals
  function modalShell(title, inner) {
    return `
      <div class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" data-action="modalBackdrop">
        <div class="bg-white w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl" role="dialog" aria-label="${esc(title)}">
          <div class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
            <h2 class="font-bold flex-1 truncate">${title}</h2>
            <button class="btn" data-action="closeModal">Close ✕</button>
          </div>
          <div class="p-4">${inner}</div>
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
        <div class="mt-3 flex gap-2">${btn('Save notes', 'saveNotes', {}, 'btn-primary')}${btn('Cancel', 'closeModal')}</div>`);
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
  const fld = (label, inner, cls = '') => `<label class="block ${cls}"><span class="lbl">${label}</span>${inner}</label>`;

  function addFormHtml() {
    const E = L.ENUMS;
    return `
      <form id="add-form" class="grid gap-3 sm:grid-cols-2" novalidate>
        ${fld('Gym Name *', inp('Gym Name', 'text', 'required'))}
        ${fld('City', inp('City'))}
        ${fld('Instagram Link (or @handle)', inp('Instagram Link', 'text', 'inputmode="url"'))}
        ${fld('Followers', inp('Followers', 'text', 'inputmode="numeric" placeholder="e.g. 4200 or 4.2k"'))}
        ${fld('Last Post Date', inp('Last Post Date', 'date'))}
        ${fld('Owner Name', inp('Owner Name'))}
        ${fld('Website Link', inp('Website Link', 'text', 'inputmode="url"'))}
        ${fld('Website Quality *', selectHtml('Website Quality', E['Website Quality'], { required: true }))}
        ${fld('Bio Link Type', selectHtml('Bio Link Type', E['Bio Link Type']))}
        ${fld('Has Booking Form', selectHtml('Has Booking Form', E['Has Booking Form']))}
        ${fld('Has Follow-up Automation', selectHtml('Has Follow-up Automation', E['Has Follow-up Automation'], { value: 'Unknown' }))}
        ${fld('Current Offer * (picks the DM 1 wording)', selectHtml('Current Offer', E['Current Offer'], { required: true }))}
        ${fld('Problem', '<textarea class="field" name="Problem" rows="2"></textarea>', 'sm:col-span-2')}
        <div class="sm:col-span-2 grid gap-3 sm:grid-cols-2 bg-indigo-50 border border-indigo-200 rounded-xl p-3">
          <div>
            ${fld('Priority (suggested — override if you like)', selectHtml('Priority', E.Priority, { placeholder: '—' }))}
            <div id="priority-hint" class="text-xs text-indigo-800 mt-1"></div>
          </div>
          <div>
            ${fld('Package (suggested — override if you like)', selectHtml('Package', E.Package, { placeholder: '—' }))}
            <div id="package-hint" class="text-xs text-indigo-800 mt-1"></div>
          </div>
        </div>
        ${fld('Notes', '<textarea class="field" name="Notes" rows="2" placeholder="e.g. uses Mindbody → Low priority"></textarea>', 'sm:col-span-2')}
        <div class="sm:col-span-2 text-xs text-gray-500">On save: Status = Warming · Engagement Started = today · Touches = 0</div>
        <div class="sm:col-span-2 flex gap-2">
          <button type="submit" class="btn btn-primary flex-1 !py-3 !text-base" id="add-submit">Add lead to Sheet</button>
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
      const star = (o.key === 'priceFull' || o.key === 'priceAddon') && o.key === rec ? ' <span class="text-emerald-700">✓ matches package</span>' : '';
      return `<button type="button" class="btn w-full !justify-start text-left ${o.indent ? 'ml-5 !w-[calc(100%-1.25rem)]' : ''} ${sel ? 'btn-primary' : ''}" ${av.ok ? '' : 'aria-disabled="true" disabled'} data-action="pickReply" data-key="${o.key}">
        <span>${esc(o.label)}${star}${av.ok ? '' : `<span class="block font-normal text-xs opacity-80">${esc(av.reason)}</span>`}</span></button>`;
    }).join('');

    let result = '';
    if (m.key) {
      const r = L.buildReply(m.key, lead, today());
      const parts = [];
      if (r.instruction) parts.push(`<div class="rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-sm font-semibold p-3">📝 Instruction: ${esc(r.instruction)}</div>`);
      r.messages.forEach((msg) => parts.push(`<div><div class="lbl">${esc(msg.label)}</div><div class="msg">${esc(msg.text)}</div><div class="mt-2">${copyBtn(msg.text, 'Copy message', 'w-full sm:w-auto')}</div></div>`));
      if (r.laterMessage) {
        parts.push(m.step2
          ? `<div><div class="lbl">${esc(r.laterMessage.label)}</div><div class="msg">${esc(r.laterMessage.text)}</div><div class="mt-2">${copyBtn(r.laterMessage.text, 'Copy Step 2', 'w-full sm:w-auto')}</div></div>`
          : `<div class="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600">Send Step 1 first. Don't offer the video until they respond.<div class="mt-2">${btn('Show Step 2 (after they respond)', 'showStep2')}</div></div>`);
      }
      if (r.loom) {
        parts.push(`<div class="rounded-lg bg-cyan-50 border border-cyan-200 p-3"><div class="font-bold text-sm mb-1">🎥 Pre-record checklist (Loom, 1.5–2 min, face on camera)</div>${loomHtml(lead, true)}</div>`);
      }
      const changes = [];
      if (r.setStatus && r.setStatus !== lead.Status) changes.push(`Status → ${r.setStatus}`);
      if (r.setPackage && r.setPackage !== lead.Package) changes.push(`Package → ${r.setPackage}`);
      if (r.logEvent) changes.push('mark price follow-up sent');
      changes.push('Last Contact → today');
      if (m.key === 'priceFull' || m.key === 'priceAddon') {
        if (rec && m.key !== rec) parts.push(`<div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">Heads up: this lead's package is <b>${esc(pkg)}</b>, but you picked the other price message. Saving will switch Package to match what you quote.</div>`);
        if (!rec) parts.push(`<div class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">This lead's package is ${esc(pkg || 'not set')} — double-check you're quoting the right tier.</div>`);
      }
      parts.push(m.saved
        ? '<div class="text-sm font-bold text-emerald-700">✓ Saved to Sheet. Copy the message above if you haven\'t yet.</div>'
        : `<div>${btn(`Save: ${esc(changes.join(' · '))}`, 'applyReply', {}, 'btn-green !py-3 w-full sm:w-auto')}<div class="text-xs text-gray-500 mt-1">Copy the message first, send it, then save.</div></div>`);
      result = `<div class="mt-4 space-y-3 border-t border-gray-200 pt-4">${parts.join('')}</div>`;
    }
    return `
      <div class="flex flex-wrap gap-1.5 mb-3">${chip(lead.Status, STATUS_CLS[lead.Status])}${chip(pkg || 'Package not set', PKG_CLS[pkg])}</div>
      <div class="space-y-1.5">${options}</div>${result}`;
  }

  // ----- Loom script
  function loomHtml(lead, checklist = false) {
    const steps = L.loomStepsFor(lead);
    const addonNote = lead && L.effectivePackage(lead) === PKG.ADDON
      ? '<div class="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded px-2 py-1 mb-2">This lead is on the Follow-up Add-on — keep the demo on the confirmation, reminder and follow-ups; don\'t promise the booking page.</div>' : '';
    return `
      ${addonNote}
      <ol class="space-y-2">
        ${steps.map((s) => `<li class="flex gap-2"><span class="chip bg-gray-900 text-white h-fit">${s.n}</span><div class="text-sm">${checklist ? '<input type="checkbox" class="mr-1.5 align-middle">' : ''}<b>${esc(s.name)} (${s.secs}s)</b> — ${esc(s.text)}</div></li>`).join('')}
      </ol>
      <div class="mt-3 text-sm font-bold text-red-700">🚫 ${esc(L.LOOM_RULE)}</div>`;
  }

  // ----- Connection test
  function testHtml() {
    const t = state.modal;
    if (t.running) return '<div class="text-sm text-gray-500">Testing read + write against your Sheet…</div>';
    const steps = (t.result && t.result.steps) || [];
    return `
      <div class="space-y-1.5">${steps.map((s) => `<div class="text-sm ${s.ok ? 'text-emerald-800' : 'text-red-700'}"><b>${s.ok ? '✓' : '✗'} ${esc(s.name)}</b><div class="text-xs break-words ${s.ok ? 'text-gray-500' : ''}">${esc(s.detail)}</div></div>`).join('')}</div>
      ${t.error ? `<div class="text-sm text-red-700 break-words">${esc(t.error)}</div>` : ''}
      ${t.result && t.result.ok ? '<div class="mt-3 font-bold text-emerald-700">All good — read and write both work.</div>' : ''}
      <div class="mt-3">${btn('Run again', 'openTest')}</div>`;
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
    if (e.target.closest('[data-stop]') && !e.target.closest('[data-action]')) return;
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

  load();
})();
