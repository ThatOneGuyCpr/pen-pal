/*
 * Pen Pal: pure logic (no DOM, no network).
 * Works in the browser (window.Logic) and in Node (require) so it can be tested.
 * Dates are plain "YYYY-MM-DD" strings. Poem text is never stored, only titles and notes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POEM_STATUSES = ['draft', 'ready', 'published'];
  const SUB_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'];
  const SIM_VALUES = ['yes', 'no', 'unknown'];
  const REPEATS = ['none', 'yearly'];
  const MS_KINDS = ['chapbook', 'full-length', 'other'];
  const ENTRY_STATUSES = ['planned', 'pending', 'finalist', 'accepted', 'rejected', 'withdrawn'];
  const YN = ['yes', 'no', 'unknown'];
  const THEMES = ['system', 'light', 'dark'];
  const RIGHTS_KINDS = ['First North American serial', 'First serial', 'First electronic', 'One-time', 'Other'];

  // ---------- small helpers ----------
  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 2000) : '');
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(s + 'T00:00:00Z');
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }
  const dateOr = (s) => (isDate(s) ? s : '');
  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function intOrNull(v) {
    const n = numOrNull(v);
    return n === null ? null : Math.floor(n);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  function addDays(date, n) {
    return new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  }
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  // Same month and day, n years later. Feb 29 becomes Feb 28 in a non-leap year.
  function addYears(date, n) {
    const y = Number(date.slice(0, 4)) + n;
    const m = date.slice(5, 7);
    let d = date.slice(8, 10);
    if (m === '02' && d === '29' && !isLeap(y)) d = '28';
    return String(y).padStart(4, '0') + '-' + m + '-' + d;
  }
  function todayLocal(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---------- data model ----------
  function emptyData() {
    return { rev: 0, poems: [], journals: [], submissions: [], manuscripts: [], entries: [], settings: normalizeSettings(), saveId: '', savedOn: '', savedAt: '', lineage: [] };
  }

  // Rights a journal took when it accepted a poem, and when the poem is free to go again.
  function normalizeRights(r) {
    r = r && typeof r === 'object' ? r : {};
    return {
      bought: str(r.bought, 200).trim(),
      issue: str(r.issue, 200).trim(),
      pubDate: dateOr(r.pubDate),
      exclusiveUntil: dateOr(r.exclusiveUntil),
      reprints: YN.includes(r.reprints) ? r.reprints : 'unknown',
      revert: str(r.revert, 200).trim(),
      credit: str(r.credit, 600).trim(),
    };
  }
  function normalizePoem(p) {
    p = p || {};
    return {
      id: str(p.id, 80) || uid(),
      title: str(p.title, 300).trim(),
      status: POEM_STATUSES.includes(p.status) ? p.status : 'draft',
      publishedWhere: str(p.publishedWhere, 300),
      publishedDate: str(p.publishedDate, 60),
      notes: str(p.notes, 5000),
      rights: normalizeRights(p.rights),
    };
  }
  const MMDD = (v) => (typeof v === 'string' && /^\d{2}-\d{2}$/.test(v) && isDate('2028-' + v) ? v : '');
  function normalizeJournal(j) {
    j = j || {};
    const opens = dateOr(j.opens), closes = dateOr(j.closes);
    return {
      id: str(j.id, 80) || uid(),
      name: str(j.name, 300).trim(),
      url: str(j.url, 600).trim(),
      opens,
      closes,
      // 'yearly' only makes sense when both dates are known and in order
      repeat: j.repeat === 'yearly' && opens && closes && closes >= opens ? 'yearly' : 'none',
      // More yearly windows beyond the main one, as month-day pairs ({ opens: '01-15', closes: '03-01' }).
      extraWindows: arr(j.extraWindows).map((w) => ({ opens: MMDD(w && w.opens), closes: MMDD(w && w.closes) })).filter((w) => w.opens && w.closes).slice(0, 6),
      alwaysOpen: j.alwaysOpen === true,
      notify: j.notify === true, // remind me before the reading period opens and closes
      replyDays: (() => { const n = intOrNull(j.replyDays); return n && n > 0 && n < 2000 ? n : null; })(),
      pays: YN.includes(j.pays) ? j.pays : 'unknown',
      reprints: YN.includes(j.reprints) ? j.reprints : 'unknown',
      dirId: str(j.dirId, 80),
      checked: dateOr(j.checked),
      fee: numOrNull(j.fee),
      maxPoems: intOrNull(j.maxPoems),
      simSubs: SIM_VALUES.includes(j.simSubs) ? j.simSubs : 'unknown',
      notes: str(j.notes, 5000),
    };
  }
  function normalizeSubmission(s) {
    s = s || {};
    const poemIds = arr(s.poemIds).map((x) => str(x, 80)).filter(Boolean);
    return {
      id: str(s.id, 80) || uid(),
      poemIds: Array.from(new Set(poemIds)),
      journalId: str(s.journalId, 80),
      sentDate: dateOr(s.sentDate),
      status: SUB_STATUSES.includes(s.status) ? s.status : 'pending',
      acceptedPoemIds: arr(s.acceptedPoemIds).map((x) => str(x, 80)).filter(Boolean),
      withdrawnPoemIds: arr(s.withdrawnPoemIds).map((x) => str(x, 80)).filter(Boolean),
      responseDate: dateOr(s.responseDate),
      feePaid: numOrNull(s.feePaid),
      notes: str(s.notes, 5000),
      queriedDate: dateOr(s.queriedDate),
      snoozedUntil: dateOr(s.snoozedUntil),
    };
  }

  function normalizeManuscript(m) {
    m = m || {};
    const pages = intOrNull(m.pageCount);
    return {
      id: str(m.id, 80) || uid(),
      title: str(m.title, 300).trim(),
      kind: MS_KINDS.includes(m.kind) ? m.kind : 'chapbook',
      pageCount: pages && pages > 0 ? pages : null,
      poemIds: Array.from(new Set(arr(m.poemIds).map((x) => str(x, 80)).filter(Boolean))),
      notes: str(m.notes, 5000),
    };
  }
  // A manuscript sent to a press or contest. Separate from single-poem submissions.
  function normalizeEntry(e) {
    e = e || {};
    return {
      id: str(e.id, 80) || uid(),
      manuscriptId: str(e.manuscriptId, 80),
      name: str(e.name, 300).trim(),
      url: str(e.url, 600).trim(),
      deadline: dateOr(e.deadline),
      fee: numOrNull(e.fee),
      feePaid: numOrNull(e.feePaid),
      sentDate: dateOr(e.sentDate),
      status: ENTRY_STATUSES.includes(e.status) ? e.status : 'planned',
      responseDate: dateOr(e.responseDate),
      notes: str(e.notes, 5000),
    };
  }
  // Monthly fee budget, stored as changes: { 'YYYY-MM': amount } means "this amount from that month on",
  // and null means "no budget from that month on". Changing it later leaves earlier months as they were.
  function normalizeMonthlyBudget(s) {
    const out = {};
    if (s.monthlyBudget && typeof s.monthlyBudget === 'object') {
      for (const k of Object.keys(s.monthlyBudget)) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)) continue;
        const v = s.monthlyBudget[k];
        const n = numOrNull(v);
        if (v === null) out[k] = null;
        else if (n !== null) out[k] = n;
      }
    } else if (s.budgets && typeof s.budgets === 'object') {
      // Pen Pal 2.0 to 2.1 kept a yearly budget: carry it over as a twelfth a month from that January.
      for (const k of Object.keys(s.budgets)) {
        const n = numOrNull(s.budgets[k]);
        if (/^\d{4}$/.test(k) && n !== null) out[k + '-01'] = Math.round((n / 12) * 100) / 100;
      }
    }
    // Drop changes that change nothing (same as the month before, or "none" when there was none).
    const tidy = {};
    let last = null;
    for (const k of Object.keys(out).sort()) {
      if (out[k] === last) continue;
      tidy[k] = out[k];
      last = out[k];
    }
    return tidy;
  }
  function normalizeSettings(s) {
    s = s || {};
    const pct = intOrNull(s.budgetWarnPct);
    const inRange = (v, lo, hi, dflt) => { const n = intOrNull(v); return n !== null && n >= lo && n <= hi ? n : dflt; };
    return {
      lastBackupDownload: dateOr(s.lastBackupDownload),
      backupSnoozedUntil: dateOr(s.backupSnoozedUntil),
      monthlyBudget: normalizeMonthlyBudget(s),
      budgetWarnPct: pct && pct >= 1 && pct <= 100 ? pct : 80,
      countPlanned: s.countPlanned !== false,
      theme: THEMES.includes(s.theme) ? s.theme : 'system',
      followUpDays: inRange(s.followUpDays, 14, 365, 90),
      deskDays: inRange(s.deskDays, 7, 180, 60),
      notifyDays: inRange(s.notifyDays, 0, 30, 3),
      checkUpdates: s.checkUpdates !== false,
      savedFinds: normalizeSavedFinds(s.savedFinds),
    };
  }

  function normalize(raw) {
    const d = emptyData();
    if (!raw || typeof raw !== 'object') return d;
    d.rev = Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0;
    d.poems = arr(raw.poems).map(normalizePoem).filter((p) => p.title);
    d.journals = arr(raw.journals).map(normalizeJournal).filter((j) => j.name);
    d.submissions = arr(raw.submissions).map(normalizeSubmission);
    d.manuscripts = arr(raw.manuscripts).map(normalizeManuscript).filter((m) => m.title);
    d.entries = arr(raw.entries).map(normalizeEntry).filter((e) => e.name);
    d.settings = normalizeSettings(raw.settings);
    // Which save this is, and the saves it builds on: lets two computers sharing a synced folder
    // notice when one replaced the other's work. Written by the server; the page only carries them.
    d.saveId = str(raw.saveId, 40);
    d.savedOn = str(raw.savedOn, 60);
    d.savedAt = str(raw.savedAt, 40);
    d.lineage = arr(raw.lineage).filter((x) => typeof x === 'string').slice(-50);
    return d;
  }

  // ---------- lookups ----------
  const poemById = (data, id) => data.poems.find((p) => p.id === id) || null;
  const journalById = (data, id) => data.journals.find((j) => j.id === id) || null;
  const manuscriptById = (data, id) => arr(data.manuscripts).find((m) => m.id === id) || null;
  const entryById = (data, id) => arr(data.entries).find((e) => e.id === id) || null;
  const activePoemIds = (sub) => sub.poemIds.filter((id) => !sub.withdrawnPoemIds.includes(id));

  function acceptedPoemIdsOf(sub) {
    if (sub.status !== 'accepted') return [];
    const active = activePoemIds(sub);
    const picked = sub.acceptedPoemIds.filter((id) => active.includes(id));
    return picked.length ? picked : active;
  }

  // Where (if anywhere) a poem has been placed. Returns null if not placed.
  function placement(data, poemId) {
    for (const s of data.submissions) {
      if (acceptedPoemIdsOf(s).includes(poemId)) {
        return { kind: 'submission', sub: s, journal: journalById(data, s.journalId) };
      }
    }
    const p = poemById(data, poemId);
    if (p && p.status === 'published') return { kind: 'manual', poem: p };
    return null;
  }

  function pendingSubsFor(data, poemId) {
    return data.submissions.filter(
      (s) => s.status === 'pending' && activePoemIds(s).includes(poemId)
    );
  }

  // 'published' | 'out' | 'ready' | 'draft'
  function poemState(data, poem) {
    if (placement(data, poem.id)) return 'published';
    if (pendingSubsFor(data, poem.id).length) return 'out';
    return poem.status === 'ready' ? 'ready' : 'draft';
  }

  // ---------- the important bit: withdraw alerts ----------
  // For every poem that has been placed, list the pending submissions that still hold it.
  function withdrawAlerts(data) {
    const alerts = [];
    for (const poem of data.poems) {
      const pl = placement(data, poem.id);
      if (!pl) continue;
      const pending = pendingSubsFor(data, poem.id).filter((s) => !(pl.sub && s.id === pl.sub.id));
      if (!pending.length) continue;
      alerts.push({
        poem,
        placedAt: pl.kind === 'submission' ? (pl.journal ? pl.journal.name : 'a journal') : poem.publishedWhere || 'elsewhere',
        submissions: pending.map((s) => ({
          sub: s,
          journal: journalById(data, s.journalId),
          multiPoem: activePoemIds(s).length > 1,
        })),
      });
    }
    return alerts;
  }

  // Mutating helpers (they edit `data` in place and return useful info).
  function acceptSubmission(data, subId, acceptedIds, date) {
    const sub = data.submissions.find((s) => s.id === subId);
    if (!sub) throw new Error('Submission not found');
    const active = activePoemIds(sub);
    const picked = arr(acceptedIds).filter((id) => active.includes(id));
    sub.status = 'accepted';
    sub.acceptedPoemIds = picked.length ? picked : active;
    sub.responseDate = dateOr(date) || sub.responseDate;
    const ids = new Set(sub.acceptedPoemIds);
    return withdrawAlerts(data).filter((a) => ids.has(a.poem.id));
  }

  function setSubmissionStatus(data, subId, status, date) {
    const sub = data.submissions.find((s) => s.id === subId);
    if (!sub || !SUB_STATUSES.includes(status)) throw new Error('Bad submission or status');
    if (status === 'accepted') return acceptSubmission(data, subId, [], date);
    sub.status = status;
    if (status === 'pending') sub.responseDate = '';
    else sub.responseDate = dateOr(date) || sub.responseDate;
    if (status !== 'accepted') sub.acceptedPoemIds = [];
    return [];
  }

  // Withdraw one poem from a (possibly multi-poem) pending submission.
  function withdrawPoem(data, subId, poemId, date) {
    const sub = data.submissions.find((s) => s.id === subId);
    if (!sub) throw new Error('Submission not found');
    if (!sub.poemIds.includes(poemId)) return;
    if (!sub.withdrawnPoemIds.includes(poemId)) sub.withdrawnPoemIds.push(poemId);
    if (!activePoemIds(sub).length) {
      sub.status = 'withdrawn';
      sub.responseDate = dateOr(date) || sub.responseDate;
    }
  }

  function removePoem(data, poemId) {
    data.poems = data.poems.filter((p) => p.id !== poemId);
    for (const m of arr(data.manuscripts)) m.poemIds = m.poemIds.filter((id) => id !== poemId);
    let touched = 0;
    for (const s of data.submissions) {
      if (s.poemIds.includes(poemId)) {
        touched++;
        s.poemIds = s.poemIds.filter((id) => id !== poemId);
        s.acceptedPoemIds = s.acceptedPoemIds.filter((id) => id !== poemId);
        s.withdrawnPoemIds = s.withdrawnPoemIds.filter((id) => id !== poemId);
      }
    }
    const before = data.submissions.length;
    data.submissions = data.submissions.filter((s) => s.poemIds.length > 0);
    return { touched, removedSubmissions: before - data.submissions.length };
  }

  function removeJournal(data, journalId) {
    data.journals = data.journals.filter((j) => j.id !== journalId);
    const before = data.submissions.length;
    data.submissions = data.submissions.filter((s) => s.journalId !== journalId);
    return { removedSubmissions: before - data.submissions.length };
  }

  // ---------- manuscripts (chapbooks, full-length books) and press or contest entries ----------
  const ACTIVE_ENTRY = ['pending', 'finalist'];
  const isActiveEntry = (e) => ACTIVE_ENTRY.includes(e.status);
  const entriesFor = (data, msId) => arr(data.entries).filter((e) => e.manuscriptId === msId);

  // 'placed' if any entry was accepted, 'out' if any is waiting, otherwise 'planning'.
  function manuscriptState(data, m) {
    const es = entriesFor(data, m.id);
    if (es.some((e) => e.status === 'accepted')) return 'placed';
    if (es.some(isActiveEntry)) return 'out';
    return 'planning';
  }

  function manuscriptSummary(data, m) {
    const poems = m.poemIds.map((id) => poemById(data, id)).filter(Boolean);
    const c = { poemCount: poems.length, placed: 0, out: 0, ready: 0, draft: 0 };
    for (const p of poems) c[poemState(data, p) === 'published' ? 'placed' : poemState(data, p)]++;
    c.placedPct = poems.length ? Math.round((c.placed / poems.length) * 100) : null;
    c.pageCount = m.pageCount;
    return c;
  }

  // Plain-language notes about a manuscript. They inform and never block.
  function manuscriptWarnings(data, m) {
    const w = [];
    const sum = manuscriptSummary(data, m);
    if (!sum.poemCount) { w.push('No poems are listed in this manuscript yet.'); return w; }
    if (sum.draft) w.push(sum.draft + ' poem' + (sum.draft === 1 ? ' is' : 's are') + ' still marked as a draft.');
    if (m.pageCount === null) w.push('No page count is set. Most presses and contests state a range.');
    else if (m.kind === 'chapbook' && (m.pageCount < 20 || m.pageCount > 40)) w.push('Chapbooks usually run about 20 to 40 pages, and this one is ' + m.pageCount + '.');
    else if (m.kind === 'full-length' && (m.pageCount < 48 || m.pageCount > 100)) w.push('Full-length collections usually run about 48 to 100 pages, and this one is ' + m.pageCount + '.');
    if (sum.poemCount >= 5 && sum.placedPct < 25) w.push('Only ' + sum.placed + ' of ' + sum.poemCount + ' poems have been accepted or published. Some presses like 25 to 50 percent to have appeared in journals.');
    return w;
  }

  // draft: { id?, manuscriptId, name, deadline, sentDate }
  function checkEntry(data, draft, today) {
    const w = [];
    const m = manuscriptById(data, draft.manuscriptId);
    if (!m) return w;
    const others = arr(data.entries).filter((e) => e.id !== draft.id && e.manuscriptId === m.id);
    const sent = dateOr(draft.sentDate) || today;
    if (draft.deadline && dateOr(draft.deadline) && sent > draft.deadline) w.push('The deadline was ' + draft.deadline + '.');
    const name = String(draft.name || '').trim().toLowerCase();
    if (name && others.some((e) => e.name.toLowerCase() === name)) w.push('This manuscript already has an entry for ' + draft.name.trim() + '.');
    const live = others.filter((e) => isActiveEntry(e) && e.name.toLowerCase() !== name);
    if (live.length) w.push('This manuscript is also out at ' + live.map((e) => e.name).join(', ') + '. Check that each one allows simultaneous submissions.');
    if (others.some((e) => e.status === 'accepted')) w.push('This manuscript has already been accepted somewhere.');
    const sum = manuscriptSummary(data, m);
    if (sum.draft) w.push(sum.draft + ' poem' + (sum.draft === 1 ? ' in the manuscript is' : 's in the manuscript are') + ' still marked as a draft.');
    const fee = numOrNull(draft.feePaid) || numOrNull(draft.fee);
    if (fee) {
      const b = budgetCheck(data, fee, dateOr(draft.sentDate) || dateOr(draft.deadline) || today, { entryId: draft.id });
      if (b) w.push(b);
    }
    return w;
  }

  // Same idea as withdrawAlerts, for books: once one entry is accepted, list the others still waiting.
  function entryAlerts(data) {
    const out = [];
    for (const m of arr(data.manuscripts)) {
      const es = entriesFor(data, m.id);
      const won = es.find((e) => e.status === 'accepted');
      if (!won) continue;
      const pending = es.filter(isActiveEntry);
      if (pending.length) out.push({ manuscript: m, acceptedAt: won.name, entries: pending });
    }
    return out;
  }

  // `date` is the day it was sent (for 'pending') or the day they replied (for the other outcomes).
  function setEntryStatus(data, entryId, status, date) {
    const e = entryById(data, entryId);
    if (!e || !ENTRY_STATUSES.includes(status)) throw new Error('Bad entry or status');
    const d = dateOr(date);
    e.status = status;
    if (status === 'planned') { e.sentDate = ''; e.responseDate = ''; }
    else if (status === 'pending') { e.responseDate = ''; if (!e.sentDate && d) e.sentDate = d; }
    else if (status === 'finalist') e.responseDate = '';
    else e.responseDate = d || e.responseDate;
    return status === 'accepted' ? entryAlerts(data).filter((a) => a.manuscript.id === e.manuscriptId) : [];
  }

  function removeManuscript(data, msId) {
    data.manuscripts = arr(data.manuscripts).filter((m) => m.id !== msId);
    const before = arr(data.entries).length;
    data.entries = arr(data.entries).filter((e) => e.manuscriptId !== msId);
    return { removedEntries: before - data.entries.length };
  }

  // ---------- one poem's history ----------
  // Every submission that has held the poem, newest first, with what happened to this poem in it.
  function poemOutcome(sub, poemId) {
    if (sub.withdrawnPoemIds.includes(poemId)) return 'withdrawn';
    if (sub.status === 'pending') return 'pending';
    if (sub.status === 'accepted') return acceptedPoemIdsOf(sub).includes(poemId) ? 'accepted' : 'not-taken';
    return sub.status; // rejected | withdrawn
  }
  function poemHistory(data, poemId, today) {
    const poem = poemById(data, poemId);
    if (!poem) return null;
    const rows = data.submissions
      .filter((s) => s.poemIds.includes(poemId))
      .map((s) => {
        const outcome = poemOutcome(s, poemId);
        let days = null;
        if (s.sentDate) {
          if (outcome === 'pending') days = today ? daysBetween(s.sentDate, today) : null;
          else if (s.responseDate) days = daysBetween(s.sentDate, s.responseDate);
        }
        return { sub: s, journal: journalById(data, s.journalId), outcome, sentDate: s.sentDate, responseDate: s.responseDate, days, withOthers: s.poemIds.length > 1 };
      })
      .sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''));
    const seen = [];
    for (const r of rows) {
      const name = r.journal ? r.journal.name : '(deleted journal)';
      if (!seen.includes(name)) seen.push(name);
    }
    return {
      poem,
      rows,
      seenBy: seen,
      placement: placement(data, poemId),
      manuscripts: arr(data.manuscripts).filter((m) => m.poemIds.includes(poemId)),
    };
  }
  // Journals that are open today and have never seen this poem. Empty if the poem is already placed.
  function nextTargets(data, poemId, today) {
    if (!poemById(data, poemId) || placement(data, poemId)) return [];
    const seenIds = new Set(data.submissions.filter((s) => s.poemIds.includes(poemId)).map((s) => s.journalId));
    const isOut = pendingSubsFor(data, poemId).length > 0;
    return openNow(data, today)
      .filter((o) => !seenIds.has(o.journal.id))
      .map((o) => Object.assign({}, o, { blockedBySim: isOut && o.journal.simSubs === 'no' }));
  }

  // ---------- reading windows (including ones that repeat every year) ----------
  const isRecurring = (j) => j.repeat === 'yearly' && isDate(j.opens) && isDate(j.closes) && j.closes >= j.opens;

  // Every yearly window as real dates near the main template's year.
  function templatesOf(j) {
    const out = [{ opens: j.opens, closes: j.closes }];
    const y = Number(j.opens.slice(0, 4));
    for (const w of arr(j.extraWindows)) {
      const o = addYears('2028-' + w.opens, y - 2028);
      let c = addYears('2028-' + w.closes, y - 2028);
      if (c < o) c = addYears(c, 1);
      out.push({ opens: o, closes: c });
    }
    return out;
  }
  function rollFrom(t, today, n) {
    let k = Math.max(0, Number(today.slice(0, 4)) - Number(t.closes.slice(0, 4)) - 1);
    while (addYears(t.closes, k) < today) k++;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ opens: addYears(t.opens, k + i), closes: addYears(t.closes, k + i), k: k + i });
    return out;
  }
  // The reading windows for a journal, starting with the first one that has not closed before `today`.
  // A yearly journal keeps its stored dates as the template and rolls them forward by whole years;
  // extra windows (a journal that reads in fall and again in spring) roll the same way.
  function windowsFrom(j, today, count) {
    const n = count || 1;
    if (j.alwaysOpen) return [];
    if (!isRecurring(j)) return j.opens || j.closes ? [{ opens: j.opens, closes: j.closes, k: 0 }] : [];
    const all = [];
    for (const t of templatesOf(j)) all.push(...rollFrom(t, today, n));
    all.sort((x, y) => x.closes.localeCompare(y.closes) || x.opens.localeCompare(y.opens));
    const seen = new Set();
    return all.filter((w) => (seen.has(w.opens + w.closes) ? false : seen.add(w.opens + w.closes))).slice(0, n);
  }
  function currentWindow(j, today) {
    if (j.alwaysOpen) return { opens: '', closes: '', k: 0, always: true };
    return windowsFrom(j, today, 1)[0] || { opens: '', closes: '', k: 0 };
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mdLabel = (md) => MONTH_NAMES[Number(md.slice(0, 2)) - 1] + ' ' + Number(md.slice(3, 5));
  // "Jan 15 to Mar 1; Jul 1 to Jul 31"  <->  [{ opens: '01-15', closes: '03-01' }, ...]
  function windowsText(list) {
    return arr(list).map((w) => mdLabel(w.opens) + ' to ' + mdLabel(w.closes)).join('; ');
  }
  function parseWindowsText(text) {
    const out = [], bad = [];
    for (const part of String(text || '').split(/[;\n]+/)) {
      const t = part.trim();
      if (!t) continue;
      const m = t.split(/\s+(?:to|through|thru|until)\s+|\s*[-–]\s*(?=[A-Za-z]|\d{1,2}\/)/i);
      const o = m.length === 2 ? parseFlexibleDate(m[0], '2028-01-01') : '';
      const c = m.length === 2 ? parseFlexibleDate(m[1], '2028-01-01') : '';
      if (o && c) out.push({ opens: o.slice(5), closes: c.slice(5) });
      else bad.push(t);
    }
    return { windows: out, bad };
  }

  // ---------- pre-send checks ----------
  // draft: { id?, poemIds, journalId, sentDate }. Returns an array of plain-language warnings.
  function checkSubmission(data, draft, today) {
    const w = [];
    const journal = journalById(data, draft.journalId);
    const ids = arr(draft.poemIds);
    if (!journal) return w;
    const others = data.submissions.filter((s) => s.id !== draft.id);

    if (journal.maxPoems && ids.length > journal.maxPoems) {
      w.push(journal.name + ' takes at most ' + journal.maxPoems + ' poem' + (journal.maxPoems === 1 ? '' : 's') + ' per submission, and this one has ' + ids.length + '.');
    }
    const sent = dateOr(draft.sentDate) || today;
    if (sent) {
      const win = currentWindow(journal, sent);
      if (win.closes && sent > win.closes) w.push('The reading period closed on ' + win.closes + '.');
      if (win.opens && sent < win.opens) w.push('The reading period does not open until ' + win.opens + '.');
    }
    const samePending = others.filter((s) => s.journalId === journal.id && s.status === 'pending');
    if (samePending.length) w.push('You already have a pending submission to ' + journal.name + '. Many journals want one at a time.');

    for (const id of ids) {
      const poem = poemById(data, id);
      if (!poem) continue;
      const t = '"' + poem.title + '"';
      const pl = placement(data, id);
      if (pl && !(pl.sub && pl.sub.id === draft.id)) {
        w.push(t + ' is already accepted or published. Most journals want unpublished work.');
        continue;
      }
      if (others.some((s) => s.journalId === journal.id && s.poemIds.includes(id))) {
        w.push(t + ' was already sent to ' + journal.name + ' before.');
      }
      const elsewhere = others.filter((s) => s.id !== draft.id && s.status === 'pending' && activePoemIds(s).includes(id) && s.journalId !== journal.id);
      if (elsewhere.length && journal.simSubs === 'no') {
        w.push(journal.name + ' does not take simultaneous submissions, but ' + t + ' is still out elsewhere.');
      } else if (elsewhere.length && journal.simSubs === 'unknown') {
        w.push(t + ' is out elsewhere, and you have not noted whether ' + journal.name + ' allows simultaneous submissions.');
      }
    }
    const fee = numOrNull(draft.feePaid);
    if (fee) {
      const b = budgetCheck(data, fee, sent || today, { subId: draft.id });
      if (b) w.push(b);
    }
    return w;
  }

  // ---------- deadlines ----------
  // Journal opens/closes plus deadlines for manuscript entries that have not been sent yet.
  function upcomingDeadlines(data, today, windowDays) {
    const win = windowDays == null ? 60 : windowDays;
    const out = [];
    for (const j of data.journals) {
      const rec = isRecurring(j);
      for (const w of windowsFrom(j, today, rec ? 4 : 1)) {
        for (const kind of ['opens', 'closes']) {
          const date = w[kind];
          if (!date) continue;
          const n = daysBetween(today, date);
          if (n >= 0 && n <= win) out.push({ kind, date, daysAway: n, journal: j, name: j.name, recurring: rec });
        }
      }
    }
    for (const e of arr(data.entries)) {
      if (e.status !== 'planned' || !e.deadline) continue;
      const n = daysBetween(today, e.deadline);
      if (n >= 0 && n <= win) out.push({ kind: 'deadline', date: e.deadline, daysAway: n, entry: e, name: e.name });
    }
    const rank = (x) => (x.kind === 'opens' ? 1 : 0);
    out.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
    return out;
  }

  // ---------- reading-period reminders (Windows notifications) ----------
  // For journals with reminders on: a reading period opening or closing within notifyDays.
  // The closing reminder is skipped when you already sent something there during that period.
  // Each has a key that stays the same for that journal, kind and date, so it is shown once.
  const dayLabel = (d) => MONTH_NAMES[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10));
  function windowAlerts(data, today) {
    const days = normalizeSettings(data.settings).notifyDays;
    const out = [];
    const when = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
    for (const j of data.journals) {
      if (!j.notify || j.alwaysOpen) continue;
      for (const w of windowsFrom(j, today, isRecurring(j) ? 4 : 1)) {
        const period = w.opens && w.closes ? 'Reading period ' + dayLabel(w.opens) + ' to ' + dayLabel(w.closes) + '.' : '';
        if (w.opens) {
          const n = daysBetween(today, w.opens);
          if (n >= 0 && n <= days) {
            out.push({ key: j.id + ':opens:' + w.opens, journalId: j.id, name: j.name, kind: 'opens', date: w.opens, daysAway: n,
              title: j.name + ' opens ' + when(n), body: period || 'Opens ' + dayLabel(w.opens) + '.' });
          }
        }
        if (w.closes) {
          const n = daysBetween(today, w.closes);
          const from = w.opens || addDays(w.closes, -366);
          const sent = data.submissions.some((s) => s.journalId === j.id && s.sentDate && s.sentDate >= from && s.sentDate <= w.closes);
          if (n >= 0 && n <= days && !sent) {
            out.push({ key: j.id + ':closes:' + w.closes, journalId: j.id, name: j.name, kind: 'closes', date: w.closes, daysAway: n,
              title: j.name + ' closes ' + when(n), body: 'Last day: ' + dayLabel(w.closes) + '. You have not sent anything there this reading period.' });
          }
        }
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const seen = new Set();
    return out.filter((a) => (seen.has(a.key) ? false : seen.add(a.key)));
  }

  function openNow(data, today) {
    return data.journals
      .map((j) => ({ journal: j, win: currentWindow(j, today) }))
      .filter(({ win }) => win.always || ((win.opens || win.closes) && (!win.opens || win.opens <= today) && (!win.closes || win.closes >= today)))
      .map(({ journal, win }) => ({ journal, opens: win.opens, closes: win.closes, daysLeft: win.closes ? daysBetween(today, win.closes) : null }))
      .sort((a, b) => (a.daysLeft === null) - (b.daysLeft === null) || a.daysLeft - b.daysLeft);
  }

  function staleSubmissions(data, today, days) {
    const limit = days == null ? 90 : days;
    return data.submissions
      .filter((s) => s.status === 'pending' && s.sentDate)
      .map((s) => ({ sub: s, journal: journalById(data, s.journalId), waiting: daysBetween(s.sentDate, today) }))
      .filter((x) => x.waiting >= limit)
      .sort((a, b) => b.waiting - a.waiting);
  }

  // ---------- stats ----------
  function median(nums) {
    if (!nums.length) return null;
    const a = nums.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function stats(data) {
    const c = { sent: data.submissions.length, pending: 0, accepted: 0, rejected: 0, withdrawn: 0 };
    const waits = [];
    let fees = 0;
    for (const s of data.submissions) {
      c[s.status]++;
      if (s.feePaid) fees += s.feePaid;
      if (s.status !== 'pending' && s.sentDate && s.responseDate) {
        const n = daysBetween(s.sentDate, s.responseDate);
        if (n >= 0) waits.push(n);
      }
    }
    for (const e of arr(data.entries)) if (e.feePaid) fees += e.feePaid;
    const decided = c.accepted + c.rejected;
    return Object.assign(c, {
      medianDays: median(waits),
      feesTotal: fees,
      acceptRate: decided ? c.accepted / decided : null,
      poemsTotal: data.poems.length,
      poemsPublished: data.poems.filter((p) => poemState(data, p) === 'published').length,
    });
  }

  // ---------- exports ----------
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsFold(line) {
    const out = [];
    let rest = line;
    while (rest.length > 70) {
      out.push(rest.slice(0, 70));
      rest = ' ' + rest.slice(70);
    }
    out.push(rest);
    return out.join('\r\n');
  }
  function icsStamp(now) {
    return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function toICS(data, today, now) {
    now = now || new Date();
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Pen Pal//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Pen Pal deadlines',
    ];
    const eventLines = (uid, date, summary, desc, alarms) => {
      const d = date.replace(/-/g, '');
      const next = addDays(date, 1).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + icsStamp(now));
      lines.push('DTSTART;VALUE=DATE:' + d);
      lines.push('DTEND;VALUE=DATE:' + next);
      lines.push('SUMMARY:' + icsEscape(summary));
      if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
      for (const [trig, text] of alarms) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(text), 'TRIGGER:' + trig, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    };
    const closeAlarms = (name) => [['-P7D', 'One week left: ' + name], ['-P1D', 'Closes tomorrow: ' + name]];
    for (const j of data.journals) {
      const rec = isRecurring(j);
      // A yearly journal exports its next two windows, each with its own year in the ID.
      for (const w of windowsFrom(j, today, rec ? 2 : 1)) {
        for (const kind of ['opens', 'closes']) {
          const date = w[kind];
          if (!date || date < today) continue;
          const desc = [j.url, j.fee ? 'Fee: $' + j.fee : ''].filter(Boolean).join('\n');
          const uid = j.id + '-' + kind + (rec ? '-' + date.slice(0, 4) : '') + '@poetry-tracker';
          eventLines(uid, date, (kind === 'closes' ? 'Closes: ' : 'Opens: ') + j.name, desc,
            kind === 'closes' ? closeAlarms(j.name) : [['PT9H', 'Reading period opens today: ' + j.name]]);
        }
      }
    }
    for (const p of data.poems) {
      const d = normalizeRights(p.rights).exclusiveUntil;
      if (!d || d < today) continue;
      eventLines(p.id + '-reprint@pen-pal', d, 'Free for reprint: ' + p.title, 'Its exclusive period ends today.', [['PT9H', 'Free for reprint: ' + p.title]]);
    }
    for (const e of arr(data.entries)) {
      if (e.status !== 'planned' || !e.deadline || e.deadline < today) continue;
      const m = manuscriptById(data, e.manuscriptId);
      const desc = [m ? 'Manuscript: ' + m.title : '', e.url, e.fee ? 'Fee: $' + e.fee : ''].filter(Boolean).join('\n');
      eventLines(e.id + '-deadline@poetry-tracker', e.deadline, 'Entry deadline: ' + e.name, desc, closeAlarms(e.name));
    }
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(data) {
    const header = ['Date sent', 'Journal', 'Poems', 'Status', 'Accepted poems', 'Response date', 'Days to response', 'Fee paid', 'Notes'];
    const rows = data.submissions
      .slice()
      .sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''))
      .map((s) => {
        const j = journalById(data, s.journalId);
        const title = (id) => (poemById(data, id) || { title: '(deleted poem)' }).title;
        const wait = s.status !== 'pending' && s.sentDate && s.responseDate ? daysBetween(s.sentDate, s.responseDate) : '';
        return [
          s.sentDate,
          j ? j.name : '(deleted journal)',
          s.poemIds.map(title).join('; '),
          s.status,
          acceptedPoemIdsOf(s).map(title).join('; '),
          s.responseDate,
          wait,
          s.feePaid === null ? '' : s.feePaid,
          s.notes,
        ];
      });
    return [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- insights (response times and acceptance rates) ----------
  const isDecided = (s) => s.status === 'accepted' || s.status === 'rejected';
  function waitDays(s) {
    if (!s.sentDate || !s.responseDate) return null;
    const n = daysBetween(s.sentDate, s.responseDate);
    return n >= 0 ? n : null;
  }
  // One row per journal that has had at least one submission.
  function journalStats(data) {
    const groups = new Map();
    for (const s of data.submissions) {
      if (!groups.has(s.journalId)) groups.set(s.journalId, []);
      groups.get(s.journalId).push(s);
    }
    const rows = [];
    for (const [id, subs] of groups) {
      const j = journalById(data, id);
      const count = (st) => subs.filter((s) => s.status === st).length;
      const accepted = count('accepted'), rejected = count('rejected');
      const waits = subs.filter(isDecided).map(waitDays).filter((n) => n !== null);
      rows.push({
        journal: j, name: j ? j.name : '(deleted journal)', sent: subs.length,
        pending: count('pending'), accepted, rejected, withdrawn: count('withdrawn'),
        decided: accepted + rejected,
        acceptRate: accepted + rejected ? accepted / (accepted + rejected) : null,
        medianDays: median(waits), waits: waits.length,
      });
    }
    rows.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
    return rows;
  }
  const BUCKETS = [
    [0, 14, 'Within 2 weeks'], [15, 30, '2 to 4 weeks'], [31, 60, '1 to 2 months'],
    [61, 90, '2 to 3 months'], [91, 180, '3 to 6 months'], [181, Infinity, 'Over 6 months'],
  ];
  // How long accepted and rejected submissions took to get an answer.
  function responseBuckets(data) {
    const waits = data.submissions.filter(isDecided).map(waitDays).filter((n) => n !== null);
    return BUCKETS.map(([from, to, label]) => ({ label, from, to, count: waits.filter((n) => n >= from && n <= to).length }));
  }
  function spend(data) {
    const subs = data.submissions.reduce((t, s) => t + (s.feePaid || 0), 0);
    const ents = arr(data.entries).reduce((t, e) => t + (e.feePaid || 0), 0);
    return { submissions: subs, entries: ents, total: subs + ents };
  }

  // ---------- undo and redo ----------
  // The page keeps a snapshot (JSON text, without the save bookkeeping) before each change.
  // Undo changes your data, never which save the file is on.
  const SAVE_META = ['rev', 'saveId', 'savedOn', 'savedAt', 'lineage'];
  const snapshot = (data) => JSON.stringify(Object.assign({}, data, { rev: 0, saveId: '', savedOn: '', savedAt: '', lineage: [] }));
  function restoreSnapshot(json, current) {
    const d = normalize(JSON.parse(json));
    if (typeof current === 'number') d.rev = current;
    else for (const k of SAVE_META) d[k] = current[k];
    return d;
  }
  function createHistory(limit) {
    return { limit: limit || 50, past: [], future: [] };
  }
  function historyRecord(h, beforeJSON, label) {
    h.past.push({ json: beforeJSON, label: label || '' });
    if (h.past.length > h.limit) h.past.shift();
    h.future.length = 0;
  }
  // Both return the entry to restore (or null), and keep the opposite stack ready.
  function historyUndo(h, currentJSON) {
    const e = h.past.pop();
    if (!e) return null;
    h.future.push({ json: currentJSON, label: e.label });
    return e;
  }
  function historyRedo(h, currentJSON) {
    const e = h.future.pop();
    if (!e) return null;
    h.past.push({ json: currentJSON, label: e.label });
    return e;
  }

  // ---------- backup reminder ----------
  // server: { folderSet, lastCopyOk, lastError } from the tracker's own server (optional).
  function backupReminder(data, today, server) {
    server = server || {};
    const st = normalizeSettings(data.settings);
    const worthSaving = data.submissions.length || data.poems.length >= 3 || arr(data.manuscripts).length;
    if (!worthSaving) return null;
    if (st.backupSnoozedUntil && today < st.backupSnoozedUntil) return null;
    if (server.folderSet && server.lastCopyOk === false) return { kind: 'copy-failing', days: null, error: server.lastError || '' };
    if (server.folderSet && server.lastCopyOk) return null; // the automatic second copy is working
    if (!st.lastBackupDownload) return { kind: 'never', days: null };
    const days = daysBetween(st.lastBackupDownload, today);
    return days >= 30 ? { kind: 'stale', days } : null;
  }
  function markBackupDownloaded(data, today) {
    data.settings = normalizeSettings(Object.assign({}, data.settings, { lastBackupDownload: today }));
  }
  function snoozeBackupReminder(data, today, days) {
    data.settings = normalizeSettings(Object.assign({}, data.settings, { backupSnoozedUntil: addDays(today, days || 90) }));
  }

  // ---------- fee budget ----------
  const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthName(ym) { return FULL_MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
  function addMonths(ym, n) {
    const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
    return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
  }
  // The budget in force for a month: the latest change made in or before it. Null for none.
  function budgetFor(settings, ym) {
    const mb = normalizeSettings(settings).monthlyBudget;
    let v = null;
    for (const k of Object.keys(mb).sort()) {
      if (k > ym) break;
      v = mb[k];
    }
    return v;
  }
  // Every fee in a period ('YYYY' or 'YYYY-MM'): paid submission and entry fees, plus planned entries (not sent yet) on their deadline.
  function feeItems(data, period, skip) {
    skip = skip || {};
    const p = String(period);
    const inP = (date) => !!date && date.slice(0, p.length) === p;
    const items = [];
    for (const s of data.submissions) {
      if (s.id === skip.subId || !s.feePaid || !inP(s.sentDate)) continue;
      const j = journalById(data, s.journalId);
      items.push({ date: s.sentDate, name: j ? j.name : '(deleted journal)', what: s.poemIds.length + ' poem' + (s.poemIds.length === 1 ? '' : 's'), amount: s.feePaid, planned: false, kind: 'submission', id: s.id });
    }
    for (const e of arr(data.entries)) {
      if (e.id === skip.entryId) continue;
      const m = manuscriptById(data, e.manuscriptId);
      const what = 'Manuscript' + (m ? ': ' + m.title : '');
      if (e.status === 'planned') {
        if (e.fee && inP(e.deadline)) items.push({ date: e.deadline, name: e.name, what: 'Planned entry', amount: e.fee, planned: true, kind: 'entry', id: e.id });
      } else if (e.feePaid && inP(e.sentDate)) {
        items.push({ date: e.sentDate, name: e.name, what, amount: e.feePaid, planned: false, kind: 'entry', id: e.id });
      }
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  // One month against that month's budget.
  function budgetSummary(data, ym, skip) {
    const st = normalizeSettings(data.settings);
    const items = feeItems(data, ym, skip);
    let spent = 0, planned = 0;
    for (const i of items) { if (i.planned) planned += i.amount; else spent += i.amount; }
    const budget = budgetFor(st, ym);
    const counted = round2(spent + (st.countPlanned ? planned : 0));
    return {
      month: ym, budget, spent: round2(spent), planned: round2(planned), counted,
      left: budget === null ? null : round2(budget - counted),
      warnAt: budget === null ? null : round2((budget * st.budgetWarnPct) / 100),
      warnPct: st.budgetWarnPct, countPlanned: st.countPlanned, items,
    };
  }
  // The twelve months of a year, each with its own budget, for the chart.
  function budgetYear(data, year) {
    const st = normalizeSettings(data.settings);
    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = year + '-' + String(i + 1).padStart(2, '0');
      return { month: ym, spent: 0, planned: 0, budget: budgetFor(st, ym) };
    });
    for (const i of feeItems(data, year)) {
      const m = months[Number(i.date.slice(5, 7)) - 1];
      if (i.planned) m.planned += i.amount; else m.spent += i.amount;
    }
    let spent = 0, planned = 0;
    for (const m of months) { m.spent = round2(m.spent); m.planned = round2(m.planned); spent += m.spent; planned += m.planned; }
    return { year: Number(year), months, spent: round2(spent), planned: round2(planned) };
  }
  // A plain-language note when a new fee goes over (or near) its month's budget. Null when fine or no budget.
  function budgetCheck(data, amount, date, skip) {
    const fee = numOrNull(amount);
    if (!fee || !isDate(date)) return null;
    const ym = date.slice(0, 7);
    const sum = budgetSummary(data, ym, skip);
    if (sum.budget === null) return null;
    const after = round2(sum.counted + fee);
    const $ = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
    if (after > sum.budget) return 'This fee would take you to ' + $(after) + ', over your ' + $(sum.budget) + ' fee budget for ' + monthName(ym) + '.';
    if (after >= sum.warnAt) return 'This fee would bring you to ' + $(after) + ' of your ' + $(sum.budget) + ' fee budget for ' + monthName(ym) + '.';
    return null;
  }
  // Set (or, with '', remove) the monthly budget from this month on. Later changes you already made stay.
  function setBudget(data, ym, amount) {
    const st = normalizeSettings(data.settings);
    const n = numOrNull(amount);
    const mb = Object.assign({}, st.monthlyBudget);
    mb[ym] = n;
    data.settings = normalizeSettings(Object.assign({}, data.settings, { monthlyBudget: mb }));
  }

  // ---------- follow-up (query) reminders ----------
  // How long a journal usually takes: your own history first (2+ answers), then what it says, then 90 days.
  function expectedReply(data, journal) {
    if (journal) {
      const row = journalStats(data).find((r) => r.journal && r.journal.id === journal.id);
      if (row && row.waits >= 2 && row.medianDays) return { days: Math.round(row.medianDays), basis: 'history' };
      if (journal.replyDays) return { days: journal.replyDays, basis: 'journal' };
    }
    return { days: normalizeSettings(data.settings).followUpDays, basis: 'default' };
  }
  function queryReminders(data, today) {
    const out = [];
    for (const s of data.submissions) {
      if (s.status !== 'pending' || !s.sentDate) continue;
      if (s.snoozedUntil && today < s.snoozedUntil) continue;
      const journal = journalById(data, s.journalId);
      const exp = expectedReply(data, journal);
      const due = s.queriedDate ? addDays(s.queriedDate, 60) : addDays(s.sentDate, exp.days);
      if (today < due) continue;
      out.push({ sub: s, journal, waiting: daysBetween(s.sentDate, today), expected: exp.days, basis: exp.basis, queried: s.queriedDate });
    }
    return out.sort((a, b) => b.waiting - a.waiting);
  }
  function markQueried(data, subId, today) {
    const s = data.submissions.find((x) => x.id === subId);
    if (s) { s.queriedDate = today; s.snoozedUntil = ''; }
  }
  function snoozeQuery(data, subId, today, days) {
    const s = data.submissions.find((x) => x.id === subId);
    if (s) s.snoozedUntil = addDays(today, days || 30);
  }

  // ---------- rights and reprints ----------
  function suggestedCredit(data, poem) {
    const pl = placement(data, poem.id);
    if (!pl) return '';
    const where = pl.kind === 'submission' ? (pl.journal ? pl.journal.name : '') : poem.publishedWhere;
    if (!where) return '';
    const r = normalizeRights(poem.rights);
    const when = r.issue || (r.pubDate ? r.pubDate.slice(0, 4) : pl.kind === 'submission' ? (pl.sub.responseDate || '').slice(0, 4) : poem.publishedDate);
    return '"' + poem.title + '" first appeared in ' + where + (when ? ', ' + when : '') + '.';
  }
  // Poems whose exclusive period ends soon (or just ended), so they can go out as reprints.
  function rightsReminders(data, today, windowDays) {
    const win = windowDays == null ? 30 : windowDays;
    const out = [];
    for (const p of data.poems) {
      const d = normalizeRights(p.rights).exclusiveUntil;
      if (!d) continue;
      const n = daysBetween(today, d);
      if (n <= win && n >= -7) {
        const pl = placement(data, p.id);
        out.push({ poem: p, date: d, daysAway: n, placedAt: pl ? (pl.kind === 'submission' ? (pl.journal ? pl.journal.name : '') : p.publishedWhere) : '' });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---------- the journal directory that ships with the app (and updates itself) ----------
  // What a journal says it is especially for, or how it describes its taste. Only tagged when the
  // journal says so itself.
  const FOCUS = [
    ['black', 'Black writers'], ['bipoc', 'Writers of color'], ['latinx', 'Latinx writers'], ['asian', 'Asian American writers'],
    ['indigenous', 'Indigenous writers'], ['lgbtq', 'LGBTQ+ writers'], ['women', 'Women writers'], ['emerging', 'Emerging writers'],
    ['south', 'The South'], ['florida', 'Florida'], ['narrative', 'Narrative'], ['experimental', 'Experimental'],
    ['formal', 'Formal verse'], ['translation', 'Translation'], ['nature', 'Nature'], ['speculative', 'Speculative'],
  ];
  const FOCUS_KEYS = FOCUS.map((f) => f[0]);
  const focusLabel = (k) => (FOCUS.find((f) => f[0] === k) || [k, k])[1];
  const FORMATS = ['print', 'online'];
  function normalizeDirEntry(e, checked) {
    e = e || {};
    const windows = arr(e.windows).map((w) => ({ opens: MMDD(w && w[0]), closes: MMDD(w && w[1]) })).filter((w) => w.opens && w.closes);
    const tags = arr(e.tags).map((t) => str(t, 60)).filter(Boolean);
    // Older entries said print / online in their tags.
    const format = (Array.isArray(e.format) ? e.format : tags.map((t) => t.toLowerCase())).filter((f) => FORMATS.includes(f));
    const pay = numOrNull(e.payPerPoem);
    return {
      id: str(e.id, 80), name: str(e.name, 300).trim(), url: cleanUrl(e.url),
      windows, yearRound: e.yearRound === true, windowsUnknown: !windows.length && e.yearRound !== true,
      fee: numOrNull(e.fee), feeNote: str(e.feeNote, 200), maxPoems: intOrNull(e.maxPoems),
      simSubs: YN.includes(e.simSubs) ? e.simSubs : 'unknown', pays: YN.includes(e.pays) ? e.pays : 'unknown',
      paysNote: str(e.paysNote, 200), payPerPoem: pay !== null && pay > 0 ? pay : null,
      reprints: YN.includes(e.reprints) ? e.reprints : 'unknown',
      replyDays: intOrNull(e.replyDays),
      format: FORMATS.filter((f) => format.includes(f)),
      focus: FOCUS_KEYS.filter((k) => arr(e.focus).includes(k)),
      tags: tags.filter((t) => !FORMATS.includes(t.toLowerCase())),
      note: str(e.note, 1000),
      checked: dateOr(e.checked) || dateOr(checked),
    };
  }
  function loadDirectory(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const checked = dateOr(raw.checked);
    const seen = new Set();
    const journals = arr(raw.journals).map((e) => normalizeDirEntry(e, checked)).filter((e) => e.id && e.name && !seen.has(e.id) && seen.add(e.id));
    return { rev: Number.isInteger(raw.rev) && raw.rev > 0 ? raw.rev : 0, checked, about: str(raw.about, 1000), journals };
  }
  // The newer of two directories (the one inside the app, and one downloaded later). Bad downloads lose.
  function pickDirectory(bundled, downloaded) {
    const a = loadDirectory(bundled), b = loadDirectory(downloaded);
    if (!b.journals.length) return { dir: a, source: 'app' };
    const newer = b.rev > a.rev || (b.rev === a.rev && b.checked > a.checked);
    return newer ? { dir: b, source: 'update' } : { dir: a, source: 'app' };
  }
  // Turn a directory entry into one of your journals. Windows become yearly; the first is the main one.
  function dirToJournal(e, today, checked) {
    const y = Number(today.slice(0, 4)) - 1;
    let opens = '', closes = '', repeat = 'none', extra = [];
    if (e.windows.length) {
      const w = e.windows[0];
      opens = addYears('2028-' + w.opens, y - 2028);
      closes = addYears('2028-' + w.closes, y - 2028);
      if (closes < opens) closes = addYears(closes, 1);
      repeat = 'yearly';
      extra = e.windows.slice(1);
    }
    const notes = [e.note, e.feeNote, e.pays === 'yes' && e.paysNote ? 'Pays ' + e.paysNote : e.paysNote].filter(Boolean).join('\n');
    return normalizeJournal({
      id: uid(), name: e.name, url: e.url, opens, closes, repeat, extraWindows: extra, alwaysOpen: e.yearRound,
      fee: e.fee, maxPoems: e.maxPoems, simSubs: e.simSubs, pays: e.pays, reprints: e.reprints, replyDays: e.replyDays,
      notes, dirId: e.id, checked: e.checked || checked,
    });
  }
  const findMine = (data, e) => data.journals.find((j) => j.dirId === e.id) || data.journals.find((j) => j.name.trim().toLowerCase() === e.name.toLowerCase()) || null;
  // Where a reading period stands today, from a window { opens, closes } in real dates.
  function stateFromWindow(w, today, within) {
    if (w.always) return { kind: 'always', opens: '', closes: '', daysLeft: null, daysUntil: null };
    if (!w.opens || !w.closes) return { kind: 'unknown', opens: '', closes: '', daysLeft: null, daysUntil: null };
    if (w.opens <= today && today <= w.closes) return { kind: 'open', opens: w.opens, closes: w.closes, daysLeft: daysBetween(today, w.closes), daysUntil: 0 };
    if (w.closes < today) return { kind: 'closed', opens: w.opens, closes: w.closes, daysLeft: null, daysUntil: null };
    const until = daysBetween(today, w.opens);
    return { kind: until <= (within == null ? 30 : within) ? 'soon' : 'closed', opens: w.opens, closes: w.closes, daysLeft: null, daysUntil: until };
  }
  // Where a directory journal stands today: open, opening soon, closed, open all year, or not known.
  function dirState(e, today, within) {
    if (e.yearRound) return stateFromWindow({ always: true }, today);
    if (!e.windows.length) return stateFromWindow({}, today);
    return stateFromWindow(currentWindow(dirToJournal(e, today, ''), today), today, within);
  }
  // The same for one of your own journals.
  const journalState = (j, today, within) => stateFromWindow(currentWindow(j, today), today, within);

  // Search options. Old saved options (openSoon, free, sim, pays, reprints, notSent) still work.
  const FIND_WHEN = ['any', 'open', 'soon', 'closing'];
  const FIND_SORTS = ['smart', 'closing', 'reply', 'pay', 'fee', 'name'];
  function normalizeFindOpts(o) {
    o = o && typeof o === 'object' ? o : {};
    const n = (v, lo, hi) => { const x = numOrNull(v); return x !== null && x >= lo && x <= hi ? x : null; };
    const when = FIND_WHEN.includes(o.when) ? o.when : o.openSoon ? 'soon' : 'any';
    return {
      q: str(o.q, 200),
      when,
      within: n(o.within, 1, 365) === null ? 30 : Math.round(n(o.within, 1, 365)),
      maxFee: o.free ? 0 : n(o.maxFee, 0, 1000),
      sim: o.sim === true, pays: o.pays === true, reprints: o.reprints === true, notSent: o.notSent === true,
      payMin: n(o.payMin, 0, 100000),
      maxReply: n(o.maxReply, 1, 2000),
      format: FORMATS.includes(o.format) ? o.format : '',
      focus: FOCUS_KEYS.filter((k) => arr(o.focus).includes(k)),
      sort: FIND_SORTS.includes(o.sort) ? o.sort : 'smart',
    };
  }
  // How many filters are on, for a "Filters (3)" label. The search words and sort do not count.
  function findFilterCount(o) {
    o = normalizeFindOpts(o);
    return (o.when !== 'any') + (o.maxFee !== null) + o.sim + o.pays + o.reprints + o.notSent + (o.payMin !== null && o.payMin > 0) +
      (o.maxReply !== null) + !!o.format + o.focus.length;
  }
  function matchesFind(e, state, sent, o) {
    if (o.when === 'open' && !['open', 'always'].includes(state.kind)) return false;
    if (o.when === 'soon' && !['open', 'always', 'soon'].includes(state.kind)) return false;
    if (o.when === 'closing' && !(state.kind === 'open' && state.daysLeft <= o.within)) return false;
    if (o.maxFee !== null && (e.fee === null || e.fee > o.maxFee)) return false;
    if (o.sim && e.simSubs !== 'yes') return false;
    if (o.pays && e.pays !== 'yes') return false;
    if (o.payMin && !(e.pays === 'yes' && e.payPerPoem !== null && e.payPerPoem >= o.payMin)) return false;
    if (o.reprints && e.reprints !== 'yes') return false;
    if (o.maxReply !== null && !(e.replyDays && e.replyDays <= o.maxReply)) return false;
    if (o.format && !e.format.includes(o.format)) return false;
    if (o.focus.some((k) => !e.focus.includes(k))) return false;
    if (o.notSent && sent) return false;
    return true;
  }
  const RANK = { open: 0, soon: 1, always: 2, closed: 3, unknown: 4 };
  const byName = (a, b) => a.entry.name.localeCompare(b.entry.name);
  const SORTERS = {
    smart: (a, b) => RANK[a.state.kind] - RANK[b.state.kind] || (a.state.daysLeft ?? a.state.daysUntil ?? 0) - (b.state.daysLeft ?? b.state.daysUntil ?? 0) || byName(a, b),
    // Open ones by closing date first, then the ones opening soonest. All-year journals after those.
    closing: (a, b) => {
      const k = (r) => (r.state.kind === 'open' ? r.state.daysLeft : r.state.kind === 'soon' || r.state.kind === 'closed' ? 1000 + r.state.daysUntil : r.state.kind === 'always' ? 5000 : 9000);
      return k(a) - k(b) || byName(a, b);
    },
    reply: (a, b) => (a.entry.replyDays || 1e6) - (b.entry.replyDays || 1e6) || byName(a, b),
    pay: (a, b) => (b.entry.payPerPoem || (b.entry.pays === 'yes' ? 0.5 : 0)) - (a.entry.payPerPoem || (a.entry.pays === 'yes' ? 0.5 : 0)) || byName(a, b),
    fee: (a, b) => (a.entry.fee ?? 1e6) - (b.entry.fee ?? 1e6) || byName(a, b),
    name: byName,
  };
  // Could this poem go to this directory journal? No if it is placed, the journal already saw it, or
  // the journal takes no simultaneous submissions while the poem is out.
  function fitsPoem(data, e, mine, poemId) {
    if (!poemById(data, poemId) || placement(data, poemId)) return false;
    if (mine && data.submissions.some((s) => s.journalId === mine.id && s.poemIds.includes(poemId))) return false;
    return !(e.simSubs === 'no' && pendingSubsFor(data, poemId).length);
  }
  // opts.poemId (not saved with a search): only journals that could take that poem.
  function searchDirectory(dir, data, opts, today) {
    const o = normalizeFindOpts(opts);
    const poemId = opts && typeof opts.poemId === 'string' ? opts.poemId : '';
    const words = o.q.toLowerCase().split(/\s+/).filter(Boolean);
    return dir.journals
      .map((e) => {
        const mine = findMine(data, e);
        const sent = mine ? data.submissions.filter((s) => s.journalId === mine.id).length : 0;
        return { entry: e, state: dirState(e, today, o.within), mine, sent };
      })
      .filter(({ entry: e, state, sent }) => {
        const hay = (e.name + ' ' + e.note + ' ' + e.tags.join(' ') + ' ' + e.paysNote + ' ' + e.focus.map(focusLabel).join(' ')).toLowerCase();
        if (words.some((w) => !hay.includes(w))) return false;
        if (poemId && !fitsPoem(data, e, findMine(data, e), poemId)) return false;
        return matchesFind(e, state, sent, o);
      })
      .sort(SORTERS[o.sort]);
  }
  // Saved searches live in settings, so they follow your data to every computer and the iPhone.
  function saveFind(data, name, opts) {
    const nm = str(name, 60).trim();
    if (!nm) return null;
    const o = normalizeFindOpts(opts);
    const list = data.settings.savedFinds;
    const same = list.find((f) => f.name.toLowerCase() === nm.toLowerCase());
    if (same) { same.opts = o; return same; }
    const f = { id: uid(), name: nm, opts: o };
    list.push(f);
    if (list.length > 20) list.shift();
    return f;
  }
  function removeFind(data, id) {
    data.settings.savedFinds = data.settings.savedFinds.filter((f) => f.id !== id);
  }
  function normalizeSavedFinds(list) {
    return arr(list).filter((f) => f && typeof f.name === 'string' && f.name.trim())
      .map((f) => ({ id: str(f.id, 80) || uid(), name: str(f.name, 60).trim(), opts: normalizeFindOpts(f.opts) })).slice(-20);
  }

  // ---------- where can this poem go? ----------
  // Journals (yours and the directory's) that are open now or opening within `within` days and have not
  // seen this poem. Leaves out ones that do not take simultaneous submissions while the poem is out.
  function poemMatches(data, dir, poemId, today, opts) {
    opts = opts || {};
    const within = opts.within == null ? 30 : opts.within;
    const poem = poemById(data, poemId);
    const out = { poem, placed: false, out: 0, items: [], hidden: { seen: 0, noSim: 0, closed: 0, fee: 0 } };
    if (!poem) return out;
    if (placement(data, poemId)) { out.placed = true; return out; }
    const pending = pendingSubsFor(data, poemId);
    out.out = pending.length;
    const seenIds = new Set(data.submissions.filter((s) => s.poemIds.includes(poemId)).map((s) => s.journalId));
    const cands = [];
    const usedDir = new Set();
    for (const j of data.journals) {
      if (j.dirId) usedDir.add(j.dirId);
      cands.push({ key: 'j:' + j.id, name: j.name, mine: j, entry: dir ? dir.journals.find((e) => e.id === j.dirId) || null : null, state: journalState(j, today, within),
        fee: j.fee, simSubs: j.simSubs, maxPoems: j.maxPoems, url: j.url });
    }
    for (const e of dir ? dir.journals : []) {
      if (usedDir.has(e.id) || data.journals.some((j) => j.name.trim().toLowerCase() === e.name.toLowerCase())) continue;
      cands.push({ key: 'd:' + e.id, name: e.name, mine: null, entry: e, state: dirState(e, today, within), fee: e.fee, simSubs: e.simSubs, maxPoems: e.maxPoems, url: e.url });
    }
    const left = budgetSummary(data, today.slice(0, 7));
    for (const c of cands) {
      if (c.mine && seenIds.has(c.mine.id)) { out.hidden.seen++; continue; }
      if (!['open', 'always', 'soon'].includes(c.state.kind)) { out.hidden.closed++; continue; }
      if (pending.length && c.simSubs === 'no') { out.hidden.noSim++; continue; }
      if (opts.free && c.fee !== 0) { out.hidden.fee++; continue; }
      const notes = [];
      if (pending.length && c.simSubs === 'unknown') notes.push('Out elsewhere; check whether they take simultaneous submissions.');
      if (c.mine && data.submissions.some((s) => s.journalId === c.mine.id && s.status === 'pending')) notes.push('You already have a submission waiting there.');
      if (c.fee && left.budget !== null && round2(left.counted + c.fee) > left.budget) notes.push('The fee would put you over this month\'s budget.');
      if (c.fee === null) notes.push('Fee not confirmed.');
      out.items.push(Object.assign(c, { notes }));
    }
    const k = (c) => (c.state.kind === 'open' ? c.state.daysLeft : c.state.kind === 'always' ? 500 : 1000 + c.state.daysUntil);
    out.items.sort((a, b) => k(a) - k(b) || !!b.mine - !!a.mine || a.name.localeCompare(b.name));
    return out;
  }

  // ---------- newer directory details for a journal you saved ----------
  // Your copy always wins: Pen Pal only offers the changes, and only when the directory checked the
  // journal after you added it (or last took its details).
  const DIR_FIELDS = [
    ['windows', 'Reading period'], ['fee', 'Fee'], ['maxPoems', 'Poems per submission'], ['simSubs', 'Simultaneous'],
    ['pays', 'Pays'], ['reprints', 'Reprints'], ['replyDays', 'Usual reply'], ['url', 'Guidelines link'],
  ];
  function mineFields(j) {
    const win = j.alwaysOpen ? 'Open all year' : isRecurring(j) ? windowsText([{ opens: j.opens.slice(5), closes: j.closes.slice(5) }].concat(j.extraWindows)) : '';
    return { windows: win, fee: j.fee, maxPoems: j.maxPoems, simSubs: j.simSubs, pays: j.pays, reprints: j.reprints, replyDays: j.replyDays, url: j.url };
  }
  function dirFields(e) {
    return { windows: e.yearRound ? 'Open all year' : windowsText(e.windows), fee: e.fee, maxPoems: e.maxPoems, simSubs: e.simSubs, pays: e.pays, reprints: e.reprints, replyDays: e.replyDays, url: e.url };
  }
  const showField = (k, v) => (v === null || v === '' || v === 'unknown' ? 'Not known' : k === 'fee' ? (v === 0 ? 'Free' : '$' + v) : k === 'replyDays' ? 'About ' + v + ' days' : String(v));
  function dirChanges(journal, entry) {
    if (!journal || !entry || !entry.checked || (journal.checked && journal.checked >= entry.checked)) return [];
    const a = mineFields(journal), b = dirFields(entry);
    return DIR_FIELDS.filter(([k]) => {
      const nb = b[k];
      if (nb === null || nb === '' || nb === 'unknown') return false; // the directory does not know: keep yours
      return String(a[k]) !== String(nb);
    }).map(([k, label]) => ({ field: k, label, mine: showField(k, a[k]), theirs: showField(k, b[k]) }));
  }
  // Take the directory's details for the changed fields. Your notes, bell and history stay.
  function applyDirChanges(data, journalId, entry, today) {
    const j = journalById(data, journalId);
    if (!j || !entry) return false;
    const changes = dirChanges(j, entry);
    const fresh = dirToJournal(entry, today, entry.checked);
    for (const c of changes) {
      if (c.field === 'windows') {
        Object.assign(j, { opens: fresh.opens, closes: fresh.closes, repeat: fresh.repeat, extraWindows: fresh.extraWindows, alwaysOpen: fresh.alwaysOpen });
      } else j[c.field] = fresh[c.field];
    }
    j.checked = entry.checked;
    j.dirId = entry.id;
    return changes.length > 0;
  }
  // "Keep mine": stop offering these changes until the directory checks the journal again.
  function dismissDirChanges(data, journalId, entry) {
    const j = journalById(data, journalId);
    if (j && entry && entry.checked) j.checked = entry.checked;
  }

  const dirIsStale = (dir, today, days) => !dir.checked || daysBetween(dir.checked, today) > (days || 180);
  // Search the big databases on their own sites. Neither documents a search link, so this is a site search.
  function searchLinks(q) {
    const t = String(q || '').trim();
    const ddg = (site) => 'https://duckduckgo.com/?q=' + encodeURIComponent('site:' + site + ' ' + (t || 'poetry'));
    return {
      chillSubs: ddg('chillsubs.com/magazine'),
      pw: ddg('pw.org/literary_magazines'),
      chillSubsBrowse: 'https://www.chillsubs.com/browse/magazines',
      pwOpen: 'https://www.pw.org/open-reading-periods',
    };
  }

  // ---------- quick add: read a journal's guidelines ----------
  // Pulls the details Pen Pal tracks out of a guidelines page (or pasted text). Everything it finds is
  // shown in the journal form to check before saving; anything it cannot find stays blank.
  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const numWord = (w) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[String(w).toLowerCase()] || null);
  const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
  const p2 = (n) => String(n).padStart(2, '0');
  function mdOf(mon, day) {
    const m = MONTHS[mon.toLowerCase().slice(0, 3)];
    const md = m && day ? p2(m) + '-' + p2(Number(day)) : '';
    return MMDD(md);
  }
  function parseGuidelines(text, title) {
    const raw = String(text || '').replace(/\s+/g, ' ').slice(0, 200000);
    const t = raw.toLowerCase();
    const found = [];
    const out = { name: '', windows: [], yearRound: false, fee: null, maxPoems: null, simSubs: 'unknown', pays: 'unknown', paysNote: '', reprints: 'unknown', replyDays: null, found };
    // Name: the page title before " | " or " - ", without words like "Submissions".
    const nm = String(title || '').split(/\s[|\u2013\u2014-]\s|:\s/).map((s) => s.replace(/\b(submissions?|submission guidelines|guidelines|submit|home)\b/gi, '').trim()).filter((s) => s.length > 1);
    if (nm.length) out.name = nm.sort((a, b) => a.length - b.length)[0].slice(0, 120);

    // Reading periods: "September 1 to November 30", "Jan 15 - Mar 1", "from 1 March through 31 May".
    const dayRe = '(\\d{1,2})(?:st|nd|rd|th)?';
    const sep = '\\s*(?:-|\u2013|\u2014|to|through|thru|until|till)\\s*';
    const yr = '(?:,?\\s*\\d{4})?';
    const re1 = new RegExp('\\b' + MON_RE + '\\s+' + dayRe + yr + sep + MON_RE + '\\s+' + dayRe, 'gi');
    const re2 = new RegExp('\\b' + dayRe + '\\s+' + MON_RE + yr + sep + dayRe + '\\s+' + MON_RE, 'gi');
    const seen = new Set();
    const add = (o, c) => { if (o && c && !seen.has(o + c)) { seen.add(o + c); out.windows.push({ opens: o, closes: c }); } };
    let m;
    while ((m = re1.exec(raw)) && out.windows.length < 4) add(mdOf(m[1], m[2]), mdOf(m[3], m[4]));
    while ((m = re2.exec(raw)) && out.windows.length < 4) add(mdOf(m[2], m[1]), mdOf(m[4], m[3]));
    // "the month of September" / "throughout October": a whole month.
    const whole = t.match(new RegExp('(?:during|throughout|the month of|open (?:in|for))\\s+(?:the month of\\s+)?' + MON_RE + '(?![a-z\\s]*\\d)'));
    if (!out.windows.length && whole) {
      const mo = MONTHS[whole[1].slice(0, 3)];
      const last = new Date(Date.UTC(2028, mo, 0)).getUTCDate();
      add(p2(mo) + '-01', p2(mo) + '-' + p2(last));
    }
    if (/\b(year[- ]round|all year|throughout the year|any time of (the )?year|open (at )?all times|rolling basis)\b/.test(t) && !out.windows.length) out.yearRound = true;
    if (out.windows.length) found.push('reading period');
    if (out.yearRound) found.push('open all year');

    // Fee. Only dollar amounts next to the word fee count, so payment amounts are not mistaken for fees.
    if (/\b(no (submission |reading )?fees?|free to submit|never charge|do not charge|don't charge|no charge|fee[- ]free|without a fee|submissions are free)\b/.test(t)) out.fee = 0;
    else {
      const f = t.match(/(?:fee|charge)[^.$]{0,40}\$\s?(\d+(?:\.\d{1,2})?)/) || t.match(/\$\s?(\d+(?:\.\d{1,2})?)\s*(?:submission|reading|processing|administrative|admin|tip jar)?\s*fee/);
      if (f) out.fee = Number(f[1]);
    }
    if (out.fee !== null) found.push('fee');

    // Poems per submission.
    const w = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';
    const pm = t.match(new RegExp('(?:up to|no more than|maximum of|max(?:imum)?|at most|not exceed)\\s+' + w + '\\s+(?:\\w+\\s+){0,2}poems?')) ||
      t.match(new RegExp(w + '\\s*(?:-|\u2013|to)\\s*' + w + '\\s+(?:\\w+\\s+){0,2}poems?')) ||
      t.match(new RegExp('(?:submit|send)\\s+' + w + '\\s+(?:\\w+\\s+){0,2}poems?'));
    if (pm) {
      const nums = pm.slice(1).filter(Boolean).map(numWord).filter((n) => n && n <= 30);
      if (nums.length) { out.maxPoems = Math.max.apply(null, nums); found.push('poems per submission'); }
    }

    // Simultaneous submissions.
    if (/\b(no|not accept(ing)?|do not (accept|consider|allow)|don't (accept|consider|allow)|cannot (accept|consider)|unable to (accept|consider))\s+(any\s+)?simultaneous/.test(t) ||
      /simultaneous submissions? (are|is) not\b/.test(t)) out.simSubs = 'no';
    else if (/simultaneous submissions? (are|is)?\s*(welcome|accepted|encouraged|fine|ok|okay|allowed|considered)|(accept|welcome|consider|allow)s?\s+simultaneous|simultaneous submissions?\s*:\s*yes/.test(t)) out.simSubs = 'yes';
    if (out.simSubs !== 'unknown') found.push('simultaneous submissions');

    // Payment.
    const pay = raw.match(/(?:pay|pays|payment of|honorarium of|honorarium|receive|compensat\w*)[^.$]{0,40}(\$\s?\d+(?:\.\d{1,2})?(?:\s*(?:per|a|\/)\s*(?:poem|page|line|piece|contributor|submission|author))?)/i);
    if (/\b(unable to (offer |provide )?pay|cannot (currently )?pay|can't (currently )?pay|do not (currently )?pay|don't (currently )?pay|no payment|not able to pay|unpaid|we are not a paying)\b/.test(t)) out.pays = 'no';
    else if (pay) { out.pays = 'yes'; out.paysNote = pay[1].replace(/\s+/g, ' '); }
    if (out.pays !== 'unknown') found.push('payment');

    // Reprints.
    if (/\b(no reprints|do not (accept|consider|publish) (reprints|previously published)|don't (accept|consider) (reprints|previously published)|not (accept|consider) (any )?(reprints|previously published)|must be (previously )?unpublished|only (accept|consider) (original,? )?unpublished|previously published (work|poems|pieces)? (is|are|will) not)\b/.test(t)) out.reprints = 'no';
    else if (/\b(reprints (are )?(welcome|accepted|considered)|(accept|consider|welcome)s? reprints|previously published (work|poems)? (is|are) (welcome|fine|ok|accepted))\b/.test(t)) out.reprints = 'yes';
    if (out.reprints !== 'unknown') found.push('reprints');

    // Reply time: "respond within three months", "response time is 6-8 weeks".
    const rm = t.match(new RegExp('(?:respon[ds]e?\\w*|reply|replies|hear back|decision)[^.]{0,50}?' + w + '(?:\\s*(?:-|\u2013|to)\\s*' + w + ')?\\s+(day|week|month)s?'));
    if (rm) {
      const n = numWord(rm[2] || rm[1]);
      const per = { day: 1, week: 7, month: 30 }[rm[3]];
      if (n && per) { out.replyDays = n * per; found.push('reply time'); }
    }
    return out;
  }
  // Fill a journal from what parseGuidelines found (for the journal form, before you save).
  function journalFromGuidelines(g, url, today) {
    const e = normalizeDirEntry({ id: 'x', name: g.name || 'New journal', url, windows: g.windows.map((w) => [w.opens, w.closes]), yearRound: g.yearRound,
      fee: g.fee, maxPoems: g.maxPoems, simSubs: g.simSubs, pays: g.pays, paysNote: g.paysNote, reprints: g.reprints, replyDays: g.replyDays });
    const j = dirToJournal(e, today, '');
    j.dirId = '';
    j.checked = today;
    j.notes = g.pays === 'yes' && g.paysNote ? 'Pays ' + g.paysNote : '';
    return j;
  }

  // ---------- importing journals from a CSV ----------
  // Parses CSV text (quotes, BOM, comma / semicolon / tab) into { headers, rows, delimiter }.
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
    const delimiter = counts[';'] > counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', inQ = false;
    const endCell = () => { row.push(cell); cell = ''; };
    const endRow = () => { endCell(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delimiter) endCell();
      else if (ch === '\n') endRow();
      else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
      else cell += ch;
    }
    if (cell !== '' || row.length) endRow();
    if (!rows.length) return { headers: [], rows: [], delimiter };
    const headers = rows[0].map((h) => h.trim());
    const body = rows.slice(1, 5001).map((r) => {
      const out = r.slice(0, headers.length).map((c) => c.trim());
      while (out.length < headers.length) out.push('');
      return out;
    });
    return { headers, rows: body, delimiter };
  }

  const IMPORT_FIELDS = ['name', 'url', 'opens', 'closes', 'fee', 'maxPoems', 'simSubs', 'notes'];
  // Best guess at which column holds which journal field, by header text. Returns an array
  // aligned with headers: a field name or ''. Each field is used at most once.
  function guessMapping(headers) {
    const rules = [
      ['simSubs', /simul|\bsim\b|sim[\s_-]?sub/],
      ['maxPoems', /^max|max.*(poem|piece|work|submission)|poem.*limit|limit|how many/],
      ['opens', /open|start|begin/],
      ['closes', /clos|deadline|\bend\b|due/],
      ['fee', /fee|cost|price/],
      ['url', /url|website|web site|link|site|guidelines|submission page/],
      ['notes', /note|comment|description|about/],
      ['name', /^name$|journal|magazine|market|publication|press|venue|title|publisher|submitted to/],
    ];
    const mapping = headers.map(() => '');
    const used = new Set();
    headers.forEach((h, i) => {
      const t = String(h).toLowerCase().trim();
      for (const [field, re] of rules) {
        if (!used.has(field) && re.test(t)) { mapping[i] = field; used.add(field); break; }
      }
    });
    return mapping;
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // Reads the date formats people actually type. Numbers are read the US way (month first),
  // unless the first number can only be a day. A date with no year means the next time it comes around.
  function parseFlexibleDate(raw, today) {
    const t = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!t) return '';
    today = today || todayLocal();
    const p2 = (n) => String(n).padStart(2, '0');
    const mk = (y, mo, d) => { const x = y + '-' + p2(mo) + '-' + p2(d); return isDate(x) ? x : ''; };
    const yearless = (mo, d) => {
      const y = Number(today.slice(0, 4));
      const thisYear = mk(y, mo, d);
      if (thisYear && thisYear >= today) return thisYear;
      return mk(y + 1, mo, d) || thisYear;
    };
    let m;
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
      const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return mk(y, +m[1], +m[2]) || mk(y, +m[2], +m[1]);
    }
    const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    if ((m = t.match(new RegExp('^' + mon + ' (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$', 'i')))) {
      return m[3] ? mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : yearless(MONTHS[m[1].toLowerCase()], +m[2]);
    }
    if ((m = t.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)? ' + mon + '(?:,? (\\d{4}))?$', 'i')))) {
      return m[3] ? mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : yearless(MONTHS[m[2].toLowerCase()], +m[1]);
    }
    return '';
  }
  function parseFee(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return null;
    if (/^(free|no fee|none|n\/a|nil)$/i.test(t) || /\bfree\b/i.test(t)) return 0;
    const m = t.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  function parseMaxPoems(raw) {
    const t = String(raw == null ? '' : raw).trim();
    const range = t.match(/(\d+)\s*(?:-|to|–)\s*(\d+)/i);
    if (range) return Math.max(Number(range[1]), Number(range[2]));
    const one = t.match(/\d+/);
    return one && Number(one[0]) > 0 ? Number(one[0]) : null;
  }
  function parseSim(raw) {
    const t = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!t) return 'unknown';
    if (/\b(no|not|n|false|never|disallowed|prohibited|don't|do not)\b/.test(t)) return 'no';
    if (/\b(yes|y|true|ok|okay|allowed|accepted|accept|welcome|fine)\b/.test(t)) return 'yes';
    return 'unknown';
  }
  function cleanUrl(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t || /\s/.test(t)) return '';
    if (/^https?:\/\//i.test(t)) return t;
    return /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) ? 'https://' + t : '';
  }
  const urlKey = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

  // Turns parsed rows into journals ready to add, with a status per row:
  // 'new', 'duplicate' (already tracked, or repeated in the file) or 'skip' (no name).
  function buildImport(parsed, mapping, existing, today) {
    today = today || todayLocal();
    const names = new Set(existing.map((j) => j.name.trim().toLowerCase()));
    const urls = new Set(existing.map((j) => urlKey(j.url)).filter(Boolean));
    return parsed.rows.map((r, i) => {
      const get = (f) => { const c = mapping.indexOf(f); return c < 0 ? '' : String(r[c] || '').trim(); };
      const problems = [], extra = [];
      const name = get('name');
      const rawUrl = get('url'), url = cleanUrl(rawUrl);
      if (rawUrl && !url) { problems.push('Could not use the web address "' + rawUrl + '".'); extra.push('Website: ' + rawUrl); }
      const rawO = get('opens'), rawC = get('closes');
      let opens = parseFlexibleDate(rawO, today), closes = parseFlexibleDate(rawC, today);
      if (rawO && !opens) { problems.push('Could not read the open date "' + rawO + '".'); extra.push('Opens: ' + rawO); }
      if (rawC && !closes) { problems.push('Could not read the close date "' + rawC + '".'); extra.push('Closes: ' + rawC); }
      let repeat = 'none';
      const noYear = (t) => t && !/\b\d{4}\b/.test(t) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2}$/.test(t);
      if (opens && closes && noYear(rawO) && noYear(rawC)) {
        // "Sep 1 to Nov 30" with no years: a yearly window. The close date is the next one coming,
        // and the open date is the most recent one on or before it.
        let o = addYears(opens, Number(closes.slice(0, 4)) - Number(opens.slice(0, 4)));
        if (o > closes) o = addYears(o, -1);
        opens = o;
        repeat = 'yearly';
      } else if (opens && closes && closes < opens) {
        const bumped = addYears(closes, 1);
        if (daysBetween(opens, bumped) <= 400) closes = bumped;
        else { problems.push('The close date is before the open date, so it was left blank.'); extra.push('Closes: ' + rawC); closes = ''; }
      }
      const notes = [get('notes')].concat(extra).filter(Boolean).join('\n');
      const journal = normalizeJournal({
        id: uid(), name, url, opens, closes, repeat, fee: parseFee(get('fee')), maxPoems: parseMaxPoems(get('maxPoems')),
        simSubs: parseSim(get('simSubs')), notes,
      });
      let status = 'new', reason = '';
      if (!name) { status = 'skip'; reason = 'No name.'; }
      else if (names.has(name.toLowerCase()) || (url && urls.has(urlKey(url)))) { status = 'duplicate'; reason = 'Already in your journals.'; }
      if (status === 'new') { names.add(name.toLowerCase()); if (url) urls.add(urlKey(url)); }
      return { line: i + 2, include: status === 'new', status, reason, problems, journal };
    });
  }
  function applyImport(data, rows) {
    let added = 0;
    for (const r of rows) {
      if (r.include && r.status !== 'skip' && r.journal.name) { data.journals.push(r.journal); added++; }
    }
    return added;
  }

  // ---------- importing past submissions from a CSV ----------
  const SUB_FIELDS = ['journal', 'poems', 'sentDate', 'status', 'responseDate', 'fee', 'notes'];
  function guessSubMapping(headers) {
    const rules = [
      ['status', /status|result|outcome|^response$|^decision$/],
      ['responseDate', /(response|reply|replied|decision|returned|heard).*(date|on)|date.*(response|reply|decision|heard)|responded/],
      ['sentDate', /sent|submitted|submission date|^date$|date sub/],
      ['fee', /fee|cost|paid/],
      ['notes', /note|comment/],
      ['poems', /title|piece|poem|work/],
      ['journal', /journal|magazine|market|publication|venue|press|publisher|outlet|where|^name$/],
    ];
    const mapping = headers.map(() => '');
    const used = new Set();
    headers.forEach((h, i) => {
      const t = String(h).toLowerCase().trim();
      for (const [field, re] of rules) {
        if (!used.has(field) && re.test(t)) { mapping[i] = field; used.add(field); break; }
      }
    });
    return mapping;
  }
  // Which kind of file it looks like, from its headings: 'submissions' or 'journals'.
  function guessImportKind(headers) {
    const m = guessSubMapping(headers);
    return m.includes('poems') && (m.includes('status') || m.includes('sentDate')) ? 'submissions' : 'journals';
  }
  function parseSubStatus(raw) {
    const t = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!t || /pend|sent|submitted|waiting|in progress|received|open|out|under review|in review/.test(t)) return { status: 'pending', silent: false, known: true };
    if (/never|lost|no response|no reply|ghost|unanswered|expired|presumed/.test(t)) return { status: 'withdrawn', silent: true, known: true };
    if (/withdr|pulled/.test(t)) return { status: 'withdrawn', silent: false, known: true };
    if (/accept|publish|taken|yes/.test(t)) return { status: 'accepted', silent: false, known: true };
    if (/reject|declin|pass|no thank|not for us|form/.test(t)) return { status: 'rejected', silent: false, known: true };
    return { status: 'pending', silent: false, known: false };
  }
  function splitTitles(raw) {
    return String(raw == null ? '' : raw)
      .split(/\s*(?:;|\||\n|\s\/\s)\s*/)
      .map((t) => t.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim())
      .filter(Boolean)
      .slice(0, 30);
  }
  const subKey = (journalName, sentDate, titles) => journalName.trim().toLowerCase() + '|' + sentDate + '|' + titles.map((t) => t.toLowerCase()).sort().join('/');
  function buildSubImport(parsed, mapping, data, today) {
    today = today || todayLocal();
    const seen = new Set();
    for (const s of data.submissions) {
      const j = journalById(data, s.journalId);
      if (!j) continue;
      seen.add(subKey(j.name, s.sentDate, s.poemIds.map((id) => (poemById(data, id) || { title: '' }).title)));
    }
    const haveJ = new Set(data.journals.map((j) => j.name.trim().toLowerCase()));
    const haveP = new Set(data.poems.map((p) => p.title.trim().toLowerCase()));
    return parsed.rows.map((r, i) => {
      const get = (f) => { const c = mapping.indexOf(f); return c < 0 ? '' : String(r[c] || '').trim(); };
      const problems = [], extra = [];
      const journalName = get('journal');
      const titles = splitTitles(get('poems'));
      const rawSent = get('sentDate'), rawResp = get('responseDate');
      const sentDate = parseFlexibleDate(rawSent, today);
      let responseDate = parseFlexibleDate(rawResp, today);
      if (rawSent && !sentDate) { problems.push('Could not read the date sent "' + rawSent + '".'); extra.push('Sent: ' + rawSent); }
      if (rawResp && !responseDate) { problems.push('Could not read the reply date "' + rawResp + '".'); extra.push('Reply: ' + rawResp); }
      const st = parseSubStatus(get('status'));
      if (!st.known) { problems.push('Could not tell the status "' + get('status') + '", so it comes in as waiting.'); extra.push('Status: ' + get('status')); }
      if (st.silent) extra.push('Marked as never answered in the import.');
      if (st.status === 'pending') responseDate = '';
      const notes = [get('notes')].concat(extra).filter(Boolean).join('\n');
      const sub = { sentDate, status: st.status, responseDate, feePaid: parseFee(get('fee')), notes };
      let status = 'new', reason = '';
      if (!journalName || !titles.length) { status = 'skip'; reason = !journalName ? 'No journal.' : 'No poem titles.'; }
      else {
        const key = subKey(journalName, sentDate, titles);
        if (seen.has(key)) { status = 'duplicate'; reason = 'Already in your submissions.'; }
        else seen.add(key);
      }
      return {
        line: i + 2, include: status === 'new', status, reason, problems, journalName, titles, sub,
        newJournal: !!journalName && !haveJ.has(journalName.toLowerCase()),
        newPoems: titles.filter((t) => !haveP.has(t.toLowerCase())),
      };
    });
  }
  function applySubImport(data, rows) {
    const res = { submissions: 0, journals: 0, poems: 0 };
    const jByName = new Map(data.journals.map((j) => [j.name.trim().toLowerCase(), j]));
    const pByTitle = new Map(data.poems.map((p) => [p.title.trim().toLowerCase(), p]));
    for (const r of rows) {
      if (!r.include || r.status === 'skip') continue;
      let j = jByName.get(r.journalName.toLowerCase());
      if (!j) { j = normalizeJournal({ id: uid(), name: r.journalName }); data.journals.push(j); jByName.set(r.journalName.toLowerCase(), j); res.journals++; }
      const ids = r.titles.map((t) => {
        let p = pByTitle.get(t.toLowerCase());
        if (!p) { p = normalizePoem({ id: uid(), title: t, status: 'ready' }); data.poems.push(p); pByTitle.set(t.toLowerCase(), p); res.poems++; }
        return p.id;
      });
      data.submissions.push(normalizeSubmission(Object.assign({ id: uid(), poemIds: ids, journalId: j.id }, r.sub)));
      res.submissions++;
    }
    return res;
  }

  function toEntriesCSV(data) {
    const header = ['Date sent', 'Press or contest', 'Manuscript', 'Status', 'Deadline', 'Response date', 'Days to response', 'Entry fee', 'Fee paid', 'Notes'];
    const rows = arr(data.entries)
      .slice()
      .sort((a, b) => (b.sentDate || b.deadline || '').localeCompare(a.sentDate || a.deadline || ''))
      .map((e) => {
        const m = manuscriptById(data, e.manuscriptId);
        const wait = !isActiveEntry(e) && e.status !== 'planned' && e.sentDate && e.responseDate ? daysBetween(e.sentDate, e.responseDate) : '';
        return [e.sentDate, e.name, m ? m.title : '(deleted manuscript)', e.status, e.deadline, e.responseDate, wait, e.fee === null ? '' : e.fee, e.feePaid === null ? '' : e.feePaid, e.notes];
      });
    return [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // Acknowledgments-style list: one line per accepted or published poem.
  function publishedList(data) {
    const items = [];
    for (const poem of data.poems) {
      const pl = placement(data, poem.id);
      if (!pl) continue;
      if (pl.kind === 'submission') {
        const r = normalizeRights(poem.rights);
        const when = r.issue || (r.pubDate || pl.sub.responseDate || '').slice(0, 4);
        items.push({ title: poem.title, where: pl.journal ? pl.journal.name : '', when });
      } else {
        items.push({ title: poem.title, where: poem.publishedWhere, when: poem.publishedDate });
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title));
    const text = items
      .map((i) => '"' + i.title + '"' + (i.where ? ', ' + i.where : '') + (i.when ? ' (' + i.when + ')' : '') + '.')
      .join('\n');
    return { items, text };
  }

  return {
    POEM_STATUSES, SUB_STATUSES, SIM_VALUES, REPEATS, MS_KINDS, ENTRY_STATUSES, IMPORT_FIELDS, SUB_FIELDS, YN, RIGHTS_KINDS, THEMES,
    uid, isDate, daysBetween, addDays, addYears, todayLocal,
    emptyData, normalize, normalizePoem, normalizeJournal, normalizeSubmission, normalizeManuscript, normalizeEntry, normalizeSettings, normalizeRights,
    poemById, journalById, manuscriptById, entryById, activePoemIds, acceptedPoemIdsOf, placement, pendingSubsFor, poemState,
    withdrawAlerts, acceptSubmission, setSubmissionStatus, withdrawPoem, removePoem, removeJournal,
    isRecurring, windowsFrom, currentWindow, windowsText, parseWindowsText,
    feeItems, budgetFor, budgetSummary, budgetYear, budgetCheck, setBudget, monthName, addMonths,
    expectedReply, queryReminders, markQueried, snoozeQuery,
    suggestedCredit, rightsReminders,
    normalizeDirEntry, loadDirectory, pickDirectory, dirToJournal, dirState, journalState, searchDirectory, dirIsStale, searchLinks,
    FOCUS, FIND_WHEN, FIND_SORTS, fitsPoem, focusLabel, normalizeFindOpts, findFilterCount, saveFind, removeFind,
    poemMatches, dirChanges, applyDirChanges, dismissDirChanges, parseGuidelines, journalFromGuidelines,
    guessSubMapping, guessImportKind, parseSubStatus, splitTitles, buildSubImport, applySubImport,
    entriesFor, isActiveEntry, manuscriptState, manuscriptSummary, manuscriptWarnings, checkEntry, entryAlerts, setEntryStatus, removeManuscript,
    poemOutcome, poemHistory, nextTargets,
    checkSubmission, upcomingDeadlines, windowAlerts, openNow, staleSubmissions, stats,
    journalStats, responseBuckets, spend,
    snapshot, restoreSnapshot, createHistory, historyRecord, historyUndo, historyRedo,
    backupReminder, markBackupDownloaded, snoozeBackupReminder,
    parseCSV, guessMapping, parseFlexibleDate, parseFee, parseMaxPoems, parseSim, cleanUrl, buildImport, applyImport,
    toICS, toCSV, toEntriesCSV, publishedList,
  };
});
