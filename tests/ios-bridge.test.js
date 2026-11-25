// The iPhone app's bridge (ios/PenPal/bridge.js), loaded the way iOS's JavaScriptCore loads it:
// logic.js and bridge.js run in a bare global context with no module, window or DOM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function bridge() {
  const ctx = vm.createContext({});
  for (const f of ['public/logic.js', 'ios/PenPal/bridge.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  ctx.PP.loadDirectory(fs.readFileSync(path.join(__dirname, '..', 'public', 'directory.json'), 'utf8'));
  return ctx.PP;
}
const J = (s) => JSON.parse(s);
const TODAY = '2026-11-24';
// Shaped like a real Pen Pal file from the Windows app.
const DOC = {
  rev: 13, saveId: 'pc1', savedOn: 'DESKTOP', savedAt: '2026-11-24T09:02:00', lineage: ['pc0'],
  poems: [{ id: 'p1', title: 'Salt', status: 'ready' }, { id: 'p2', title: 'Tide Chart', status: 'ready' }, { id: 'p3', title: 'Ferry', status: 'draft' }],
  journals: [
    { id: 'pl', name: 'Poet Lore', opens: '2025-04-01', closes: '2025-05-31', repeat: 'yearly', extraWindows: [{ opens: '10-01', closes: '11-30' }], notify: true, replyDays: 210, pays: 'yes', fee: 0, maxPoems: 5, simSubs: 'yes' },
    { id: 'kw', name: 'Kweli Journal', opens: '2025-09-01', closes: '2026-05-30', repeat: 'yearly', pays: 'yes', fee: 0, maxPoems: 3 },
    { id: 'rm', name: 'Rust & Moth', opens: '2026-12-01', closes: '2026-12-20', repeat: 'yearly', extraWindows: [{ opens: '06-01', closes: '06-20' }, { opens: '09-01', closes: '09-20' }, { opens: '12-01', closes: '12-20' }], notify: true, replyDays: 60, pays: 'no', simSubs: 'yes' },
  ],
  submissions: [{ id: 's1', journalId: 'kw', poemIds: ['p3'], sentDate: '2026-07-01', status: 'pending' }],
  settings: { theme: 'dark', notifyDays: 3 },
};

test('loads a Windows file and keeps everything, save chain included', () => {
  const PP = bridge();
  const m = J(PP.load(JSON.stringify(DOC)));
  assert.deepEqual([m.rev, m.saveId, m.lineage], [13, 'pc1', ['pc0']]);
  const back = J(PP.json());
  assert.equal(back.journals.length, 3);
  assert.equal(back.settings.theme, 'dark');
});

test('Desk: closing soon, opening soon with its reminder date, open now, waiting', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  const d = J(PP.desk(TODAY));
  assert.equal(d.dateLabel, 'Tuesday, Nov 24');
  assert.deepEqual(d.closing.map((c) => [c.name, c.chip, c.tone]), [['Poet Lore', '6 days left', 'red']]);
  assert.equal(d.closing[0].detail, 'Closes Nov 30. Free, up to 5 poems, pays.');
  assert.deepEqual(d.opening.map((c) => [c.name, c.chip]), [['Rust & Moth', 'In 7 days']]);
  assert.match(d.opening[0].detail, /Opens Dec 1, closes Dec 20\. Reminder on Nov 28\./);
  assert.deepEqual(d.open.map((c) => c.name), ['Kweli Journal']);
  assert.equal(d.waiting[0].titles, 'Ferry');
  assert.deepEqual(d.needs.map((n) => n.kind), ['followup']); // 146 days at Kweli, past the 90-day default
  assert.equal(d.fees.label, 'Fees in November');
});

test('journals list, filters and a journal page with its year bar', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  const all = J(PP.journals(TODAY, 'all', ''));
  assert.deepEqual(all.items.map((i) => i.name), ['Poet Lore', 'Kweli Journal', 'Rust & Moth']);
  assert.deepEqual(J(PP.journals(TODAY, 'bells', '')).items.map((i) => i.name), ['Poet Lore', 'Rust & Moth']);
  assert.deepEqual(J(PP.journals(TODAY, 'open', 'kweli')).items.map((i) => i.name), ['Kweli Journal']);
  const rm = J(PP.journal('rm', TODAY));
  assert.equal(rm.periodsTitle, 'Reading periods, every year, 3 windows');
  assert.equal(rm.periodsText, 'Dec 1 to Dec 20; Jun 1 to Jun 20; Sep 1 to Sep 20.');
  assert.equal(rm.bars.length, 3);
  assert.ok(rm.todayPos > 0.89 && rm.todayPos < 0.9);
  assert.equal(rm.remindText, 'Nov 28 and Dec 17, 9 AM');
  assert.equal(rm.facts[0].value, 'About 60 days');
  assert.equal(rm.form.extra, 'Jun 1 to Jun 20; Sep 1 to Sep 20; Dec 1 to Dec 20');
});

test('adding and editing journals goes through logic.js rules', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  const blank = J(PP.blankJournal());
  assert.equal(J(PP.saveJournal(JSON.stringify(blank))).error, 'Give the journal a name.');
  const r = J(PP.saveJournal(JSON.stringify(Object.assign(blank, { name: 'New Review', opens: '2026-12-10', closes: '2027-01-31', yearly: true, extra: 'Jun 1 to Jun 30', fee: '3', notify: true }))));
  assert.equal(r.error, '');
  const j = J(PP.journal(r.id, TODAY));
  assert.equal(j.form.extra, 'Jun 1 to Jun 30');
  assert.equal(j.facts[3].value, '$3');
  assert.match(J(PP.saveJournal(JSON.stringify(Object.assign(j.form, { extra: 'whenever' })))).error, /could not read/);
  PP.setNotify(r.id, false);
  assert.equal(J(PP.journal(r.id, TODAY)).notify, false);
  const dir = J(PP.directory('rust', TODAY));
  assert.equal(dir.items.length, 1);
  assert.equal(dir.items[0].mineId, 'rm'); // already in your list (matched by name)
});

test('directory: add a journal from it', () => {
  const PP = bridge();
  PP.fresh();
  const all = J(PP.directory('', TODAY));
  assert.equal(all.total, all.items.length);
  const pick = all.items[0];
  const id = PP.addFromDirectory(pick.dirId, TODAY);
  assert.ok(id);
  assert.equal(J(PP.directory('', TODAY)).items.find((i) => i.dirId === pick.dirId).mineId, id);
});

test('sending poems: the same pre-send checks as Windows, plus what happens next', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  const f = J(PP.sendForm('pl', TODAY));
  assert.equal(f.journal.line, 'Open, closes Nov 30. Up to 5 poems.');
  assert.deepEqual(f.poems.map((p) => [p.title, p.label]), [['Salt', 'Ready to send'], ['Tide Chart', 'Ready to send'], ['Ferry', 'Out at 1 journal']]);
  const c = J(PP.sendCheck(JSON.stringify({ journalId: 'pl', poemIds: ['p1', 'p2'], sentDate: TODAY }), TODAY));
  assert.deepEqual(c.warn, []);
  assert.deepEqual(c.ok, ["2 poems is within Poet Lore's limit of 5.", 'They usually answer in about 210 days. Pen Pal will suggest a follow-up around Jun 22, 2027.']);
  const late = J(PP.sendCheck(JSON.stringify({ journalId: 'rm', poemIds: ['p1'], sentDate: TODAY }), TODAY));
  assert.deepEqual(late.warn, ['The reading period does not open until Dec 1.']);
  assert.equal(J(PP.logSubmission(JSON.stringify({ journalId: 'pl', poemIds: [], sentDate: TODAY }))).error, 'Pick at least one poem.');
  const r = J(PP.logSubmission(JSON.stringify({ journalId: 'pl', poemIds: ['p1', 'p2'], sentDate: TODAY, feePaid: '' })));
  assert.equal(r.error, '');
  assert.equal(J(PP.subs(TODAY)).pending.length, 2);
  // Poet Lore's closing reminder is dropped now that something went there this period
  assert.ok(!J(PP.reminderPlan(TODAY, 60, '[]')).some((a) => a.key === 'pl:closes:2026-11-30'));
});

test('accepting a poem asks you to withdraw it elsewhere', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  PP.logSubmission(JSON.stringify({ journalId: 'pl', poemIds: ['p3'], sentDate: TODAY }));
  const plSub = J(PP.subs(TODAY)).pending.find((s) => s.journal === 'Poet Lore');
  const alerts = J(PP.setSubStatus(plSub.id, 'accepted', TODAY));
  assert.deepEqual(alerts, ['"Ferry" is still out at Kweli Journal. Withdraw it there.']);
  assert.deepEqual(J(PP.desk(TODAY)).needs.map((n) => n.kind), ['withdraw', 'followup']);
  PP.withdraw('s1', 'p3', TODAY);
  assert.deepEqual(J(PP.desk(TODAY)).needs, []);
  assert.equal(J(PP.poem('p3', TODAY)).label, 'Published in Poet Lore');
});

test('reminders: each on the first day it is due, skipping ones a PC already showed', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  const plan = J(PP.reminderPlan(TODAY, 60, '[]'));
  assert.deepEqual(plan.map((a) => [a.key, a.fire, a.title]), [
    ['pl:closes:2026-11-30', '2026-11-27', 'Poet Lore closes in 3 days'],
    ['rm:opens:2026-12-01', '2026-11-28', 'Rust & Moth opens in 3 days'],
    ['rm:closes:2026-12-20', '2026-12-17', 'Rust & Moth closes in 3 days'],
  ]);
  assert.equal(J(PP.reminderPlan(TODAY, 60, JSON.stringify(['rm:opens:2026-12-01']))).length, 2);
});

test('save chain: stamping, building on, and putting a version back', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  PP.setSetting('notifyDays', '5');
  const saved = J(PP.stamp(JSON.stringify(DOC), 'iPhone', '2026-11-24T09:10:00', 'ip1'));
  assert.deepEqual([saved.rev, saved.saveId, saved.savedOn, saved.lineage], [14, 'ip1', 'iPhone', ['pc0', 'pc1']]);
  assert.equal(saved.settings.notifyDays, 5);
  assert.equal(PP.buildsOn(JSON.stringify(saved), 'pc1'), true);
  assert.equal(PP.buildsOn(JSON.stringify(DOC), 'ip1'), false);
  // the PC's version replaced ours; put ours back on top of theirs
  const theirs = Object.assign({}, DOC, { rev: 14, saveId: 'pc2', lineage: ['pc0', 'pc1'] });
  const back = J(PP.adopt(JSON.stringify(saved), JSON.stringify(theirs), 'iPhone', '2026-11-24T09:20:00', 'ip2'));
  assert.deepEqual([back.rev, back.saveId, back.lineage.slice(-1)[0], back.settings.notifyDays], [15, 'ip2', 'pc2', 5]);
  const s = J(PP.summary(JSON.stringify(DOC)));
  assert.equal(s.counts, '3 journals, 3 poems, 1 submission');
  assert.equal(s.saved, 'on DESKTOP, Nov 24 at 9:02 AM');
});

test('poems: add titles in bulk, no duplicates, edit and remove', () => {
  const PP = bridge();
  PP.load(JSON.stringify(DOC));
  assert.equal(PP.addTitles('Salt\nNew One\n  "Quoted"  \n\nNew One', 'ready'), 2);
  assert.deepEqual(J(PP.poems('', TODAY)).map((p) => p.title), ['New One', 'Quoted', 'Salt', 'Tide Chart', 'Ferry']);
  assert.match(J(PP.savePoem(JSON.stringify({ title: 'salt' }))).error, /already have/);
  const id = J(PP.poems('quoted', TODAY))[0].id;
  PP.savePoem(JSON.stringify({ id, title: 'Quoted, revised', status: 'draft', notes: 'n' }));
  assert.equal(J(PP.poem(id, TODAY)).title, 'Quoted, revised');
  PP.removePoem(id);
  assert.equal(J(PP.poem(id, TODAY)), null);
});
