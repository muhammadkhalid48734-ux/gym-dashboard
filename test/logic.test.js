const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/logic');
const { ENUMS, HEADERS } = require('../api/_lib/schema');

const T = '2026-10-08';
const lead = (o = {}) => ({
  'Gym Name': 'Iron Haven', City: 'Austin', 'Owner Name': 'Sam', Followers: '4,200',
  'Website Quality': 'Modern', 'Has Booking Form': 'No', 'Has Follow-up Automation': 'Unknown',
  'Current Offer': 'Free Trial', 'Last Post Date': '2026-10-05', Status: 'Warming', Notes: '', Package: '', ...o,
});

test('enums in the browser logic match the server schema', () => {
  Object.keys(ENUMS).forEach((k) => assert.deepEqual(L.ENUMS[k], ENUMS[k], k));
});

test('dates', () => {
  assert.equal(L.daysBetween('2026-10-01', '2026-10-08'), 7);
  assert.equal(L.daysBetween('10/1/2026', '2026-10-08'), 7); // Sheets-style typed date
  assert.equal(L.daysBetween('', T), null);
  const days = L.daysBetween(T, L.DEADLINE);
  assert.equal(days, 26);
});

test('priority suggestion', () => {
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'Outdated' }), T), 'High');
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'None' }), T), 'High');
  assert.equal(L.suggestPriority(lead({ 'Has Booking Form': 'Yes', 'Has Follow-up Automation': 'No' }), T), 'High');
  // stale post kills High
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'Outdated', 'Last Post Date': '2026-09-01' }), T), 'Low');
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'Outdated', 'Last Post Date': '2026-09-24' }), T), 'High'); // exactly 14 days
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'Outdated', 'Last Post Date': '2026-09-23' }), T), 'Low'); // 15 days
  assert.equal(L.suggestPriority(lead({ 'Current Offer': 'Paid Intro' }), T), 'Medium');
  assert.equal(L.suggestPriority(lead(), T), 'Low');
  // platform mention forces Low even when High would apply
  assert.equal(L.suggestPriority(lead({ 'Website Quality': 'Outdated', Notes: 'uses Mindbody' }), T), 'Low');
  assert.equal(L.suggestPriority(lead({ 'Current Offer': 'Paid Intro', Notes: 'on wodify' }), T), 'Low');
});

test('package suggestion uses the product names and never gives the add-on the full-system name', () => {
  assert.equal(L.suggestPackage(lead({ 'Website Quality': 'None' })), 'Trial-to-Member System');
  assert.equal(L.suggestPackage(lead({ 'Website Quality': 'Outdated' })), 'Trial-to-Member System');
  assert.equal(L.suggestPackage(lead({ 'Has Booking Form': 'Yes', 'Has Follow-up Automation': 'No' })), 'Follow-up Add-on');
  assert.equal(L.suggestPackage(lead({ Notes: 'Glofox', 'Has Booking Form': 'Yes', 'Has Follow-up Automation': 'No' })), 'Skip');
  assert.equal(L.suggestPackage(lead({ Notes: 'Glofox' })), 'Skip');
  assert.equal(L.suggestPackage(lead()), ''); // modern, no rule applies -> user chooses
  assert.equal(L.PACKAGE_LABELS['Trial-to-Member System'], 'Trial-to-Member System — $500 (page + confirmation + reminder + follow-up)');
  assert.equal(L.PACKAGE_LABELS['Follow-up Add-on'], 'Follow-up Add-on — $250-300 (confirmation + reminder + follow-up only)');
  assert.equal(L.PACKAGE_LABELS.Skip, 'Skip or deprioritize');
  assert.equal(L.effectivePackage(lead({ Package: 'Skip', 'Website Quality': 'None' })), 'Skip'); // override wins
});

test('DM 1 templates are exact and contain NO product name', () => {
  assert.equal(L.dm1(lead()), "Hey Sam! Saw Iron Haven's page, love the energy. Quick question — when someone asks about your free trial through Instagram, how do you usually handle it?");
  assert.equal(L.dm1(lead({ 'Current Offer': 'Paid Intro' })), 'Hey Sam! Quick question — when someone books your intro offer, does a reminder or follow-up go out automatically, or do you track it manually?');
  assert.equal(L.dm1(lead({ 'Current Offer': 'None' })), "Hey Sam! Saw Iron Haven's page, love the energy. Quick one — do you give new people a way to try the place first, like a free class or intro week?");
  ['Free Trial', 'Paid Intro', 'None'].forEach((o) => {
    const t = L.dm1(lead({ 'Current Offer': o }));
    assert.doesNotMatch(t, /Trial-to-Member|Add-on|\$/);
  });
  assert.match(L.dm1(lead({ 'Owner Name': '' })), /^Hey there!/);
});

test('reply handler message text matches the spec exactly', () => {
  const r = (k, l) => L.buildReply(k, l || lead(), T);
  assert.equal(r('manual').messages[0].text, "Oh interesting — so most of it comes through DMs then? That's how it works at a lot of studios I look at.");
  assert.equal(r('manual').laterMessage.text, "Yeah, that's usually where leads leak — people who book but never get a nudge just don't show up. I built something for this called the Trial-to-Member System — mind if I send a 2-min video showing how it works?");
  assert.equal(r('manual').setStatus, 'Replied');
  assert.equal(r('platform').messages[0].text, 'Nice — does the person who books actually get an automatic reminder and a follow-up after, or just the booking confirmation?');
  assert.equal(r('platform').instruction, 'Ask whether the booked person gets an automatic reminder/follow-up. YES → exit politely, mark Lost. NO → pitch follow-up automation only.');
  assert.equal(r('platformNo').messages[0].text, "Gotcha — that's the gap I'd fill. I have a Follow-up Add-on that plugs into what you already use: automatic reminder before the trial, and a couple of follow-ups after. Want me to send a short video?");
  assert.equal(r('video').setStatus, 'Audit Sent');
  assert.equal(r('video').loom, true);
  assert.equal(r('priceFull').messages[0].text, "The Trial-to-Member System is $500 one-time — landing page, instant booking confirmation, a reminder before the trial, and a follow-up sequence after. 50% to start, 50% when it's live. Want to get started?");
  assert.equal(r('priceAddon').messages[0].text, "The Follow-up Add-on is $300 one-time — it hooks into your existing booking form and handles the confirmation, the reminder, and the follow-ups after. 50% to start, 50% when it's live. Want to get started?");
  assert.equal(r('priceFull').setStatus, 'Price Sent');
  assert.equal(r('priceAddon').setPackage, 'Follow-up Add-on');
  assert.equal(r('no').messages[0].text, 'Totally understand, appreciate you replying! If that ever changes, feel free to reach out.');
  assert.equal(r('no').setStatus, 'Lost');
  assert.equal(r('quiet', lead({ Package: 'Trial-to-Member System' })).messages[0].text, "If $500 isn't right for now, I can also do a smaller scope for less — let me know if that works better.");
});

test('price message follows the package; add-on never gets the $500 / "smaller scope" wording', () => {
  assert.equal(L.recommendedPriceKey(lead({ Package: 'Follow-up Add-on' })), 'priceAddon');
  assert.equal(L.recommendedPriceKey(lead({ Package: 'Trial-to-Member System' })), 'priceFull');
  assert.equal(L.recommendedPriceKey(lead({ Package: 'Skip' })), null);
  // falls back to the suggestion when the column is blank (e.g. rows from the old 19-column sheet)
  assert.equal(L.recommendedPriceKey(lead({ 'Website Quality': 'None' })), 'priceFull');
  const q = L.quietMessage(lead({ Package: 'Follow-up Add-on' }));
  assert.doesNotMatch(q, /\$500|smaller scope/);
});

test('"went quiet after price" is only available Price Sent + 3 days', () => {
  assert.equal(L.replyAvailability('quiet', lead({ Status: 'Replied' }), T).ok, false);
  assert.equal(L.replyAvailability('quiet', lead({ Status: 'Price Sent', 'Last Contact Date': '2026-10-07' }), T).ok, false);
  assert.equal(L.replyAvailability('quiet', lead({ Status: 'Price Sent', 'Last Contact Date': '2026-10-05' }), T).ok, true);
});

test('follow-up templates are exact', () => {
  assert.equal(L.FOLLOW_UPS[0].text(lead()), "Hey Sam, just floating this back up — no worries if now's not a good time!");
  assert.equal(L.FOLLOW_UPS[1].text(lead()), 'Quick context on why I asked — most studios lose trial bookings somewhere between the signup and the actual class, just because nothing follows up automatically. Curious how it works on your end?');
  assert.equal(L.FOLLOW_UPS[2].text(lead()), "No worries if this isn't useful right now — I'll leave it here. Feel free to reach out anytime.");
});

test('NO fabricated social proof in any template', () => {
  const banned = /\b(my clients?|our clients?|I've (done|helped|worked)|I have (done|helped)|gyms? (I|we)'?ve|converting|results?|case stud|testimonial|\d+\s+gyms)\b/i;
  L.allTemplates().forEach((t) => assert.doesNotMatch(t, banned, t));
});

test('Loom script: product name in steps 3 & 5, [X] filled from followers, no price in video', () => {
  assert.match(L.LOOM_STEPS[2].text, /Walk through the Trial-to-Member System: the booking page, the instant confirmation, the reminder, the follow-up sequence\./);
  assert.match(L.LOOM_STEPS[4].text, /If the Trial-to-Member System looks useful, reply and I'll walk you through pricing/);
  assert.match(L.loomStepsFor(lead())[3].text, /1% trial-booking rate is 42 leads/);
  assert.match(L.LOOM_STEPS[3].text, /\[X\]/);
  assert.doesNotMatch(L.LOOM_STEPS.map((s) => s.text).join(' '), /\$(250|300|500)/);
  assert.match(L.LOOM_RULE, /Never mention price/);
});

const ev = (gym, event, date) => ({ Gym: gym, City: 'Austin', Event: event, Date: date, Detail: '' });

test('due today: warm-up only when not touched today', () => {
  const d = L.dueToday([lead({ 'Last Contact Date': '' }), lead({ 'Gym Name': 'B', 'Last Contact Date': T }), lead({ 'Gym Name': 'C', 'Last Contact Date': '2026-10-07' })], [], T);
  assert.deepEqual(d.warmup.map((x) => x.lead['Gym Name']), ['Iron Haven', 'C']);
});

test('due today: follow-ups at day 3 / 6 / 10, counted from DM 1 (not from the last follow-up)', () => {
  const l = (lc) => lead({ Status: 'DM Sent', 'Last Contact Date': lc });
  const dm = [ev('Iron Haven', 'DM Sent', '2026-10-01')];
  // day 3, nothing sent yet
  let d = L.dueToday([l('2026-10-01')], dm, '2026-10-04').followups;
  assert.equal(d.length, 1); assert.equal(d[0].day, 3); assert.match(d[0].text, /floating this back up/);
  // day 2: not yet
  assert.equal(L.dueToday([l('2026-10-01')], dm, '2026-10-03').followups.length, 0);
  // Day 3 sent on day 3 -> Last Contact reset. On day 4/5 nothing due (this is the bug a naive "days since Last Contact" rule has)
  const afterF1 = dm.concat([ev('Iron Haven', 'Follow-up', '2026-10-04')]);
  assert.equal(L.dueToday([l('2026-10-04')], afterF1, '2026-10-05').followups.length, 0);
  d = L.dueToday([l('2026-10-04')], afterF1, '2026-10-07').followups;
  assert.equal(d[0].day, 6); assert.match(d[0].text, /Quick context/);
  const afterF2 = afterF1.concat([ev('Iron Haven', 'Follow-up', '2026-10-07')]);
  d = L.dueToday([l('2026-10-07')], afterF2, '2026-10-11').followups;
  assert.equal(d[0].day, 10); assert.match(d[0].text, /leave it here/);
  // everything sent, day 11 -> Mark Lost
  const afterF3 = afterF2.concat([ev('Iron Haven', 'Follow-up', '2026-10-11')]);
  d = L.dueToday([l('2026-10-11')], afterF3, '2026-10-12').followups;
  assert.equal(d[0].type, 'lost'); assert.equal(d[0].text, null);
  assert.equal(L.dueToday([l('2026-10-11')], afterF3, '2026-10-11').followups.length, 0); // day 10 handled, nothing more today
});

test('due today: a missed day does not make a follow-up vanish; one stage per day', () => {
  const dm = [ev('Iron Haven', 'DM Sent', '2026-10-01')];
  const l = lead({ Status: 'DM Sent', 'Last Contact Date': '2026-10-01' });
  const d = L.dueToday([l], dm, '2026-10-05').followups; // day 4
  assert.equal(d[0].day, 3);
  // sent late on day 7 (stage 1 done): the day-6 threshold is already passed, but not due again the same day
  const after = dm.concat([ev('Iron Haven', 'Follow-up', '2026-10-08')]);
  assert.equal(L.dueToday([lead({ Status: 'DM Sent', 'Last Contact Date': '2026-10-08' })], after, '2026-10-08').followups.length, 0);
});

test('due today: DM Sent set by hand in the Sheet (no activity) falls back to Last Contact', () => {
  const l = lead({ Status: 'DM Sent', 'Last Contact Date': '2026-10-05' });
  assert.equal(L.dueToday([l], [], '2026-10-08').followups[0].day, 3);
});

test('due today: price-sent quiet 3+ days, once', () => {
  const l = lead({ Status: 'Price Sent', 'Last Contact Date': '2026-10-05', Package: 'Trial-to-Member System' });
  assert.equal(L.dueToday([l], [], T).price.length, 1);
  assert.equal(L.dueToday([lead({ ...l, 'Last Contact Date': '2026-10-06' })], [], T).price.length, 0);
  const done = [ev('Iron Haven', 'Price Sent', '2026-10-05'), ev('Iron Haven', 'Price follow-up', '2026-10-08')];
  assert.equal(L.dueToday([l], done, T).price.length, 0);
});

test('daily counter counts distinct leads moved to DM Sent today, even if they replied since', () => {
  const act = [ev('A', 'DM Sent', T), ev('A', 'DM Sent', T), ev('B', 'DM Sent', '2026-10-07'), ev('C', 'DM Sent', T), ev('C', 'Replied', T)];
  assert.equal(L.dmsSentToday(act, T), 2);
});

test('nextMessage for "Copy follow-up"', () => {
  assert.match(L.nextMessage(lead({ Status: 'Warming' }), [], T).text, /^Hey Sam! Saw/);
  assert.match(L.nextMessage(lead({ Status: 'DM Sent', 'Last Contact Date': T }), [], T).label, /Day 3/);
  assert.equal(L.nextMessage(lead({ Status: 'Lost' }), [], T).text, null);
});
