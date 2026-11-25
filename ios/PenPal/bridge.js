/*
 * Pen Pal for iPhone: the bridge between the Swift screens and public/logic.js.
 * The rules all live in logic.js (shared with the Windows app). This file only calls them,
 * keeps the open document, and shapes results for each screen. Every function that the
 * Swift side reads returns a JSON string. Dates are "YYYY-MM-DD". Poem text is never stored.
 */
(function (g) {
  'use strict';
  const L = g.Logic;
  let DOC = L.emptyData();
  let DIR = { checked: '', journals: [] };
  const PP = {};
  const out = (v) => JSON.stringify(v);
  const META = ['rev', 'saveId', 'savedOn', 'savedAt', 'lineage'];

  // ---------- words ----------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function fmt(d, today) {
    if (!d) return '';
    const s = MON[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10));
    return today && d.slice(0, 4) !== today.slice(0, 4) ? s + ', ' + d.slice(0, 4) : s;
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
  function until(n) { return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days'; }
  function left(n) { return n === 0 ? 'Last day' : n === 1 ? '1 day left' : n + ' days left'; }
  function titlesOf(ids) {
    const t = ids.map((id) => L.poemById(DOC, id)).filter(Boolean).map((p) => p.title);
    return t.length ? t.join(', ') : 'No poems';
  }
  const jname = (id) => { const j = L.journalById(DOC, id); return j ? j.name : '(deleted journal)'; };
  function savedLabel(m) {
    if (!m || !m.savedAt) return '';
    const t = new Date(m.savedAt);
    if (isNaN(t)) return '';
    const h = t.getHours(), mm = String(t.getMinutes()).padStart(2, '0');
    const time = ((h + 11) % 12 + 1) + ':' + mm + (h < 12 ? ' AM' : ' PM');
    return (m.savedOn ? 'on ' + m.savedOn + ', ' : '') + MON[t.getMonth()] + ' ' + t.getDate() + ' at ' + time;
  }

  // Where a journal stands today, for lists and cards.
  function status(j, today) {
    if (j.alwaysOpen) return { kind: 'always', line: 'Open all year', chip: '', tone: 'gray', open: true };
    const w = L.currentWindow(j, today);
    if (!w.opens && !w.closes) return { kind: 'unknown', line: 'No reading dates yet', chip: '', tone: 'gray', open: false };
    const opened = !w.opens || w.opens <= today;
    if (opened && w.closes && w.closes >= today) {
      const n = L.daysBetween(today, w.closes);
      return { kind: 'open', line: 'Open, closes ' + fmt(w.closes, today), chip: left(n), tone: n <= 14 ? 'red' : 'gray', open: true, daysLeft: n, closes: w.closes, opens: w.opens };
    }
    if (opened && !w.closes) return { kind: 'open', line: 'Open', chip: '', tone: 'gray', open: true, daysLeft: null };
    if (w.opens > today) {
      const n = L.daysBetween(today, w.opens);
      const len = w.closes ? L.daysBetween(w.opens, w.closes) + 1 : 0;
      return { kind: 'soon', line: 'Opens ' + fmt(w.opens, today) + (len ? ' for ' + plural(len, 'day') : ''), chip: until(n), tone: n <= 30 ? 'blue' : 'gray', open: false, daysUntil: n, opens: w.opens, closes: w.closes };
    }
    return { kind: 'closed', line: 'Closed since ' + fmt(w.closes, today), chip: '', tone: 'gray', open: false };
  }
  const reminderDates = (journalId, today) =>
    PP._plan(today, 120, []).filter((a) => a.journalId === journalId).map((a) => fmt(a.fire, today));

  // ---------- the document ----------
  PP.load = (json) => { DOC = L.normalize(JSON.parse(json)); return out(PP._meta(DOC)); };
  PP.fresh = () => { DOC = L.emptyData(); return out(PP._meta(DOC)); };
  PP.json = () => JSON.stringify(DOC);
  PP._meta = (d) => ({ rev: Number(d.rev) || 0, saveId: String(d.saveId || ''), savedOn: String(d.savedOn || ''), savedAt: String(d.savedAt || ''), lineage: Array.isArray(d.lineage) ? d.lineage : [] });
  PP.meta = () => out(PP._meta(DOC));
  PP.metaOf = (json) => out(PP._meta(JSON.parse(json)));
  // A save on top of `base` (the file as it is now): the same chain the Windows app keeps.
  PP.stamp = (baseJSON, machine, nowISO, newId) => {
    const b = PP._meta(JSON.parse(baseJSON));
    DOC.lineage = b.lineage.filter((x) => typeof x === 'string').concat(b.saveId ? [b.saveId] : []).slice(-50);
    DOC.saveId = newId;
    DOC.savedOn = machine;
    DOC.savedAt = nowISO;
    DOC.rev = b.rev + 1;
    return JSON.stringify(DOC);
  };
  // Take the content of another version (this iPhone's last save, or a second copy) and save it on top of `base`.
  PP.adopt = (json, baseJSON, machine, nowISO, newId) => {
    const raw = JSON.parse(json);
    for (const k of META) delete raw[k];
    DOC = L.normalize(raw);
    return PP.stamp(baseJSON, machine, nowISO, newId);
  };
  PP.buildsOn = (json, saveId) => {
    const m = PP._meta(JSON.parse(json));
    return !saveId || m.saveId === saveId || m.lineage.indexOf(saveId) >= 0;
  };
  PP.summary = (json) => {
    const d = JSON.parse(json);
    const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
    const m = PP._meta(d);
    return out({ journals: n('journals'), poems: n('poems'), submissions: n('submissions'), saved: savedLabel(m),
      counts: plural(n('journals'), 'journal') + ', ' + plural(n('poems'), 'poem') + ', ' + plural(n('submissions'), 'submission') });
  };
  PP.loadDirectory = (json) => { DIR = L.loadDirectory(JSON.parse(json)); return DIR.journals.length; };

  // ---------- settings ----------
  PP.settings = (today) => {
    const s = L.normalizeSettings(DOC.settings);
    return out({ theme: s.theme, notifyDays: s.notifyDays, deskDays: s.deskDays, followUpDays: s.followUpDays, budget: L.budgetFor(s, today.slice(0, 7)) });
  };
  PP.setSetting = (key, valueJSON) => {
    const patch = {};
    patch[key] = JSON.parse(valueJSON);
    DOC.settings = L.normalizeSettings(Object.assign({}, DOC.settings, patch));
    return true;
  };

  // ---------- Desk ----------
  PP.desk = (today) => {
    const t = new Date(today + 'T12:00:00');
    const needs = [];
    for (const a of L.withdrawAlerts(DOC)) {
      for (const s of a.submissions) {
        needs.push({ id: 'w-' + s.sub.id + '-' + a.poem.id, kind: 'withdraw', label: 'Withdraw', subId: s.sub.id, poemId: a.poem.id,
          text: '"' + a.poem.title + '" was accepted ' + (a.placedAt === 'elsewhere' ? 'elsewhere' : 'by ' + a.placedAt) + '. ' + (s.journal ? s.journal.name : 'A deleted journal') + ' still has it.' });
      }
    }
    for (const x of L.queryReminders(DOC, today)) {
      const why = x.queried ? 'You followed up on ' + fmt(x.queried, today) + ' and have not heard back.'
        : x.basis === 'history' ? 'Your past answers from them took about ' + x.expected + ' days.'
          : x.basis === 'journal' ? 'They usually answer in about ' + x.expected + ' days.'
            : 'That is past the ' + x.expected + ' days you set for following up.';
      needs.push({ id: 'q-' + x.sub.id, kind: 'followup', label: 'Follow up', subId: x.sub.id, poemId: '',
        text: (x.journal ? x.journal.name : 'A deleted journal') + ' has had ' + titlesOf(L.activePoemIds(x.sub)) + ' for ' + x.waiting + ' days. ' + why });
    }
    for (const x of L.rightsReminders(DOC, today)) {
      needs.push({ id: 'r-' + x.poem.id, kind: 'reprint', label: 'Reprint', subId: '', poemId: x.poem.id,
        text: '"' + x.poem.title + '" comes out of its exclusive period on ' + fmt(x.date, today) + '. After that you can offer it as a reprint.' });
    }
    const card = (j, st, detail) => ({ id: j.id, name: j.name, detail, chip: st.chip, tone: st.tone, notify: j.notify });
    const closing = [], open = [], opening = [];
    for (const o of L.openNow(DOC, today)) {
      const st = status(o.journal, today);
      const j = o.journal;
      const bits = [];
      if (j.fee === 0) bits.push('Free'); else if (j.fee) bits.push(money(j.fee) + ' fee');
      if (j.maxPoems) bits.push('up to ' + plural(j.maxPoems, 'poem'));
      if (j.pays === 'yes') bits.push('pays');
      if (st.daysLeft !== null && st.daysLeft !== undefined && st.daysLeft <= 14) {
        closing.push(card(j, st, 'Closes ' + fmt(o.closes, today) + '.' + (bits.length ? ' ' + bits.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.' : '')));
      } else {
        open.push(card(j, st, (o.closes ? 'Until ' + fmt(o.closes, today) + '.' : 'Open all year.') + (j.maxPoems ? ' Up to ' + plural(j.maxPoems, 'poem') + '.' : '')));
      }
    }
    const seen = new Set();
    const s = L.normalizeSettings(DOC.settings);
    for (const e of L.upcomingDeadlines(DOC, today, s.deskDays)) {
      if (e.kind !== 'opens' || seen.has(e.journal.id)) continue;
      seen.add(e.journal.id);
      const st = status(e.journal, today);
      const w = L.currentWindow(e.journal, today);
      const rem = e.journal.notify ? reminderDates(e.journal.id, today)[0] : '';
      opening.push(card(e.journal, st, 'Opens ' + fmt(e.date, today) + (w.closes ? ', closes ' + fmt(w.closes, today) : '') + '.' + (rem ? ' Reminder on ' + rem + '.' : '')));
    }
    const waiting = DOC.submissions.filter((x) => x.status === 'pending')
      .sort((a, b) => (a.sentDate || '').localeCompare(b.sentDate || ''))
      .map((x) => ({ subId: x.id, journal: jname(x.journalId), titles: titlesOf(L.activePoemIds(x)),
        line: x.sentDate ? 'Sent ' + fmt(x.sentDate, today) + ', ' + plural(L.daysBetween(x.sentDate, today), 'day') + ' ago' : 'Sent' }));
    const ym = today.slice(0, 7);
    const b = L.budgetSummary(DOC, ym);
    const fees = { label: 'Fees in ' + MONTH[Number(ym.slice(5, 7)) - 1], spent: money(b.spent),
      budget: b.budget === null ? '' : money(b.budget), left: b.left === null ? '' : b.left >= 0 ? money(b.left) + ' left' : money(-b.left) + ' over', over: b.left !== null && b.left < 0 };
    return out({ dateLabel: DAY[t.getDay()] + ', ' + fmt(today), needs, closing, opening, open, waiting, fees,
      empty: !DOC.journals.length, noPoems: !DOC.poems.length });
  };

  // ---------- journals ----------
  PP.journals = (today, filter, q) => {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rank = { open: 0, soon: 1, always: 2, closed: 3, unknown: 4 };
    const items = DOC.journals.map((j) => ({ j, st: status(j, today) }))
      .filter(({ j, st }) => {
        const hay = (j.name + ' ' + j.notes).toLowerCase();
        if (words.some((w) => !hay.includes(w))) return false;
        if (filter === 'open' && !st.open) return false;
        if (filter === 'bells' && !j.notify) return false;
        if (filter === 'pays' && j.pays !== 'yes') return false;
        return true;
      })
      .sort((a, b) => rank[a.st.kind] - rank[b.st.kind] || (a.st.daysLeft ?? a.st.daysUntil ?? 0) - (b.st.daysLeft ?? b.st.daysUntil ?? 0) || a.j.name.localeCompare(b.j.name))
      .map(({ j, st }) => ({ id: j.id, name: j.name, line: st.line, chip: st.chip, tone: st.tone, pays: j.pays === 'yes', notify: j.notify, always: j.alwaysOpen }));
    return out({ items, count: DOC.journals.length });
  };
  const YNW = { yes: 'Yes', no: 'No', unknown: 'Not noted' };
  PP.journal = (id, today) => {
    const j = L.journalById(DOC, id);
    if (!j) return out(null);
    const st = status(j, today);
    // Reading periods drawn on this year's calendar.
    const y = today.slice(0, 4);
    const yearLen = L.daysBetween(y + '-01-01', (Number(y) + 1) + '-01-01');
    const pos = (d) => Math.max(0, Math.min(1, L.daysBetween(y + '-01-01', d) / yearLen));
    let bars = [], periodsText = '', title = 'Reading period';
    if (L.isRecurring(j)) {
      title = 'Reading periods, every year';
      const temps = [{ opens: j.opens.slice(5), closes: j.closes.slice(5) }].concat(j.extraWindows);
      const seen = new Set();
      const uniq = temps.filter((w) => (seen.has(w.opens + w.closes) ? false : seen.add(w.opens + w.closes))).sort((a, b) => a.opens.localeCompare(b.opens));
      for (const w of uniq) {
        const o = y + '-' + w.opens, c = y + '-' + w.closes;
        if (c >= o) bars.push({ start: pos(o), width: Math.max(0.01, pos(c) - pos(o) + 1 / yearLen) });
        else { bars.push({ start: pos(o), width: 1 - pos(o) }); bars.push({ start: 0, width: pos(c) + 1 / yearLen }); }
      }
      periodsText = L.windowsText(uniq) + '.';
      if (uniq.length > 1) title += ', ' + uniq.length + ' windows';
    } else if (j.opens || j.closes) {
      const o = j.opens || y + '-01-01', c = j.closes || y + '-12-31';
      if (c >= y + '-01-01' && o <= y + '-12-31') bars.push({ start: pos(o < y + '-01-01' ? y + '-01-01' : o), width: Math.max(0.01, pos(c) - pos(o < y + '-01-01' ? y + '-01-01' : o)) });
      periodsText = (j.opens ? fmt(j.opens, today) : 'Open') + ' to ' + (j.closes ? fmt(j.closes, today) : 'no end date') + '.';
    }
    const exp = L.expectedReply(DOC, j);
    const facts = [
      { label: 'Usual reply', value: exp.basis === 'default' ? 'Not noted' : 'About ' + exp.days + ' days' },
      { label: 'Pays', value: YNW[j.pays] },
      { label: 'Sent elsewhere too', value: { yes: 'Allowed', no: 'Not allowed', unknown: 'Not noted' }[j.simSubs] },
      { label: 'Fee', value: j.fee === 0 ? 'Free' : j.fee ? money(j.fee) : 'Not noted' },
      { label: 'Poems at a time', value: j.maxPoems ? 'Up to ' + j.maxPoems : 'Not noted' },
      { label: 'Reprints', value: YNW[j.reprints] },
    ];
    const rem = j.notify ? reminderDates(j.id, today) : [];
    const subs = DOC.submissions.filter((s) => s.journalId === j.id).sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''))
      .map((s) => ({ id: s.id, titles: titlesOf(s.poemIds), line: (s.sentDate ? 'Sent ' + fmt(s.sentDate, today) : 'Sent') + ', ' + STATUS_WORD[s.status].toLowerCase() }));
    const form = { id: j.id, name: j.name, url: j.url, opens: j.opens, closes: j.closes, yearly: j.repeat === 'yearly', always: j.alwaysOpen, notify: j.notify,
      replyDays: j.replyDays ? String(j.replyDays) : '', pays: j.pays, reprints: j.reprints, fee: j.fee === null ? '' : String(j.fee),
      maxPoems: j.maxPoems ? String(j.maxPoems) : '', simSubs: j.simSubs, notes: j.notes, extra: L.windowsText(j.extraWindows) };
    return out({ id: j.id, name: j.name, url: j.url, notes: j.notes, notify: j.notify, always: j.alwaysOpen, line: st.line, chip: st.chip || st.line, tone: st.tone,
      hasDates: bars.length > 0, bars, todayPos: pos(today), periodsTitle: title, periodsText,
      facts, remindText: rem.length ? rem.slice(0, 3).join(' and ') + ', 9 AM' : '', subs, form, open: st.open });
  };
  PP.blankJournal = () => out({ id: '', name: '', url: '', opens: '', closes: '', yearly: false, always: false, notify: false, replyDays: '', pays: 'unknown',
    reprints: 'unknown', fee: '', maxPoems: '', simSubs: 'unknown', notes: '', extra: '' });
  PP.saveJournal = (formJSON) => {
    const f = JSON.parse(formJSON);
    if (!String(f.name || '').trim()) return out({ id: '', error: 'Give the journal a name.' });
    const ex = L.parseWindowsText(f.extra || '');
    if (ex.bad.length) return out({ id: '', error: 'Pen Pal could not read these windows: ' + ex.bad.join('; ') + '. Write them like "Jan 15 to Mar 1".' });
    if (f.opens && f.closes && f.closes < f.opens) return out({ id: '', error: 'The closing date is before the opening date.' });
    const fields = { name: f.name, url: L.cleanUrl(f.url || ''), opens: f.always ? '' : f.opens, closes: f.always ? '' : f.closes, repeat: f.yearly ? 'yearly' : 'none',
      alwaysOpen: !!f.always, notify: !!f.notify, extraWindows: f.yearly ? ex.windows : [], replyDays: f.replyDays, pays: f.pays, reprints: f.reprints,
      fee: f.fee === '' ? null : L.parseFee(f.fee), maxPoems: f.maxPoems === '' ? null : f.maxPoems, simSubs: f.simSubs, notes: f.notes };
    const existing = f.id ? L.journalById(DOC, f.id) : null;
    if (existing) { Object.assign(existing, L.normalizeJournal(Object.assign({}, existing, fields, { id: existing.id }))); return out({ id: existing.id, error: '' }); }
    const j = L.normalizeJournal(Object.assign({ id: L.uid() }, fields));
    DOC.journals.push(j);
    return out({ id: j.id, error: '' });
  };
  PP.setNotify = (id, on) => { const j = L.journalById(DOC, id); if (j) j.notify = !!on; return !!j; };
  PP.removeJournal = (id) => out(L.removeJournal(DOC, id));

  // ---------- the directory that ships with the app ----------
  PP.directory = (q, today) => {
    const rows = L.searchDirectory(DIR, DOC, { q }, today);
    return out({ checked: fmt(DIR.checked), total: DIR.journals.length, items: rows.map((r) => {
      const st = r.state;
      const line = st.kind === 'open' ? 'Open, closes ' + fmt(st.closes, today) : st.kind === 'soon' || st.kind === 'closed' ? 'Opens ' + fmt(st.opens, today)
        : st.kind === 'always' ? 'Open all year' : 'Reading dates not known';
      const chip = st.kind === 'open' ? left(st.daysLeft) : st.kind === 'soon' ? until(st.daysUntil) : '';
      const e = r.entry;
      const facts = [e.fee === 0 ? 'Free' : e.fee ? money(e.fee) + ' fee' : '', e.pays === 'yes' ? 'Pays' : '', e.simSubs === 'yes' ? 'Simultaneous OK' : ''].filter(Boolean).join(' · ');
      return { dirId: e.id, name: e.name, line, chip, tone: st.kind === 'open' && st.daysLeft <= 14 ? 'red' : st.kind === 'soon' ? 'blue' : 'gray',
        facts, note: e.note, mineId: r.mine ? r.mine.id : '', url: e.url };
    }) });
  };
  PP.addFromDirectory = (dirId, today) => {
    const e = DIR.journals.find((x) => x.id === dirId);
    if (!e) return '';
    const j = L.dirToJournal(e, today, DIR.checked);
    DOC.journals.push(j);
    return j.id;
  };

  // ---------- poems ----------
  const STATE_ORDER = { ready: 0, draft: 1, out: 2, published: 3 };
  function poemLine(p, today) {
    const st = L.poemState(DOC, p);
    if (st === 'published') {
      const pl = L.placement(DOC, p.id);
      return { state: st, label: 'Published' + (pl && pl.kind === 'submission' && pl.journal ? ' in ' + pl.journal.name : p.publishedWhere ? ' in ' + p.publishedWhere : '') };
    }
    if (st === 'out') {
      const n = L.pendingSubsFor(DOC, p.id).length;
      return { state: st, label: 'Out at ' + plural(n, 'journal') };
    }
    return { state: st, label: st === 'ready' ? 'Ready to send' : 'Draft' };
  }
  PP.poems = (q, today) => {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return out(DOC.poems.filter((p) => !words.some((w) => !(p.title + ' ' + p.notes).toLowerCase().includes(w)))
      .map((p) => Object.assign({ id: p.id, title: p.title, notes: p.notes }, poemLine(p, today)))
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.title.localeCompare(b.title)));
  };
  PP.poem = (id, today) => {
    const p = L.poemById(DOC, id);
    if (!p) return out(null);
    const history = DOC.submissions.filter((s) => s.poemIds.includes(id)).sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''))
      .map((s) => ({ id: s.id, journal: jname(s.journalId),
        line: (s.sentDate ? fmt(s.sentDate, today) : 'Undated') + ', ' + (s.withdrawnPoemIds.includes(id) ? 'withdrawn' : L.acceptedPoemIdsOf(s).includes(id) ? 'accepted' : STATUS_WORD[s.status].toLowerCase()) }));
    return out(Object.assign({ id: p.id, title: p.title, status: p.status, notes: p.notes, history }, poemLine(p, today)));
  };
  PP.savePoem = (json) => {
    const f = JSON.parse(json);
    const title = String(f.title || '').trim();
    if (!title) return out({ id: '', error: 'Give the poem a title.' });
    const existing = f.id ? L.poemById(DOC, f.id) : null;
    if (existing) { Object.assign(existing, L.normalizePoem(Object.assign({}, existing, { title, status: f.status, notes: f.notes }))); return out({ id: existing.id, error: '' }); }
    if (DOC.poems.some((p) => p.title.toLowerCase() === title.toLowerCase())) return out({ id: '', error: 'You already have a poem called "' + title + '".' });
    const p = L.normalizePoem({ id: L.uid(), title, status: f.status, notes: f.notes });
    DOC.poems.push(p);
    return out({ id: p.id, error: '' });
  };
  PP.addTitles = (text, status) => {
    const have = new Set(DOC.poems.map((p) => p.title.toLowerCase()));
    let n = 0;
    for (const raw of String(text || '').split('\n')) {
      const title = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
      if (!title || have.has(title.toLowerCase())) continue;
      have.add(title.toLowerCase());
      DOC.poems.push(L.normalizePoem({ id: L.uid(), title, status: status || 'draft' }));
      n++;
    }
    return n;
  };
  PP.removePoem = (id) => out(L.removePoem(DOC, id));

  // ---------- sending poems ----------
  PP.journalPicker = (today) => out(DOC.journals.map((j) => ({ j, st: status(j, today) }))
    .sort((a, b) => (b.st.open - a.st.open) || a.j.name.localeCompare(b.j.name))
    .map(({ j, st }) => ({ id: j.id, name: j.name, line: st.line })));
  PP.sendForm = (journalId, today) => {
    const j = L.journalById(DOC, journalId);
    if (!j) return out(null);
    const st = status(j, today);
    const bits = [st.line + '.'];
    if (j.maxPoems) bits.push('Up to ' + plural(j.maxPoems, 'poem') + '.');
    const poems = DOC.poems.map((p) => Object.assign({ id: p.id, title: p.title }, poemLine(p, today)))
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.title.localeCompare(b.title))
      .map((p) => Object.assign(p, { blocked: p.state === 'published' }));
    return out({ journal: { id: j.id, name: j.name, line: bits.join(' ') }, poems, max: j.maxPoems || null, fee: j.fee === null ? '' : String(j.fee) });
  };
  PP.sendCheck = (json, today) => {
    const d = JSON.parse(json);
    const draft = { poemIds: d.poemIds || [], journalId: d.journalId, sentDate: d.sentDate || today, feePaid: d.feePaid };
    const warn = L.checkSubmission(DOC, draft, today).map((w) => w.replace(/closed on (\d{4}-\d{2}-\d{2})/, (m, x) => 'closed on ' + fmt(x, today)).replace(/until (\d{4}-\d{2}-\d{2})/, (m, x) => 'until ' + fmt(x, today)));
    const ok = [];
    const j = L.journalById(DOC, d.journalId);
    if (j && draft.poemIds.length) {
      if (j.maxPoems && draft.poemIds.length <= j.maxPoems) ok.push(plural(draft.poemIds.length, 'poem') + ' is within ' + j.name + "'s limit of " + j.maxPoems + '.');
      const exp = L.expectedReply(DOC, j);
      const when = fmt(L.addDays(draft.sentDate, exp.days), today);
      ok.push(exp.basis === 'default' ? 'Pen Pal will suggest a follow-up after ' + exp.days + ' days, around ' + when + '.'
        : 'They usually answer in about ' + exp.days + ' days. Pen Pal will suggest a follow-up around ' + when + '.');
    }
    return out({ ok, warn });
  };
  PP.logSubmission = (json) => {
    const d = JSON.parse(json);
    if (!L.journalById(DOC, d.journalId)) return out({ id: '', error: 'Pick a journal.' });
    if (!(d.poemIds || []).length) return out({ id: '', error: 'Pick at least one poem.' });
    const s = L.normalizeSubmission({ id: L.uid(), status: 'pending', journalId: d.journalId, poemIds: d.poemIds, sentDate: d.sentDate, feePaid: d.feePaid === '' ? null : L.parseFee(String(d.feePaid)), notes: d.notes || '' });
    DOC.submissions.push(s);
    return out({ id: s.id, error: '' });
  };

  // ---------- what's out ----------
  const STATUS_WORD = { pending: 'Waiting', accepted: 'Accepted', rejected: 'Declined', withdrawn: 'Withdrawn' };
  PP.subs = (today) => {
    const row = (s) => ({ id: s.id, journal: jname(s.journalId), journalId: s.journalId, titles: titlesOf(L.activePoemIds(s)), status: s.status, statusLabel: STATUS_WORD[s.status],
      line: s.status === 'pending' ? (s.sentDate ? 'Sent ' + fmt(s.sentDate, today) + ', ' + plural(L.daysBetween(s.sentDate, today), 'day') + ' waiting' : 'Waiting')
        : STATUS_WORD[s.status] + (s.responseDate ? ' ' + fmt(s.responseDate, today) : ''),
      poems: s.poemIds.map((id) => ({ id, title: (L.poemById(DOC, id) || { title: '(deleted poem)' }).title, withdrawn: s.withdrawnPoemIds.includes(id) })) });
    const pending = DOC.submissions.filter((s) => s.status === 'pending').sort((a, b) => (a.sentDate || '').localeCompare(b.sentDate || '')).map(row);
    const done = DOC.submissions.filter((s) => s.status !== 'pending').sort((a, b) => (b.responseDate || b.sentDate || '').localeCompare(a.responseDate || a.sentDate || '')).map(row);
    return out({ pending, done });
  };
  PP.setSubStatus = (id, st, today) => {
    const alerts = L.setSubmissionStatus(DOC, id, st, today);
    const lines = [];
    for (const a of alerts) for (const s of a.submissions) lines.push('"' + a.poem.title + '" is still out at ' + (s.journal ? s.journal.name : 'a deleted journal') + '. Withdraw it there.');
    return out(lines);
  };
  PP.withdraw = (subId, poemId, today) => { L.withdrawPoem(DOC, subId, poemId, today); return true; };
  PP.markQueried = (id, today) => { L.markQueried(DOC, id, today); return true; };
  PP.snooze = (id, today) => { L.snoozeQuery(DOC, id, today, 30); return true; };
  PP.removeSub = (id) => { DOC.submissions = DOC.submissions.filter((s) => s.id !== id); return true; };

  // ---------- reminders on this iPhone ----------
  // Each reminder from logic.js's windowAlerts, on the first day it is due: that is when the notification fires.
  // `skip` holds keys already shown somewhere (reminders-sent.json, shared with the PCs).
  PP._plan = (today, horizon, skip) => {
    const first = {};
    for (let i = 0; i <= horizon; i++) {
      const day = L.addDays(today, i);
      for (const a of L.windowAlerts(DOC, day)) if (!(a.key in first)) first[a.key] = Object.assign({}, a, { fire: day });
    }
    const s = new Set(skip || []);
    return Object.keys(first).map((k) => first[k]).filter((a) => !s.has(a.key)).sort((a, b) => a.fire.localeCompare(b.fire) || a.key.localeCompare(b.key));
  };
  PP.reminderPlan = (today, horizon, skipJSON) =>
    out(PP._plan(today, horizon, JSON.parse(skipJSON || '[]')).map((a) => ({ key: a.key, title: a.title, body: a.body, fire: a.fire, date: a.date, journalId: a.journalId })));

  g.PP = PP;
})(this);
