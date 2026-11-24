(async function () {
  'use strict';
  const L = window.Logic;
  const api = () => window.pywebview && window.pywebview.api;
  await new Promise((done) => {
    if (api() && api().finish) done();
    else window.addEventListener('pywebviewready', done, { once: true });
  });
  let alerts = [];
  let error = '';
  try {
    const r = await fetch('/api/data');
    if (!r.ok) throw new Error('data ' + r.status);
    alerts = L.windowAlerts(L.normalize(await r.json()), L.todayLocal());
  } catch (e) {
    error = String((e && e.message) || e);
  }
  await api().finish(alerts, error);
})();
