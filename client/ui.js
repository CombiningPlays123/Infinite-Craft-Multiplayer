/* ui.js - the overlay. Lives in a Shadow DOM so the game's CSS can't leak in and ours can't leak out,
   docked to a screen corner and collapsible so the original game stays fully usable. */
const TIMERS = [[60, '1 min'], [180, '3 min'], [300, '5 min'], [600, '10 min'], [900, '15 min'], [1800, '30 min'], [0, 'Unlimited']];

class UI {
  constructor(app) {
    const { h } = M;
    this.app = app; this.draft = {}; this.sig = ''; this.refs = {}; this.collapsed = M.store.get('icmp.collapsed', false);
    this.dock = M.store.get('icmp.dock', 'left');
    this.host = h('div', { id: 'icmp-root', style: { all: 'initial', position: 'fixed', zIndex: '2147483000', top: '0', left: '0', width: '0', height: '0' } });
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.appendChild(h('style', { text: M.STYLES }));
    this.toasts = h('div', { class: 'toasts' });
    this.banner = h('div', { class: 'banner-wrap' });
    this.status = h('span', { class: 'status', title: 'connection' });
    this.codeChip = h('button', { class: 'code-chip', style: { display: 'none' }, title: 'Copy room code', onclick: () => this.copyCode() });
    this.head = h('div', { class: 'head' },
      h('span', { class: 'logo' }, '∞'), h('span', { class: 'title' }, 'Multiplayer'), this.status, this.codeChip,
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon', title: 'Move to other side', onclick: () => this.setDock(this.dock === 'left' ? 'right' : 'left') }, '⇆'),
      h('button', { class: 'icon', title: 'Minimise', onclick: () => this.setCollapsed(true) }, '–'),
      h('button', { class: 'icon', title: 'Disconnect and close', onclick: () => this.app.disconnect(true) }, '✕'));
    this.body = h('div', { class: 'body' });
    this.chat = new M.Chat(app);
    this.chatSlot = h('div', { class: 'chat-slot' });
    this.panel = h('div', { class: 'panel' }, this.head, this.banner, this.body, this.chatSlot);
    this.pill = h('button', { class: 'pill', onclick: () => this.setCollapsed(false) }, h('span', { class: 'logo' }, '∞'), this.pillText = h('span', {}, 'Multiplayer'));
    this.wrap = h('div', { class: 'wrap' }, this.panel, this.pill, this.toasts);
    this.root.appendChild(this.wrap);
    ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'wheel', 'click', 'dblclick', 'contextmenu']
      .forEach(ev => this.host.addEventListener(ev, e => e.stopPropagation()));
    document.documentElement.appendChild(this.host);
    this.applyLayout();
    this.ticker = setInterval(() => this.tick(), 200);
  }
  destroy() { clearInterval(this.ticker); this.host.remove(); }
  applyLayout() {
    this.wrap.classList.toggle('left', this.dock === 'left'); this.wrap.classList.toggle('right', this.dock === 'right');
    this.panel.style.display = this.collapsed ? 'none' : ''; this.pill.style.display = this.collapsed ? '' : 'none';
  }
  setDock(d) { this.dock = d; M.store.set('icmp.dock', d); this.applyLayout(); }
  setCollapsed(v) { this.collapsed = v; M.store.set('icmp.collapsed', v); this.applyLayout(); if (!v) this.chat.scroll(); }

  toast(msg, kind = 'info') {
    const t = M.h('div', { class: 'toast ' + kind }, msg);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 6000 : 3800);
  }
  setBanner(b) {
    const key = b ? b.title + b.text : '';
    if (key === this.bannerKey) return; this.bannerKey = key;
    this.banner.replaceChildren();
    if (!b) return;
    this.banner.appendChild(M.h('div', { class: 'banner' }, M.h('b', {}, '⚠ ' + b.title), M.h('p', {}, b.text),
      M.h('div', { class: 'row' }, b.actions.map(a => { const btn = M.h('button', { class: 'btn small', onclick: () => this.run(btn, a.run) }, a.label); return btn; }))));
  }
  setStatus(st, detail) {
    const map = { idle: ['', ''], connecting: ['connecting', 'Connecting…'], online: ['online', 'Connected'], reconnecting: ['reconnecting', 'Reconnecting…'], error: ['error', 'Error'] };
    const [cls, label] = map[st] || map.idle;
    this.status.className = 'status ' + cls; this.status.textContent = label; this.status.title = detail || label;
  }
  async run(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { this.toast(M.errText(e), 'bad'); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  async copyCode() {
    const code = this.app.rm.code; if (!code) return;
    try { await navigator.clipboard.writeText(code); this.toast('Room code copied: ' + code, 'good'); }
    catch { const ta = M.h('textarea', { text: code }); this.root.appendChild(ta); ta.select(); try { document.execCommand('copy'); this.toast('Room code copied: ' + code, 'good'); } catch { this.toast('Room code: ' + code, 'info'); } ta.remove(); }
  }

  /* ---------------------------------------------------------------- rendering */
  stateSig(s) {
    return JSON.stringify([s.phase, s.room.mode, s.room.timerSeconds, s.room.hostId,
      s.players.map(p => [p.id, p.name, p.online, p.submitted, p.voted, p.discoveries, p.crafts, p.host]),
      s.game && [s.game.id, s.game.target, s.game.mySubmission, s.game.myVote, s.game.number], s.submissions, s.tally, s.items, s.result,
      this.app.rm.startsInMs() > 0]);
  }
  render(s) {
    this.codeChip.style.display = s ? '' : 'none';
    if (s) { this.codeChip.textContent = s.room.code + ' ⧉'; }
    this.chatSlot.replaceChildren(s ? this.chat.el : '');
    if (s) this.chat.update(s);
    const sig = s ? this.stateSig(s) : 'landing:' + (this.landingErr || '');
    if (sig === this.sig) return;
    this.sig = sig;
    const active = this.root.activeElement, focusId = active && active.id, caret = active && active.selectionStart;
    this.refs = {};
    this.body.replaceChildren(s ? this.roomView(s) : this.landing());
    if (focusId) { const el = this.root.getElementById ? this.root.getElementById(focusId) : this.root.querySelector('#' + focusId); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* n/a */ } } }
    this.tick();
  }
  roomView(s) {
    const mode = s.game ? s.game.mode : s.room.mode;
    this.wrap.dataset.mode = mode;
    switch (s.phase) {
      case 'lobby': return this.lobby(s);
      case 'submit': return M.h('div', {}, this.modeBadge(s), M.views.submit(this, s), this.leaveBtn());
      case 'vote': return M.h('div', {}, this.modeBadge(s), M.views.vote(this, s), this.leaveBtn());
      case 'playing': return M.h('div', {}, mode === 'shared' ? M.views.sharedPlay(this, s) : M.views.competitionPlay(this, s), this.leaveBtn());
      case 'results': return M.h('div', {}, mode === 'shared' ? M.views.sharedResults(this, s) : M.views.competitionResults(this, s), this.resultActions(s));
    }
    return M.h('div', {}, 'Unknown phase ' + s.phase);
  }
  modeBadge(s) {
    const m = s.game ? s.game.mode : s.room.mode;
    return M.h('div', { class: 'modebadge ' + m }, m === 'shared' ? '🤝 Shared · co-op' : '⚔ Competition · race', M.h('small', {}, this.timerLabel(s.game ? s.game.timerSeconds : s.room.timerSeconds)));
  }
  timerLabel(sec) { const t = TIMERS.find(x => x[0] === (sec || 0)); return t ? t[1] : '∞'; }
  leaveBtn() { return M.h('div', { class: 'footer-row' }, M.h('button', { class: 'btn ghost small', onclick: e => this.confirmLeave(e.currentTarget) }, 'Leave room')); }
  confirmLeave(btn) {
    if (btn.dataset.sure) { this.run(btn, () => this.app.leaveRoom()); return; }
    btn.dataset.sure = '1'; btn.textContent = 'Really leave?'; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Leave room'; } }, 3000);
  }

  landing() {
    const { h } = M, cfgOk = this.app.api.configured;
    const name = h('input', { id: 'name-input', class: 'input', maxlength: '16', placeholder: 'Your name', value: this.draft.name || M.store.get('icmp.name', ''), autocomplete: 'off' });
    const code = h('input', { id: 'code-input', class: 'input code', maxlength: '8', placeholder: 'ROOM CODE', value: this.draft.code || '', autocomplete: 'off' });
    name.addEventListener('input', () => { this.draft.name = name.value; });
    code.addEventListener('input', () => { code.value = code.value.toUpperCase(); this.draft.code = code.value; });
    const nm = () => { const v = name.value.trim(); if (!v) { this.toast('Enter a name first.', 'warn'); name.focus(); return null; } M.store.set('icmp.name', v); return v; };
    const create = h('button', { class: 'btn primary big', onclick: () => { const n = nm(); if (n) this.run(create, () => this.app.rm.create(n)); } }, 'Create room');
    const join = h('button', { class: 'btn', onclick: () => { const n = nm(); if (!n) return; if (!code.value.trim()) { this.toast('Enter a room code.', 'warn'); code.focus(); return; } this.run(join, () => this.app.rm.join(code.value, n)); } }, 'Join');
    code.addEventListener('keydown', e => { if (e.key === 'Enter') join.click(); });
    return h('div', { class: 'landing' },
      h('h2', {}, 'Play Infinite Craft together'),
      h('p', { class: 'hint' }, 'Up to 4 players · race to a target, or build one world together. Uses your normal game - nothing is changed in your saves.'),
      !cfgOk ? h('div', { class: 'banner'}, h('b', {}, '⚠ Not configured'), h('p', {}, M.ERRORS.not_configured)) : null,
      name, create, h('div', { class: 'or' }, h('span', {}, 'or join a friend')), h('div', { class: 'row' }, code, join));
  }

  lobby(s) {
    const { h } = M, isHost = s.room.hostId === s.me, online = s.players.filter(p => p.online).length;
    const setting = (mode, timer) => this.run(null, () => this.app.rm.act('update_settings', { p_mode: mode, p_timer: timer }));
    const timerNow = s.room.timerSeconds || 0;
    const modeCard = (id, icon, title, desc) => h('button', { class: 'mode ' + id + (s.room.mode === id ? ' sel' : ''), disabled: !isHost, onclick: () => setting(id, timerNow) },
      h('span', { class: 'micon' }, icon), h('b', {}, title), h('small', {}, desc));
    const start = h('button', { class: 'btn primary big', disabled: online < 2, onclick: () => this.run(start, () => this.app.rm.act('start_game')) },
      online < 2 ? 'Need 2+ players to start' : 'Start game');
    return h('div', {},
      h('div', { class: 'invite' }, h('small', {}, 'Share this code'), h('button', { class: 'bigcode', onclick: () => this.copyCode() }, s.room.code), h('small', {}, 'click to copy · ' + s.players.length + '/4 players')),
      h('div', { class: 'section-title' }, 'Players'),
      h('div', { class: 'players' }, s.players.map(p => h('div', { class: 'player' + (p.id === s.me ? ' me' : '') + (p.online ? '' : ' off') },
        h('span', { class: 'dot ' + (p.online ? 'on' : 'off'), title: p.online ? 'connected' : 'disconnected' }),
        h('span', { class: 'pname' }, p.name, p.host ? h('span', { class: 'crown', title: 'Host' }, ' 👑') : null, p.id === s.me ? h('span', { class: 'you' }, ' (you)') : null),
        h('span', { class: 'tag' }, p.online ? 'online' : 'reconnecting…'),
        isHost && p.id !== s.me ? h('button', { class: 'icon kick', title: 'Kick ' + p.name, onclick: e => this.run(e.currentTarget, () => this.app.rm.act('kick_player', { p_target: p.id })) }, '⛔') : null))),
      h('div', { class: 'section-title' }, 'Mode', !isHost ? h('small', {}, 'host chooses') : null),
      h('div', { class: 'modes' },
        modeCard('competition', '⚔', 'Competition', 'Own board each. First to craft the target wins.'),
        modeCard('shared', '🤝', 'Shared', 'One world. Everyone builds toward the target together.')),
      h('div', { class: 'section-title' }, 'Timer', !isHost ? h('small', {}, 'host chooses') : null),
      h('div', { class: 'chips' }, TIMERS.map(([sec, label]) => h('button', { class: 'chip' + (timerNow === sec ? ' sel' : ''), disabled: !isHost, onclick: () => setting(s.room.mode, sec) }, label))),
      isHost ? start : h('p', { class: 'hint center' }, 'Waiting for the host to start…'),
      this.leaveBtn());
  }

  targetBanner(s) {
    const { h } = M, g = s.game;
    const timer = h('span', { class: 'timer' }, '--:--');
    this.refs.timer = timer;
    this.refs.cd = h('div', { class: 'countdown' });
    return h('div', { class: 'target' },
      this.refs.cd,
      h('small', {}, g.mode === 'shared' ? 'Craft together' : 'First to craft'),
      h('div', { class: 'tname' }, g.target),
      h('div', { class: 'trow' }, h('span', { class: 'modebadge ' + g.mode }, g.mode === 'shared' ? '🤝 Shared' : '⚔ Competition'), timer));
  }
  tallyDetails(s) {
    const { h } = M; if (!s.tally || !s.tally.length) return null;
    return h('details', { class: 'tally' }, h('summary', {}, 'How the vote went'),
      s.tally.slice().sort((a, b) => b.votes - a.votes).map(t => h('div', { class: 'trow2' }, h('b', {}, t.text), h('span', {}, `${t.votes} vote${t.votes === 1 ? '' : 's'}`), h('small', {}, (t.voters || []).join(', ')))));
  }
  resultBanner(kind, title, sub) { return M.h('div', { class: 'result ' + kind }, M.h('div', { class: 'big' }, title), M.h('p', {}, sub)); }
  resultActions(s) {
    const { h } = M, isHost = s.room.hostId === s.me;
    if (!isHost) return h('div', {}, h('p', { class: 'hint center' }, 'Waiting for the host to choose what happens next…'), this.leaveBtn());
    const again = h('button', { class: 'btn primary', onclick: () => this.run(again, () => this.app.rm.act('start_game')) }, '↻ Play again');
    const lobby = h('button', { class: 'btn', onclick: () => this.run(lobby, () => this.app.rm.act('back_to_lobby')) }, 'Return to lobby');
    return h('div', {}, h('div', { class: 'row actions' }, again, lobby), this.leaveBtn());
  }

  /* ------------------------------------------------ 5 Hz tick: timers/countdown only (no re-render) */
  tick() {
    const rm = this.app.rm, s = rm.state;
    if (!s) { this.pillText.textContent = 'Multiplayer'; return; }
    let pill = s.room.code;
    if (s.phase === 'playing') {
      const si = rm.startsInMs(), rem = rm.remainingMs();
      if (this.refs.cd) {
        if (si > 0) { this.refs.cd.textContent = Math.ceil(si / 1000); this.refs.cd.classList.add('show'); }
        else this.refs.cd.classList.remove('show');
      }
      if (this.refs.timer) {
        this.refs.timer.textContent = si > 0 ? 'starting…' : (rem == null ? '∞ unlimited' : M.fmtTime(rem));
        this.refs.timer.classList.toggle('low', rem != null && rem < 15000 && si === 0);
      }
      pill += si > 0 ? ' · ' + Math.ceil(si / 1000) : ' · ' + (rem == null ? '∞' : M.fmtTime(rem));
      if (rem === 0 && si === 0 && performance.now() - (this.lastNudge || 0) > 1000) { this.lastNudge = performance.now(); rm.refresh(); }
    }
    this.pillText.textContent = pill;
  }
}
M.UI = UI;
