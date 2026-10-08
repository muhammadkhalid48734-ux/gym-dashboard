// Pure business logic: dates, suggestions, message templates, due-today rules.
// No DOM, no network — loaded by the browser as window.Logic and by node tests via require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEADLINE = '2026-11-03';
  // Two sending accounts, 10 DMs each per day (20 total).
  const ACCOUNTS = ['Account 1', 'Account 2'];
  const ACCOUNT_CAP = 10;
  const DAILY_DM_CAP = ACCOUNTS.length * ACCOUNT_CAP;

  const PKG = { FULL: 'Trial-to-Member System', ADDON: 'Follow-up Add-on', SKIP: 'Skip' };
  const PACKAGE_LABELS = {
    [PKG.FULL]: 'Trial-to-Member System — $500 (page + confirmation + reminder + follow-up)',
    [PKG.ADDON]: 'Follow-up Add-on — $250-300 (confirmation + reminder + follow-up only)',
    [PKG.SKIP]: 'Skip or deprioritize',
  };

  const ENUMS = {
    'Website Quality': ['None', 'Outdated', 'Modern'],
    'Bio Link Type': ['Linktree', 'None', 'Website'],
    'Has Booking Form': ['Yes', 'No'],
    'Has Follow-up Automation': ['Yes', 'No', 'Unknown'],
    'Current Offer': ['Free Trial', 'Paid Intro', 'None'],
    'Priority': ['High', 'Medium', 'Low'],
    'Status': ['Warming', 'DM Sent', 'Replied', 'Audit Sent', 'Price Sent', 'Closed', 'Lost'],
    'Package': [PKG.FULL, PKG.ADDON, PKG.SKIP],
    'DM Account': ['Account 1', 'Account 2'],
  };

  // ---------- dates (all YYYY-MM-DD, local calendar days) ----------
  const pad = (n) => String(n).padStart(2, '0');
  function todayISO(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // Accepts YYYY-MM-DD and M/D/YYYY (what Sheets shows if a date is typed in by hand).
  function parseDate(s) {
    if (s === undefined || s === null) return null;
    s = String(s).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
    return null;
  }
  // Any accepted date format -> YYYY-MM-DD ('' if unparseable)
  function normalizeDate(s) {
    const ms = parseDate(s);
    return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
  }
  // whole days from a to b (b - a); null if either is unparseable
  function daysBetween(a, b) {
    const x = parseDate(a);
    const y = parseDate(b);
    if (x === null || y === null) return null;
    return Math.round((y - x) / 86400000);
  }
  const daysSince = (date, today) => daysBetween(date, today || todayISO());

  function parseFollowers(v) {
    if (v === undefined || v === null) return null;
    const m = /^([\d.,]+)\s*([km])?$/i.exec(String(v).trim());
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1e3 : 1e6;
    return Math.round(n);
  }

  // ---------- suggestions ----------
  const PLATFORM_RE = /mindbody|glofox|wodify/i;
  const mentionsPlatform = (lead) => PLATFORM_RE.test(`${lead.Notes || ''} ${lead.Problem || ''}`);

  function suggestPriority(lead, today) {
    if (mentionsPlatform(lead)) return 'Low';
    const sinceDays = daysSince(lead['Last Post Date'], today);
    const postedRecently = sinceDays !== null && sinceDays <= 14;
    const weakWebsite = lead['Website Quality'] === 'None' || lead['Website Quality'] === 'Outdated';
    const bookingGap = lead['Has Booking Form'] === 'Yes' && lead['Has Follow-up Automation'] === 'No';
    if ((weakWebsite || bookingGap) && postedRecently) return 'High';
    if (lead['Current Offer'] === 'Paid Intro') return 'Medium';
    return 'Low';
  }

  // Returns a Package value, or '' when none of the rules apply (user picks manually).
  function suggestPackage(lead) {
    const wq = lead['Website Quality'];
    if (wq === 'None' || wq === 'Outdated') return PKG.FULL;
    if (wq === 'Modern') {
      if (mentionsPlatform(lead)) return PKG.SKIP;
      if (lead['Has Booking Form'] === 'Yes' && lead['Has Follow-up Automation'] === 'No') return PKG.ADDON;
    }
    return '';
  }
  const effectivePackage = (lead) => lead.Package || suggestPackage(lead);

  // ---------- message templates ----------
  const owner = (l) => (l['Owner Name'] || '').trim() || 'there';
  const gym = (l) => (l['Gym Name'] || '').trim() || 'your gym';

  function dm1(lead) {
    const o = owner(lead);
    const g = gym(lead);
    switch (lead['Current Offer']) {
      case 'Free Trial':
        return `Hey ${o}! Saw ${g}'s page, love the energy. Quick question — when someone asks about your free trial through Instagram, how do you usually handle it?`;
      case 'Paid Intro':
        return `Hey ${o}! Quick question — when someone books your intro offer, does a reminder or follow-up go out automatically, or do you track it manually?`;
      default: // 'None' (or unset)
        return `Hey ${o}! Saw ${g}'s page, love the energy. Quick one — do you give new people a way to try the place first, like a free class or intro week?`;
    }
  }

  const FOLLOW_UPS = [
    { day: 3, text: (l) => `Hey ${owner(l)}, just floating this back up — no worries if now's not a good time!` },
    { day: 6, text: () => 'Quick context on why I asked — most studios lose trial bookings somewhere between the signup and the actual class, just because nothing follows up automatically. Curious how it works on your end?' },
    { day: 10, text: () => "No worries if this isn't useful right now — I'll leave it here. Feel free to reach out anytime." },
  ];

  const MSG = {
    manualStep1: "Oh interesting — so most of it comes through DMs then? That's how it works at a lot of studios I look at.",
    manualStep2: "Yeah, that's usually where leads leak — people who book but never get a nudge just don't show up. I built something for this called the Trial-to-Member System — mind if I send a 2-min video showing how it works?",
    platformInstruction: 'Ask whether the booked person gets an automatic reminder/follow-up. YES → exit politely, mark Lost. NO → pitch follow-up automation only.',
    platformQuestion: 'Nice — does the person who books actually get an automatic reminder and a follow-up after, or just the booking confirmation?',
    platformNoFollowUp: "Gotcha — that's the gap I'd fill. I have a Follow-up Add-on that plugs into what you already use: automatic reminder before the trial, and a couple of follow-ups after. Want me to send a short video?",
    priceFull: 'The Trial-to-Member System is $500 one-time — landing page, instant booking confirmation, a reminder before the trial, and a follow-up sequence after. 50% to start, 50% when it\'s live. Want to get started?',
    priceAddon: 'The Follow-up Add-on is $300 one-time — it hooks into your existing booking form and handles the confirmation, the reminder, and the follow-ups after. 50% to start, 50% when it\'s live. Want to get started?',
    quietFull: "If $500 isn't right for now, I can also do a smaller scope for less — let me know if that works better.",
    // The Add-on is already the smaller scope, so the "$500 / smaller scope" wording would be wrong for it.
    quietAddon: "If $300 isn't right for now, no worries. Let me know and I'm happy to chat it through.",
    notInterested: 'Totally understand, appreciate you replying! If that ever changes, feel free to reach out.',
  };

  const priceMessage = (pkg) => (pkg === PKG.ADDON ? MSG.priceAddon : MSG.priceFull);
  const quietMessage = (lead) => (effectivePackage(lead) === PKG.ADDON ? MSG.quietAddon : MSG.quietFull);

  // ---------- Loom script (static reference) ----------
  const LOOM_STEPS = [
    { n: 1, name: 'Intro', secs: 10, text: 'Who I am, why I\'m reaching out.' },
    { n: 2, name: 'Problem', secs: 20, text: 'Show their Instagram/bio, point out the booking gap.' },
    { n: 3, name: 'Solution', secs: 40, text: 'Walk through the Trial-to-Member System: the booking page, the instant confirmation, the reminder, the follow-up sequence.' },
    { n: 4, name: 'Value', secs: 15, text: '"At your follower count, even a 1% trial-booking rate is [X] leads — one member is worth $600+/year."' },
    { n: 5, name: 'CTA', secs: 10, text: '"If the Trial-to-Member System looks useful, reply and I\'ll walk you through pricing."' },
  ];
  // Your exact wording for the reminder shown in the Warming panel.
  const WARMUP_REMINDER = 'Real comments only — something specific about the post, not an emoji.';
  const LOOM_RULE = 'Never mention price in the video. Aim for 1.5-2 min, face on camera.';

  // Same steps with [X] filled from the lead's follower count (1% of followers).
  function loomStepsFor(lead) {
    const f = parseFollowers(lead && lead.Followers);
    return LOOM_STEPS.map((s) => (s.n === 4 && f ? { ...s, text: s.text.replace('[X]', String(Math.round(f * 0.01))) } : s));
  }

  // ---------- activity-derived state ----------
  // Undo support: an "Undo" row cancels the latest in-effect event of that name for the same lead.
  // Everything that reads the log (DM counters, follow-up stage, price follow-up) works on the cleaned list.
  function cleanActivity(activity) {
    const out = [];
    (activity || []).forEach((e) => {
      if (e.Event !== 'Undo') { out.push(e); return; }
      const key = leadKey(e);
      for (let i = out.length - 1; i >= 0; i--) {
        if (leadKey(out[i]) === key && out[i].Event === e.Detail) { out.splice(i, 1); break; }
      }
    });
    return out;
  }

  const leadKey = (l) => `${(l['Gym Name'] || l.Gym || '').trim()}|${(l.City || '').trim()}`.toLowerCase();
  const eventsFor = (activity, lead) => (activity || []).filter((e) => leadKey(e) === leadKey(lead));

  // DM 1 date + how many of the Day 3/6/10 follow-ups have been sent since.
  // Falls back to Last Contact when the lead was moved to "DM Sent" by hand in the Sheet.
  function dmState(lead, activity, today) {
    const evs = eventsFor(activity, lead);
    let lastDm = -1;
    evs.forEach((e, i) => { if (e.Event === 'DM Sent') lastDm = i; });
    const dm1Date = lastDm >= 0 ? evs[lastDm].Date : lead['Last Contact Date'];
    const followUpsSent = evs.slice(lastDm + 1).filter((e) => e.Event === 'Follow-up').length;
    return { dm1Date, daysSinceDm: daysSince(dm1Date, today), followUpsSent, hasDmEvent: lastDm >= 0 };
  }

  function priceFollowUpSent(lead, activity) {
    const evs = eventsFor(activity, lead);
    let lastPrice = -1;
    evs.forEach((e, i) => { if (e.Event === 'Price Sent') lastPrice = i; });
    return evs.slice(lastPrice + 1).some((e) => e.Event === 'Price follow-up');
  }

  // Next unsent follow-up message for a lead (used by "Copy follow-up"), regardless of whether it's due.
  function nextMessage(lead, activity, today) {
    const st = lead.Status;
    if (st === 'Warming') return { label: 'DM 1', text: dm1(lead) };
    if (st === 'DM Sent') {
      const s = dmState(lead, activity, today);
      if (s.followUpsSent >= FOLLOW_UPS.length) return { label: null, text: null, reason: 'All 3 follow-ups already sent. Mark Lost if there is still no reply.' };
      const f = FOLLOW_UPS[s.followUpsSent];
      return { label: `Day ${f.day} follow-up`, text: f.text(lead) };
    }
    if (st === 'Price Sent') return { label: 'Price follow-up', text: quietMessage(lead) };
    return { label: null, text: null, reason: `No follow-up message for status "${st}".` };
  }

  // ---------- Due Today ----------
  function dueToday(leads, activity, today) {
    const warmup = [];
    const followups = [];
    const price = [];
    leads.forEach((lead) => {
      if (lead.Status === 'Warming') {
        if (daysSince(lead['Last Contact Date'], today) !== 0) warmup.push({ lead });
      } else if (lead.Status === 'DM Sent') {
        const s = dmState(lead, activity, today);
        if (s.daysSinceDm === null) return;
        if (s.daysSinceDm >= 11) {
          followups.push({
            lead, type: 'lost', daysSinceDm: s.daysSinceDm,
            text: s.followUpsSent < FOLLOW_UPS.length ? FOLLOW_UPS[2].text(lead) : null,
            state: s,
          });
        } else if (s.followUpsSent < FOLLOW_UPS.length) {
          const f = FOLLOW_UPS[s.followUpsSent];
          // >= (not ==) so a missed day doesn't make the follow-up silently disappear;
          // skipped if already contacted today so one "Mark Sent" doesn't immediately surface the next stage.
          if (s.daysSinceDm >= f.day && daysSince(lead['Last Contact Date'], today) !== 0) {
            followups.push({ lead, type: 'followup', day: f.day, stage: s.followUpsSent + 1, text: f.text(lead), daysSinceDm: s.daysSinceDm, state: s });
          }
        }
      } else if (lead.Status === 'Price Sent') {
        const d = daysSince(lead['Last Contact Date'], today);
        if (d !== null && d >= 3 && !priceFollowUpSent(lead, activity)) {
          price.push({ lead, text: quietMessage(lead), daysQuiet: d });
        }
      }
    });
    return { warmup, followups, price };
  }

  // ---------- Reply handler ----------
  // Each option: { key, label, indent? }. buildReply returns what to show + what saving does.
  const REPLY_OPTIONS = [
    { key: 'manual', label: 'Manually / no system' },
    { key: 'platform', label: 'They already use Mindbody / Glofox / Wodify' },
    { key: 'platformNo', label: 'Platform user: NO automatic follow-up', indent: true },
    { key: 'platformYes', label: 'Platform user: already has automatic follow-up (exit)', indent: true },
    { key: 'video', label: 'Said yes, send the video' },
    { key: 'priceFull', label: 'Interested after the video: Trial-to-Member System ($500)' },
    { key: 'priceAddon', label: 'Interested after the video: Follow-up Add-on ($300)' },
    { key: 'quiet', label: 'Went quiet after price' },
    { key: 'no', label: 'Not interested' },
  ];

  function replyAvailability(key, lead, today) {
    if (key === 'quiet') {
      if (lead.Status !== 'Price Sent') return { ok: false, reason: 'Only when Status = Price Sent' };
      const d = daysSince(lead['Last Contact Date'], today);
      if (d === null || d < 3) return { ok: false, reason: `Needs 3+ days since price was sent${d === null ? '' : ` (${d} so far)`}` };
    }
    return { ok: true };
  }

  function buildReply(key, lead, today) {
    const base = { key, messages: [], laterMessage: null, instruction: null, loom: false, setStatus: null, setPackage: null, logEvent: null };
    switch (key) {
      case 'manual':
        return { ...base,
          messages: [{ label: 'Step 1: send now', text: MSG.manualStep1 }],
          laterMessage: { label: 'Step 2: send AFTER they respond', text: MSG.manualStep2 },
          setStatus: 'Replied' };
      case 'platform':
        return { ...base,
          instruction: MSG.platformInstruction,
          messages: [{ label: 'Ready message', text: MSG.platformQuestion }],
          setStatus: 'Replied' };
      case 'platformNo':
        return { ...base,
          messages: [{ label: 'They have no automatic follow-up', text: MSG.platformNoFollowUp }],
          setStatus: 'Replied', setPackage: PKG.ADDON };
      case 'platformYes':
        return { ...base,
          instruction: 'Exit politely and mark Lost.',
          messages: [{ label: 'Polite exit', text: MSG.notInterested }],
          setStatus: 'Lost' };
      case 'video':
        return { ...base, loom: true, setStatus: 'Audit Sent' };
      case 'priceFull':
        return { ...base,
          messages: [{ label: 'Price: Trial-to-Member System', text: MSG.priceFull }],
          setStatus: 'Price Sent', setPackage: PKG.FULL };
      case 'priceAddon':
        return { ...base,
          messages: [{ label: 'Price: Follow-up Add-on', text: MSG.priceAddon }],
          setStatus: 'Price Sent', setPackage: PKG.ADDON };
      case 'quiet':
        return { ...base,
          messages: [{ label: 'Price objection', text: quietMessage(lead) }],
          logEvent: 'Price follow-up' };
      case 'no':
        return { ...base, messages: [{ label: 'Polite close', text: MSG.notInterested }], setStatus: 'Lost' };
      default:
        throw new Error(`Unknown reply type: ${key}`);
    }
  }

  // Which price option matches the lead's package (for highlighting in the reply handler).
  function recommendedPriceKey(lead) {
    const pkg = effectivePackage(lead);
    if (pkg === PKG.ADDON) return 'priceAddon';
    if (pkg === PKG.FULL) return 'priceFull';
    return null;
  }

  // Every template string, for tests that guard against invented social proof.
  function allTemplates() {
    const sample = { 'Gym Name': 'G', 'Owner Name': 'O' };
    const out = Object.values(MSG).slice();
    ['Free Trial', 'Paid Intro', 'None'].forEach((o) => out.push(dm1({ ...sample, 'Current Offer': o })));
    FOLLOW_UPS.forEach((f) => out.push(f.text(sample)));
    LOOM_STEPS.forEach((s) => out.push(s.text));
    return out;
  }

  function statusCounts(leads) {
    const c = {};
    ENUMS.Status.forEach((s) => { c[s] = 0; });
    leads.forEach((l) => { if (c[l.Status] !== undefined) c[l.Status] += 1; });
    return c;
  }

  // Distinct leads whose status became "DM Sent" today (from the Activity log).
  function dmsSentToday(activity, today) {
    const set = new Set();
    (activity || []).forEach((e) => { if (e.Event === 'DM Sent' && e.Date === today) set.add(leadKey(e)); });
    return set.size;
  }


  // ---------- two sending accounts ----------
  const accountOf = (detail) => { const m = /Account\s*(\d)/i.exec(detail || ''); return m ? `Account ${m[1]}` : null; };

  // Distinct leads moved to "DM Sent" today, per account (read from the Activity log; "unassigned" = no account recorded).
  function dmsByAccountToday(activity, today) {
    const seen = { 'Account 1': new Set(), 'Account 2': new Set(), unassigned: new Set() };
    (activity || []).forEach((e) => {
      if (e.Event !== 'DM Sent' || e.Date !== today) return;
      const a = accountOf(e.Detail);
      seen[a && seen[a] ? a : 'unassigned'].add(leadKey(e));
    });
    return { 'Account 1': seen['Account 1'].size, 'Account 2': seen['Account 2'].size, unassigned: seen.unassigned.size };
  }

  // First account that still has room today (Account 1 fills first), or null when both are full.
  const nextAccount = (counts) => ACCOUNTS.find((a) => counts[a] < ACCOUNT_CAP) || null;

  function warmupInfo(lead, today) {
    const touches = parseInt(lead['Engagement Touches'], 10) || 0;
    const days = daysSince(lead['Engagement Started'], today);
    return { lead, touches, days, ready: touches >= 3 && days !== null && days >= 2 };
  }

  // Which account a lead belongs to is written in the Sheet ("DM Account"). Leads go in blocks of 10 in Sheet order:
  // rows 1-10 → Account 1, 11-20 → Account 2, 21-30 → Account 1, and so on.
  const blockAccount = (index) => ACCOUNTS[Math.floor(index / ACCOUNT_CAP) % ACCOUNTS.length];

  // Account for a lead that is about to be added at the end of the sheet: carry on the current block of 10.
  function nextNewLeadAccount(leads) {
    const assigned = leads.filter((l) => ACCOUNTS.includes(l['DM Account'])).sort((a, b) => a._row - b._row);
    if (!assigned.length) return ACCOUNTS[0];
    const last = assigned[assigned.length - 1]['DM Account'];
    let run = 0;
    for (let i = assigned.length - 1; i >= 0 && assigned[i]['DM Account'] === last; i--) run++;
    return run < ACCOUNT_CAP ? last : ACCOUNTS[(ACCOUNTS.indexOf(last) + 1) % ACCOUNTS.length];
  }

  // Today's DM list. Each account's list holds the READY leads assigned to it (most touches first), up to the slots it has left
  // today; leads with no account yet fill whatever room is left (Account 1 first). A lead that is sent leaves the list and frees
  // a slot in its own account, so nobody else changes account while you work through it.
  function buildDmQueue(leads, activity, today, includeNotReady) {
    const counts = dmsByAccountToday(activity, today);
    const warming = leads.filter((l) => l.Status === 'Warming').map((l) => warmupInfo(l, today));
    const pool = warming.filter((x) => includeNotReady || x.ready)
      .sort((a, b) => (b.ready - a.ready) || (b.touches - a.touches) || (a.lead._row - b.lead._row));
    const room = {};
    const lists = {};
    ACCOUNTS.forEach((a) => { room[a] = Math.max(ACCOUNT_CAP - counts[a], 0); lists[a] = []; });
    const waiting = [];
    pool.forEach((x) => {
      const a = x.lead['DM Account'];
      if (!ACCOUNTS.includes(a)) return;
      if (lists[a].length < room[a]) lists[a].push(x); else waiting.push(x);
    });
    pool.forEach((x) => {
      if (ACCOUNTS.includes(x.lead['DM Account'])) return;
      const a = ACCOUNTS.find((acc) => lists[acc].length < room[acc]);
      if (a) lists[a].push(x); else waiting.push(x);
    });
    return {
      counts, lists,
      readyTotal: warming.filter((x) => x.ready).length,
      notReadyTotal: warming.filter((x) => !x.ready).length,
      queued: ACCOUNTS.reduce((n, a) => n + lists[a].length, 0),
      leftover: waiting.length,
    };
  }

  return {
    WARMUP_REMINDER, cleanActivity, ACCOUNTS, ACCOUNT_CAP, accountOf, dmsByAccountToday, nextAccount, warmupInfo, blockAccount, nextNewLeadAccount, buildDmQueue,
    DEADLINE, DAILY_DM_CAP, PKG, PACKAGE_LABELS, ENUMS, MSG, FOLLOW_UPS, LOOM_STEPS, LOOM_RULE, REPLY_OPTIONS,
    todayISO, parseDate, normalizeDate, daysBetween, daysSince, parseFollowers,
    suggestPriority, suggestPackage, effectivePackage, mentionsPlatform,
    dm1, priceMessage, quietMessage, loomStepsFor, leadKey, dmState, nextMessage, dueToday,
    replyAvailability, buildReply, recommendedPriceKey, allTemplates, statusCounts, dmsSentToday,
  };
});
