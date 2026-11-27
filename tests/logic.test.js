const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/logic.js');

function fixture() {
  const d = L.emptyData();
  d.poems = [
    { id: 'p1', title: 'Salt Line', status: 'ready' },
    { id: 'p2', title: 'Wet Season', status: 'ready' },
    { id: 'p3', title: 'Old Draft', status: 'draft' },
  ].map(L.normalizePoem);
  d.journals = [
    { id: 'j1', name: 'Alpha Review', opens: '2026-09-01', closes: '2026-12-01', fee: 3, simSubs: 'yes' },
    { id: 'j2', name: 'Beta Quarterly', opens: '2026-12-15', closes: '2027-01-31', simSubs: 'yes' },
    { id: 'j3', name: 'No-Sim Journal', simSubs: 'no', maxPoems: 3 },
  ].map(L.normalizeJournal);
  d.submissions = [
    { id: 's1', poemIds: ['p1', 'p2'], journalId: 'j1', sentDate: '2026-10-01' },
    { id: 's2', poemIds: ['p1'], journalId: 'j2', sentDate: '2026-10-05' },
    { id: 's3', poemIds: ['p2'], journalId: 'j3', sentDate: '2026-10-06' },
  ].map(L.normalizeSubmission);
  return d;
}

test('poem state follows submissions', () => {
  const d = fixture();
  assert.equal(L.poemState(d, d.poems[0]), 'out');
  assert.equal(L.poemState(d, d.poems[2]), 'draft');
  d.submissions.forEach((s) => (s.status = 'rejected'));
  assert.equal(L.poemState(d, d.poems[0]), 'ready');
});

test('no alerts until something is accepted', () => {
  assert.equal(L.withdrawAlerts(fixture()).length, 0);
});

test('accepting a poem flags every other pending submission holding it', () => {
  const d = fixture();
  const alerts = L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].poem.id, 'p1');
  assert.equal(alerts[0].placedAt, 'Beta Quarterly');
  assert.deepEqual(alerts[0].submissions.map((x) => x.sub.id), ['s1']);
  assert.equal(alerts[0].submissions[0].multiPoem, true);
  assert.equal(L.poemState(d, d.poems[0]), 'published');
  // p2 is untouched
  assert.equal(L.poemState(d, d.poems[1]), 'out');
});

test('withdrawing one poem from a multi-poem submission keeps the rest pending', () => {
  const d = fixture();
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  L.withdrawPoem(d, 's1', 'p1', '2026-11-11');
  const s1 = d.submissions.find((s) => s.id === 's1');
  assert.equal(s1.status, 'pending');
  assert.deepEqual(L.activePoemIds(s1), ['p2']);
  assert.equal(L.withdrawAlerts(d).length, 0);
  L.withdrawPoem(d, 's1', 'p2', '2026-11-12');
  assert.equal(s1.status, 'withdrawn');
});

test('partial acceptance of a multi-poem submission releases the others', () => {
  const d = fixture();
  L.acceptSubmission(d, 's1', ['p2'], '2026-11-02');
  assert.equal(L.poemState(d, d.poems[1]), 'published');
  // p1 was in s1 but not accepted; s2 still holds it so it stays out, with no alert
  assert.equal(L.poemState(d, d.poems[0]), 'out');
  assert.equal(L.withdrawAlerts(d).filter((a) => a.poem.id === 'p1').length, 0);
  // p2 is also pending at s3, so that one is flagged
  const a = L.withdrawAlerts(d);
  assert.equal(a.length, 1);
  assert.equal(a[0].submissions[0].sub.id, 's3');
});

test('manually marked published poems also raise alerts', () => {
  const d = fixture();
  d.poems[2].status = 'published';
  d.submissions.push(L.normalizeSubmission({ id: 's4', poemIds: ['p3'], journalId: 'j1' }));
  const a = L.withdrawAlerts(d);
  assert.equal(a.length, 1);
  assert.equal(a[0].poem.id, 'p3');
});

test('setSubmissionStatus sets response date and clears it on pending', () => {
  const d = fixture();
  L.setSubmissionStatus(d, 's1', 'rejected', '2026-10-20');
  assert.equal(d.submissions[0].responseDate, '2026-10-20');
  L.setSubmissionStatus(d, 's1', 'pending');
  assert.equal(d.submissions[0].responseDate, '');
});

test('pre-send checks', () => {
  const d = fixture();
  const w1 = L.checkSubmission(d, { poemIds: ['p1', 'p2', 'p3', 'p1'], journalId: 'j3', sentDate: '2026-11-18' }, '2026-11-18');
  assert.ok(w1.some((m) => /simultaneous/.test(m)));
  const w2 = L.checkSubmission(d, { poemIds: ['p3'], journalId: 'j1', sentDate: '2026-12-05' }, '2026-12-05');
  assert.ok(w2.some((m) => /closed on 2026-12-01/.test(m)));
  assert.ok(w2.some((m) => /pending submission to Alpha/.test(m)));
  const w3 = L.checkSubmission(d, { poemIds: ['p3'], journalId: 'j2', sentDate: '2026-11-18' }, '2026-11-18');
  assert.ok(w3.some((m) => /does not open until 2026-12-15/.test(m)));
  const w4 = L.checkSubmission(d, { poemIds: ['p1'], journalId: 'j1', sentDate: '2026-10-02', id: 's1' }, '2026-10-02');
  assert.equal(w4.filter((m) => /already sent/.test(m)).length, 0); // editing itself is fine
  const maxed = L.normalizeJournal({ id: 'jm', name: 'Tiny', maxPoems: 2 });
  d.journals.push(maxed);
  const w5 = L.checkSubmission(d, { poemIds: ['p1', 'p2', 'p3'], journalId: 'jm' }, '2026-11-18');
  assert.ok(w5.some((m) => /at most 2 poems/.test(m)));
});

test('already-published poem is warned about', () => {
  const d = fixture();
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  const w = L.checkSubmission(d, { poemIds: ['p1'], journalId: 'j3' }, '2026-11-18');
  assert.ok(w.some((m) => /already accepted or published/.test(m)));
});

test('deadlines within window, sorted, past ignored', () => {
  const d = fixture();
  const e = L.upcomingDeadlines(d, '2026-11-18', 60);
  assert.deepEqual(e.map((x) => x.kind + ':' + x.journal.id), ['closes:j1', 'opens:j2']);
  assert.equal(e[0].daysAway, 13);
  assert.equal(L.upcomingDeadlines(d, '2026-11-18', 5).length, 0);
});

test('open now', () => {
  const d = fixture();
  const o = L.openNow(d, '2026-11-18');
  assert.deepEqual(o.map((x) => x.journal.id), ['j1']);
  assert.equal(o[0].daysLeft, 13);
});

test('stale submissions', () => {
  const d = fixture();
  const s = L.staleSubmissions(d, '2027-01-10', 90);
  assert.equal(s.length, 3);
  assert.equal(s[0].sub.id, 's1');
  assert.equal(L.staleSubmissions(d, '2026-11-18', 90).length, 0);
});

test('stats', () => {
  const d = fixture();
  L.setSubmissionStatus(d, 's1', 'rejected', '2026-10-11');
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  d.submissions[0].feePaid = 3;
  const s = L.stats(d);
  assert.equal(s.sent, 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.accepted, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.feesTotal, 3);
  assert.equal(s.medianDays, (10 + 36) / 2);
  assert.equal(s.acceptRate, 0.5);
  assert.equal(s.poemsPublished, 1);
});

test('ICS output', () => {
  const d = fixture();
  d.journals[0].name = 'Alpha, Review; "The"';
  const ics = L.toICS(d, '2026-11-18', new Date('2026-11-18T12:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3); // j1 closes, j2 opens, j2 closes (j1 opens is past)
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261201'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261202'));
  assert.ok(ics.includes('SUMMARY:Closes: Alpha\\, Review\\; "The"'));
  assert.ok(ics.includes('TRIGGER:-P7D'));
  assert.ok(ics.includes('DTSTAMP:20261118T120000Z'));
  assert.ok(!/Opens: Alpha/.test(ics));
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 71, 'line too long: ' + line);
  assert.ok(!/[^\r]\n/.test(ics));
});

test('ICS folds long lines without losing text', () => {
  const d = L.emptyData();
  d.journals = [L.normalizeJournal({ id: 'jx', name: 'X'.repeat(200), closes: '2030-01-01' })];
  const ics = L.toICS(d, '2026-01-01', new Date('2026-01-01T00:00:00Z'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Closes: ' + 'X'.repeat(200)));
});

test('CSV output, quoting, and formula guard', () => {
  const d = fixture();
  d.submissions[0].notes = 'said "maybe", then\nsilence';
  d.submissions[1].notes = '=HYPERLINK("http://x")';
  L.setSubmissionStatus(d, 's1', 'rejected', '2026-10-11');
  const csv = L.toCSV(d);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Date sent,Journal,Poems,Status,Accepted poems,Response date,Days to response,Fee paid,Notes');
  assert.ok(csv.includes('"said ""maybe"", then\nsilence"'));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"http://x\"\")\""));
  assert.ok(csv.includes('Salt Line; Wet Season'));
  assert.ok(csv.includes(',10,'));
});

test('published list', () => {
  const d = fixture();
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  d.poems[2].status = 'published';
  d.poems[2].publishedWhere = 'Gamma Journal';
  d.poems[2].publishedDate = '2024';
  const r = L.publishedList(d);
  assert.equal(r.items.length, 2);
  assert.equal(r.text, '"Old Draft", Gamma Journal (2024).\n"Salt Line", Beta Quarterly (2026).');
});

test('removing a poem or journal cleans up submissions', () => {
  const d = fixture();
  const r = L.removePoem(d, 'p1');
  assert.equal(r.touched, 2);
  assert.equal(r.removedSubmissions, 1); // s2 only held p1
  assert.deepEqual(d.submissions.find((s) => s.id === 's1').poemIds, ['p2']);
  const r2 = L.removeJournal(d, 'j1');
  assert.equal(r2.removedSubmissions, 1);
});

test('normalize rejects junk and bad dates', () => {
  const d = L.normalize({
    rev: 'x',
    poems: [{ title: '  ' }, { title: 'Ok', status: 'weird' }, null],
    journals: [{ name: 'J', opens: '2026-02-31', closes: '2026-03-01', fee: -5, simSubs: 'maybe' }],
    submissions: [{ poemIds: ['a', 'a', 5], status: 'bogus', sentDate: 'tomorrow' }],
  });
  assert.equal(d.rev, 0);
  assert.equal(d.poems.length, 1);
  assert.equal(d.poems[0].status, 'draft');
  assert.equal(d.journals[0].opens, '');
  assert.equal(d.journals[0].closes, '2026-03-01');
  assert.equal(d.journals[0].fee, null);
  assert.equal(d.journals[0].simSubs, 'unknown');
  assert.deepEqual(d.submissions[0].poemIds, ['a']);
  assert.equal(d.submissions[0].status, 'pending');
  assert.equal(d.submissions[0].sentDate, '');
  assert.deepEqual(L.normalize(null), L.emptyData());
});

test('date helpers', () => {
  assert.equal(L.daysBetween('2026-11-18', '2026-12-01'), 13);
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.todayLocal(new Date(2026, 10, 18, 23, 59)), '2026-11-18');
});

// ======================================================================
// Second round: yearly windows, manuscripts, history, import, insights, undo, backup
// ======================================================================

test('old data files load unchanged and gain the new empty parts', () => {
  const old = { rev: 4, poems: [{ id: 'a', title: 'A', status: 'ready' }], journals: [{ id: 'j', name: 'J', opens: '2026-09-01', closes: '2026-11-30' }], submissions: [] };
  const d = L.normalize(old);
  assert.equal(d.rev, 4);
  assert.equal(d.poems[0].title, 'A');
  assert.equal(d.journals[0].repeat, 'none');
  assert.deepEqual(d.manuscripts, []);
  assert.deepEqual(d.entries, []);
  assert.deepEqual(d.settings, { lastBackupDownload: '', backupSnoozedUntil: '', monthlyBudget: {}, budgetWarnPct: 80, countPlanned: true, theme: 'system', followUpDays: 90, deskDays: 60, notifyDays: 3, checkUpdates: true, savedFinds: [] });
  assert.deepEqual(d.poems[0].rights, { bought: '', issue: '', pubDate: '', exclusiveUntil: '', reprints: 'unknown', revert: '', credit: '' });
  assert.equal(d.journals[0].alwaysOpen, false);
  // normalizing twice changes nothing
  assert.deepEqual(L.normalize(JSON.parse(JSON.stringify(d))), d);
});

test('addYears handles Feb 29', () => {
  assert.equal(L.addYears('2028-02-29', 1), '2029-02-28');
  assert.equal(L.addYears('2028-02-29', 4), '2032-02-29');
  assert.equal(L.addYears('2026-11-30', -1), '2025-11-30');
});

test('repeat only sticks when both dates exist and are in order', () => {
  assert.equal(L.normalizeJournal({ name: 'x', opens: '2026-09-01', closes: '2026-11-30', repeat: 'yearly' }).repeat, 'yearly');
  assert.equal(L.normalizeJournal({ name: 'x', opens: '2026-09-01', repeat: 'yearly' }).repeat, 'none');
  assert.equal(L.normalizeJournal({ name: 'x', opens: '2026-11-30', closes: '2026-09-01', repeat: 'yearly' }).repeat, 'none');
  assert.equal(L.normalizeJournal({ name: 'x', repeat: 'weekly' }).repeat, 'none');
});

test('a yearly reading period rolls forward by whole years', () => {
  const j = L.normalizeJournal({ id: 'r', name: 'Autumn', opens: '2026-09-01', closes: '2026-11-30', repeat: 'yearly' });
  assert.deepEqual(L.currentWindow(j, '2026-10-01'), { opens: '2026-09-01', closes: '2026-11-30', k: 0 });
  assert.equal(L.currentWindow(j, '2026-11-30').closes, '2026-11-30'); // the closing day still counts
  assert.deepEqual(L.currentWindow(j, '2026-12-05'), { opens: '2027-09-01', closes: '2027-11-30', k: 1 });
  assert.equal(L.currentWindow(j, '2031-03-01').opens, '2031-09-01');
  assert.equal(L.currentWindow(j, '2025-01-01').opens, '2026-09-01'); // template in the future: use it as is
  assert.deepEqual(L.windowsFrom(j, '2026-12-05', 2).map((w) => w.opens), ['2027-09-01', '2028-09-01']);
});

test('a window that spans New Year works', () => {
  const j = L.normalizeJournal({ name: 'Winter', opens: '2026-11-01', closes: '2027-02-01', repeat: 'yearly' });
  assert.deepEqual(L.currentWindow(j, '2027-01-10'), { opens: '2026-11-01', closes: '2027-02-01', k: 0 });
  assert.deepEqual(L.currentWindow(j, '2027-03-01'), { opens: '2027-11-01', closes: '2028-02-01', k: 1 });
});

test('a Feb 29 date lands on Feb 28 in a non-leap year', () => {
  const j = L.normalizeJournal({ name: 'Leap', opens: '2028-02-29', closes: '2028-03-31', repeat: 'yearly' });
  assert.equal(L.currentWindow(j, '2029-01-01').opens, '2029-02-28');
  assert.equal(L.currentWindow(j, '2032-01-01').opens, '2032-02-29');
});

test('a journal that does not repeat is untouched by all of that', () => {
  const j = L.normalizeJournal({ name: 'One', opens: '2026-09-01', closes: '2026-11-30' });
  assert.deepEqual(L.currentWindow(j, '2027-05-05'), { opens: '2026-09-01', closes: '2026-11-30', k: 0 });
  assert.deepEqual(L.currentWindow(L.normalizeJournal({ name: 'No dates' }), '2027-05-05'), { opens: '', closes: '', k: 0 });
});

test('yearly journals feed deadlines, open-now and pre-send checks', () => {
  const d = L.emptyData();
  d.journals = [L.normalizeJournal({ id: 'r', name: 'Autumn', opens: '2026-09-01', closes: '2026-11-30', repeat: 'yearly' })];
  const e = L.upcomingDeadlines(d, '2026-12-05', 365);
  assert.deepEqual(e.map((x) => x.kind + ':' + x.date), ['opens:2027-09-01', 'closes:2027-11-30']);
  assert.ok(e.every((x) => x.recurring && x.name === 'Autumn'));
  assert.equal(L.openNow(d, '2026-12-05').length, 0);
  assert.equal(L.openNow(d, '2027-10-01').length, 1);
  assert.equal(L.openNow(d, '2027-10-01')[0].closes, '2027-11-30');
  const w = L.checkSubmission(d, { poemIds: [], journalId: 'r', sentDate: '2027-01-20' }, '2027-01-20');
  assert.ok(w.some((m) => /does not open until 2027-09-01/.test(m)));
  assert.equal(L.checkSubmission(d, { poemIds: [], journalId: 'r', sentDate: '2027-10-20' }, '2027-10-20').length, 0);
});

test('ICS: a yearly journal exports two windows with the year in each ID', () => {
  const d = L.emptyData();
  d.journals = [L.normalizeJournal({ id: 'r', name: 'Autumn', opens: '2026-09-01', closes: '2026-11-30', repeat: 'yearly' })];
  const ics = L.toICS(d, '2026-12-05', new Date('2026-12-05T00:00:00Z'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  for (const uid of ['r-opens-2027', 'r-closes-2027', 'r-opens-2028', 'r-closes-2028']) assert.ok(ics.includes('UID:' + uid + '@poetry-tracker'), uid);
});

// ---------- manuscripts and entries ----------
function bookFixture() {
  const d = fixture();
  d.manuscripts = [L.normalizeManuscript({ id: 'm1', title: 'Salt Chapbook', kind: 'chapbook', pageCount: 32, poemIds: ['p1', 'p2', 'p3', 'p3'] })];
  d.entries = [
    { id: 'e1', manuscriptId: 'm1', name: 'Press A', status: 'pending', sentDate: '2026-11-01', feePaid: 20 },
    { id: 'e2', manuscriptId: 'm1', name: 'Contest B', status: 'finalist', sentDate: '2026-11-02' },
    { id: 'e3', manuscriptId: 'm1', name: 'Contest C', status: 'planned', deadline: '2026-12-10', fee: 25, url: 'https://c.example' },
  ].map(L.normalizeEntry);
  return d;
}

test('manuscript normalizing', () => {
  const m = L.normalizeManuscript({ title: ' Book ', kind: 'epic', pageCount: '0', poemIds: ['a', 'a', 7] });
  assert.equal(m.title, 'Book');
  assert.equal(m.kind, 'chapbook');
  assert.equal(m.pageCount, null);
  assert.deepEqual(m.poemIds, ['a']);
  const e = L.normalizeEntry({ name: 'X', status: 'nope', deadline: '2026-02-31', fee: -1 });
  assert.equal(e.status, 'planned');
  assert.equal(e.deadline, '');
  assert.equal(e.fee, null);
  const d = L.normalize({ manuscripts: [{ title: '' }, { title: 'Ok' }], entries: [{ name: '' }, { name: 'Ok' }] });
  assert.equal(d.manuscripts.length, 1);
  assert.equal(d.entries.length, 1);
});

test('manuscript summary and state', () => {
  const d = bookFixture();
  const m = d.manuscripts[0];
  assert.deepEqual(L.manuscriptSummary(d, m), { poemCount: 3, placed: 0, out: 2, ready: 0, draft: 1, placedPct: 0, pageCount: 32 });
  assert.equal(L.manuscriptState(d, m), 'out');
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  assert.equal(L.manuscriptSummary(d, m).placed, 1);
  assert.equal(L.manuscriptSummary(d, m).placedPct, 33);
  d.entries.forEach((e) => (e.status = 'rejected'));
  assert.equal(L.manuscriptState(d, m), 'planning');
});

test('manuscript warnings', () => {
  const d = bookFixture();
  const m = d.manuscripts[0];
  assert.deepEqual(L.manuscriptWarnings(d, m), ['1 poem is still marked as a draft.']);
  m.pageCount = 12;
  assert.ok(L.manuscriptWarnings(d, m).some((w) => /about 20 to 40 pages, and this one is 12/.test(w)));
  m.pageCount = null;
  assert.ok(L.manuscriptWarnings(d, m).some((w) => /No page count/.test(w)));
  m.kind = 'full-length'; m.pageCount = 60;
  assert.ok(!L.manuscriptWarnings(d, m).some((w) => /48 to 100/.test(w)));
  m.poemIds = [];
  assert.deepEqual(L.manuscriptWarnings(d, m), ['No poems are listed in this manuscript yet.']);
  // many poems, few placed
  for (let i = 0; i < 6; i++) { d.poems.push(L.normalizePoem({ id: 'x' + i, title: 'X' + i, status: 'ready' })); m.poemIds.push('x' + i); }
  assert.ok(L.manuscriptWarnings(d, m).some((w) => /25 to 50 percent/.test(w)));
});

test('accepting a manuscript flags the other live entries', () => {
  const d = bookFixture();
  assert.equal(L.entryAlerts(d).length, 0);
  const alerts = L.setEntryStatus(d, 'e1', 'accepted', '2026-12-01');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].acceptedAt, 'Press A');
  assert.deepEqual(alerts[0].entries.map((e) => e.id), ['e2']); // the planned one is not waiting on anyone
  assert.equal(L.manuscriptState(d, d.manuscripts[0]), 'placed');
  L.setEntryStatus(d, 'e2', 'withdrawn', '2026-12-02');
  assert.equal(L.entryAlerts(d).length, 0);
  assert.equal(L.entryById(d, 'e2').responseDate, '2026-12-02');
});

test('entry status changes keep dates sensible', () => {
  const d = bookFixture();
  L.setEntryStatus(d, 'e3', 'pending', '2026-12-08');
  assert.equal(L.entryById(d, 'e3').sentDate, '2026-12-08');
  L.setEntryStatus(d, 'e3', 'finalist', '2026-12-20');
  assert.equal(L.entryById(d, 'e3').responseDate, '');
  L.setEntryStatus(d, 'e3', 'rejected', '2027-01-05');
  assert.equal(L.entryById(d, 'e3').responseDate, '2027-01-05');
  L.setEntryStatus(d, 'e3', 'planned');
  assert.equal(L.entryById(d, 'e3').sentDate, '');
  assert.throws(() => L.setEntryStatus(d, 'e3', 'nope'));
});

test('pre-send checks for an entry', () => {
  const d = bookFixture();
  const w = L.checkEntry(d, { manuscriptId: 'm1', name: 'press a', deadline: '2026-12-01', sentDate: '2026-12-05' }, '2026-12-05');
  assert.ok(w.some((m) => /deadline was 2026-12-01/.test(m)));
  assert.ok(w.some((m) => /already has an entry for press a/.test(m)));
  assert.ok(w.some((m) => /also out at Contest B/.test(m)));
  assert.ok(w.some((m) => /still marked as a draft/.test(m)));
  assert.equal(L.checkEntry(d, { manuscriptId: 'nope', name: 'x' }, '2026-12-05').length, 0);
  const own = L.checkEntry(d, { id: 'e3', manuscriptId: 'm1', name: 'Contest C', deadline: '2026-12-10', sentDate: '2026-12-08' }, '2026-12-08');
  assert.ok(!own.some((m) => /already has an entry/.test(m)));
});

test('entry deadlines appear in the deadline list and the calendar, only while planned', () => {
  const d = bookFixture();
  const e = L.upcomingDeadlines(d, '2026-11-18', 30);
  const dl = e.find((x) => x.kind === 'deadline');
  assert.equal(dl.name, 'Contest C');
  assert.equal(dl.daysAway, 22);
  const ics = L.toICS(d, '2026-11-18', new Date('2026-11-18T00:00:00Z'));
  assert.ok(ics.includes('UID:e3-deadline@poetry-tracker'));
  assert.ok(ics.includes('SUMMARY:Entry deadline: Contest C'));
  assert.ok(ics.includes('Manuscript: Salt Chapbook'));
  assert.ok(!ics.includes('e1-deadline'));
  L.setEntryStatus(d, 'e3', 'pending', '2026-11-20');
  assert.ok(!L.upcomingDeadlines(d, '2026-11-18', 30).some((x) => x.kind === 'deadline'));
});

test('deleting a poem or manuscript cleans up', () => {
  const d = bookFixture();
  L.removePoem(d, 'p1');
  assert.deepEqual(d.manuscripts[0].poemIds, ['p2', 'p3']);
  const r = L.removeManuscript(d, 'm1');
  assert.equal(r.removedEntries, 3);
  assert.equal(d.manuscripts.length, 0);
  assert.equal(d.entries.length, 0);
});

test('entry fees count toward fees paid and spend', () => {
  const d = bookFixture();
  d.submissions[0].feePaid = 3;
  assert.equal(L.stats(d).feesTotal, 23);
  assert.deepEqual(L.spend(d), { submissions: 3, entries: 20, total: 23 });
});

test('entries CSV', () => {
  const d = bookFixture();
  d.entries[2].notes = '=SUM(1)';
  const lines = L.toEntriesCSV(d).split('\r\n');
  assert.equal(lines[0], 'Date sent,Press or contest,Manuscript,Status,Deadline,Response date,Days to response,Entry fee,Fee paid,Notes');
  assert.ok(L.toEntriesCSV(d).includes("'=SUM(1)"));
  assert.ok(L.toEntriesCSV(d).includes('Press A,Salt Chapbook,pending'));
});

// ---------- one poem's history ----------
test('poem history: outcomes, order, who has seen it', () => {
  const d = bookFixture();
  L.setSubmissionStatus(d, 's1', 'rejected', '2026-10-11');
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  const h = L.poemHistory(d, 'p1', '2026-11-18');
  assert.deepEqual(h.rows.map((r) => r.outcome), ['accepted', 'rejected']); // newest first
  assert.deepEqual(h.rows.map((r) => r.days), [36, 10]);
  assert.equal(h.rows[1].withOthers, true);
  assert.deepEqual(h.seenBy, ['Beta Quarterly', 'Alpha Review']);
  assert.equal(h.placement.kind, 'submission');
  assert.deepEqual(h.manuscripts.map((m) => m.id), ['m1']);
  assert.equal(L.poemHistory(d, 'nope', '2026-11-18'), null);
});

test('poem history: pending, withdrawn and not-taken', () => {
  const d = fixture();
  assert.equal(L.poemHistory(d, 'p2', '2026-11-18').rows.find((r) => r.sub.id === 's3').days, 43);
  assert.equal(L.poemHistory(d, 'p2', '2026-11-18').rows.find((r) => r.sub.id === 's3').outcome, 'pending');
  L.withdrawPoem(d, 's1', 'p1', '2026-11-01');
  assert.equal(L.poemHistory(d, 'p1', '2026-11-18').rows.find((r) => r.sub.id === 's1').outcome, 'withdrawn');
  L.acceptSubmission(d, 's1', ['p2'], '2026-11-02');
  const s1 = d.submissions.find((s) => s.id === 's1');
  s1.withdrawnPoemIds = [];
  assert.equal(L.poemOutcome(s1, 'p1'), 'not-taken');
  assert.equal(L.poemOutcome(s1, 'p2'), 'accepted');
});

test('where a poem could go next', () => {
  const d = fixture();
  d.journals.push(L.normalizeJournal({ id: 'j4', name: 'Delta', opens: '2026-11-01', closes: '2026-12-31', simSubs: 'no' }));
  // p3 has never been sent anywhere: both open journals are fair game
  assert.deepEqual(L.nextTargets(d, 'p3', '2026-11-18').map((t) => t.journal.id).sort(), ['j1', 'j4']);
  // p1 is out at j1 and j2, so only Delta is left, and Delta bans simultaneous submissions
  const t = L.nextTargets(d, 'p1', '2026-11-18');
  assert.deepEqual(t.map((x) => x.journal.id), ['j4']);
  assert.equal(t[0].blockedBySim, true);
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  assert.deepEqual(L.nextTargets(d, 'p1', '2026-11-18'), []); // already placed
});

// ---------- insights ----------
test('journal stats and response buckets', () => {
  const d = fixture();
  L.setSubmissionStatus(d, 's1', 'rejected', '2026-10-11');
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  const rows = L.journalStats(d);
  assert.deepEqual(rows.map((r) => r.name), ['Alpha Review', 'Beta Quarterly', 'No-Sim Journal']);
  assert.equal(rows[0].medianDays, 10);
  assert.equal(rows[0].acceptRate, 0);
  assert.equal(rows[1].acceptRate, 1);
  assert.equal(rows[2].acceptRate, null);
  assert.equal(rows[2].medianDays, null);
  const b = L.responseBuckets(d);
  assert.equal(b.length, 6);
  assert.equal(b[0].count, 1); // 10 days
  assert.equal(b[2].count, 1); // 36 days
  assert.equal(b.reduce((t, x) => t + x.count, 0), 2);
});

// ---------- undo ----------
test('snapshots ignore the revision and restore keeps the current one', () => {
  const a = fixture(); a.rev = 5;
  const b = fixture(); b.rev = 9;
  assert.equal(L.snapshot(a), L.snapshot(b));
  const back = L.restoreSnapshot(L.snapshot(a), 12);
  assert.equal(back.rev, 12);
  assert.equal(back.poems.length, 3);
});

test('undo and redo walk back and forth', () => {
  const d = fixture();
  const h = L.createHistory(3);
  const before = L.snapshot(d);
  d.poems.push(L.normalizePoem({ title: 'New' }));
  L.historyRecord(h, before, 'Added a poem');
  assert.equal(L.historyUndo(L.createHistory(), L.snapshot(d)), null);
  const u = L.historyUndo(h, L.snapshot(d));
  assert.equal(u.label, 'Added a poem');
  const back = L.restoreSnapshot(u.json, 7);
  assert.equal(back.poems.length, 3);
  const r = L.historyRedo(h, L.snapshot(back));
  assert.equal(L.restoreSnapshot(r.json, 8).poems.length, 4);
  assert.equal(L.historyRedo(h, L.snapshot(back)), null);
  // a new change after an undo throws the redo stack away
  L.historyUndo(h, L.snapshot(d));
  L.historyRecord(h, before, 'Something else');
  assert.equal(h.future.length, 0);
  // the stack is capped
  for (let i = 0; i < 6; i++) L.historyRecord(h, before, 'c' + i);
  assert.equal(h.past.length, 3);
  assert.equal(h.past[2].label, 'c5');
});

// ---------- backup reminder ----------
test('backup reminder', () => {
  const d = fixture();
  assert.equal(L.backupReminder(d, '2026-11-18').kind, 'never');
  L.markBackupDownloaded(d, '2026-11-01');
  assert.equal(L.backupReminder(d, '2026-11-18'), null);
  const stale = L.backupReminder(d, '2026-12-05');
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.days, 34);
  L.snoozeBackupReminder(d, '2026-12-05', 90);
  assert.equal(d.settings.backupSnoozedUntil, '2027-03-05');
  assert.equal(L.backupReminder(d, '2026-12-06'), null);
  assert.equal(L.backupReminder(d, '2027-03-05').kind, 'stale');
  // a working second folder means no nagging; a broken one does nag
  const e = fixture();
  assert.equal(L.backupReminder(e, '2026-11-18', { folderSet: true, lastCopyOk: true }), null);
  const bad = L.backupReminder(e, '2026-11-18', { folderSet: true, lastCopyOk: false, lastError: 'disk full' });
  assert.equal(bad.kind, 'copy-failing');
  assert.equal(bad.error, 'disk full');
  // nothing worth saving yet
  assert.equal(L.backupReminder(L.emptyData(), '2026-11-18'), null);
});

// ---------- CSV import ----------
test('CSV parsing: quotes, BOM, line endings, delimiters, ragged rows', () => {
  const t = '﻿Name,Website,Closes,Notes\r\n"Alpha, Review",alpha.org,"Nov 30, 2026","said ""hi""\nline2"\r\n\r\nBeta\r\n';
  const p = L.parseCSV(t);
  assert.deepEqual(p.headers, ['Name', 'Website', 'Closes', 'Notes']);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0][0], 'Alpha, Review');
  assert.equal(p.rows[0][2], 'Nov 30, 2026');
  assert.equal(p.rows[0][3], 'said "hi"\nline2');
  assert.deepEqual(p.rows[1], ['Beta', '', '', '']);
  assert.equal(L.parseCSV('a;b\n1;2').delimiter, ';');
  assert.deepEqual(L.parseCSV('a\tb\n1\t2').rows[0], ['1', '2']);
  assert.deepEqual(L.parseCSV('a,b\n1,2,3,4').rows[0], ['1', '2']);
  assert.deepEqual(L.parseCSV(''), { headers: [], rows: [], delimiter: ',' });
});

test('guessing which column is which', () => {
  assert.deepEqual(
    L.guessMapping(['Journal Name', 'Website', 'Reading Period Opens', 'Reading Period Closes', 'Fee', 'Max poems', 'Simultaneous submissions?', 'Notes', 'Extra']),
    ['name', 'url', 'opens', 'closes', 'fee', 'maxPoems', 'simSubs', 'notes', '']
  );
  assert.deepEqual(L.guessMapping(['Magazine', 'Link', 'Deadline', 'Cost', 'Sim subs']), ['name', 'url', 'closes', 'fee', 'simSubs']);
  assert.deepEqual(L.guessMapping(['Name', 'Title']), ['name', '']); // each field is used once
});

test('reading the dates people type', () => {
  const t = '2026-11-18';
  const f = (s) => L.parseFlexibleDate(s, t);
  assert.equal(f('2026-12-01'), '2026-12-01');
  assert.equal(f('12/1/2026'), '2026-12-01');
  assert.equal(f('12/1/26'), '2026-12-01');
  assert.equal(f('31/12/2026'), '2026-12-31');
  assert.equal(f('Sep 1, 2027'), '2027-09-01');
  assert.equal(f('September 1st 2027'), '2027-09-01');
  assert.equal(f('1 Sept 2027'), '2027-09-01');
  assert.equal(f('Dec 15'), '2026-12-15');
  assert.equal(f('Nov 18'), '2026-11-18');
  assert.equal(f('Nov 1'), '2027-11-01'); // already passed this year
  assert.equal(f('rolling'), '');
  assert.equal(f('2026-02-30'), '');
  assert.equal(f(''), '');
});

test('reading fees, poem limits, simultaneous flags and web addresses', () => {
  assert.equal(L.parseFee('$25'), 25);
  assert.equal(L.parseFee('Free'), 0);
  assert.equal(L.parseFee('No fee'), 0);
  assert.equal(L.parseFee('$3.50'), 3.5);
  assert.equal(L.parseFee('varies'), null);
  assert.equal(L.parseFee(''), null);
  assert.equal(L.parseMaxPoems('3-5'), 5);
  assert.equal(L.parseMaxPoems('Up to 6 poems'), 6);
  assert.equal(L.parseMaxPoems('0'), null);
  assert.equal(L.parseMaxPoems('n/a'), null);
  assert.equal(L.parseSim('Yes'), 'yes');
  assert.equal(L.parseSim('Sim subs OK'), 'yes');
  assert.equal(L.parseSim('No simultaneous submissions'), 'no');
  assert.equal(L.parseSim('not allowed'), 'no');
  assert.equal(L.parseSim('?'), 'unknown');
  assert.equal(L.parseSim(''), 'unknown');
  assert.equal(L.cleanUrl('alpha.org'), 'https://alpha.org');
  assert.equal(L.cleanUrl('http://x.com/a'), 'http://x.com/a');
  assert.equal(L.cleanUrl('javascript:alert(1)'), '');
  assert.equal(L.cleanUrl('ftp://x.org'), '');
  assert.equal(L.cleanUrl('not a url'), '');
});

test('building an import: duplicates, bad dates, year-less windows', () => {
  const existing = [L.normalizeJournal({ id: 'j1', name: 'Alpha Review', url: 'https://alpha.org/' })];
  const csv = [
    'Name,Website,Opens,Closes,Fee,Max,Sim',
    'alpha review,,,,,,',
    'Gamma,www.gamma.org,Sep 1,Nov 30,$3,3-5,yes',
    'Delta,,,rolling,Free,,no',
    ',x.org,,,,,',
    'GAMMA,,,,,,',
    'Different Name,alpha.org,,,,,',
    'Winter,,Nov 1,Feb 1,,,',
  ].join('\n');
  const parsed = L.parseCSV(csv);
  const map = L.guessMapping(parsed.headers);
  assert.deepEqual(map, ['name', 'url', 'opens', 'closes', 'fee', 'maxPoems', 'simSubs']);
  const rows = L.buildImport(parsed, map, existing, '2026-11-18');
  assert.deepEqual(rows.map((r) => r.status), ['duplicate', 'new', 'new', 'skip', 'duplicate', 'duplicate', 'new']);
  const gamma = rows[1].journal;
  assert.equal(gamma.url, 'https://www.gamma.org');
  assert.equal(gamma.opens, '2026-09-01'); // read as a window: Sep 1 to Nov 30, open right now
  assert.equal(gamma.closes, '2026-11-30');
  assert.equal(gamma.repeat, 'yearly');
  assert.equal(gamma.fee, 3);
  assert.equal(gamma.maxPoems, 5);
  assert.equal(gamma.simSubs, 'yes');
  const delta = rows[2];
  assert.equal(delta.journal.closes, '');
  assert.equal(delta.journal.fee, 0);
  assert.equal(delta.problems.length, 1);
  assert.ok(delta.journal.notes.includes('Closes: rolling'));
  assert.equal(rows[0].include, false);
  assert.equal(rows[6].journal.opens, '2026-11-01'); // spans New Year
  assert.equal(rows[6].journal.closes, '2027-02-01');
  const d = L.emptyData();
  d.journals = existing.slice();
  assert.equal(L.applyImport(d, rows), 3);
  assert.equal(d.journals.length, 4);
  rows[0].include = true; // the user may force a duplicate in
  assert.equal(L.applyImport(d, rows), 4);
});

test('nothing in the files the tool shows contains an em dash', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'public');
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|html|css|json)$/.test(f)) continue;
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('\u2014'), f + ' has an em dash');
  }
});

// ======================================================================
// Pen Pal: extra windows, always-open journals, budget, follow-ups, rights, directory, history import
// ======================================================================

test('extra yearly windows roll forward with the main one', () => {
  const j = L.normalizeJournal({ id: 'cn', name: 'Two Windows', opens: '2026-08-15', closes: '2026-12-01', repeat: 'yearly', extraWindows: [{ opens: '01-15', closes: '03-01' }, { opens: '13-01', closes: '02-30' }] });
  assert.equal(j.extraWindows.length, 1); // the impossible pair is dropped
  assert.deepEqual(L.currentWindow(j, '2026-11-20'), { opens: '2026-08-15', closes: '2026-12-01', k: 0 });
  assert.equal(L.currentWindow(j, '2026-12-10').opens, '2027-01-15');
  assert.equal(L.currentWindow(j, '2027-03-05').opens, '2027-08-15');
  assert.deepEqual(L.windowsFrom(j, '2026-12-10', 3).map((w) => w.opens), ['2027-01-15', '2027-08-15', '2028-01-15']);
  // extra windows only apply to journals that repeat yearly
  const once = L.normalizeJournal({ name: 'x', opens: '2026-08-15', closes: '2026-12-01', extraWindows: [{ opens: '01-15', closes: '03-01' }] });
  assert.equal(L.windowsFrom(once, '2026-12-10', 3).length, 1);
});

test('an extra window that runs over New Year', () => {
  const j = L.normalizeJournal({ name: 'BWR', opens: '2026-06-01', closes: '2026-09-30', repeat: 'yearly', extraWindows: [{ opens: '12-15', closes: '03-01' }] });
  assert.deepEqual(L.currentWindow(j, '2027-01-10'), { opens: '2026-12-15', closes: '2027-03-01', k: 0 });
  assert.equal(L.currentWindow(j, '2026-10-05').opens, '2026-12-15');
});

test('window text round trip', () => {
  const r = L.parseWindowsText('Jan 15 to Mar 1; July 1 - July 31\nnonsense');
  assert.deepEqual(r.windows, [{ opens: '01-15', closes: '03-01' }, { opens: '07-01', closes: '07-31' }]);
  assert.deepEqual(r.bad, ['nonsense']);
  assert.equal(L.windowsText(r.windows), 'Jan 15 to Mar 1; Jul 1 to Jul 31');
  assert.deepEqual(L.parseWindowsText('Feb 29 to Mar 3').windows, [{ opens: '02-29', closes: '03-03' }]);
});

test('always-open journals count as open and never warn about dates', () => {
  const d = L.emptyData();
  d.journals = [L.normalizeJournal({ id: 'a', name: 'Always', alwaysOpen: true })];
  assert.equal(L.currentWindow(d.journals[0], '2026-11-23').always, true);
  assert.deepEqual(L.openNow(d, '2026-11-23').map((o) => o.daysLeft), [null]);
  assert.equal(L.checkSubmission(d, { poemIds: [], journalId: 'a', sentDate: '2026-11-23' }, '2026-11-23').length, 0);
  assert.equal(L.upcomingDeadlines(d, '2026-11-23', 365).length, 0);
});

// ---------- budget ----------
function budgetFixture() {
  const d = bookFixture();
  d.submissions[0].feePaid = 3; // s1, sent 2026-10-01
  d.submissions[1].feePaid = 5; // s2, sent 2026-10-05
  d.submissions.push(L.normalizeSubmission({ id: 's9', poemIds: ['p3'], journalId: 'j1', sentDate: '2025-12-30', feePaid: 50 }));
  // from bookFixture: e1 paid $20 on 2026-11-01; e3 is planned, $25 fee, due 2026-12-10
  return d;
}

test('fees for a month and a year, with planned entries', () => {
  const d = budgetFixture();
  const s = L.budgetSummary(d, '2026-10');
  assert.equal(s.budget, null);
  assert.equal(s.spent, 8);
  assert.deepEqual(s.items.map((i) => i.name), ['Beta Quarterly', 'Alpha Review']);
  assert.equal(L.budgetSummary(d, '2026-12').planned, 25);
  assert.equal(L.budgetSummary(d, '2025-12').spent, 50);
  const y = L.budgetYear(d, 2026);
  assert.equal(y.spent, 28);
  assert.equal(y.planned, 25);
  assert.equal(y.months[9].spent, 8);
  assert.equal(y.months[10].spent, 20);
  assert.equal(y.months[11].planned, 25);
  assert.equal(y.months[0].budget, null);
});

test('a monthly budget applies from its month on, and later changes keep history', () => {
  const d = budgetFixture();
  L.setBudget(d, '2026-11', '30');
  assert.equal(L.budgetFor(d.settings, '2026-10'), null); // earlier months untouched
  assert.equal(L.budgetFor(d.settings, '2026-11'), 30);
  assert.equal(L.budgetFor(d.settings, '2027-06'), 30); // carries forward
  const s = L.budgetSummary(d, '2026-11');
  assert.equal(s.counted, 20);
  assert.equal(s.left, 10);
  assert.equal(s.warnAt, 24);
  L.setBudget(d, '2027-01', 50); // a raise in January leaves November and December alone
  assert.equal(L.budgetFor(d.settings, '2026-12'), 30);
  assert.equal(L.budgetFor(d.settings, '2027-02'), 50);
  assert.deepEqual(L.budgetYear(d, 2027).months.map((m) => m.budget).slice(0, 2), [50, 50]);
  L.setBudget(d, '2026-12', ''); // remove from December on: January's change still stands
  assert.equal(L.budgetFor(d.settings, '2026-11'), 30);
  assert.equal(L.budgetFor(d.settings, '2026-12'), null);
  assert.equal(L.budgetFor(d.settings, '2027-03'), 50);
  L.setBudget(d, '2027-01', 30); // tidy: no entry that repeats the month before
  assert.deepEqual(L.normalizeSettings(d.settings).monthlyBudget, { '2026-11': 30, '2026-12': null, '2027-01': 30 });
  d.settings = L.normalizeSettings(Object.assign({}, d.settings, { countPlanned: false }));
  L.setBudget(d, '2026-12', 40);
  assert.equal(L.budgetSummary(d, '2026-12').left, 40); // the planned $25 entry not counted
  assert.deepEqual(L.normalizeSettings({ monthlyBudget: { '2026-13': 5, abc: 3, '2027-02': '40', '2027-01': -5 }, budgetWarnPct: 500 }),
    { lastBackupDownload: '', backupSnoozedUntil: '', monthlyBudget: { '2027-02': 40 }, budgetWarnPct: 80, countPlanned: true, theme: 'system', followUpDays: 90, deskDays: 60, notifyDays: 3, checkUpdates: true, savedFinds: [] });
});

test('a yearly budget from Pen Pal 2.1 becomes a monthly one', () => {
  assert.deepEqual(L.normalizeSettings({ budgets: { 2026: 120, 2027: 100 } }).monthlyBudget, { '2026-01': 10, '2027-01': 8.33 });
  const d = budgetFixture();
  d.settings = { budgets: { 2026: 240 } };
  assert.equal(L.budgetSummary(d, '2026-11').budget, 20);
  const n = L.normalize(Object.assign({}, d, { settings: { budgets: { 2026: 240 } } }));
  assert.equal(n.settings.budgets, undefined);
  assert.deepEqual(n.settings.monthlyBudget, { '2026-01': 20 });
});

test('budget warnings in the pre-send checks', () => {
  const d = budgetFixture();
  assert.equal(L.budgetCheck(d, 30, '2026-11-20'), null); // no budget set
  L.setBudget(d, '2026-11', 50);
  assert.equal(L.budgetCheck(d, 3, '2026-11-20'), null); // 20 + 3 = 23, under the $40 heads-up line
  assert.equal(L.budgetCheck(d, 25, '2026-11-20'), 'This fee would bring you to $45 of your $50 fee budget for November 2026.');
  assert.equal(L.budgetCheck(d, 35, '2026-11-20'), 'This fee would take you to $55, over your $50 fee budget for November 2026.');
  assert.equal(L.budgetCheck(d, 35, '2026-10-02'), null); // before the budget started
  // December carries the $50 budget and already has the $25 planned entry
  assert.equal(L.budgetCheck(d, 20, '2026-12-01'), 'This fee would bring you to $45 of your $50 fee budget for December 2026.');
  // editing a submission does not count its own old fee twice
  d.submissions[0].sentDate = '2026-11-02';
  assert.equal(L.budgetCheck(d, 20, '2026-11-20', { subId: 's1' }), 'This fee would bring you to $40 of your $50 fee budget for November 2026.');
  const w = L.checkSubmission(d, { poemIds: ['p3'], journalId: 'j1', sentDate: '2026-11-20', feePaid: '50' }, '2026-11-20');
  assert.ok(w.some((m) => /over your \$50 fee budget/.test(m)));
  const we = L.checkEntry(d, { manuscriptId: 'm1', name: 'New Prize', deadline: '2026-12-20', fee: '20' }, '2026-11-20');
  assert.ok(we.some((m) => /\$45 of your \$50/.test(m)));
});

// ---------- follow-up reminders ----------
test('follow-up reminders use your history, then the journal, then 90 days', () => {
  const d = fixture();
  // s1 at j1 sent 2026-10-01; s2 at j2 sent 2026-10-05; s3 at j3 sent 2026-10-06
  assert.equal(L.queryReminders(d, '2026-12-01').length, 0);
  d.journals[1].replyDays = 30; // Beta says about 30 days
  let q = L.queryReminders(d, '2026-12-01');
  assert.deepEqual(q.map((x) => x.sub.id), ['s2']);
  assert.equal(q[0].basis, 'journal');
  assert.equal(q[0].waiting, 57);
  // two answered submissions at Alpha make its own history win
  d.submissions.push(L.normalizeSubmission({ id: 'h1', poemIds: ['p3'], journalId: 'j1', sentDate: '2026-01-01', status: 'rejected', responseDate: '2026-01-21' }));
  d.submissions.push(L.normalizeSubmission({ id: 'h2', poemIds: ['p3'], journalId: 'j1', sentDate: '2026-03-01', status: 'rejected', responseDate: '2026-03-31' }));
  assert.deepEqual(L.expectedReply(d, d.journals[0]), { days: 25, basis: 'history' });
  q = L.queryReminders(d, '2026-12-01');
  assert.deepEqual(q.map((x) => x.sub.id), ['s1', 's2']);
  assert.equal(L.expectedReply(d, d.journals[2]).basis, 'default');
  assert.equal(L.queryReminders(d, '2027-01-05').length, 3);
});

test('marking a query sent or snoozing hides the reminder for a while', () => {
  const d = fixture();
  L.snoozeQuery(d, 's3', '2027-01-05', 30);
  assert.ok(!L.queryReminders(d, '2027-01-05').some((x) => x.sub.id === 's3'));
  assert.ok(L.queryReminders(d, '2027-02-04').some((x) => x.sub.id === 's3'));
  L.markQueried(d, 's1', '2027-01-05');
  assert.ok(!L.queryReminders(d, '2027-02-01').some((x) => x.sub.id === 's1'));
  const again = L.queryReminders(d, '2027-03-06').find((x) => x.sub.id === 's1');
  assert.equal(again.queried, '2027-01-05');
  L.setSubmissionStatus(d, 's1', 'rejected', '2027-03-07');
  assert.ok(!L.queryReminders(d, '2027-03-08').some((x) => x.sub.id === 's1'));
});

// ---------- rights ----------
test('rights normalize and suggest a credit line', () => {
  const d = fixture();
  const r = L.normalizeRights({ bought: ' First North American serial ', pubDate: '2026-10-12', exclusiveUntil: 'soon', reprints: 'maybe' });
  assert.equal(r.bought, 'First North American serial');
  assert.equal(r.exclusiveUntil, '');
  assert.equal(r.reprints, 'unknown');
  assert.equal(L.suggestedCredit(d, d.poems[0]), ''); // not placed yet
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  assert.equal(L.suggestedCredit(d, d.poems[0]), '"Salt Line" first appeared in Beta Quarterly, 2026.');
  d.poems[0].rights = L.normalizeRights({ issue: 'Fall 2026' });
  assert.equal(L.suggestedCredit(d, d.poems[0]), '"Salt Line" first appeared in Beta Quarterly, Fall 2026.');
  d.poems[2].status = 'published';
  d.poems[2].publishedWhere = 'Gamma';
  d.poems[2].publishedDate = '2024';
  assert.equal(L.suggestedCredit(d, d.poems[2]), '"Old Draft" first appeared in Gamma, 2024.');
});

test('reprint reminders, published list and calendar use the rights dates', () => {
  const d = fixture();
  L.acceptSubmission(d, 's2', ['p1'], '2026-11-10');
  d.poems[0].rights = L.normalizeRights({ exclusiveUntil: '2026-12-02', pubDate: '2027-02-01' });
  assert.deepEqual(L.rightsReminders(d, '2026-11-23').map((x) => [x.poem.id, x.daysAway, x.placedAt]), [['p1', 9, 'Beta Quarterly']]);
  assert.equal(L.rightsReminders(d, '2026-10-01').length, 0);
  assert.equal(L.rightsReminders(d, '2026-12-08').length, 1); // a few days after, still shown
  assert.equal(L.rightsReminders(d, '2026-12-20').length, 0);
  assert.equal(L.publishedList(d).items[0].when, '2027');
  const ics = L.toICS(d, '2026-11-23', new Date('2026-11-23T00:00:00Z'));
  assert.ok(ics.includes('UID:p1-reprint@pen-pal'));
  assert.ok(ics.includes('SUMMARY:Free for reprint: Salt Line'));
});

// ---------- directory ----------
const DIR = L.loadDirectory({
  checked: '2026-11-23',
  journals: [
    { id: 'cn', name: 'Copper Test', url: 'copper.example/submit', windows: [['08-15', '12-01'], ['01-15', '03-01']], fee: 3, maxPoems: 6, simSubs: 'yes', pays: 'yes', paysNote: '$30 per page', reprints: 'no', tags: ['print', 'Denver'], note: 'Caps early.' },
    { id: 'rt', name: 'Rattle Test', yearRound: true, fee: 0, simSubs: 'yes', pays: 'yes', tags: ['online'], note: 'Any length.' },
    { id: 'kr', name: 'Kenyon Test', windows: [['09-01', '09-30']], fee: 0, simSubs: 'yes', pays: 'yes', replyDays: 180, note: 'Short window.' },
    { id: 'sw', name: 'Miami Daily', windowsUnknown: true, fee: null, simSubs: 'yes', pays: 'no', tags: ['Miami', 'Florida'], note: 'A poem every weekday.' },
    { id: 'bad', name: '', windows: [] },
  ],
});

test('the shipped directory file loads cleanly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'directory.json'), 'utf8'));
  const dir = L.loadDirectory(raw);
  assert.equal(dir.journals.length, raw.journals.length);
  assert.ok(L.isDate(dir.checked));
  const ids = new Set();
  for (const e of dir.journals) {
    assert.ok(!ids.has(e.id), 'duplicate id ' + e.id);
    ids.add(e.id);
    assert.ok(/^https:\/\//.test(e.url), e.name + ' needs an https link');
    assert.ok(e.note && !e.note.includes('\u2014'), e.name + ' note');
    for (const w of e.windows) assert.ok(L.isDate('2028-' + w.opens) && L.isDate('2028-' + w.closes), e.name + ' window');
  }
});

test('directory entries become journals with yearly windows', () => {
  assert.equal(DIR.journals.length, 4);
  assert.equal(DIR.journals[0].url, 'https://copper.example/submit');
  const j = L.dirToJournal(DIR.journals[0], '2026-11-23', '2026-11-23');
  assert.equal(j.repeat, 'yearly');
  assert.equal(j.opens, '2025-08-15');
  assert.deepEqual(j.extraWindows, [{ opens: '01-15', closes: '03-01' }]);
  assert.equal(j.dirId, 'cn');
  assert.equal(j.checked, '2026-11-23');
  assert.ok(j.notes.includes('Caps early.') && j.notes.includes('Pays $30 per page'));
  assert.deepEqual(L.currentWindow(j, '2026-11-23'), { opens: '2026-08-15', closes: '2026-12-01', k: 1 });
  const always = L.dirToJournal(DIR.journals[1], '2026-11-23', '');
  assert.equal(always.alwaysOpen, true);
  assert.equal(always.opens, '');
  const unknown = L.dirToJournal(DIR.journals[3], '2026-11-23', '');
  assert.equal(unknown.repeat, 'none');
  assert.equal(unknown.alwaysOpen, false);
});

test('directory states and search', () => {
  const d = L.emptyData();
  assert.deepEqual(L.dirState(DIR.journals[0], '2026-11-23'), { kind: 'open', opens: '2026-08-15', closes: '2026-12-01', daysLeft: 8, daysUntil: 0 });
  assert.equal(L.dirState(DIR.journals[0], '2026-12-20').kind, 'soon');
  assert.equal(L.dirState(DIR.journals[2], '2026-11-23').kind, 'closed');
  assert.equal(L.dirState(DIR.journals[1], '2026-11-23').kind, 'always');
  assert.equal(L.dirState(DIR.journals[3], '2026-11-23').kind, 'unknown');
  const names = (opts) => L.searchDirectory(DIR, d, opts, '2026-11-23').map((r) => r.entry.id);
  assert.deepEqual(names({}), ['cn', 'rt', 'kr', 'sw']); // open, always, closed, unknown
  assert.deepEqual(names({ q: 'miami' }), ['sw']);
  assert.deepEqual(names({ q: 'florida weekday' }), ['sw']);
  assert.deepEqual(names({ openSoon: true }), ['cn', 'rt']);
  assert.deepEqual(names({ free: true }), ['rt', 'kr']);
  assert.deepEqual(names({ pays: true, free: true }), ['rt', 'kr']);
  // added and sent to: shows as yours, and "not sent to yet" hides it
  const j = L.dirToJournal(DIR.journals[1], '2026-11-23', '');
  d.journals.push(j);
  d.poems.push(L.normalizePoem({ id: 'p', title: 'P' }));
  d.submissions.push(L.normalizeSubmission({ poemIds: ['p'], journalId: j.id, sentDate: '2026-11-01' }));
  const r = L.searchDirectory(DIR, d, {}, '2026-11-23').find((x) => x.entry.id === 'rt');
  assert.equal(r.mine.id, j.id);
  assert.equal(r.sent, 1);
  assert.deepEqual(names({ notSent: true }), ['cn', 'kr', 'sw']);
  // a journal you typed in yourself with the same name also counts as yours
  d.journals.push(L.normalizeJournal({ name: 'kenyon test' }));
  assert.ok(L.searchDirectory(DIR, d, { q: 'kenyon' }, '2026-11-23')[0].mine);
});

test('directory freshness and outside search links', () => {
  assert.equal(L.dirIsStale(DIR, '2027-03-01'), false);
  assert.equal(L.dirIsStale(DIR, '2027-07-01'), true);
  const links = L.searchLinks('ecopoetry & water');
  assert.ok(links.chillSubs.startsWith('https://duckduckgo.com/?q=site%3Achillsubs.com%2Fmagazine%20ecopoetry%20%26%20water'));
  assert.ok(links.pw.includes('pw.org%2Fliterary_magazines'));
  assert.equal(links.pwOpen, 'https://www.pw.org/open-reading-periods');
});

// ---------- importing past submissions ----------
test('history import: column guesses and the kind of file', () => {
  const h = ['Market', 'Piece', 'Date Sent', 'Status', 'Response Date', 'Fee', 'Notes'];
  assert.deepEqual(L.guessSubMapping(h), ['journal', 'poems', 'sentDate', 'status', 'responseDate', 'fee', 'notes']);
  assert.equal(L.guessImportKind(h), 'submissions');
  assert.equal(L.guessImportKind(['Name', 'Website', 'Opens', 'Closes']), 'journals');
  assert.deepEqual(L.guessSubMapping(['Title', 'Publication', 'Submitted', 'Response']), ['poems', 'journal', 'sentDate', 'status']);
});

test('history import: statuses and titles', () => {
  const st = (t) => L.parseSubStatus(t).status;
  assert.equal(st('Accepted'), 'accepted');
  assert.equal(st('Declined'), 'rejected');
  assert.equal(st('Form rejection'), 'rejected');
  assert.equal(st('Withdrawn'), 'withdrawn');
  assert.equal(st('Pending'), 'pending');
  assert.equal(st(''), 'pending');
  assert.equal(L.parseSubStatus('Never responded').silent, true);
  assert.equal(L.parseSubStatus('???').known, false);
  assert.deepEqual(L.splitTitles('"Salt Line"; Low Tide | “Wet Season”'), ['Salt Line', 'Low Tide', 'Wet Season']);
  assert.deepEqual(L.splitTitles('One, Two'), ['One, Two']); // commas can be part of a title
});

test('history import: build, duplicates and apply', () => {
  const d = fixture();
  const csv = [
    'Market,Piece,Date Sent,Status,Response Date,Fee,Notes',
    'Alpha Review,Salt Line; Wet Season,10/1/2026,Pending,,,dupe of s1',
    'Fernhouse,Salt Line,3/3/2026,Declined,4/18/2026,$3,form note',
    'Fernhouse,New One; Salt Line,spring 2025,Accepted,6/1/2025,,',
    'Gull,,3/3/2026,Pending,,,',
    ',Orphan,3/3/2026,Pending,,,',
    'Gull,Mangrove,5/5/2026,Never responded,,,',
    'Fernhouse,Salt Line,3/3/2026,Declined,4/18/2026,$3,repeated row',
  ].join('\n');
  const parsed = L.parseCSV(csv);
  const rows = L.buildSubImport(parsed, L.guessSubMapping(parsed.headers), d, '2026-11-23');
  assert.deepEqual(rows.map((r) => r.status), ['duplicate', 'new', 'new', 'skip', 'skip', 'new', 'duplicate']);
  assert.equal(rows[1].sub.responseDate, '2026-04-18');
  assert.equal(rows[1].sub.feePaid, 3);
  assert.equal(rows[1].newJournal, true);
  assert.deepEqual(rows[2].newPoems, ['New One']);
  assert.equal(rows[2].sub.sentDate, '');
  assert.ok(rows[2].problems[0].includes('spring 2025'));
  assert.ok(rows[2].sub.notes.includes('Sent: spring 2025'));
  assert.equal(rows[5].sub.status, 'withdrawn');
  assert.ok(rows[5].sub.notes.includes('never answered'));
  const before = { s: d.submissions.length, j: d.journals.length, p: d.poems.length };
  const res = L.applySubImport(d, rows);
  assert.deepEqual(res, { submissions: 3, journals: 2, poems: 2 });
  assert.equal(d.submissions.length, before.s + 3);
  assert.equal(d.journals.length, before.j + 2);
  assert.equal(d.poems.length, before.p + 2);
  // the accepted row places "Salt Line" and "New One"
  const salt = d.poems.find((p) => p.title === 'Salt Line');
  assert.equal(L.poemState(d, salt), 'published');
  assert.ok(L.withdrawAlerts(d).some((a) => a.poem.id === salt.id)); // still pending at Alpha and Beta
  // importing the same file again adds nothing
  const again = L.buildSubImport(parsed, L.guessSubMapping(parsed.headers), d, '2026-11-23');
  assert.equal(again.filter((r) => r.status === 'new').length, 0);
});


// ---------- settings page ----------
test('display and reminder settings normalize with safe defaults', () => {
  const st = L.normalizeSettings({ theme: 'dark', followUpDays: '45', deskDays: 30, checkUpdates: false });
  assert.deepEqual([st.theme, st.followUpDays, st.deskDays, st.checkUpdates], ['dark', 45, 30, false]);
  const bad = L.normalizeSettings({ theme: 'purple', followUpDays: 2, deskDays: 9999, checkUpdates: 'no' });
  assert.deepEqual([bad.theme, bad.followUpDays, bad.deskDays, bad.checkUpdates], ['system', 90, 60, true]);
});

test('the follow-up setting changes the default wait', () => {
  const d = fixture();
  // s3 at a journal with no history or stated reply time, sent 2026-10-06
  assert.ok(!L.queryReminders(d, '2026-11-20').some((x) => x.sub.id === 's3'));
  d.settings = L.normalizeSettings(Object.assign({}, d.settings, { followUpDays: 30 }));
  const r = L.queryReminders(d, '2026-11-20').find((x) => x.sub.id === 's3');
  assert.equal(r.expected, 30);
  assert.equal(r.basis, 'default');
});

// ---------- reading-period reminders ----------
test('reminders before a reading period opens and closes, only for journals with the bell on', () => {
  const d = L.normalize({
    journals: [
      { id: 'a', name: 'Alpha', opens: '2026-11-26', closes: '2027-01-10', notify: true },
      { id: 'b', name: 'Beta', opens: '2026-10-01', closes: '2026-11-25', notify: true },
      { id: 'c', name: 'Gamma', opens: '2026-11-25', closes: '2026-12-01' }, // bell off
      { id: 'e', name: 'Epsilon', opens: '2026-10-01', closes: '2026-11-27', notify: true }, // already sent this period
      { id: 'f', name: 'Far', opens: '2026-12-20', closes: '2027-01-20', notify: true }, // too far ahead
      { id: 'g', name: 'Always', alwaysOpen: true, notify: true },
      { id: 'y', name: 'Yearly', opens: '2024-11-27', closes: '2025-01-31', repeat: 'yearly', notify: true }, // rolls to 2026-11-27
    ],
    submissions: [{ id: 's1', journalId: 'e', sentDate: '2026-10-15', poemIds: [] }, { id: 's2', journalId: 'b', sentDate: '2025-10-15', poemIds: [] }],
  });
  const a = L.windowAlerts(d, '2026-11-24');
  assert.deepEqual(a.map((x) => x.key), ['b:closes:2026-11-25', 'a:opens:2026-11-26', 'y:opens:2026-11-27']);
  assert.equal(a[0].title, 'Beta closes tomorrow'); // a submission from last year does not count
  assert.equal(a[0].body, 'Last day: Nov 25. You have not sent anything there this reading period.');
  assert.equal(a[1].title, 'Alpha opens in 2 days');
  assert.equal(a[1].body, 'Reading period Nov 26 to Jan 10.');
  assert.equal(a[2].title, 'Yearly opens in 3 days');
  assert.equal(L.windowAlerts(d, '2026-11-26').find((x) => x.journalId === 'a').title, 'Alpha opens today');
});

test('how far ahead reminders come is a setting, and the bell is kept on the journal', () => {
  const d = L.normalize({ journals: [{ id: 'f', name: 'Far', opens: '2026-12-04', closes: '2027-01-20', notify: true }], settings: { notifyDays: 10 } });
  assert.equal(L.windowAlerts(d, '2026-11-24').length, 1);
  d.settings.notifyDays = 0;
  assert.equal(L.windowAlerts(d, '2026-11-24').length, 0);
  assert.equal(L.windowAlerts(d, '2026-12-04')[0].title, 'Far opens today');
  assert.equal(L.normalizeSettings({ notifyDays: 99 }).notifyDays, 3);
  assert.equal(L.normalizeJournal({ name: 'X', notify: 'yes' }).notify, false);
  assert.equal(L.normalizeJournal({ name: 'X', notify: true }).notify, true);
});

// ---------- shared folder: the save chain rides along, and undo never touches it ----------
test('save bookkeeping is kept, and undo changes data but not which save the file is on', () => {
  const d = L.normalize({ journals: [{ id: 'a', name: 'A' }], rev: 4, saveId: 's4', savedOn: 'DESKTOP', savedAt: '2026-11-24T02:00:00', lineage: ['s2', 's3', 7] });
  assert.deepEqual([d.saveId, d.savedOn, d.lineage], ['s4', 'DESKTOP', ['s2', 's3']]);
  const snap = L.snapshot(d);
  d.journals.push(L.normalizeJournal({ id: 'b', name: 'B' }));
  Object.assign(d, { rev: 5, saveId: 's5', lineage: ['s2', 's3', 's4'] }); // the change was saved
  const back = L.restoreSnapshot(snap, d);
  assert.equal(back.journals.length, 1);
  assert.deepEqual([back.rev, back.saveId, back.lineage], [5, 's5', ['s2', 's3', 's4']]);
  assert.equal(L.snapshot(back), snap);
  assert.equal(L.restoreSnapshot(snap, 9).rev, 9); // the older call style still works
});

// ---------- 2.5: richer directory, filters, saved searches, poem match, updates, quick add ----------
const DIR2 = L.loadDirectory({
  rev: 3,
  checked: '2026-11-26',
  journals: [
    { id: 'a', name: 'Alpha', url: 'https://a.example', windows: [['11-01', '12-10']], fee: 0, simSubs: 'yes', pays: 'yes', payPerPoem: 50, replyDays: 60, format: ['print'], focus: ['black', 'south'], note: 'A.' },
    { id: 'b', name: 'Bravo', url: 'https://b.example', yearRound: true, fee: 3, simSubs: 'no', pays: 'yes', paysNote: '$10', payPerPoem: 10, replyDays: 20, format: ['online'], focus: ['experimental'], note: 'B.', checked: '2026-10-01' },
    { id: 'c', name: 'Charlie', url: 'https://c.example', windows: [['12-15', '01-31']], fee: 2, simSubs: 'yes', pays: 'no', format: ['print', 'online'], focus: ['narrative', 'florida', 'nope'], note: 'C.' },
    { id: 'd', name: 'Delta', url: 'https://d.example', windows: [['03-01', '04-30']], fee: 0, simSubs: 'unknown', pays: 'yes', tags: ['online', 'Ohio'], note: 'D.' },
    { id: 'a', name: 'Alpha again', note: 'duplicate id is dropped' },
  ],
});
const T = '2026-11-26';

test('directory entries carry format, focus, pay and their own checked date', () => {
  assert.equal(DIR2.rev, 3);
  assert.equal(DIR2.journals.length, 4);
  const [a, b, c, d] = DIR2.journals;
  assert.deepEqual(a.focus, ['black', 'south']);
  assert.deepEqual(c.focus, ['florida', 'narrative'], 'unknown focus words are dropped, order follows the list');
  assert.deepEqual(d.format, ['online'], 'older entries take print / online from their tags');
  assert.deepEqual(d.tags, ['Ohio']);
  assert.equal(a.checked, '2026-11-26');
  assert.equal(b.checked, '2026-10-01');
  assert.equal(a.payPerPoem, 50);
  assert.equal(L.focusLabel('south'), 'The South');
});

test('the newer directory wins, and a broken download never replaces the one in the app', () => {
  const app = { rev: 2, checked: '2026-11-01', journals: [{ id: 'x', name: 'X' }] };
  assert.equal(L.pickDirectory(app, { rev: 3, checked: '2026-10-01', journals: [{ id: 'y', name: 'Y' }] }).source, 'update');
  assert.equal(L.pickDirectory(app, { rev: 2, checked: '2026-11-20', journals: [{ id: 'y', name: 'Y' }] }).source, 'update');
  assert.equal(L.pickDirectory(app, { rev: 1, checked: '2026-12-01', journals: [{ id: 'y', name: 'Y' }] }).source, 'app');
  assert.equal(L.pickDirectory(app, { rev: 9, journals: [] }).source, 'app');
  assert.equal(L.pickDirectory(app, null).dir.journals[0].id, 'x');
  assert.equal(L.pickDirectory(app, 'garbage').source, 'app');
});

test('filters: when, fee, pay, reply time, format and focus', () => {
  const d = L.emptyData();
  const ids = (o) => L.searchDirectory(DIR2, d, o, T).map((r) => r.entry.id);
  assert.deepEqual(ids({ when: 'open' }), ['a', 'b']);
  assert.deepEqual(ids({ when: 'soon' }), ['a', 'c', 'b'], 'Charlie opens in 19 days');
  assert.deepEqual(ids({ when: 'soon', within: 10 }), ['a', 'b']);
  assert.deepEqual(ids({ when: 'closing', within: 14 }), ['a']);
  assert.deepEqual(ids({ when: 'closing', within: 7 }), []);
  assert.deepEqual(ids({ maxFee: 2, sort: 'name' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ maxFee: 0, sort: 'name' }), ['a', 'd']);
  assert.deepEqual(ids({ payMin: 20 }), ['a']);
  assert.deepEqual(ids({ payMin: 5, sort: 'pay' }), ['a', 'b']);
  assert.deepEqual(ids({ maxReply: 30 }), ['b']);
  assert.deepEqual(ids({ format: 'print', sort: 'name' }), ['a', 'c']);
  assert.deepEqual(ids({ focus: ['florida'] }), ['c']);
  assert.deepEqual(ids({ focus: ['black', 'south'] }), ['a']);
  assert.deepEqual(ids({ focus: ['black', 'florida'] }), [], 'every chosen focus has to match');
  assert.deepEqual(ids({ q: 'south' }), ['a'], 'focus labels are searchable');
  assert.equal(L.findFilterCount({ when: 'open', focus: ['black', 'south'], maxFee: 0, q: 'x', sort: 'pay' }), 4);
  assert.equal(L.findFilterCount({}), 0);
});

test('sorting the directory', () => {
  const d = L.emptyData();
  const ids = (sort) => L.searchDirectory(DIR2, d, { sort }, T).map((r) => r.entry.id);
  assert.deepEqual(ids('smart'), ['a', 'c', 'b', 'd'], 'open, opening soon, all year, closed');
  assert.deepEqual(ids('closing'), ['a', 'c', 'd', 'b'], 'open by closing date, then by opening date, all-year last');
  assert.deepEqual(ids('reply'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids('pay'), ['a', 'b', 'd', 'c'], 'pays without a known amount comes after known amounts');
  assert.deepEqual(ids('fee'), ['a', 'd', 'c', 'b']);
  assert.deepEqual(ids('name'), ['a', 'b', 'c', 'd']);
});

test('old search options keep working', () => {
  const o = L.normalizeFindOpts({ openSoon: true, free: true, sim: true, bogus: 1 });
  assert.equal(o.when, 'soon');
  assert.equal(o.maxFee, 0);
  assert.equal(o.sim, true);
  assert.equal(o.sort, 'smart');
  assert.equal(L.normalizeFindOpts({ within: 9999 }).within, 30);
  assert.equal(L.normalizeFindOpts({ format: 'audio' }).format, '');
});

test('saved searches live in settings, replace by name, and survive a reload', () => {
  const d = L.emptyData();
  const f = L.saveFind(d, 'Free and open', { when: 'open', maxFee: 0, q: 'x' });
  assert.ok(f.id);
  L.saveFind(d, 'free AND open', { when: 'soon' });
  assert.equal(d.settings.savedFinds.length, 1);
  assert.equal(d.settings.savedFinds[0].opts.when, 'soon');
  assert.equal(L.saveFind(d, '   ', {}), null);
  for (let i = 0; i < 25; i++) L.saveFind(d, 'S' + i, {});
  assert.equal(d.settings.savedFinds.length, 20);
  const again = L.normalize(JSON.parse(JSON.stringify(d)));
  assert.equal(again.settings.savedFinds.length, 20);
  assert.equal(again.settings.savedFinds[19].name, 'S24');
  L.removeFind(again, again.settings.savedFinds[0].id);
  assert.equal(again.settings.savedFinds.length, 19);
  assert.deepEqual(L.normalize({ settings: { savedFinds: [{ name: '' }, 'x', { name: 'Ok', opts: { sort: 'pay' } }] } }).settings.savedFinds.map((s) => s.opts.sort), ['pay']);
});

test('where can this poem go: open, unseen, and simultaneous-safe', () => {
  const d = L.emptyData();
  d.poems = [{ id: 'p1', title: 'Salt' }, { id: 'p2', title: 'Placed' }].map(L.normalizePoem);
  const mine = L.dirToJournal(DIR2.journals[0], T, '');
  const own = L.normalizeJournal({ id: 'own', name: 'Own Review', opens: '2026-11-01', closes: '2026-11-30', fee: 5, simSubs: 'yes' });
  const shut = L.normalizeJournal({ id: 'shut', name: 'Shut Review', opens: '2026-03-01', closes: '2026-04-01' });
  d.journals = [mine, own, shut];
  d.submissions = [
    { id: 's1', poemIds: ['p1'], journalId: mine.id, sentDate: '2026-11-02' },
    { id: 's2', poemIds: ['p2'], journalId: own.id, sentDate: '2026-10-01', status: 'accepted', acceptedPoemIds: ['p2'] },
  ].map(L.normalizeSubmission);
  const m = L.poemMatches(d, DIR2, 'p1', T);
  assert.equal(m.out, 1);
  assert.deepEqual(m.items.map((i) => i.name), ['Own Review', 'Charlie']);
  assert.equal(m.hidden.seen, 1, 'Alpha already has it');
  assert.equal(m.hidden.noSim, 1, 'Bravo takes no simultaneous submissions and the poem is out');
  assert.equal(m.hidden.closed, 2, 'Shut Review and Delta are closed');
  assert.ok(m.items[0].notes.some((n) => n.includes('waiting there')) === false);
  assert.equal(m.items[0].mine.id, 'own');
  assert.equal(m.items[1].entry.id, 'c');
  // once nothing is out, Bravo comes back
  d.submissions[0].status = 'rejected';
  const m2 = L.poemMatches(d, DIR2, 'p1', T);
  assert.ok(m2.items.some((i) => i.name === 'Bravo'));
  assert.equal(m2.hidden.noSim, 0);
  // free only
  assert.deepEqual(L.poemMatches(d, DIR2, 'p1', T, { free: true }).items.map((i) => i.name), []);
  // placed poems go nowhere
  const placed = L.poemMatches(d, DIR2, 'p2', T);
  assert.equal(placed.placed, true);
  assert.equal(placed.items.length, 0);
  // budget note
  L.setBudget(d, '2026-11', 4);
  assert.ok(L.poemMatches(d, DIR2, 'p1', T).items.find((i) => i.name === 'Own Review').notes.some((n) => n.includes('budget')));
});

test('newer directory details are offered, never forced, and can be taken or kept', () => {
  const d = L.emptyData();
  const old = L.normalizeDirEntry({ id: 'k', name: 'K', url: 'https://k.example', windows: [['09-01', '09-30']], fee: 0, simSubs: 'yes', note: 'n' }, '2026-01-01');
  const j = L.dirToJournal(old, '2026-02-01', '2026-01-01');
  j.notes = 'my own notes';
  j.notify = true;
  d.journals.push(j);
  assert.deepEqual(L.dirChanges(j, old), [], 'same check date: nothing to offer');
  const fresh = L.normalizeDirEntry({ id: 'k', name: 'K', url: 'https://k.example', windows: [['10-01', '10-31']], fee: 3, simSubs: 'unknown', note: 'n2', checked: '2026-11-20' });
  const ch = L.dirChanges(j, fresh);
  assert.deepEqual(ch.map((c) => c.field), ['windows', 'fee'], 'unknown values in the directory never replace yours');
  assert.equal(ch[1].theirs, '$3');
  assert.equal(ch[0].mine, 'Sep 1 to Sep 30');
  assert.equal(L.applyDirChanges(d, j.id, fresh, '2026-11-26'), true);
  assert.equal(j.fee, 3);
  assert.equal(L.currentWindow(j, '2026-11-26').opens, '2027-10-01');
  assert.equal(j.notes, 'my own notes');
  assert.equal(j.notify, true);
  assert.equal(j.checked, '2026-11-20');
  assert.deepEqual(L.dirChanges(j, fresh), []);
  // keep mine
  const newer = Object.assign({}, fresh, { fee: 4, checked: '2026-12-01' });
  assert.equal(L.dirChanges(j, newer).length, 1);
  L.dismissDirChanges(d, j.id, newer);
  assert.deepEqual(L.dirChanges(j, newer), []);
  assert.equal(j.fee, 3);
});

test('quick add reads a guidelines page', () => {
  const page = 'Submissions | The Gulf Review - A journal of the coast. Our reading period runs from September 1 through November 30, ' +
    'and again January 15 – March 1, 2027. Please submit up to five poems in a single document. There is a $3 reading fee to cover Submittable. ' +
    'Simultaneous submissions are welcome; please withdraw if accepted elsewhere. We pay $40 per poem on publication. ' +
    'We do not accept previously published work. We aim to respond within three months.';
  const g = L.parseGuidelines(page, 'Submissions | The Gulf Review');
  assert.equal(g.name, 'The Gulf Review');
  assert.deepEqual(g.windows, [{ opens: '09-01', closes: '11-30' }, { opens: '01-15', closes: '03-01' }]);
  assert.equal(g.fee, 3);
  assert.equal(g.maxPoems, 5);
  assert.equal(g.simSubs, 'yes');
  assert.equal(g.pays, 'yes');
  assert.equal(g.paysNote, '$40 per poem');
  assert.equal(g.reprints, 'no');
  assert.equal(g.replyDays, 90);
  assert.deepEqual(g.found, ['reading period', 'fee', 'poems per submission', 'simultaneous submissions', 'payment', 'reprints', 'reply time']);
  const j = L.journalFromGuidelines(g, 'https://gulf.example/submit', '2026-11-26');
  assert.equal(j.name, 'The Gulf Review');
  assert.equal(j.repeat, 'yearly');
  assert.deepEqual(j.extraWindows, [{ opens: '01-15', closes: '03-01' }]);
  assert.equal(j.fee, 3);
  assert.equal(j.checked, '2026-11-26');
  assert.equal(j.dirId, '');

  const free = L.parseGuidelines('We read year-round. There is no submission fee. Send 3-5 poems. We do not accept simultaneous submissions. ' +
    'Unfortunately we are unable to pay contributors at this time. Reprints are welcome. Expect a reply in 6-8 weeks.', 'Moon Mag');
  assert.equal(free.yearRound, true);
  assert.equal(free.fee, 0);
  assert.equal(free.maxPoems, 5);
  assert.equal(free.simSubs, 'no');
  assert.equal(free.pays, 'no');
  assert.equal(free.reprints, 'yes');
  assert.equal(free.replyDays, 56);
  assert.equal(free.name, 'Moon Mag');

  const month = L.parseGuidelines('We are open for poetry during the month of September only. Contributors receive $25.', '');
  assert.deepEqual(month.windows, [{ opens: '09-01', closes: '09-30' }]);
  assert.equal(month.paysNote, '$25');
  const blank = L.parseGuidelines('', '');
  assert.deepEqual(blank.found, []);
  assert.equal(blank.fee, null);
  // a pay amount alone is not a fee
  assert.equal(L.parseGuidelines('We pay $50 per poem.', '').fee, null);
  // day-first dates
  assert.deepEqual(L.parseGuidelines('Open from 1 March to 31 May.', '').windows, [{ opens: '03-01', closes: '05-31' }]);
});

test('the directory can be narrowed to journals that could take one poem', () => {
  const d = L.emptyData();
  d.poems = [{ id: 'p1', title: 'Salt' }].map(L.normalizePoem);
  const alpha = L.dirToJournal(DIR2.journals[0], T, '');
  d.journals = [alpha];
  d.submissions = [{ id: 's', poemIds: ['p1'], journalId: alpha.id, sentDate: '2026-11-01' }].map(L.normalizeSubmission);
  const ids = (o) => L.searchDirectory(DIR2, d, Object.assign({ sort: 'name' }, o), T).map((r) => r.entry.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ poemId: 'p1' }), ['c', 'd'], 'Alpha saw it, Bravo takes no simultaneous submissions while it is out');
  assert.deepEqual(ids({ poemId: 'nope' }), []);
});

test('a guidelines page as plain text (for the iPhone)', () => {
  const r = L.htmlToText('<html><head><title>Submit &amp; Read | Gulf</title><style>p{}</style></head><body><script>var fee="$99 fee"</script>' +
    '<p>Reading period: Sept&nbsp;1 &ndash; Nov 30.</p><!-- $5 fee --><div>No fee. It&#8217;s free &#x2014; really.</div></body></html>');
  assert.equal(r.title, 'Submit & Read | Gulf');
  assert.ok(r.text.includes('Reading period: Sept 1 – Nov 30.'));
  assert.ok(r.text.includes('It’s free — really.'));
  assert.ok(!r.text.includes('$99') && !r.text.includes('$5'));
  assert.equal(L.parseGuidelines(r.text, r.title).fee, 0);
  assert.deepEqual(L.htmlToText(''), { title: '', text: '' });
});
