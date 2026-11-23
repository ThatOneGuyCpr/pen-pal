/* Pen Pal: the page. All rules live in logic.js; this file draws things and saves. */
(function () {
  'use strict';
  const L = window.Logic;

  let data = null;
  let tab = 'desk';
  let dir = { checked: '', about: '', journals: [] };
  let info = { dataFolder: '', desktop: false, version: '' };
  let server = { folder: '', folderSet: false, lastCopyOk: null, lastCopyAt: '', lastError: '' };
  const hist = L.createHistory(50);
  let lastSnap = '';
  const ui = {
    subFilter: 'pending', poemFilter: 'all', poemQuery: '',
    findQuery: '', findSel: '', find: { openSoon: true, sim: false, free: false, pays: false, reprints: false, notSent: false },
    budgetYear: Number(L.todayLocal().slice(0, 4)),
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => L.todayLocal();

  function fmtDate(s) {
    if (!s) return '';
    return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function rel(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    return 'in ' + n + ' days';
  }
  const money = (n) => (n === null || n === undefined ? '' : '$' + (Number.isInteger(n) ? n : n.toFixed(2)));
  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : '';
  }
  const q = (t) => '“' + t + '”'; // curly quotes around a title

  const POEM_LABEL = { draft: 'Draft', ready: 'Ready', out: 'Out', published: 'Published' };
  const SUB_LABEL = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
  const chip = (cls, label) => '<span class="chip chip-' + cls + '">' + esc(label) + '</span>';

  // ---------------------------------------------------------------- saving
  let saving = false, dirty = false, conflict = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let saveText = '', saveBad = false;
  function setStatus(text, bad) {
    saveText = text;
    saveBad = !!bad;
    const el = $('#saveState');
    if (el) { el.textContent = text; el.className = bad ? 'bad' : ''; }
  }
  function markDirty() {
    dirty = true;
    setStatus('Saving…');
    pump();
  }
  async function pump() {
    if (saving || conflict) return;
    saving = true;
    while (dirty && !conflict) {
      dirty = false;
      try {
        const r = await fetch('/api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Pen-Pal': '1' },
          body: JSON.stringify(data),
        });
        if (r.status === 409) {
          conflict = true;
          $('#banner').innerHTML =
            'Pen Pal was changed in another window, so your last edit here was not saved. ' +
            '<button class="small" id="reloadBtn">Reload the latest version</button>';
          $('#reloadBtn').onclick = () => location.reload();
          setStatus('Not saved', true);
          break;
        }
        if (!r.ok) {
          let msg = r.status;
          try { msg = (await r.json()).error || msg; } catch (e) { /* ignore */ }
          throw new Error(msg);
        }
        data.rev = (await r.json()).rev;
        if (!dirty) setStatus('Saved on this PC');
        refreshServer();
      } catch (e) {
        dirty = true;
        setStatus('Not saved (' + e.message + '). Retrying…', true);
        await sleep(3000);
      }
    }
    saving = false;
  }
  // The desktop window asks this before closing, so a save in flight can finish.
  window.PenPal = { busy: () => dirty || saving };
  window.addEventListener('beforeunload', (e) => {
    if (dirty || saving) { e.preventDefault(); e.returnValue = ''; }
  });
  // Call after changing `data`. The label is what Undo will say it undid.
  function commit(label) {
    const now = L.snapshot(data);
    if (now !== lastSnap) {
      L.historyRecord(hist, lastSnap, label || 'the last change');
      lastSnap = now;
    }
    render();
    markDirty();
  }
  // For settings-type changes (backup reminders) that should not be undoable.
  function commitQuiet() {
    lastSnap = L.snapshot(data);
    render();
    markDirty();
  }
  function syncUndoButtons() {
    const u = $('#undoBtn'), r = $('#redoBtn');
    if (!u) return;
    const past = hist.past[hist.past.length - 1], fut = hist.future[hist.future.length - 1];
    u.disabled = !past;
    r.disabled = !fut;
    u.title = past ? 'Undo: ' + past.label + ' (Ctrl+Z)' : 'Nothing to undo';
    r.title = fut ? 'Redo: ' + fut.label + ' (Ctrl+Y)' : 'Nothing to redo';
  }
  function stepHistory(redo) {
    const e = (redo ? L.historyRedo : L.historyUndo)(hist, L.snapshot(data));
    if (!e) return;
    data = L.restoreSnapshot(e.json, data.rev);
    lastSnap = L.snapshot(data);
    render();
    markDirty();
    toast((redo ? 'Redid: ' : 'Undid: ') + e.label);
  }

  async function refreshServer() {
    try {
      const r = await fetch('/api/settings');
      if (!r.ok) return;
      const b = await r.json();
      const was = server.lastCopyOk;
      server = { folder: b.backupFolder || '', folderSet: !!b.backupFolder, lastCopyOk: b.mirror ? b.mirror.ok : null, lastCopyAt: b.mirror ? b.mirror.when : '', lastError: b.mirror ? b.mirror.error : '' };
      if (was !== server.lastCopyOk) render();
    } catch (e) { /* the server answers /api/data too; settings are optional */ }
  }

  // ---------------------------------------------------------------- small UI helpers
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed. Select the text and copy it by hand.'); }
      ta.remove();
    }
  }
  // Returns true once the file is saved (or handed to the browser).
  async function download(name, text, type) {
    const api = window.pywebview && window.pywebview.api;
    if (api && api.save_file) {
      try {
        const where = await api.save_file(name, text);
        if (where) toast('Saved to ' + where);
        return !!where;
      } catch (e) {
        toast('Could not save the file: ' + e);
        return false;
      }
    }
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  }
  function openDialog(html, onSubmit, onOpen) {
    const dlg = $('#dlg');
    if (dlg.open) dlg.close();
    dlg.classList.remove('wide');
    dlg.innerHTML = '<form id="dlgForm">' + html + '</form>';
    const form = $('#dlgForm');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const res = onSubmit ? onSubmit(new FormData(form), ev.submitter ? ev.submitter.value : '', form) : true;
      if (res !== false) dlg.close();
    });
    form.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) dlg.close();
    });
    dlg.showModal();
    if (onOpen) onOpen(form);
  }
  function infoDialog(title, bodyHtml, buttonLabel) {
    openDialog(
      '<h2>' + esc(title) + '</h2>' + bodyHtml +
      '<div class="actions"><span class="grow"></span><button class="primary" type="button" data-close>' + esc(buttonLabel || 'OK') + '</button></div>'
    );
  }
  const setErr = (form, msg) => { $('#dlgErr', form).textContent = msg; return false; };
  const actionsHtml = (opts) =>
    '<div class="err" id="dlgErr" role="alert"></div><div class="actions">' +
    (opts.del ? '<button class="danger" type="submit" value="delete" formnovalidate>Delete</button>' : '') +
    '<span class="grow"></span><button type="button" data-close>Cancel</button>' +
    '<button class="primary" type="submit" value="save">' + esc(opts.save || 'Save') + '</button></div>';

  // ---------------------------------------------------------------- views
  const ICON = {
    desk: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
    find: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4.5 4.5"/>',
    journals: '<path d="M4 5.5C6.5 4.5 9 4.5 12 6c3-1.5 5.5-1.5 8-.5V19c-2.5-1-5-1-8 .5-3-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
    poems: '<path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z"/><path d="M13.5 7.3l3.2 3.2"/>',
    subs: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    books: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3"/><path d="M9 11h6M9 14.5h6"/>',
    budget: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9"/><path d="M14.6 9.6c-.4-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.6 5.3 1.3 5.3 3.9 0 1.1-1.2 1.9-2.7 1.9-1.3 0-2.3-.5-2.7-1.4"/>',
    insights: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    import: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M4 15v4.5h16V15"/>',
    export: '<path d="M12 14V3M7.5 7.5L12 3l4.5 4.5"/><path d="M4 15v4.5h16V15"/>',
  };
  const icon = (k, size) => '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>';
  const APPMARK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="5" width="21" height="14" rx="2" fill="currentColor"/><path d="M2.5 6.5l9.5 6.8 9.5-6.8" fill="none" stroke="var(--side)" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.5 16.5h4.5" stroke="var(--red)" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const TABS = [
    ['desk', 'Desk'],
    ['find', 'Find journals'],
    ['journals', 'My journals'],
    ['poems', 'Poems'],
    ['subs', 'Submissions'],
    ['books', 'Manuscripts'],
    ['budget', 'Fee budget'],
    ['insights', 'Insights'],
    ['calendar', 'Calendar'],
    ['import', 'Import'],
    ['export', 'Export and backup'],
  ];
  function navCount(k) {
    if (k === 'journals') return data.journals.length || '';
    if (k === 'poems') return data.poems.length || '';
    if (k === 'subs') { const n = data.submissions.filter((s) => s.status === 'pending').length; return n ? n + ' out' : ''; }
    if (k === 'books') return data.manuscripts.length || '';
    return '';
  }
  function backupLine() {
    if (server.folderSet && server.lastCopyOk === false) return ['Second copy failed. See Export.', true];
    if (server.folderSet && server.lastCopyOk) return ['Also copied to your second folder', false];
    if (server.folderSet) return ['Second folder set', false];
    return [data.settings.lastBackupDownload ? 'Backup file saved ' + fmtDate(data.settings.lastBackupDownload) : 'No second copy yet', false];
  }
  function render() {
    const [bl, bad] = backupLine();
    $('#nav').innerHTML = '<div class="brand">' + APPMARK + '<span>Pen Pal</span></div>' +
      TABS.map((t) => '<button class="navitem" data-tab="' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '><span class="dot"></span>' +
        icon(t[0]) + '<span>' + t[1] + '</span>' + (navCount(t[0]) !== '' ? '<span class="count">' + navCount(t[0]) + '</span>' : '') + '</button>').join('') +
      '<div class="navfoot"><span id="saveState" role="status" aria-live="polite" class="' + (saveBad ? 'bad' : '') + '">' + esc(saveText) + '</span>' +
      '<span id="backupState" class="' + (bad ? 'bad' : '') + '">' + esc(bl) + '</span></div>';
    const v = { desk: viewDesk, find: viewFind, subs: viewSubs, poems: viewPoems, journals: viewJournals, books: viewBooks, budget: viewBudget, insights: viewInsights, calendar: viewCalendar, import: viewImport, export: viewExport }[tab];
    $('#view').innerHTML = v();
    syncUndoButtons();
  }
  function pageHead(kicker, title, buttons) {
    return '<header class="pagehead"><div><span class="kicker">' + esc(kicker) + '</span><h1>' + esc(title) + '</h1></div>' +
      (buttons ? '<div class="btnrow">' + buttons + '</div>' : '') + '</header>';
  }

  function titlesOf(ids) {
    return ids.map((id) => { const p = L.poemById(data, id); return p ? q(p.title) : '(deleted poem)'; }).join(', ');
  }
  function journalName(id) {
    const j = L.journalById(data, id);
    return j ? j.name : '(deleted journal)';
  }

  function deadlineChip(e) {
    return e.kind === 'closes' ? chip('red', 'Closes') : e.kind === 'deadline' ? chip('red', 'Entry deadline') : chip('open', 'Opens');
  }

  // ----- Desk
  const longDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
  const dueWords = (n) => (n === 0 ? 'today' : n > 0 ? 'in ' + n + ' day' + (n === 1 ? '' : 's') : -n + ' day' + (n === -1 ? '' : 's') + ' ago');
  function needRow(tag, kind, html, buttons) {
    return '<li><div class="tagcol">' + chip(kind, tag) + '</div><div class="what"><div>' + html + '</div><div class="btnrow">' + buttons + '</div></div></li>';
  }
  const sbtn = (label, act, attrs, primary) => '<button class="small' + (primary ? ' primary' : '') + '" data-act="' + act + '"' + (attrs || '') + '>' + esc(label) + '</button>';
  const attr = (k, v) => ' data-' + k + '="' + esc(v) + '"';
  function viewDesk() {
    const t = today();
    let html = pageHead(longDate(t), 'Your desk',
      '<button data-tab="find">' + icon('find', 16) + 'Find journals</button><button class="primary" data-act="new-sub">Log a submission</button>');
    if (!data.poems.length) {
      html += '<section class="card note"><h2>Start here</h2><ol style="margin:0 0 12px;padding-left:20px">' +
        '<li><b>Poems:</b> add your titles. Titles and notes only, never the poems themselves.</li>' +
        '<li><b>Find journals:</b> browse the directory and add places you like, or import a list.</li>' +
        '<li><b>Submissions:</b> log each time you send poems out. Pen Pal does the remembering.</li></ol>' +
        '<div class="btnrow"><button class="primary" data-act="bulk-poems">Add my poem titles</button><button data-tab="import">Import my history</button></div></section>';
    }

    // what needs doing
    const rows = [];
    for (const a of L.withdrawAlerts(data)) {
      for (const s of a.submissions) {
        const jn = s.journal ? s.journal.name : '(deleted journal)';
        rows.push(needRow('Withdraw', 'red',
          '<b>' + esc(q(a.poem.title)) + '</b> was accepted ' + (a.placedAt === 'elsewhere' ? 'elsewhere' : 'by ' + esc(a.placedAt)) + '. ' + esc(jn) + ' still has it' +
          (s.sub.sentDate ? ' <span class="sub">(sent ' + fmtDate(s.sub.sentDate) + ')</span>' : '') + '.' +
          (s.multiPoem ? ' <span class="sub">Only this poem comes out; the rest of that submission stays.</span>' : ''),
          sbtn('Copy note', 'copy-withdraw', attr('sub', s.sub.id) + attr('poem', a.poem.id)) + sbtn('Mark withdrawn', 'withdraw', attr('sub', s.sub.id) + attr('poem', a.poem.id), true)));
      }
    }
    for (const a of L.entryAlerts(data)) {
      for (const e of a.entries) {
        rows.push(needRow('Withdraw', 'red', '<b>' + esc(q(a.manuscript.title)) + '</b> was accepted by ' + esc(a.acceptedAt) + '. ' + esc(e.name) + ' still has it.',
          sbtn('Copy note', 'copy-withdraw-entry', attr('id', e.id)) + sbtn('Mark withdrawn', 'withdraw-entry', attr('id', e.id), true)));
      }
    }
    for (const x of L.queryReminders(data, t)) {
      const jn = x.journal ? x.journal.name : '(deleted journal)';
      const why = x.queried ? 'You followed up on ' + fmtDate(x.queried) + ' and have not heard back.'
        : x.basis === 'history' ? 'Your past answers from them took about ' + x.expected + ' days.'
          : x.basis === 'journal' ? 'They say they usually answer in about ' + x.expected + ' days.'
            : 'That is past the usual 90 days.';
      rows.push(needRow('Follow up', 'blue', esc(jn) + ' has had <b>' + esc(titlesOf(L.activePoemIds(x.sub))) + '</b> for ' + x.waiting + ' days. ' + esc(why),
        sbtn('Copy query', 'copy-query', attr('id', x.sub.id)) + sbtn('I followed up', 'queried', attr('id', x.sub.id)) + sbtn('Snooze', 'snooze-query', attr('id', x.sub.id)) + sbtn('Update', 'status-sub', attr('id', x.sub.id))));
    }
    for (const x of L.rightsReminders(data, t)) {
      rows.push(needRow('Reprint', 'muted', '<b>' + esc(q(x.poem.title)) + '</b> comes out of its exclusive period' + (x.placedAt ? ' with ' + esc(x.placedAt) : '') +
        ' on ' + fmtDate(x.date) + ' (' + dueWords(x.daysAway) + '). After that you can offer it as a reprint where they take them.',
        sbtn('Open poem', 'poem-history', attr('id', x.poem.id))));
    }
    const nudge = L.backupReminder(data, t, server);
    if (nudge) {
      const msg = nudge.kind === 'never' ? 'You have not saved a backup file yet, and there is no second copy of your data.'
        : nudge.kind === 'stale' ? 'Your last backup file was ' + nudge.days + ' days ago.'
          : 'The copy to your second folder failed' + (nudge.error ? ': ' + nudge.error : '.') + ' Your data is still saved on this PC.';
      rows.push(needRow('Backup', 'muted', esc(msg), sbtn('Back up', 'go-export') + sbtn('Remind me in 90 days', 'snooze-backup')));
    }
    let left = '<section class="card"><div class="cardhead"><h2>Needs you</h2><span class="sub">' + (rows.length ? rows.length + ' thing' + (rows.length === 1 ? '' : 's') : '') + '</span></div>' +
      (rows.length ? '<ul class="needs">' + rows.join('') + '</ul>' : '<p class="quiet-line">Nothing needs you right now.</p>') + '</section>';

    const soon = L.upcomingDeadlines(data, t, 60);
    left += '<section class="card"><div class="cardhead"><h2>Coming up</h2><span class="sub">next 60 days</span></div>' +
      (soon.length ? '<ul class="uplist">' + soon.map((e) => {
        const wd = new Date(e.date + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
        const md = new Date(e.date + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
        const note = e.kind === 'deadline' ? (e.entry.fee ? money(e.entry.fee) + ' fee' : rel(e.daysAway)) : e.recurring && e.kind === 'opens' ? 'every year' : rel(e.daysAway);
        const btn = e.kind === 'closes' ? sbtn('Send poems', 'new-sub', attr('journal', e.journal.id)) : e.kind === 'deadline' ? sbtn('Open', 'edit-entry', attr('id', e.entry.id)) : '';
        return '<li><div class="d">' + md + '<span>' + wd + '</span></div><div>' + deadlineChip(e) + '</div><div class="n">' + esc(e.name) + ' <span class="sub" style="font-weight:400">' + esc(note) + '</span></div><div>' + btn + '</div></li>';
      }).join('') + '</ul>' : '<p class="quiet-line">Nothing opens, closes or is due in the next 60 days. Dates come from your journals and manuscript entries.</p>') + '</section>';

    // right column: budget and what is out
    const year = Number(t.slice(0, 4));
    const b = L.budgetSummary(data, year);
    let right = '<section class="card"><div class="cardhead"><h2>Fee budget</h2><span class="sub">' + year + '</span></div>';
    if (b.budget !== null) {
      const pct = (n) => Math.min(100, (n / Math.max(b.budget, 0.01)) * 100).toFixed(1) + '%';
      right += '<div style="display:flex;align-items:baseline;gap:8px"><span class="big">' + (money(b.spent) || '$0') + '</span><span class="sub">of ' + money(b.budget) + '</span></div>' +
        '<div class="meter" role="img" aria-label="' + esc((money(b.spent) || '$0') + ' spent' + (b.planned ? ', ' + money(b.planned) + ' planned' : '') + ', of ' + money(b.budget)) + '">' +
        '<span class="spent" style="width:' + pct(b.spent) + '"></span>' + (b.countPlanned && b.planned ? '<span class="planned" style="left:' + pct(b.spent) + ';width:' + pct(b.planned) + '"></span>' : '') + '</div>' +
        '<p style="margin:0;font-size:13.5px">' + (b.left >= 0 ? money(b.left) + ' left' : money(-b.left) + ' over') + (b.planned && b.countPlanned ? ', counting ' + money(b.planned) + ' in planned entries.' : '.') + '</p>';
    } else {
      right += '<p style="margin:0 0 10px">' + (money(b.spent) || '$0') + ' spent on fees so far this year.</p><button class="small" data-tab="budget">Set a yearly budget</button>';
    }
    right += '</section>';
    const out = data.poems.map((p) => ({ p, subs: L.pendingSubsFor(data, p.id) })).filter((x) => x.subs.length);
    const journalsOut = new Set(data.submissions.filter((s) => s.status === 'pending').map((s) => s.journalId)).size;
    const acceptedThisYear = data.submissions.filter((s) => s.status === 'accepted' && (s.responseDate || '').slice(0, 4) === String(year)).length;
    const outRows = [];
    for (const x of out) for (const s of x.subs) outRows.push({ title: x.p.title, where: journalName(s.journalId), days: s.sentDate ? L.daysBetween(s.sentDate, t) : null });
    outRows.sort((a2, b2) => (b2.days || 0) - (a2.days || 0));
    right += '<section class="card"><div class="mailhead"><div class="stamp" aria-hidden="true"><div><b>' + out.length + '</b><span>OUT NOW</span></div></div>' +
      '<div><h2 style="margin:0">In the mail</h2><p class="sub" style="margin:4px 0 0">' + out.length + ' poem' + (out.length === 1 ? '' : 's') + ' at ' + journalsOut + ' journal' + (journalsOut === 1 ? '' : 's') + '. ' +
      acceptedThisYear + ' accepted this year.</p></div></div>' +
      (outRows.length ? '<ul class="outlist">' + outRows.slice(0, 6).map((r) => '<li><span><b style="font-weight:600">' + esc(r.title) + '</b><span class="sub"> at ' + esc(r.where) + '</span></span><span class="days">' + (r.days === null ? '' : r.days + ' d') + '</span></li>').join('') + '</ul>' +
        (outRows.length > 6 ? '<p class="sub" style="margin:8px 0 0"><button class="link" data-tab="subs">See all ' + outRows.length + '</button></p>' : '')
        : '<p class="quiet-line">Nothing out right now.</p>') + '</section>';
    return html + '<div class="desk"><div>' + left + '</div><div>' + right + '</div></div>';
  }

  // ----- Poems
  function poemWhere(p, state) {
    const rejected = Array.from(new Set(data.submissions.filter((s) => s.status === 'rejected' && s.poemIds.includes(p.id)).map((s) => journalName(s.journalId))));
    let main = '';
    if (state === 'published') {
      const pl = L.placement(data, p.id);
      main = pl.kind === 'submission' ? (pl.journal ? pl.journal.name : '') : [p.publishedWhere, p.publishedDate].filter(Boolean).join(', ');
      main = 'At ' + (main || 'elsewhere');
    } else if (state === 'out') {
      main = 'Out at ' + L.pendingSubsFor(data, p.id).map((s) => journalName(s.journalId)).join(', ');
    }
    return esc(main) + (rejected.length ? '<div class="sub">Declined by ' + esc(rejected.join(', ')) + '</div>' : '');
  }
  function viewPoems() {
    const rows = data.poems
      .map((p) => ({ p, state: L.poemState(data, p) }))
      .filter((x) => (ui.poemFilter === 'all' || x.state === ui.poemFilter) && (!ui.poemQuery || x.p.title.toLowerCase().includes(ui.poemQuery.toLowerCase())))
      .sort((a, b) => a.p.title.localeCompare(b.p.title));
    let html = '<div class="toolbar"><h2 style="margin:0">Poems</h2><span class="grow"></span>' +
      '<label class="sub" style="margin:0">Show <select id="poemFilter" style="width:auto">' +
      [['all', 'All'], ['draft', 'Draft'], ['ready', 'Ready'], ['out', 'Out'], ['published', 'Published']]
        .map((o) => '<option value="' + o[0] + '"' + (ui.poemFilter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
      '<input id="poemQuery" type="search" placeholder="Search titles" aria-label="Search titles" value="' + esc(ui.poemQuery) + '" style="width:12rem">' +
      '<button data-act="bulk-poems">Add several</button><button class="primary" data-act="add-poem">Add poem</button></div>' +
      '<p class="hint">Titles and notes only. Keep the poems themselves wherever you already store them.</p>';
    if (!rows.length) {
      return html + '<div class="empty">' + (data.poems.length ? 'No poems match that filter.' : 'No poems yet. Add your titles to get started.') + '</div>';
    }
    html += '<table><thead><tr><th>Title</th><th>Status</th><th>Where</th><th>Notes</th><th></th></tr></thead><tbody>' +
      rows.map(({ p, state }) =>
        '<tr><td><b>' + esc(p.title) + '</b></td><td>' + chip(state, POEM_LABEL[state]) + '</td><td>' + poemWhere(p, state) + '</td><td class="sub">' + esc(p.notes) + '</td><td class="nowrap"><div class="btnrow">' +
        (state === 'published' ? '' : '<button class="small" data-act="new-sub" data-poem="' + esc(p.id) + '">Send out</button>') +
        '<button class="small" data-act="poem-history" data-id="' + esc(p.id) + '">History</button>' +
        '<button class="small" data-act="edit-poem" data-id="' + esc(p.id) + '">Edit</button></div></td></tr>').join('') + '</tbody></table>';
    return html;
  }

  // ----- Find journals (the directory that ships with the app)
  const KIND_CHIP = { open: ['open', 'Open'], soon: ['blue', 'Opens soon'], always: ['open', 'Open all year'], closed: ['muted', 'Closed now'], unknown: ['plain', 'Dates: check site'] };
  function stateChip(st) {
    if (st.kind === 'open') return chip('open', 'Open, closes ' + shortDate(st.closes));
    if (st.kind === 'soon' || st.kind === 'closed') return chip(st.kind === 'soon' ? 'blue' : 'muted', 'Opens ' + shortDate(st.opens));
    return chip(KIND_CHIP[st.kind][0], KIND_CHIP[st.kind][1]);
  }
  const shortDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const feeText = (fee) => (fee === null ? 'Not confirmed' : fee === 0 ? 'Free' : money(fee));
  const YN_TEXT = { yes: 'Yes', no: 'No', unknown: 'Not confirmed' };
  const FIND_TOGGLES = [['openSoon', 'Open now or soon'], ['sim', 'Takes simultaneous'], ['free', 'No fee'], ['pays', 'Pays writers'], ['reprints', 'Takes reprints'], ['notSent', 'Not sent to yet']];
  function viewFind() {
    const t = today();
    const res = L.searchDirectory(dir, data, Object.assign({ q: ui.findQuery }, ui.find), t);
    if (!res.some((r) => r.entry.id === ui.findSel)) ui.findSel = res.length ? res[0].entry.id : '';
    const links = L.searchLinks(ui.findQuery);
    let html = pageHead(dir.checked ? 'Directory checked ' + fmtDate(dir.checked) + ', ' + dir.journals.length + ' journals' : 'Directory', 'Find journals',
      '<button data-act="add-journal">Add one by hand</button>');
    if (dir.journals.length && L.dirIsStale(dir, t)) html += '<div class="card alert">These directory details were checked more than six months ago. Reading periods and fees change, so confirm on each journal\'s site.</div>';
    html += '<label class="searchbox">' + icon('find', 19) + '<span class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Search journals</span>' +
      '<input id="findQuery" type="search" placeholder="Search by name, place or kind of journal" value="' + esc(ui.findQuery) + '"><span class="sub" style="white-space:nowrap">' + res.length + ' match' + (res.length === 1 ? '' : 'es') + '</span></label>' +
      '<div class="btnrow">' + FIND_TOGGLES.map(([k, label]) => '<button class="toggle" data-act="find-toggle" data-key="' + k + '" aria-pressed="' + (ui.find[k] ? 'true' : 'false') + '">' + label + '</button>').join('') + '</div>';
    const list = res.length
      ? '<ul class="results">' + res.map((r) => {
        const e = r.entry;
        const chips = [stateChip(r.state), chip('plain', feeText(e.fee) === 'Not confirmed' ? 'Fee: check' : feeText(e.fee))];
        if (e.simSubs === 'yes') chips.push(chip('plain', 'Sim subs OK'));
        if (e.simSubs === 'no') chips.push(chip('red', 'No sim subs'));
        if (e.pays === 'yes') chips.push(chip('plain', e.paysNote ? 'Pays ' + e.paysNote : 'Pays'));
        return '<li><button class="result" data-act="find-pick" data-id="' + esc(e.id) + '" aria-pressed="' + (e.id === ui.findSel ? 'true' : 'false') + '">' +
          '<span class="t"><span>' + esc(e.name) + '</span>' + (r.mine ? '<span class="mine">In your journals</span>' : '') + '</span>' +
          '<span class="l">' + esc(e.note.split('. ')[0].replace(/\.$/, '')) + '.</span><span class="chips">' + chips.join('') + '</span></button></li>';
      }).join('') + '</ul>'
      : '<div class="empty">No journals match. Try fewer filters or other words.</div>';
    const outside = '<section class="card" style="margin-top:14px"><h3>Not finding it here?</h3><p class="hint">The big databases have thousands more. These open a search on their sites' +
      (ui.findQuery ? ' for <b>' + esc(ui.findQuery) + '</b>' : '') + '. When you find one, add it with "Add one by hand".</p><div class="btnrow">' +
      '<a class="btn small" href="' + esc(links.chillSubs) + '" target="_blank" rel="noopener noreferrer">Search Chill Subs</a>' +
      '<a class="btn small" href="' + esc(links.pw) + '" target="_blank" rel="noopener noreferrer">Search Poets &amp; Writers</a>' +
      '<a class="btn small quiet" href="' + esc(links.pwOpen) + '" target="_blank" rel="noopener noreferrer">Open reading periods list</a></div></section>';
    return html + '<div class="find"><div>' + list + outside + '</div><div>' + findDetail(res.find((r) => r.entry.id === ui.findSel), t) + '</div></div>';
  }
  function findDetail(r, t) {
    if (!r) return '';
    const e = r.entry;
    const period = e.yearRound ? 'Open all year' : e.windows.length ? L.windowsText(e.windows) + ', every year' : 'Changes; check their site';
    const ready = data.poems.filter((p) => L.poemState(data, p) === 'ready');
    const unseen = r.mine ? ready.filter((p) => !data.submissions.some((s) => s.journalId === r.mine.id && s.poemIds.includes(p.id))) : ready;
    const hist = r.mine
      ? (r.sent ? 'You have sent here ' + r.sent + ' time' + (r.sent === 1 ? '' : 's') + '. ' : 'Nothing sent here yet. ') + unseen.length + ' of your ready poems have not been seen by this journal.'
      : 'Not in your journals yet. ' + unseen.length + ' ready poem' + (unseen.length === 1 ? '' : 's') + ' could go here.';
    return '<section class="card detail">' +
      '<span class="kicker" style="display:block;font:500 12px var(--mono);color:var(--muted);letter-spacing:.04em;text-transform:uppercase">' + esc(e.tags.join(' · ') || 'Poetry') + '</span>' +
      '<h2 style="font-size:1.6rem;margin:6px 0 4px">' + esc(e.name) + '</h2>' +
      (safeUrl(e.url) ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer" style="font-size:13.5px">' + esc(e.url.replace(/^https?:\/\//, '')) + '</a>' : '') +
      '<p style="margin:12px 0 6px;font-size:14px;color:var(--ink2)">' + esc(e.note) + '</p>' +
      '<div class="facts">' +
      [['Reading period', period], ['Fee', feeText(e.fee) + (e.feeNote ? '. ' + e.feeNote : '')], ['Poems per submission', e.maxPoems ? 'Up to ' + e.maxPoems : 'Not stated'],
        ['Simultaneous', YN_TEXT[e.simSubs]], ['Pays', e.pays === 'yes' ? (e.paysNote || 'Yes') : e.pays === 'no' ? (e.paysNote || 'No') : 'Not confirmed'],
        ['Reprints', YN_TEXT[e.reprints]], ['Usual reply', e.replyDays ? 'About ' + e.replyDays + ' days' : 'Not stated'], ['Right now', stateChip(r.state)]]
        .map(([k, v]) => '<div class="fact"><b>' + k + '</b><span>' + (k === 'Right now' ? v : esc(v)) + '</span></div>').join('') + '</div>' +
      '<div class="yourhist"><b>Your history here:</b> ' + esc(hist) + '</div>' +
      '<div class="btnrow" style="margin-top:16px">' +
      (r.mine ? '<button class="primary" data-act="new-sub" data-journal="' + esc(r.mine.id) + '">Send poems</button><button data-act="edit-journal" data-id="' + esc(r.mine.id) + '">Your notes on it</button>'
        : '<button class="primary" data-act="find-add" data-id="' + esc(e.id) + '">Add to my journals</button>') +
      (safeUrl(e.url) ? '<a class="btn quiet" href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">Guidelines</a>' : '') + '</div>' +
      '<p class="sub" style="margin:12px 0 0">Checked ' + (dir.checked ? fmtDate(dir.checked) : 'by hand') + '. Details change; read their guidelines before you send.</p></section>';
  }

  // ----- Fee budget
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function viewBudget() {
    const y = ui.budgetYear;
    const b = L.budgetSummary(data, y);
    const max = Math.max(1, ...b.months.map((m) => m.spent + m.planned));
    const pct = (n) => (b.budget ? Math.min(100, (n / Math.max(b.budget, 0.01)) * 100) : 0).toFixed(1) + '%';
    let html = pageHead(String(y), 'Fee budget',
      '<button data-act="budget-year" data-delta="-1">' + (y - 1) + '</button><button data-act="budget-year" data-delta="1">' + (y + 1) + '</button>');
    let left = '<section class="card"><div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 28px;margin-bottom:6px">' +
      '<div><div class="sub">Spent in ' + y + '</div><div class="big" style="font-size:2.8rem">' + (money(b.spent) || '$0') + '</div></div>';
    if (b.budget !== null) {
      left += '<div style="flex:1;min-width:220px"><div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted)"><span>$0</span><span>Heads-up at ' + money(b.warnAt) + '</span><span>' + money(b.budget) + '</span></div>' +
        '<div class="meter" role="img" aria-label="' + esc((money(b.spent) || '$0') + ' spent, ' + (money(b.planned) || '$0') + ' planned, of a ' + money(b.budget) + ' budget') + '">' +
        '<span class="spent" style="width:' + pct(b.spent) + '"></span>' + (b.countPlanned && b.planned ? '<span class="planned" style="left:' + pct(b.spent) + ';width:' + pct(b.planned) + '"></span>' : '') +
        '<span class="mark" style="left:' + b.warnPct + '%"></span></div>' +
        '<div style="font-size:13.5px">' + (b.left >= 0 ? money(b.left) + ' left' : money(-b.left) + ' over budget') + (b.planned ? '. Planned entries: ' + money(b.planned) + (b.countPlanned ? ', counted.' : ', not counted.') : '.') + '</div></div>';
    } else {
      left += '<p class="hint" style="flex:1">No budget set for ' + y + '. Set one on the right and Pen Pal will warn you before a fee goes over.</p>';
    }
    left += '</div><h3 style="margin-top:18px">By month</h3>' +
      '<div class="mchart" role="img" aria-label="' + esc('Fees by month in ' + y + ': ' + b.months.map((m, i) => MONTHS[i] + ' ' + (money(m.spent) || '$0') + (m.planned ? ' plus ' + money(m.planned) + ' planned' : '')).join(', ')) + '">' +
      b.months.map((m, i) => {
        const tot = m.spent + m.planned;
        return '<div class="mcol" title="' + esc(MONTHS[i] + ': ' + (money(m.spent) || '$0') + ' paid' + (m.planned ? ', ' + money(m.planned) + ' planned' : '')) + '">' +
          (tot ? '<span class="v">' + money(tot) + '</span>' : '') +
          '<div class="bar" style="height:' + ((tot / max) * 150).toFixed(0) + 'px">' + (m.planned ? '<div class="p" style="flex:' + m.planned + '"></div>' : '') + (m.spent ? '<div class="s" style="flex:' + m.spent + '"></div>' : '') + '</div></div>';
      }).join('') + '</div><div class="mlabels" aria-hidden="true">' + MONTHS.map((m) => '<span>' + m + '</span>').join('') + '</div>' +
      '<div class="legend"><span><i style="background:var(--blue)"></i>Paid</span><span><i style="background:repeating-linear-gradient(135deg,var(--blue-mid) 0 3px,var(--blue-soft) 3px 5px)"></i>Planned entry</span></div></section>';
    let right = '<section class="card"><h2>Budget for ' + y + '</h2>' +
      '<label>Yearly budget for fees ($)<input id="budgetAmount" type="number" min="0" step="1" inputmode="decimal" value="' + (b.budget === null ? '' : b.budget) + '"></label>' +
      '<label>Give me a heads-up at (% of the budget)<input id="budgetWarn" type="number" min="1" max="100" step="1" value="' + b.warnPct + '"></label>' +
      '<label class="check"><input id="countPlanned" type="checkbox"' + (b.countPlanned ? ' checked' : '') + '> Count planned contest entries</label>' +
      '<div class="btnrow" style="margin-top:12px"><button class="primary" data-act="budget-save">Save budget</button>' + (b.budget !== null ? '<button data-act="budget-clear">Remove</button>' : '') + '</div>' +
      '<p class="hint" style="margin-top:12px">Fees come from what you enter as "Fee paid" on submissions and manuscript entries. Unsent entries count as planned on their deadline.</p></section>';
    right += '<section class="card"><h2>Fees in ' + y + '</h2>' + (b.items.length
      ? '<table><tbody>' + b.items.slice(0, 14).map((i) => '<tr><td class="datecell">' + shortDate(i.date) + '</td><td><b>' + esc(i.name) + '</b><div class="sub">' + esc(i.what) + '</div></td><td class="num mono" style="' + (i.planned ? 'color:var(--blue)' : '') + '">' + money(i.amount) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="hint">No fees recorded for ' + y + '.</p>') + '</section>';
    return html + '<div class="budget"><div>' + left + '</div><div>' + right + '</div></div>';
  }

  // ----- Import
  function viewImport() {
    return pageHead('Bring things in', 'Import') +
      '<div class="desk"><div>' +
      '<section class="card"><h2>Your submission history</h2><p>A spreadsheet of where you have sent poems, saved as CSV: one row per submission, with the journal, the poem titles, the date sent, and what happened. ' +
      'An export from another tracker works if it has those columns.</p><p class="hint">Journals and poem titles you do not have yet are added for you. Rows you already have are skipped. You see everything before it is added.</p>' +
      '<label class="btn primary" style="margin:0;font-weight:600">Choose a CSV of submissions<input id="importSubsFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden></label></section>' +
      '<section class="card"><h2>A list of journals</h2><p>One journal per row: name, website, reading dates, fee, how many poems, simultaneous submissions. Any spreadsheet saved as CSV.</p>' +
      '<label class="btn" style="margin:0;font-weight:600">Choose a CSV of journals<input id="importFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden></label></section>' +
      '</div><div><section class="card note"><h3>From Excel or Google Sheets</h3><p style="margin:0;font-size:14px">Excel: File, Save As, "CSV UTF-8". Google Sheets: File, Download, "Comma-separated values". ' +
      'Dates like 3/4/2026 are read month first. Titles in one cell can be split with a semicolon: Salt Line; Low Tide.</p></section></div></div>';
  }

  // ----- Journals
  function windowChip(j, t) {
    const w = L.currentWindow(j, t);
    if (w.always) return chip('open', 'Open all year');
    if (!w.opens && !w.closes) return '<span class="sub">No dates</span>';
    if (w.closes && w.closes < t) return chip('closed', 'Closed');
    if (w.opens && w.opens > t) return chip('muted', 'Opens ' + rel(L.daysBetween(t, w.opens)));
    return chip('open', 'Open' + (w.closes ? ', ' + L.daysBetween(t, w.closes) + ' days left' : ''));
  }
  function viewJournals() {
    const t = today();
    const closeOf = (j) => L.currentWindow(j, t).closes || '9999';
    const rows = data.journals.slice().sort((a, b) => closeOf(a).localeCompare(closeOf(b)) || a.name.localeCompare(b.name));
    let html = '<div class="toolbar"><h2 style="margin:0">My journals</h2><span class="grow"></span>' +
      '<button data-tab="find">' + icon('find', 16) + 'Find journals</button><button data-act="import-journals">Import from CSV</button><button class="primary" data-act="add-journal">Add journal</button>' +
      '<input id="importFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden></div>' +
      '<p class="hint">Reading dates drive the Calendar and the deadline list. A journal marked as repeating yearly rolls its dates forward on its own.</p>';
    if (!rows.length) return html + '<div class="empty">No journals yet.</div>';
    html += '<table><thead><tr><th>Journal</th><th>Reading period</th><th>Fee</th><th>Limits</th><th>Sent</th><th></th></tr></thead><tbody>' +
      rows.map((j) => {
        const n = data.submissions.filter((s) => s.journalId === j.id).length;
        const url = safeUrl(j.url);
        const w = L.currentWindow(j, t);
        return '<tr><td><b>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(j.name) + '</a>' : esc(j.name)) + '</b>' +
          (j.notes ? '<div class="sub">' + esc(j.notes) + '</div>' : '') + '</td>' +
          '<td>' + windowChip(j, t) + '<div class="sub">' + (w.opens ? fmtDate(w.opens) : '') + (w.opens && w.closes ? ' to ' : '') + (w.closes ? fmtDate(w.closes) : '') +
          (L.isRecurring(j) ? '<br>Repeats every year' + (j.extraWindows.length ? '. Also ' + esc(L.windowsText(j.extraWindows)) : '') : '') +
          (j.dirId ? '<br>From the directory' + (j.checked ? ', checked ' + fmtDate(j.checked) : '') : '') + '</div></td>' +
          '<td>' + (j.fee === null ? '' : j.fee === 0 ? 'Free' : money(j.fee)) + '</td>' +
          '<td class="sub">' + (j.maxPoems ? 'Up to ' + j.maxPoems + ' poems<br>' : '') + 'Simultaneous: ' + ({ yes: 'yes', no: 'no', unknown: 'not sure' }[j.simSubs]) + '</td>' +
          '<td class="num">' + n + '</td><td class="nowrap"><div class="btnrow"><button class="small" data-act="new-sub" data-journal="' + esc(j.id) + '">Send poems</button>' +
          '<button class="small" data-act="edit-journal" data-id="' + esc(j.id) + '">Edit</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  // ----- Submissions
  function viewSubs() {
    const t = today();
    const rows = data.submissions
      .filter((s) => ui.subFilter === 'all' || s.status === ui.subFilter)
      .sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || ''));
    let html = '<div class="toolbar"><h2 style="margin:0">Submissions</h2><span class="grow"></span>' +
      '<label class="sub" style="margin:0">Show <select id="subFilter" style="width:auto">' +
      [['all', 'All'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']]
        .map((o) => '<option value="' + o[0] + '"' + (ui.subFilter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
      '<button class="primary" data-act="new-sub">Log a submission</button></div>';
    if (!rows.length) {
      return html + '<div class="empty">' + (data.submissions.length ? 'Nothing with that status.' : 'No submissions yet. Log one when you send poems out.') + '</div>';
    }
    html += '<table><thead><tr><th>Sent</th><th>Journal</th><th>Poems</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map((s) => {
        let note = '';
        if (s.status === 'pending' && s.sentDate) note = L.daysBetween(s.sentDate, t) + ' days waiting' + (s.queriedDate ? '. Followed up ' + fmtDate(s.queriedDate) : '');
        else if (s.responseDate) {
          note = fmtDate(s.responseDate) + (s.sentDate ? ' (' + L.daysBetween(s.sentDate, s.responseDate) + ' days)' : '');
        }
        const acc = L.acceptedPoemIdsOf(s);
        const poems = s.status === 'accepted' && acc.length < L.activePoemIds(s).length
          ? 'Accepted: ' + titlesOf(acc) + '<div class="sub">Also sent: ' + esc(titlesOf(s.poemIds.filter((id) => !acc.includes(id)))) + '</div>'
          : esc(titlesOf(s.status === 'accepted' ? acc : s.poemIds));
        const withdrawn = s.withdrawnPoemIds.length && s.status === 'pending' ? '<div class="sub">Withdrawn: ' + esc(titlesOf(s.withdrawnPoemIds)) + '</div>' : '';
        return '<tr><td class="nowrap">' + (s.sentDate ? fmtDate(s.sentDate) : '') + '</td><td><b>' + esc(journalName(s.journalId)) + '</b>' +
          (s.notes ? '<div class="sub">' + esc(s.notes) + '</div>' : '') + '</td><td>' + poems + withdrawn + '</td>' +
          '<td>' + chip(s.status, SUB_LABEL[s.status]) + '<div class="sub">' + esc(note) + '</div></td><td class="nowrap"><div class="btnrow">' +
          (s.status === 'pending'
            ? '<button class="small" data-act="status-sub" data-id="' + esc(s.id) + '" data-status="accepted">Accepted</button>' +
              '<button class="small" data-act="status-sub" data-id="' + esc(s.id) + '" data-status="rejected">Rejected</button>'
            : '<button class="small" data-act="status-sub" data-id="' + esc(s.id) + '">Change status</button>') +
          '<button class="small" data-act="edit-sub" data-id="' + esc(s.id) + '">Edit</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  // ----- Calendar
  function viewCalendar() {
    const t = today();
    const open = L.openNow(data, t);
    const events = L.upcomingDeadlines(data, t, 365);
    const undated = data.journals.filter((j) => !j.opens && !j.closes && !j.alwaysOpen).length;
    let html = '<div class="toolbar"><h2 style="margin:0">Calendar</h2><span class="grow"></span>' +
      '<button class="primary" data-act="dl-ics">Download calendar file (.ics)</button></div>' +
      '<p class="hint">The .ics file holds every future opening and closing date (the next two cycles for journals that repeat yearly) and the deadline for each manuscript entry not yet sent, with reminders a week and a day before each close. ' +
      'Open it to add the dates to Outlook, Google Calendar or Apple Calendar. Each event has a fixed ID, so most apps update them if you import again; ' +
      'if yours shows duplicates, delete the old ones first.</p>';
    html += '<section class="card"><h2>Open right now</h2>';
    html += open.length
      ? '<table><thead><tr><th>Journal</th><th>Closes</th><th>Fee</th><th></th></tr></thead><tbody>' + open.map((o) =>
        '<tr><td><b>' + esc(o.journal.name) + '</b></td><td>' + (o.closes ? fmtDate(o.closes) + '<div class="sub">' + o.daysLeft + ' days left</div>' : '<span class="sub">' + (o.journal.alwaysOpen ? 'Open all year' : 'No close date') + '</span>') +
        '</td><td>' + (o.journal.fee === null ? '' : o.journal.fee === 0 ? 'Free' : money(o.journal.fee)) + '</td><td><button class="small" data-act="new-sub" data-journal="' + esc(o.journal.id) + '">Send poems</button></td></tr>').join('') + '</tbody></table>'
      : '<p class="hint">No journal with dates is open today.</p>';
    html += '</section><section class="card"><h2>Coming up (next 12 months)</h2>';
    html += events.length
      ? '<table><thead><tr><th>Date</th><th>What</th><th>Journal</th></tr></thead><tbody>' + events.map((e) =>
        '<tr><td class="nowrap">' + fmtDate(e.date) + '<div class="sub">' + rel(e.daysAway) + '</div></td><td>' + deadlineChip(e) + '</td><td>' + esc(e.name) + '</td></tr>').join('') + '</tbody></table>'
      : '<p class="hint">No upcoming dates.</p>';
    html += '</section>';
    if (undated) html += '<p class="hint">' + undated + ' journal' + (undated === 1 ? ' has' : 's have') + ' no reading dates, so they do not appear here.</p>';
    return html;
  }

  // ----- Export
  function viewExport() {
    const pub = L.publishedList(data);
    const folder = info.dataFolder || 'the data folder';
    const canOpen = window.pywebview && window.pywebview.api && window.pywebview.api.open_data_folder;
    return pageHead('Your files', 'Export and backup') +
      '<section class="card"><h3>Submissions spreadsheet</h3><p class="hint">A CSV of every submission. Opens in Excel or Google Sheets.</p>' +
      '<div class="btnrow"><button data-act="dl-csv">Download submissions.csv</button>' +
      (data.entries.length ? '<button data-act="dl-entries-csv">Download manuscript entries.csv</button>' : '') + '</div></section>' +
      '<section class="card"><h3>Acknowledgments list</h3><p class="hint">Accepted and published poems, ready to adapt for a book’s acknowledgments page or a cover letter.</p>' +
      (pub.items.length
        ? '<textarea class="mono" readonly aria-label="Acknowledgments list">' + esc(pub.text) + '</textarea><div class="btnrow" style="margin-top:8px"><button data-act="copy-pub">Copy</button></div>'
        : '<p class="hint">Nothing accepted yet. It fills in as you record acceptances.</p>') + '</section>' +
      '<section class="card"><h3>Backup and restore</h3><p class="hint">Your data lives in <code>' + esc(folder) + '</code> as <code>tracker.json</code>, with a daily copy in its <code>backups</code> folder (the last 14 days). ' +
      'For a copy off this computer, set a second folder below or save a backup file now and then.</p>' +
      (canOpen ? '<div class="btnrow" style="margin-bottom:10px"><button class="small" data-act="open-data-folder">Open the data folder</button></div>' : '') +
      '<p class="hint">' + (data.settings.lastBackupDownload ? 'Last backup file saved: ' + fmtDate(data.settings.lastBackupDownload) + '.' : 'You have not saved a backup file yet.') + '</p>' +
      '<div class="btnrow"><button data-act="dl-backup">Save a backup file</button>' +
      '<label class="btn" style="margin:0">Restore from a backup file… <input id="restoreFile" type="file" accept=".json,application/json" hidden></label></div>' +
      '<p class="hint" style="margin-top:10px">Coming from the old Poetry Tracker folder? Restore from its <code>data\\tracker.json</code> and everything comes across.</p></section>' +
      '<section class="card"><h3>Second backup folder (optional)</h3><p class="hint">Give a folder on another drive, a USB stick, or inside OneDrive or Dropbox. After every save Pen Pal copies your data there ' +
      '(a latest file plus one per day, the last 14 days). If that folder is ever missing, saving here still works and this page tells you.</p>' +
      '<label>Folder path<input id="folderInput" placeholder="D:\\Backups\\Pen Pal" value="' + esc(server.folder) + '"></label>' +
      '<div class="btnrow"><button data-act="save-folder">' + (server.folderSet ? 'Change folder' : 'Start copying here') + '</button>' +
      (server.folderSet ? '<button data-act="clear-folder">Switch off</button>' : '') + '</div><div class="err" id="folderErr" role="alert"></div>' +
      '<p class="hint">' + esc(!server.folderSet ? 'Not set.' : server.lastCopyOk ? 'Working. Last copy: ' + new Date(server.lastCopyAt).toLocaleString() + '.'
        : server.lastCopyOk === false ? 'The last copy failed: ' + server.lastError : 'Set. The first copy happens at your next save.') + '</p></section>';
  }

  // ---------------------------------------------------------------- dialogs
  function poemDialog(id) {
    const p = id ? L.poemById(data, id) : { title: '', status: 'draft', publishedWhere: '', publishedDate: '', notes: '' };
    if (!p) return;
    const pl = id ? L.placement(data, id) : null;
    openDialog(
      '<h2>' + (id ? 'Edit poem' : 'Add poem') + '</h2>' +
      '<label>Title<input name="title" required maxlength="300" value="' + esc(p.title) + '"></label>' +
      (pl && pl.kind === 'submission'
        ? '<p class="hint">Accepted by ' + esc(pl.journal ? pl.journal.name : 'a journal') + ' through the Submissions tab. Change that submission to undo it.</p>'
        : '<label>Status<select name="status"><option value="draft">Draft</option><option value="ready">Ready to send</option><option value="published">Already published (before you started tracking)</option></select></label>' +
          '<div id="pubFields"><div class="row2"><label>Published in<input name="publishedWhere" maxlength="300" value="' + esc(p.publishedWhere) + '"></label>' +
          '<label>When<input name="publishedDate" maxlength="60" placeholder="2024" value="' + esc(p.publishedDate) + '"></label></div></div>') +
      '<label>Notes<textarea name="notes" rows="3" maxlength="5000">' + esc(p.notes) + '</textarea></label>' +
      actionsHtml({ del: !!id }),
      (fd, action, form) => {
        if (action === 'delete') {
          const n = data.submissions.filter((s) => s.poemIds.includes(id)).length;
          if (!confirm('Delete ' + q(p.title) + '?' + (n ? ' It will also be removed from ' + n + ' submission' + (n === 1 ? '' : 's') + '.' : ''))) return false;
          L.removePoem(data, id);
          return commit('Deleted a poem');
        }
        const title = String(fd.get('title')).trim();
        if (!title) return setErr(form, 'Please enter a title.');
        const dup = data.poems.find((x) => x.id !== id && x.title.toLowerCase() === title.toLowerCase());
        if (dup && !confirm('You already have a poem called ' + q(dup.title) + '. Save anyway?')) return false;
        const fields = { title, notes: String(fd.get('notes')) };
        if (!(pl && pl.kind === 'submission')) {
          fields.status = fd.get('status');
          fields.publishedWhere = String(fd.get('publishedWhere') || '');
          fields.publishedDate = String(fd.get('publishedDate') || '');
        }
        if (id) Object.assign(p, L.normalizePoem(Object.assign({}, p, fields)));
        else data.poems.push(L.normalizePoem(Object.assign({ id: L.uid() }, fields)));
        commit('Saved a poem');
      },
      (form) => {
        const sel = $('[name=status]', form);
        if (!sel) return;
        sel.value = p.status;
        const sync = () => { $('#pubFields', form).hidden = sel.value !== 'published'; };
        sel.addEventListener('change', sync);
        sync();
        $('[name=title]', form).focus();
      }
    );
  }

  function bulkPoemsDialog() {
    openDialog(
      '<h2>Add several poems</h2><p class="hint">One title per line. Titles only, not the poems.</p>' +
      '<label>Titles<textarea name="titles" rows="8" required></textarea></label>' +
      '<label>Mark them as<select name="status"><option value="ready">Ready to send</option><option value="draft">Draft</option></select></label>' + actionsHtml({ save: 'Add' }),
      (fd, action, form) => {
        const have = new Set(data.poems.map((p) => p.title.toLowerCase()));
        let added = 0;
        for (const line of String(fd.get('titles')).split(/\r?\n/)) {
          const title = line.trim().replace(/^[-*\d.)\s]+(?=\S)/, '').trim();
          if (!title || have.has(title.toLowerCase())) continue;
          have.add(title.toLowerCase());
          data.poems.push(L.normalizePoem({ id: L.uid(), title, status: fd.get('status') }));
          added++;
        }
        if (!added) return setErr(form, 'No new titles found.');
        tab = 'poems';
        commit('Added poems');
        toast(added + ' poem' + (added === 1 ? '' : 's') + ' added');
      },
      (form) => $('[name=titles]', form).focus()
    );
  }

  function journalDialog(id) {
    const j = id ? L.journalById(data, id) : L.normalizeJournal({ id: 'new', name: '' });
    if (!j) return;
    openDialog(
      '<h2>' + (id ? 'Edit journal' : 'Add journal') + '</h2>' +
      '<label>Name<input name="name" required maxlength="300" value="' + esc(j.name) + '"></label>' +
      '<label>Website or submission page<input name="url" maxlength="600" placeholder="https://" value="' + esc(j.url) + '"></label>' +
      '<div class="row2"><label>Reading period opens<input type="date" name="opens" value="' + esc(j.opens) + '"></label>' +
      '<label>Reading period closes<input type="date" name="closes" value="' + esc(j.closes) + '"></label></div>' +
      '<label class="check"><input type="checkbox" name="alwaysOpen"' + (j.alwaysOpen ? ' checked' : '') + '> Open all year (no reading period)</label>' +
      '<label class="check"><input type="checkbox" name="repeat"' + (j.repeat === 'yearly' ? ' checked' : '') + '> Repeats every year. Enter this year\'s dates and Pen Pal moves them forward on its own.</label>' +
      '<label id="extraField">Other yearly windows (optional)<input name="extra" placeholder="Jan 15 to Mar 1; Jul 1 to Jul 31" value="' + esc(L.windowsText(j.extraWindows)) + '"></label>' +
      '<div class="row2"><label>Fee in dollars (0 if free)<input type="number" name="fee" min="0" step="0.01" value="' + (j.fee === null ? '' : j.fee) + '"></label>' +
      '<label>Most poems per submission<input type="number" name="maxPoems" min="1" step="1" value="' + (j.maxPoems === null ? '' : j.maxPoems) + '"></label></div>' +
      '<div class="row2"><label>Simultaneous submissions allowed?<select name="simSubs"><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>' +
      '<label>Usual reply time (days)<input type="number" name="replyDays" min="1" step="1" placeholder="Used for follow-up reminders" value="' + (j.replyDays === null ? '' : j.replyDays) + '"></label></div>' +
      '<div class="row2"><label>Pays writers?<select name="pays"><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label>' +
      '<label>Takes reprints?<select name="reprints"><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></label></div>' +
      '<label>Notes<textarea name="notes" rows="3" maxlength="5000" placeholder="Rights, typical response time, editor names">' + esc(j.notes) + '</textarea></label>' +
      actionsHtml({ del: !!id }),
      (fd, action, form) => {
        if (action === 'delete') {
          const n = data.submissions.filter((s) => s.journalId === id).length;
          if (!confirm('Delete ' + j.name + '?' + (n ? ' Its ' + n + ' logged submission' + (n === 1 ? '' : 's') + ' will be deleted too.' : ''))) return false;
          L.removeJournal(data, id);
          return commit('Deleted a journal');
        }
        const name = String(fd.get('name')).trim();
        if (!name) return setErr(form, 'Please enter a name.');
        const opens = String(fd.get('opens')), closes = String(fd.get('closes'));
        if (opens && closes && closes < opens) return setErr(form, 'The close date is before the open date.');
        const alwaysOpen = !!fd.get('alwaysOpen');
        const repeat = fd.get('repeat') && !alwaysOpen ? 'yearly' : 'none';
        if (repeat === 'yearly' && !(opens && closes)) return setErr(form, 'To repeat every year, fill in both the open and close dates.');
        const ex = L.parseWindowsText(String(fd.get('extra') || ''));
        if (repeat === 'yearly' && ex.bad.length) return setErr(form, 'Could not read "' + ex.bad[0] + '". Write windows like: Jan 15 to Mar 1; Jul 1 to Jul 31');
        let url = String(fd.get('url')).trim();
        if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
        const fields = { name, url, opens: alwaysOpen ? '' : opens, closes: alwaysOpen ? '' : closes, repeat, alwaysOpen, extraWindows: repeat === 'yearly' ? ex.windows : [],
          replyDays: fd.get('replyDays'), pays: fd.get('pays'), reprints: fd.get('reprints'), fee: fd.get('fee'), maxPoems: fd.get('maxPoems'), simSubs: fd.get('simSubs'), notes: String(fd.get('notes')) };
        if (id) Object.assign(j, L.normalizeJournal(Object.assign({}, j, fields)));
        else data.journals.push(L.normalizeJournal(Object.assign({ id: L.uid() }, fields)));
        commit('Saved a journal');
      },
      (form) => {
        $('[name=simSubs]', form).value = j.simSubs;
        $('[name=pays]', form).value = j.pays;
        $('[name=reprints]', form).value = j.reprints;
        const rep = $('[name=repeat]', form), always = $('[name=alwaysOpen]', form);
        const sync = () => {
          $('#extraField', form).hidden = !rep.checked || always.checked;
          rep.disabled = always.checked;
          form.querySelectorAll('[name=opens],[name=closes]').forEach((el) => { el.disabled = always.checked; });
        };
        rep.addEventListener('change', sync);
        always.addEventListener('change', sync);
        sync();
        $('[name=name]', form).focus();
      }
    );
  }

  function subDialog(id, preset) {
    preset = preset || {};
    if (!data.poems.length || !data.journals.length) {
      infoDialog('Add poems and journals first', '<p>A submission links poems to a journal, so add at least one of each (Poems and Journals tabs).</p>');
      return;
    }
    const existing = id ? data.submissions.find((s) => s.id === id) : null;
    const s = existing || { poemIds: preset.poemId ? [preset.poemId] : [], journalId: preset.journalId || '', sentDate: today(), feePaid: null, notes: '' };
    const order = { ready: 0, draft: 1, out: 2, published: 3 };
    const poems = data.poems.map((p) => ({ p, state: L.poemState(data, p) })).sort((a, b) => order[a.state] - order[b.state] || a.p.title.localeCompare(b.p.title));
    openDialog(
      '<h2>' + (existing ? 'Edit submission' : 'Log a submission') + '</h2>' +
      '<label>Journal<select name="journalId" required><option value="">Choose a journal…</option>' +
      data.journals.slice().sort((a, b) => a.name.localeCompare(b.name)).map((j) => '<option value="' + esc(j.id) + '">' + esc(j.name) + '</option>').join('') + '</select></label>' +
      '<fieldset><legend>Poems sent</legend>' +
      poems.map(({ p, state }) => '<label class="check"><input type="checkbox" name="poem" value="' + esc(p.id) + '"' + (s.poemIds.includes(p.id) ? ' checked' : '') + '> ' + esc(p.title) + ' ' + chip(state, POEM_LABEL[state]) + '</label>').join('') + '</fieldset>' +
      '<div class="row2"><label>Date sent<input type="date" name="sentDate" required value="' + esc(s.sentDate) + '"></label>' +
      '<label>Fee paid ($)<input type="number" name="feePaid" min="0" step="0.01" value="' + (s.feePaid === null || s.feePaid === undefined ? '' : s.feePaid) + '"></label></div>' +
      '<label>Notes<textarea name="notes" rows="2" maxlength="5000">' + esc(s.notes) + '</textarea></label>' +
      '<ul class="warns" id="warns" aria-live="polite"></ul>' + actionsHtml({ del: !!existing, save: existing ? 'Save' : 'Log it' }),
      (fd, action, form) => {
        if (action === 'delete') {
          if (!confirm('Delete this submission record?')) return false;
          data.submissions = data.submissions.filter((x) => x.id !== id);
          return commit('Deleted a submission');
        }
        const poemIds = fd.getAll('poem');
        if (!poemIds.length) return setErr(form, 'Pick at least one poem.');
        const fields = { poemIds, journalId: fd.get('journalId'), sentDate: fd.get('sentDate'), feePaid: fd.get('feePaid'), notes: String(fd.get('notes')) };
        if (existing) {
          Object.assign(existing, L.normalizeSubmission(Object.assign({}, existing, fields, {
            acceptedPoemIds: existing.acceptedPoemIds.filter((x) => poemIds.includes(x)),
            withdrawnPoemIds: existing.withdrawnPoemIds.filter((x) => poemIds.includes(x)),
          })));
        } else {
          data.submissions.push(L.normalizeSubmission(Object.assign({ id: L.uid(), status: 'pending' }, fields)));
        }
        tab = 'subs';
        if (!existing && ui.subFilter !== 'all' && ui.subFilter !== 'pending') ui.subFilter = 'pending';
        commit('Saved a submission');
      },
      (form) => {
        const jSel = $('[name=journalId]', form), fee = $('[name=feePaid]', form);
        jSel.value = s.journalId;
        const warns = () => {
          const draft = { id: id || undefined, poemIds: Array.from(form.querySelectorAll('[name=poem]:checked')).map((c) => c.value), journalId: jSel.value, sentDate: $('[name=sentDate]', form).value, feePaid: fee.value };
          $('#warns', form).innerHTML = L.checkSubmission(data, draft, today()).map((m) => '<li>' + esc(m) + '</li>').join('');
        };
        fee.addEventListener('input', () => { fee.dataset.touched = '1'; warns(); });
        jSel.addEventListener('change', () => {
          const j = L.journalById(data, jSel.value);
          if (j && !fee.dataset.touched && !existing) fee.value = j.fee === null ? '' : j.fee;
          warns();
        });
        form.addEventListener('change', warns);
        if (!existing && s.journalId) { const j = L.journalById(data, s.journalId); if (j && j.fee !== null) fee.value = j.fee; }
        warns();
      }
    );
  }

  function statusDialog(id, preset) {
    const s = data.submissions.find((x) => x.id === id);
    if (!s) return;
    const active = L.activePoemIds(s);
    const accepted = L.acceptedPoemIdsOf(s);
    openDialog(
      '<h2>' + esc(journalName(s.journalId)) + '</h2><p class="hint">' + esc(titlesOf(active)) + '</p>' +
      '<label>Status<select name="status">' + L.SUB_STATUSES.map((k) => '<option value="' + k + '">' + SUB_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<fieldset id="accFields"><legend>Which poems were accepted?</legend>' +
      active.map((pid) => '<label class="check"><input type="checkbox" name="acc" value="' + esc(pid) + '"' + (!accepted.length || accepted.includes(pid) ? ' checked' : '') + '> ' + esc((L.poemById(data, pid) || { title: '(deleted)' }).title) + '</label>').join('') + '</fieldset>' +
      '<label id="dateField">Date they replied<input type="date" name="date" value="' + esc(s.responseDate || today()) + '"></label>' + actionsHtml({}),
      (fd, action, form) => {
        const status = fd.get('status');
        const date = fd.get('date') || today();
        if (status === 'accepted') {
          const picked = fd.getAll('acc');
          if (!picked.length) return setErr(form, 'Pick at least one accepted poem.');
          const alerts = L.acceptSubmission(data, id, picked, date);
          commit('Marked accepted');
          if (alerts.length) {
            tab = 'desk';
            commit();
            setTimeout(() => infoDialog('Congratulations. Now withdraw elsewhere',
              '<p>' + alerts.map((a) => esc(q(a.poem.title)) + ' is still out at ' + esc(a.submissions.map((x) => x.journal ? x.journal.name : '(deleted journal)').join(', '))).join('. ') +
              '.</p><p class="hint">Your Desk lists each one with a note ready to copy. When the acceptance email arrives, add the rights details on the poem\'s History page.</p>', 'Got it'), 0);
          } else {
            toast('Marked accepted');
          }
          return;
        }
        L.setSubmissionStatus(data, id, status, date);
        commit('Changed a submission status');
      },
      (form) => {
        const sel = $('[name=status]', form);
        sel.value = preset || s.status;
        const sync = () => {
          $('#accFields', form).hidden = sel.value !== 'accepted';
          $('#dateField', form).hidden = sel.value === 'pending';
        };
        sel.addEventListener('change', sync);
        sync();
      }
    );
  }

  function withdrawText(subId, poemId) {
    const s = data.submissions.find((x) => x.id === subId);
    const p = L.poemById(data, poemId);
    if (!s || !p) return '';
    const multi = L.activePoemIds(s).length > 1;
    return 'Subject: Withdrawal: ' + q(p.title) + '\n\nHello,\n\nI am writing to withdraw ' + q(p.title) + ' from consideration, as it has been accepted elsewhere. ' +
      (multi ? 'The other poems in my submission remain available for your consideration. ' : '') +
      'Thank you very much for reading my work.\n\nBest,\n[Your name]';
  }


  // ---------------------------------------------------------------- poem history
  const OUTCOME_LABEL = { pending: 'Waiting', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn', 'not-taken': 'Not taken' };
  const OUTCOME_CHIP = { pending: 'pending', accepted: 'accepted', rejected: 'rejected', withdrawn: 'withdrawn', 'not-taken': 'withdrawn' };
  function poemHistoryDialog(id) {
    const t = today();
    const h = L.poemHistory(data, id, t);
    if (!h) return;
    const state = L.poemState(data, h.poem);
    const pl = h.placement;
    const where = pl ? (pl.kind === 'submission' ? (pl.journal ? pl.journal.name : 'a journal') : h.poem.publishedWhere || 'elsewhere') : '';
    const r = h.poem.rights;
    // where it has been, oldest first, as a timeline of sends and answers
    const events = [];
    for (const row of h.rows) {
      const jn = row.journal ? row.journal.name : '(deleted journal)';
      if (row.sentDate) events.push({ date: row.sentDate, kind: 'sent', title: 'Sent to ' + jn, note: row.withOthers ? 'With ' + (row.sub.poemIds.length - 1) + ' other poem' + (row.sub.poemIds.length === 2 ? '' : 's') : '' });
      if (row.outcome !== 'pending' && row.responseDate) {
        const verb = { accepted: 'Accepted by ', rejected: 'Declined by ', withdrawn: 'Withdrawn from ', 'not-taken': 'Not taken by ' }[row.outcome];
        events.push({ date: row.responseDate, kind: row.outcome, title: verb + jn, note: row.days !== null ? row.days + ' days' + (row.outcome === 'not-taken' ? '. They took others from that batch.' : '') : '' });
      } else if (row.outcome === 'pending') {
        events.push({ date: '', kind: 'pending', title: 'Waiting on ' + jn, note: row.days !== null ? row.days + ' days so far' : '' });
      } else if (row.outcome !== 'pending') {
        events.push({ date: '', kind: row.outcome, title: OUTCOME_LABEL[row.outcome] + ' at ' + jn, note: '' });
      }
    }
    events.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
    const travels = events.length
      ? '<ol class="travels">' + events.map((e) => '<li><span class="d">' + (e.date ? fmtDate(e.date) : 'now') + '</span><span class="dot ' + e.kind + '" aria-hidden="true"></span>' +
        '<div><div style="font-weight:600">' + esc(e.title) + '</div>' + (e.note ? '<div class="sub">' + esc(e.note) + '</div>' : '') + '</div></li>').join('') + '</ol>'
      : '<p class="hint">It has not been sent anywhere yet.</p>';
    const credit = r.credit || L.suggestedCredit(data, h.poem);
    const rrow = (k, v) => '<div class="rrow"><b>' + k + '</b><span>' + v + '</span></div>';
    const untilTxt = r.exclusiveUntil ? fmtDate(r.exclusiveUntil) + ' <span class="sub">(' + (L.daysBetween(t, r.exclusiveUntil) >= 0 ? 'in ' + L.daysBetween(t, r.exclusiveUntil) + ' days' : 'passed') + ')</span>' : '<span class="sub">Not set</span>';
    const rights = '<section class="card" style="margin:0"><div class="cardhead"><h2 style="margin:0">Rights and reprints</h2><span class="grow"></span><button class="small" type="button" data-act="edit-rights" data-id="' + esc(id) + '">Edit</button></div>' +
      (pl || r.bought || r.exclusiveUntil
        ? rrow('Rights they took', r.bought ? esc(r.bought) : '<span class="sub">Not set</span>') +
          rrow('Published', esc([r.issue, r.pubDate ? fmtDate(r.pubDate) : ''].filter(Boolean).join(', ')) || '<span class="sub">Not set</span>') +
          rrow('Exclusive until', untilTxt) +
          rrow('Reprints', { yes: 'Allowed', no: 'Not allowed', unknown: '<span class="sub">Not set</span>' }[r.reprints]) +
          (r.revert ? rrow('Rights come back', esc(r.revert)) : '') +
          (credit ? '<div class="credit"><div class="sub" style="font-family:var(--sans);font-weight:600;margin-bottom:4px">CREDIT LINE</div><div style="display:flex;gap:12px;align-items:center"><span class="grow">' + esc(credit) + '</span>' +
            '<button class="small" type="button" data-act="copy-credit" data-id="' + esc(id) + '">Copy</button></div></div>' : '')
        : '<p class="hint">When a journal takes this poem, note the rights from the acceptance email here: what they bought, when it comes out, and when you can send it elsewhere as a reprint.</p>') +
      '</section>';
    const next = L.nextTargets(data, id, t);
    let body = '<h2 style="margin-bottom:6px">' + esc(q(h.poem.title)) + '</h2><div class="btnrow" style="margin-bottom:14px">' + chip(state, POEM_LABEL[state]) + (where ? chip('plain', where) : '') +
      (r.exclusiveUntil && L.daysBetween(t, r.exclusiveUntil) >= 0 ? chip('blue', 'Exclusive for ' + L.daysBetween(t, r.exclusiveUntil) + ' more days') : '') + '</div>' +
      '<div class="poemgrid"><section class="card" style="margin:0"><div class="cardhead"><h2 style="margin:0">Where it has been</h2><span class="sub">' + h.seenBy.length + ' journal' + (h.seenBy.length === 1 ? '' : 's') + '</span></div>' + travels + '</section>' +
      '<div>' + rights +
      (h.manuscripts.length ? '<p style="margin:14px 0 0;font-size:14px"><b>In manuscripts:</b> ' + esc(h.manuscripts.map((m) => m.title).join(', ')) + '.</p>' : '') +
      (next.length ? '<h3 style="margin-top:14px">Open now, not tried yet</h3><ul style="margin:0;padding-left:18px">' + next.slice(0, 6).map((n) =>
        '<li>' + esc(n.journal.name) + ' <span class="sub">' + (n.daysLeft === null ? 'open all year' : n.daysLeft + ' days left') + '</span>' +
        (n.blockedBySim ? ' <span class="sub">No simultaneous submissions, and this poem is out elsewhere.</span>'
          : ' <button class="small" type="button" data-act="new-sub" data-poem="' + esc(id) + '" data-journal="' + esc(n.journal.id) + '">Send out</button>') + '</li>').join('') + '</ul>' : '') +
      '<p class="sub" style="margin-top:14px">Pen Pal keeps the title and your notes. The poem itself stays in your own files.</p></div></div>';
    openDialog(body + '<div class="actions"><span class="grow"></span><button class="primary" type="button" data-close>Close</button></div>', null, () => $('#dlg').classList.add('wide'));
  }

  function rightsDialog(id) {
    const p = L.poemById(data, id);
    if (!p) return;
    const r = p.rights;
    const suggestion = L.suggestedCredit(data, Object.assign({}, p, { rights: Object.assign({}, r, { credit: '' }) }));
    openDialog(
      '<h2>Rights for ' + esc(q(p.title)) + '</h2><p class="hint">Copy these from the acceptance email or contract.</p>' +
      '<label>Rights they took<input name="bought" list="rightsKinds" maxlength="200" value="' + esc(r.bought) + '" placeholder="First North American serial"></label>' +
      '<datalist id="rightsKinds">' + L.RIGHTS_KINDS.map((k) => '<option value="' + esc(k) + '">').join('') + '</datalist>' +
      '<div class="row2"><label>Issue<input name="issue" maxlength="200" value="' + esc(r.issue) + '" placeholder="Fall 2026"></label>' +
      '<label>Publication date<input type="date" name="pubDate" value="' + esc(r.pubDate) + '"></label></div>' +
      '<div class="row2"><label>Exclusive until<input type="date" name="exclusiveUntil" value="' + esc(r.exclusiveUntil) + '"></label>' +
      '<label>Reprints allowed after that?<select name="reprints"><option value="unknown">Not sure</option><option value="yes">Yes, with credit</option><option value="no">No</option></select></label></div>' +
      '<label>When rights come back to you<input name="revert" maxlength="200" value="' + esc(r.revert) + '" placeholder="On publication"></label>' +
      '<label>Credit line for reprints and your book<textarea name="credit" rows="2" maxlength="600" placeholder="' + esc(suggestion) + '">' + esc(r.credit) + '</textarea></label>' +
      '<p class="hint">Leave the credit line empty to use the suggestion. Pen Pal reminds you on the Desk when the exclusive period is about to end, and the calendar file includes that date.</p>' +
      actionsHtml({}),
      (fd) => {
        p.rights = L.normalizeRights({ bought: fd.get('bought'), issue: fd.get('issue'), pubDate: fd.get('pubDate'), exclusiveUntil: fd.get('exclusiveUntil'), reprints: fd.get('reprints'), revert: fd.get('revert'), credit: fd.get('credit') });
        commit('Saved rights for a poem');
        setTimeout(() => poemHistoryDialog(id), 0);
      },
      (form) => { $('[name=reprints]', form).value = r.reprints; $('[name=bought]', form).focus(); }
    );
  }

  // ---------------------------------------------------------------- import journals from CSV
  const IMPORT_LABEL = { '': 'Ignore this column', name: 'Journal name', url: 'Website', opens: 'Opens', closes: 'Closes', fee: 'Fee', maxPoems: 'Most poems', simSubs: 'Simultaneous submissions', notes: 'Notes' };
  function importDialog(text) {
    const parsed = L.parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) { toast('That file has no rows to import.'); return; }
    if (L.guessImportKind(parsed.headers) === 'submissions' && confirm('This file looks like a history of submissions. Import it as submissions instead?')) { subImportDialog(text); return; }
    const mapping = L.guessMapping(parsed.headers);
    let rows = [];
    const sample = (i) => { const r = parsed.rows.find((x) => x[i]); return r ? r[i] : ''; };
    const cols = '<table><thead><tr><th>Column in your file</th><th>Example</th><th>Use it as</th></tr></thead><tbody>' + parsed.headers.map((h, i) =>
      '<tr><td>' + esc(h || '(no heading)') + '</td><td class="sub">' + esc(sample(i).slice(0, 60)) + '</td><td><select data-col="' + i + '" aria-label="Use column ' + esc(h) + ' as">' +
      Object.keys(IMPORT_LABEL).map((k) => '<option value="' + k + '"' + (mapping[i] === k ? ' selected' : '') + '>' + IMPORT_LABEL[k] + '</option>').join('') + '</select></td></tr>').join('') + '</tbody></table>';
    const statusChip = (r) => r.status === 'new' ? chip('ready', 'New') : r.status === 'duplicate' ? chip('withdrawn', 'Already have it') : chip('closed', 'No name');
    const preview = () => {
      rows = L.buildImport(parsed, mapping, data.journals, today());
      const n = rows.filter((r) => r.include).length;
      return '<p class="hint" id="impCount">' + n + ' of ' + rows.length + ' rows will be added. Untick any you do not want.</p>' +
        '<table><thead><tr><th></th><th>Journal</th><th>Reading period</th><th>Fee</th><th>Status</th></tr></thead><tbody>' + rows.map((r, i) => {
          const j = r.journal;
          return '<tr><td><input type="checkbox" data-inc="' + i + '"' + (r.include ? ' checked' : '') + (r.status === 'skip' ? ' disabled' : '') + ' aria-label="Import row ' + r.line + '"></td>' +
            '<td><b>' + esc(j.name || '(blank)') + '</b>' + (j.url ? '<div class="sub">' + esc(j.url) + '</div>' : '') + '</td>' +
            '<td>' + (j.opens ? fmtDate(j.opens) : '') + (j.opens && j.closes ? ' to ' : '') + (j.closes ? fmtDate(j.closes) : '') + (j.repeat === 'yearly' ? '<div class="sub">Repeats every year</div>' : '') + '</td>' +
            '<td>' + (j.fee === null ? '' : j.fee === 0 ? 'Free' : money(j.fee)) + '</td>' +
            '<td>' + statusChip(r) + r.problems.map((x) => '<div class="sub">' + esc(x) + '</div>').join('') + '</td></tr>';
        }).join('') + '</tbody></table>';
    };
    openDialog(
      '<h2>Import journals</h2><p class="hint">Check that each column is matched to the right field, then look over the rows below. ' +
      'Dates are read month first (3/4/2026 is March 4). Dates with no year, like Sep 1 to Nov 30, become a window that repeats every year.</p>' +
      '<div id="impCols">' + cols + '</div><div id="impPreview" style="margin-top:12px">' + preview() + '</div>' +
      '<div class="err" id="dlgErr" role="alert"></div><div class="actions"><span class="grow"></span><button type="button" data-close>Cancel</button><button class="primary" type="submit" value="import">Import</button></div>',
      (fd, action, form) => {
        if (!mapping.includes('name')) return setErr(form, 'Choose which column holds the journal name.');
        const added = L.applyImport(data, rows);
        if (!added) return setErr(form, 'No rows are ticked.');
        tab = 'journals';
        commit('Imported ' + added + ' journal' + (added === 1 ? '' : 's'));
        toast(added + ' journal' + (added === 1 ? '' : 's') + ' added');
      },
      (form) => {
        $('#dlg').classList.add('wide');
        form.addEventListener('change', (ev) => {
          const sel = ev.target.closest('[data-col]');
          const inc = ev.target.closest('[data-inc]');
          if (sel) {
            const i = Number(sel.dataset.col);
            if (sel.value) form.querySelectorAll('[data-col]').forEach((o) => { if (o !== sel && o.value === sel.value) { o.value = ''; mapping[Number(o.dataset.col)] = ''; } });
            mapping[i] = sel.value;
            $('#impPreview', form).innerHTML = preview();
          } else if (inc) {
            rows[Number(inc.dataset.inc)].include = inc.checked;
            $('#impCount', form).textContent = rows.filter((r) => r.include).length + ' of ' + rows.length + ' rows will be added. Untick any you do not want.';
          }
        });
      }
    );
  }

  // ---------------------------------------------------------------- import past submissions from CSV
  const SUB_LABEL_IMPORT = { '': 'Ignore this column', journal: 'Journal', poems: 'Poem titles', sentDate: 'Date sent', status: 'Status', responseDate: 'Reply date', fee: 'Fee paid', notes: 'Notes' };
  function subImportDialog(text) {
    const parsed = L.parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) { toast('That file has no rows to import.'); return; }
    if (L.guessImportKind(parsed.headers) === 'journals' && !confirm('This file looks like a list of journals, not submissions. Import it as submissions anyway?')) { importDialog(text); return; }
    const mapping = L.guessSubMapping(parsed.headers);
    let rows = [];
    const sample = (i) => { const r = parsed.rows.find((x) => x[i]); return r ? r[i] : ''; };
    const cols = '<table><thead><tr><th>Column in your file</th><th>Example</th><th>Use it as</th></tr></thead><tbody>' + parsed.headers.map((h, i) =>
      '<tr><td>' + esc(h || '(no heading)') + '</td><td class="sub">' + esc(sample(i).slice(0, 60)) + '</td><td><select data-col="' + i + '" aria-label="Use column ' + esc(h) + ' as">' +
      Object.keys(SUB_LABEL_IMPORT).map((k) => '<option value="' + k + '"' + (mapping[i] === k ? ' selected' : '') + '>' + SUB_LABEL_IMPORT[k] + '</option>').join('') + '</select></td></tr>').join('') + '</tbody></table>';
    const statusChip = (r) => r.status === 'new' ? chip(r.sub.status, SUB_LABEL[r.sub.status]) : r.status === 'duplicate' ? chip('muted', 'Already have it') : chip('closed', 'Skipped');
    const count = () => {
      const inc = rows.filter((r) => r.include);
      const nj = new Set(inc.filter((r) => r.newJournal).map((r) => r.journalName.toLowerCase())).size;
      const np = new Set([].concat(...inc.map((r) => r.newPoems.map((t) => t.toLowerCase())))).size;
      return inc.length + ' submission' + (inc.length === 1 ? '' : 's') + ' will be added, with ' + nj + ' new journal' + (nj === 1 ? '' : 's') + ' and ' + np + ' new poem title' + (np === 1 ? '' : 's') + '.';
    };
    const preview = () => {
      rows = L.buildSubImport(parsed, mapping, data, today());
      return '<p class="hint" id="impCount">' + count() + ' Untick any you do not want.</p>' +
        '<table><thead><tr><th></th><th>Journal</th><th>Poems</th><th>Sent</th><th>Result</th></tr></thead><tbody>' + rows.map((r, i) =>
          '<tr><td><input type="checkbox" data-inc="' + i + '"' + (r.include ? ' checked' : '') + (r.status === 'skip' ? ' disabled' : '') + ' aria-label="Import row ' + r.line + '"></td>' +
          '<td><b>' + esc(r.journalName || '(none)') + '</b>' + (r.newJournal ? '<div class="sub">New journal</div>' : '') + '</td>' +
          '<td>' + esc(r.titles.join('; ') || '(none)') + (r.newPoems.length ? '<div class="sub">New: ' + esc(r.newPoems.join('; ')) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + (r.sub.sentDate ? fmtDate(r.sub.sentDate) : '') + '</td>' +
          '<td>' + statusChip(r) + (r.reason ? '<div class="sub">' + esc(r.reason) + '</div>' : '') + r.problems.map((x) => '<div class="sub">' + esc(x) + '</div>').join('') + '</td></tr>').join('') + '</tbody></table>';
    };
    openDialog(
      '<h2>Import your submission history</h2><p class="hint">Check that each column is matched to the right field, then look over the rows. Dates are read month first (3/4/2026 is March 4). ' +
      'Several titles in one cell can be split with a semicolon. A row marked as never answered comes in as withdrawn, with a note.</p>' +
      '<div>' + cols + '</div><div id="impPreview" style="margin-top:12px">' + preview() + '</div>' +
      '<div class="err" id="dlgErr" role="alert"></div><div class="actions"><span class="grow"></span><button type="button" data-close>Cancel</button><button class="primary" type="submit" value="import">Import</button></div>',
      (fd, action, form) => {
        if (!mapping.includes('journal') || !mapping.includes('poems')) return setErr(form, 'Choose which columns hold the journal and the poem titles.');
        const res = L.applySubImport(data, rows);
        if (!res.submissions) return setErr(form, 'No rows are ticked.');
        tab = 'subs';
        ui.subFilter = 'all';
        commit('Imported ' + res.submissions + ' submission' + (res.submissions === 1 ? '' : 's'));
        toast(res.submissions + ' submissions, ' + res.journals + ' journals and ' + res.poems + ' poem titles added');
      },
      (form) => {
        $('#dlg').classList.add('wide');
        form.addEventListener('change', (ev) => {
          const sel = ev.target.closest('[data-col]');
          const inc = ev.target.closest('[data-inc]');
          if (sel) {
            if (sel.value) form.querySelectorAll('[data-col]').forEach((o) => { if (o !== sel && o.value === sel.value) { o.value = ''; mapping[Number(o.dataset.col)] = ''; } });
            mapping[Number(sel.dataset.col)] = sel.value;
            $('#impPreview', form).innerHTML = preview();
          } else if (inc) {
            rows[Number(inc.dataset.inc)].include = inc.checked;
            $('#impCount', form).textContent = count() + ' Untick any you do not want.';
          }
        });
      }
    );
  }

  // ---------------------------------------------------------------- manuscripts and entries
  const ENTRY_LABEL = { planned: 'Not sent yet', pending: 'Sent', finalist: 'Finalist', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
  const ENTRY_CHIP = { planned: 'ready', pending: 'pending', finalist: 'pending', accepted: 'accepted', rejected: 'rejected', withdrawn: 'withdrawn' };
  const KIND_LABEL = { chapbook: 'Chapbook', 'full-length': 'Full-length book', other: 'Other' };
  const MS_STATE = { planning: ['draft', 'Planning'], out: ['out', 'Out'], placed: ['published', 'Accepted'] };

  function viewBooks() {
    const t = today();
    let html = '<div class="toolbar"><h2 style="margin:0">Manuscripts</h2><span class="grow"></span>' +
      '<button class="primary" data-act="add-manuscript">Add manuscript</button></div>' +
      '<p class="hint">A chapbook or book is tracked here, apart from single-poem submissions. List the poems in it (titles only), then log each press or contest you enter it in.</p>';
    if (!data.manuscripts.length) return html + '<div class="empty">No manuscripts yet.</div>';
    for (const m of data.manuscripts.slice().sort((a, b) => a.title.localeCompare(b.title))) {
      const sum = L.manuscriptSummary(data, m);
      const st = MS_STATE[L.manuscriptState(data, m)];
      const warns = L.manuscriptWarnings(data, m);
      const es = L.entriesFor(data, m.id).sort((a, b) => (a.deadline || a.sentDate || '9999').localeCompare(b.deadline || b.sentDate || '9999'));
      html += '<section class="card"><div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">' + esc(m.title) + '</h2>' + chip(st[0], st[1]) +
        '<span class="sub">' + esc(KIND_LABEL[m.kind]) + (m.pageCount ? ', ' + m.pageCount + ' pages' : '') + '</span><span class="grow"></span>' +
        '<button class="small" data-act="add-entry" data-manuscript="' + esc(m.id) + '">Add entry</button>' +
        '<button class="small" data-act="edit-manuscript" data-id="' + esc(m.id) + '">Edit</button></div>' +
        '<p class="sub" style="margin:0 0 8px">' + sum.poemCount + ' poem' + (sum.poemCount === 1 ? '' : 's') +
        (sum.poemCount ? ': ' + sum.placed + ' accepted or published (' + sum.placedPct + '%), ' + sum.out + ' out, ' + sum.ready + ' ready, ' + sum.draft + ' draft' : '') + '.' +
        (m.poemIds.length ? ' ' + esc(titlesOf(m.poemIds)) : '') + '</p>' +
        (m.notes ? '<p class="sub" style="margin:0 0 8px">' + esc(m.notes) + '</p>' : '') +
        (warns.length ? '<ul class="warns">' + warns.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '');
      if (es.length) {
        html += '<table><thead><tr><th>Press or contest</th><th>Deadline</th><th>Fee</th><th>Status</th><th></th></tr></thead><tbody>' + es.map((e) => {
          const url = safeUrl(e.url);
          let note = '';
          if (e.sentDate) note = 'Sent ' + fmtDate(e.sentDate);
          if (e.responseDate) note += (note ? ', ' : '') + 'answered ' + fmtDate(e.responseDate) + (e.sentDate ? ' (' + L.daysBetween(e.sentDate, e.responseDate) + ' days)' : '');
          const dl = e.deadline ? fmtDate(e.deadline) + (e.status === 'planned' && e.deadline >= t ? '<div class="sub">' + rel(L.daysBetween(t, e.deadline)) + '</div>' : '') : '';
          const live = L.isActiveEntry(e);
          return '<tr><td><b>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.name) + '</a>' : esc(e.name)) + '</b>' +
            (e.notes ? '<div class="sub">' + esc(e.notes) + '</div>' : '') + '</td><td class="nowrap">' + dl + '</td>' +
            '<td>' + (e.fee === null ? '' : e.fee === 0 ? 'Free' : money(e.fee)) + '</td>' +
            '<td>' + chip(ENTRY_CHIP[e.status], ENTRY_LABEL[e.status]) + '<div class="sub">' + esc(note) + '</div></td><td class="nowrap"><div class="btnrow">' +
            (e.status === 'planned' ? '<button class="small" data-act="status-entry" data-id="' + esc(e.id) + '" data-status="pending">Mark sent</button>'
              : live ? '<button class="small" data-act="status-entry" data-id="' + esc(e.id) + '" data-status="accepted">Accepted</button><button class="small" data-act="status-entry" data-id="' + esc(e.id) + '" data-status="rejected">Rejected</button>'
                : '<button class="small" data-act="status-entry" data-id="' + esc(e.id) + '">Change status</button>') +
            '<button class="small" data-act="edit-entry" data-id="' + esc(e.id) + '">Edit</button></div></td></tr>';
        }).join('') + '</tbody></table>';
      } else {
        html += '<p class="hint">No presses or contests logged for this manuscript yet.</p>';
      }
      html += '</section>';
    }
    return html;
  }

  function manuscriptDialog(id) {
    const m = id ? L.manuscriptById(data, id) : { title: '', kind: 'chapbook', pageCount: null, poemIds: [], notes: '' };
    if (!m) return;
    const poems = data.poems.slice().sort((a, b) => a.title.localeCompare(b.title));
    openDialog(
      '<h2>' + (id ? 'Edit manuscript' : 'Add manuscript') + '</h2>' +
      '<label>Title<input name="title" required maxlength="300" value="' + esc(m.title) + '"></label>' +
      '<div class="row2"><label>Kind<select name="kind">' + L.MS_KINDS.map((k) => '<option value="' + k + '">' + KIND_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<label>Page count<input type="number" name="pageCount" min="1" step="1" value="' + (m.pageCount === null ? '' : m.pageCount) + '"></label></div>' +
      '<fieldset><legend>Poems in it</legend>' + (poems.length
        ? poems.map((p) => '<label class="check"><input type="checkbox" name="poem" value="' + esc(p.id) + '"' + (m.poemIds.includes(p.id) ? ' checked' : '') + '> ' + esc(p.title) + '</label>').join('')
        : '<p class="hint">No poems yet. Add them on the Poems tab, then come back and edit this.</p>') + '</fieldset>' +
      '<label>Notes<textarea name="notes" rows="2" maxlength="5000">' + esc(m.notes) + '</textarea></label>' +
      '<ul class="warns" id="warns" aria-live="polite"></ul>' + actionsHtml({ del: !!id }),
      (fd, action, form) => {
        if (action === 'delete') {
          const n = L.entriesFor(data, id).length;
          if (!confirm('Delete ' + q(m.title) + '?' + (n ? ' Its ' + n + ' logged entr' + (n === 1 ? 'y' : 'ies') + ' will be deleted too.' : ''))) return false;
          L.removeManuscript(data, id);
          return commit('Deleted a manuscript');
        }
        const title = String(fd.get('title')).trim();
        if (!title) return setErr(form, 'Please enter a title.');
        const fields = { title, kind: fd.get('kind'), pageCount: fd.get('pageCount'), poemIds: fd.getAll('poem'), notes: String(fd.get('notes')) };
        if (id) Object.assign(m, L.normalizeManuscript(Object.assign({}, m, fields)));
        else data.manuscripts.push(L.normalizeManuscript(Object.assign({ id: L.uid() }, fields)));
        tab = 'books';
        commit('Saved a manuscript');
      },
      (form) => {
        $('[name=kind]', form).value = m.kind;
        const warns = () => {
          const draft = L.normalizeManuscript({ id, title: 'x', kind: $('[name=kind]', form).value, pageCount: $('[name=pageCount]', form).value, poemIds: Array.from(form.querySelectorAll('[name=poem]:checked')).map((c) => c.value) });
          $('#warns', form).innerHTML = L.manuscriptWarnings(data, draft).map((w) => '<li>' + esc(w) + '</li>').join('');
        };
        form.addEventListener('change', warns);
        form.addEventListener('input', warns);
        warns();
        $('[name=title]', form).focus();
      }
    );
  }

  function acceptedBookDialog(manuscriptId) {
    const alerts = L.entryAlerts(data).filter((a) => a.manuscript.id === manuscriptId);
    if (!alerts.length) return;
    tab = 'desk';
    render();
    setTimeout(() => infoDialog('Congratulations. Now withdraw elsewhere',
      '<p>' + esc(q(alerts[0].manuscript.title)) + ' is still out at ' + esc(alerts[0].entries.map((e) => e.name).join(', ')) +
      '.</p><p class="hint">Your Desk lists each one with a note ready to copy.</p>', 'Got it'), 0);
  }

  function entryDialog(id, preset) {
    preset = preset || {};
    if (!data.manuscripts.length) { infoDialog('Add a manuscript first', '<p>An entry links a manuscript to a press or contest. Add a manuscript on the Manuscripts tab first.</p>'); return; }
    const existing = id ? L.entryById(data, id) : null;
    if (id && !existing) return;
    const e = existing || { manuscriptId: preset.manuscriptId || (data.manuscripts.length === 1 ? data.manuscripts[0].id : ''), name: '', url: '', deadline: '', fee: null, feePaid: null, sentDate: '', status: 'planned', responseDate: '', notes: '' };
    openDialog(
      '<h2>' + (existing ? 'Edit entry' : 'Add an entry') + '</h2>' +
      '<label>Manuscript<select name="manuscriptId" required><option value="">Choose a manuscript…</option>' +
      data.manuscripts.slice().sort((a, b) => a.title.localeCompare(b.title)).map((m) => '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>').join('') + '</select></label>' +
      '<label>Press or contest<input name="name" required maxlength="300" value="' + esc(e.name) + '"></label>' +
      '<label>Website or guidelines page<input name="url" maxlength="600" placeholder="https://" value="' + esc(e.url) + '"></label>' +
      '<div class="row2"><label>Deadline<input type="date" name="deadline" value="' + esc(e.deadline) + '"></label>' +
      '<label>Entry fee ($)<input type="number" name="fee" min="0" step="0.01" value="' + (e.fee === null ? '' : e.fee) + '"></label></div>' +
      '<label>Status<select name="status">' + L.ENTRY_STATUSES.map((k) => '<option value="' + k + '">' + ENTRY_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<div class="row2"><label id="sentField">Date sent<input type="date" name="sentDate" value="' + esc(e.sentDate) + '"></label>' +
      '<label id="paidField">Fee paid ($)<input type="number" name="feePaid" min="0" step="0.01" value="' + (e.feePaid === null ? '' : e.feePaid) + '"></label></div>' +
      '<label id="respField">Date they replied<input type="date" name="responseDate" value="' + esc(e.responseDate) + '"></label>' +
      '<label>Notes<textarea name="notes" rows="2" maxlength="5000">' + esc(e.notes) + '</textarea></label>' +
      '<ul class="warns" id="warns" aria-live="polite"></ul>' + actionsHtml({ del: !!existing }),
      (fd, action, form) => {
        if (action === 'delete') {
          if (!confirm('Delete this entry?')) return false;
          data.entries = data.entries.filter((x) => x.id !== id);
          return commit('Deleted an entry');
        }
        const status = fd.get('status');
        const name = String(fd.get('name')).trim();
        if (!fd.get('manuscriptId')) return setErr(form, 'Choose a manuscript.');
        if (!name) return setErr(form, 'Please enter the press or contest name.');
        const sent = status === 'planned' ? '' : String(fd.get('sentDate')) || today();
        const replied = ['accepted', 'rejected', 'withdrawn'].includes(status) ? String(fd.get('responseDate')) || today() : '';
        if (sent && replied && replied < sent) return setErr(form, 'The reply date is before the date sent.');
        let url = String(fd.get('url')).trim();
        if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
        const fields = { manuscriptId: fd.get('manuscriptId'), name, url, deadline: fd.get('deadline'), fee: fd.get('fee'), feePaid: fd.get('feePaid'), status, sentDate: sent, responseDate: replied, notes: String(fd.get('notes')) };
        if (existing) Object.assign(existing, L.normalizeEntry(Object.assign({}, existing, fields)));
        else data.entries.push(L.normalizeEntry(Object.assign({ id: L.uid() }, fields)));
        tab = 'books';
        commit('Saved an entry');
        if (status === 'accepted') acceptedBookDialog(fields.manuscriptId);
      },
      (form) => {
        const ms = $('[name=manuscriptId]', form), st = $('[name=status]', form), fee = $('[name=fee]', form), paid = $('[name=feePaid]', form);
        ms.value = e.manuscriptId;
        st.value = e.status;
        const sync = () => {
          $('#sentField', form).hidden = st.value === 'planned';
          $('#paidField', form).hidden = st.value === 'planned';
          $('#respField', form).hidden = !['accepted', 'rejected', 'withdrawn'].includes(st.value);
        };
        const warns = () => {
          const sent = st.value === 'planned' ? '' : $('[name=sentDate]', form).value;
          const draft = { id: id || undefined, manuscriptId: ms.value, name: $('[name=name]', form).value, deadline: $('[name=deadline]', form).value, sentDate: sent, fee: fee.value, feePaid: st.value === 'planned' ? '' : paid.value };
          $('#warns', form).innerHTML = L.checkEntry(data, draft, today()).map((m) => '<li>' + esc(m) + '</li>').join('');
        };
        st.addEventListener('change', () => {
          if (st.value !== 'planned' && !$('[name=sentDate]', form).value) $('[name=sentDate]', form).value = today();
          if (['accepted', 'rejected', 'withdrawn'].includes(st.value) && !$('[name=responseDate]', form).value) $('[name=responseDate]', form).value = today();
          if (st.value !== 'planned' && !paid.value && !paid.dataset.touched && fee.value) paid.value = fee.value;
          sync();
        });
        paid.addEventListener('input', () => { paid.dataset.touched = '1'; });
        form.addEventListener('change', warns);
        form.addEventListener('input', (ev) => { if (ev.target.name === 'name') warns(); });
        sync();
        warns();
        $('[name=name]', form).focus();
      }
    );
  }

  function entryStatusDialog(id, preset) {
    const e = L.entryById(data, id);
    if (!e) return;
    openDialog(
      '<h2>' + esc(e.name) + '</h2><p class="hint">' + esc((L.manuscriptById(data, e.manuscriptId) || { title: '' }).title) + '</p>' +
      '<label>Status<select name="status">' + L.ENTRY_STATUSES.map((k) => '<option value="' + k + '">' + ENTRY_LABEL[k] + '</option>').join('') + '</select></label>' +
      '<label id="dateField"><span id="dateLabel">Date</span><input type="date" name="date" value="' + esc(today()) + '"></label>' + actionsHtml({}),
      (fd) => {
        const status = fd.get('status');
        const alerts = L.setEntryStatus(data, id, status, fd.get('date') || today());
        commit('Changed an entry status');
        if (alerts.length) acceptedBookDialog(e.manuscriptId);
      },
      (form) => {
        const sel = $('[name=status]', form);
        sel.value = preset || e.status;
        const sync = () => {
          $('#dateField', form).hidden = sel.value === 'planned' || sel.value === 'finalist';
          $('#dateLabel', form).textContent = sel.value === 'pending' ? 'Date you sent it' : 'Date they replied';
        };
        sel.addEventListener('change', sync);
        sync();
      }
    );
  }

  function queryText(subId) {
    const s = data.submissions.find((x) => x.id === subId);
    if (!s) return '';
    const titles = titlesOf(L.activePoemIds(s));
    return 'Subject: Status query: ' + titles + '\n\nHello,\n\nI sent ' + titles + (s.sentDate ? ' on ' + fmtDate(s.sentDate) : '') +
      ' and wanted to check whether ' + (L.activePoemIds(s).length > 1 ? 'they are' : 'it is') + ' still under consideration. Thank you for your time and for reading my work.\n\nBest,\n[Your name]';
  }
  function withdrawEntryText(entryId) {
    const e = L.entryById(data, entryId);
    const m = e && L.manuscriptById(data, e.manuscriptId);
    if (!e || !m) return '';
    return 'Subject: Withdrawal: ' + q(m.title) + '\n\nHello,\n\nI am writing to withdraw my manuscript ' + q(m.title) + ' from consideration, as it has been accepted elsewhere. ' +
      'Thank you very much for reading it.\n\nBest,\n[Your name]';
  }

  // ---------------------------------------------------------------- insights
  function barRows(items) {
    return '<div class="bars">' + items.map((i) =>
      '<div class="barrow" title="' + esc(i.title || '') + '"><span class="barlabel">' + esc(i.label) + (i.sub ? ' <span class="sub">' + esc(i.sub) + '</span>' : '') + '</span>' +
      '<span class="bartrack"><span class="barfill" style="width:' + (i.max ? Math.max((i.value / i.max) * 100, i.value > 0 ? 1.5 : 0) : 0).toFixed(1) + '%"></span></span>' +
      '<span class="barval">' + esc(i.text) + '</span></div>').join('') + '</div>';
  }
  function viewInsights() {
    const st = L.stats(data);
    const js = L.journalStats(data);
    const buckets = L.responseBuckets(data);
    const sp = L.spend(data);
    const decided = st.accepted + st.rejected;
    let html = pageHead('How it is going', 'Insights');
    if (!decided && !js.length) {
      return html + '<div class="empty">Charts fill in as you log submissions and record replies.</div>';
    }
    html += '<div class="stats" style="margin-bottom:18px">' + [
      [decided ? st.accepted + ' of ' + decided : '–', 'Accepted, of those answered'],
      [st.acceptRate === null ? '–' : Math.round(st.acceptRate * 100) + '%', 'Acceptance rate'],
      [st.medianDays === null ? '–' : Math.round(st.medianDays) + 'd', 'Median reply'],
      [money(sp.total) || '$0', 'Fees paid in total'],
    ].map((x) => '<div class="stat"><b>' + esc(x[0]) + '</b><span>' + x[1] + '</span></div>').join('') + '</div>';

    const timed = js.filter((r) => r.medianDays !== null).sort((a, b) => a.medianDays - b.medianDays);
    html += '<section class="card"><h3>How long each journal takes to answer</h3><p class="hint">Median days from sending to a reply (accepted or rejected). With only a few replies, treat it as a rough guide.</p>' +
      (timed.length
        ? barRows(timed.map((r) => ({ label: r.name, sub: r.waits + ' repl' + (r.waits === 1 ? 'y' : 'ies'), value: r.medianDays, max: timed[timed.length - 1].medianDays || 1, text: Math.round(r.medianDays) + ' days', title: r.name + ': median ' + Math.round(r.medianDays) + ' days over ' + r.waits + ' replies' })))
        : '<p class="hint">No replies with both a sent date and a reply date yet.</p>') + '</section>';

    const answered = js.filter((r) => r.decided > 0).sort((a, b) => b.acceptRate - a.acceptRate || b.decided - a.decided);
    html += '<section class="card"><h3>Acceptance by journal</h3><p class="hint">Accepted out of the submissions that got a yes or a no. Withdrawn and still-waiting ones are left out.</p>' +
      (answered.length
        ? barRows(answered.map((r) => ({ label: r.name, value: r.acceptRate * 100, max: 100, text: r.accepted + ' of ' + r.decided, title: r.name + ': ' + r.accepted + ' accepted out of ' + r.decided + ' answered' })))
        : '<p class="hint">Nothing answered yet.</p>') + '</section>';

    const most = Math.max.apply(null, buckets.map((b) => b.count));
    html += '<section class="card"><h3>How long replies take overall</h3><p class="hint">Number of answered submissions in each range.</p>' +
      (most ? barRows(buckets.map((b) => ({ label: b.label, value: b.count, max: most, text: String(b.count), title: b.label + ': ' + b.count }))) : '<p class="hint">No replies with dates yet.</p>') + '</section>';

    if (data.entries.length) {
      const n = (k) => data.entries.filter((e) => e.status === k).length;
      html += '<section class="card"><h3>Manuscript entries</h3><p>' + data.entries.length + ' logged: ' + n('planned') + ' not sent yet, ' + (n('pending') + n('finalist')) + ' waiting, ' + n('accepted') + ' accepted, ' + n('rejected') + ' rejected, ' + n('withdrawn') + ' withdrawn.</p>' +
        '<p class="sub">Fees paid: ' + (money(sp.submissions) || '$0') + ' on journal submissions and ' + (money(sp.entries) || '$0') + ' on manuscript entries.</p></section>';
    }
    return html;
  }

  // ---------------------------------------------------------------- events
  const actions = {
    'bulk-poems': () => bulkPoemsDialog(),
    'add-poem': () => poemDialog(),
    'edit-poem': (d) => poemDialog(d.id),
    'add-journal': () => journalDialog(),
    'edit-journal': (d) => journalDialog(d.id),
    'new-sub': (d) => subDialog(null, { poemId: d.poem, journalId: d.journal }),
    'edit-sub': (d) => subDialog(d.id),
    'status-sub': (d) => statusDialog(d.id, d.status),
    'withdraw': (d) => { L.withdrawPoem(data, d.sub, d.poem, today()); commit('Marked withdrawn'); toast('Marked withdrawn'); },
    'copy-withdraw': (d) => copyText(withdrawText(d.sub, d.poem)),
    'poem-history': (d) => poemHistoryDialog(d.id),
    'edit-rights': (d) => rightsDialog(d.id),
    'copy-credit': (d) => { const p = L.poemById(data, d.id); if (p) copyText(p.rights.credit || L.suggestedCredit(data, p)); },
    'find-toggle': (d) => { ui.find[d.key] = !ui.find[d.key]; render(); },
    'find-pick': (d) => { ui.findSel = d.id; render(); const el = document.querySelector('.detail'); if (el && window.innerWidth <= 900) el.scrollIntoView({ block: 'start' }); },
    'find-add': (d) => {
      const e = dir.journals.find((x) => x.id === d.id);
      if (!e) return;
      data.journals.push(L.dirToJournal(e, today(), dir.checked));
      commit('Added ' + e.name);
      toast(e.name + ' added to your journals');
    },
    'go-export': () => { tab = 'export'; render(); $('#view').focus(); },
    'copy-query': (d) => copyText(queryText(d.id)),
    'queried': (d) => { L.markQueried(data, d.id, today()); commit('Marked a follow-up sent'); toast('Noted. Pen Pal will remind you again in 60 days.'); },
    'snooze-query': (d) => { L.snoozeQuery(data, d.id, today(), 30); commit('Snoozed a follow-up'); toast('Snoozed for 30 days'); },
    'budget-year': (d) => { ui.budgetYear += Number(d.delta); render(); },
    'budget-save': () => {
      const amt = $('#budgetAmount').value, warn = $('#budgetWarn').value;
      if (amt !== '' && !(Number(amt) >= 0)) { toast('Enter the budget as a number of dollars.'); return; }
      L.setBudget(data, ui.budgetYear, amt);
      data.settings = L.normalizeSettings(Object.assign({}, data.settings, { budgetWarnPct: warn, countPlanned: $('#countPlanned').checked }));
      commit('Changed the fee budget');
      toast(amt === '' ? 'Budget removed' : 'Budget saved');
    },
    'budget-clear': () => { L.setBudget(data, ui.budgetYear, ''); commit('Removed the fee budget'); },
    'open-data-folder': async () => {
      const api = window.pywebview && window.pywebview.api;
      if (api && api.open_data_folder) { try { await api.open_data_folder(); } catch (e) { toast('Could not open the folder.'); } }
    },
    'import-journals': () => $('#importFile').click(),
    'add-manuscript': () => manuscriptDialog(),
    'edit-manuscript': (d) => manuscriptDialog(d.id),
    'add-entry': (d) => entryDialog(null, { manuscriptId: d.manuscript }),
    'edit-entry': (d) => entryDialog(d.id),
    'status-entry': (d) => entryStatusDialog(d.id, d.status),
    'withdraw-entry': (d) => { L.setEntryStatus(data, d.id, 'withdrawn', today()); commit('Marked an entry withdrawn'); toast('Marked withdrawn'); },
    'copy-withdraw-entry': (d) => copyText(withdrawEntryText(d.id)),
    'snooze-backup': () => { L.snoozeBackupReminder(data, today(), 90); commitQuiet(); toast('OK. The reminder is off for 90 days.'); },
    'save-folder': () => saveFolder($('#folderInput').value),
    'clear-folder': () => saveFolder(''),
    'dl-entries-csv': () => download('pen-pal-manuscript-entries-' + today() + '.csv', '\ufeff' + L.toEntriesCSV(data), 'text/csv;charset=utf-8'),
    'dl-csv': () => download('pen-pal-submissions-' + today() + '.csv', '﻿' + L.toCSV(data), 'text/csv;charset=utf-8'),
    'dl-ics': () => download('pen-pal-deadlines.ics', L.toICS(data, today()), 'text/calendar;charset=utf-8'),
    'dl-backup': async () => {
      const ok = await download('pen-pal-backup-' + today() + '.json', JSON.stringify(data, null, 2), 'application/json');
      if (!ok) return;
      L.markBackupDownloaded(data, today());
      commitQuiet();
    },
    'copy-pub': () => copyText(L.publishedList(data).text),
  };
  async function saveFolder(value) {
    const err = $('#folderErr');
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Poetry-Tracker': '1' }, body: JSON.stringify({ backupFolder: value }) });
      const b = await r.json();
      if (!r.ok) { if (err) err.textContent = b.error || 'Could not save that folder.'; return; }
      await refreshServer();
      render();
      toast(value.trim() ? (server.lastCopyOk === false ? 'Saved, but the copy failed. See below.' : 'Second folder set') : 'Second copy switched off');
    } catch (e) {
      if (err) err.textContent = 'Could not reach Pen Pal in the background. Try closing and opening it again.';
    }
  }
  $('#undoBtn').addEventListener('click', () => stepHistory(false));
  $('#redoBtn').addEventListener('click', () => stepHistory(true));
  document.addEventListener('keydown', (e) => {
    if (!data || !(e.ctrlKey || e.metaKey) || $('#dlg').open) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(false); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepHistory(true); }
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; render(); $('#view').focus(); return; }
    const b = e.target.closest('[data-act]');
    if (b && actions[b.dataset.act]) actions[b.dataset.act](b.dataset);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'subFilter') { ui.subFilter = e.target.value; render(); }
    else if (e.target.id === 'poemFilter') { ui.poemFilter = e.target.value; render(); }
    else if (e.target.id === 'importSubsFile') {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) f.text().then(subImportDialog, () => toast('Could not read that file.'));
    } else if (e.target.id === 'importFile') {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) f.text().then(importDialog, () => toast('Could not read that file.'));
    } else if (e.target.id === 'restoreFile') {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        let obj;
        try { obj = JSON.parse(txt); } catch (err) { toast('That file is not valid JSON.'); return; }
        if (!obj || !Array.isArray(obj.poems) || !Array.isArray(obj.journals) || !Array.isArray(obj.submissions)) { toast('That does not look like a Pen Pal or Poetry Tracker backup.'); return; }
        const d = L.normalize(obj);
        if (!confirm('Replace everything here with the backup? It has ' + d.poems.length + ' poems, ' + d.journals.length + ' journals and ' + d.submissions.length + ' submissions.')) return;
        d.rev = data.rev;
        data = d;
        commit('Restored a backup');
        toast('Backup restored');
      });
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'findQuery') {
      ui.findQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const el = $('#findQuery');
      el.focus();
      el.setSelectionRange(pos, pos);
    } else if (e.target.id === 'poemQuery') {
      ui.poemQuery = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const el = $('#poemQuery');
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  });

  // ---------------------------------------------------------------- start
  async function boot() {
    try {
      const r = await fetch('/api/data');
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.status);
      data = L.normalize(body);
      lastSnap = L.snapshot(data);
      try { const d = await fetch('directory.json'); if (d.ok) dir = L.loadDirectory(await d.json()); } catch (e) { /* the app works without it */ }
      try { const i = await fetch('/api/info'); if (i.ok) info = await i.json(); } catch (e) { /* optional */ }
      setStatus('Saved on this PC');
      render();
      refreshServer();
    } catch (e) {
      $('#view').innerHTML = '<div class="card alert"><h2>Could not load your data</h2><p>' + esc(e.message) +
        '</p><p>Nothing has been changed. If Pen Pal was closed in the background, start it again.</p></div>';
    }
  }
  boot();
})();
