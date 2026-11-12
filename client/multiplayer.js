/* multiplayer.js - boot + wiring. */
(async function boot() {
  const app = { alive: true };
  window.__ICMP__ = { alive: true, version: M.VERSION, show() { app.ui && app.ui.setCollapsed(false); }, disconnect: () => app.disconnect && app.disconnect(true) };

  app.api = new M.Api(M.CONFIG);
  app.adapter = new M.Adapter();
  app.rm = new M.RoomManager(app.api);
  app.ui = new M.UI(app);
  app.round = null;

  app.disconnect = async (closeUi) => {
    if (!app.alive) return;
    app.alive = false;
    try { await app.rm.leave(); } catch { /* ignore */ }
    app.round && app.round.destroy();
    app.adapter.destroy();
    app.ui.destroy();
    delete window.__ICMP__;
    console.info('[ICMP] disconnected');
  };
  app.leaveRoom = async () => { app.round && app.round.destroy(); app.round = null; await app.rm.leave(); app.ui.render(null); };

  app.rm.on('status', (st, detail) => app.ui.setStatus(st, detail));
  app.rm.on('error', e => app.ui.toast(M.errText(e), 'bad'));
  app.rm.on('ejected', reason => {
    app.round && app.round.destroy(); app.round = null; app.ui.sig = '';
    app.ui.render(null);
    app.ui.toast(M.errText({ code: reason }), reason === 'kicked' ? 'bad' : 'warn');
  });
  app.rm.on('state', (s, prev) => {
    // new round -> fresh Round controller; leaving play phases -> tear down
    const inGame = !!s.game && s.phase !== 'lobby';
    if (inGame && (!app.round || app.round.gameId !== s.game.id)) { app.round && app.round.destroy(); app.round = new M.Round(app); app.round.gameId = s.game.id; }
    if (!inGame && app.round) { app.round.destroy(); app.round = null; }
    if (prev && prev.phase !== s.phase) app.onPhase(s, prev);
    app.ui.render(s);
    app.round && app.round.onState(s);
  });
  app.onPhase = (s, prev) => {
    if (s.phase === 'vote') app.ui.toast('Everyone submitted - vote!', 'info');
    if (s.phase === 'playing') app.ui.toast(`Target chosen: ${s.game.target}`, 'good');
    if (s.phase === 'results') app.ui.toast(s.result.outcome === 'win' ? `${s.result.winnerName} crafted ${s.result.target}!` : 'Round over', 'info');
    if (s.phase === 'lobby' && prev.phase === 'results') app.ui.toast('Back in the lobby', 'info');
  };
  let prevSi = null;
  setInterval(() => {
    const si = app.rm.state && app.rm.state.phase === 'playing' ? app.rm.startsInMs() : null;
    if (prevSi > 0 && si === 0) app.ui.toast('GO!  Start crafting!', 'good');
    prevSi = si;
  }, 100);

  app.ui.render(null);
  app.ui.setStatus('idle');
  if (!M.Adapter.onGame()) {
    app.ui.toast('Open https://neal.fun/infinite-craft/ first, then run the snippet there.', 'bad');
    app.ui.body.replaceChildren(M.h('div', { class: 'landing' }, M.h('h2', {}, 'Wrong page'),
      M.h('p', { class: 'hint' }, 'Multiplayer works on the original Infinite Craft. Open it, then paste the snippet into that tab\'s console.'),
      M.h('a', { class: 'btn primary', href: 'https://neal.fun/infinite-craft/', target: '_blank', rel: 'noopener' }, 'Open Infinite Craft')));
    return;
  }
  try { await app.adapter.ready(); }
  catch (e) {
    app.ui.setStatus('error', e.message); app.ui.toast(e.message, 'bad');
    app.ui.body.replaceChildren(M.h('div', { class: 'landing' }, M.h('h2', {}, 'Couldn\'t attach to the game'), M.h('p', { class: 'hint' }, e.message + ' Try reloading the game page and running the snippet again.')));
    return;
  }
  if (await app.rm.resume()) app.ui.toast('Reconnected to your room', 'good');
  console.info('[ICMP] Infinite Craft Multiplayer ' + M.VERSION + ' ready');
})();
