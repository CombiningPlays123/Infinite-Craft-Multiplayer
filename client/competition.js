/* competition.js
 *  - Round: the logic shared by BOTH modes while a round is running (reporting crafts to the server in
 *    order, mirroring the server inventory into the local save when needed, guarding against foreign
 *    elements from an old save).
 *  - Competition-mode views (own board per player, only discovery COUNTS of others are visible).
 */
class Round {
  constructor(app) {
    this.app = app; this.queue = []; this.draining = false; this.syncing = false; this.dirty = false;
    this.unsub = app.adapter.onCraft(c => this.onCraft(c));
    this.foreignKey = '';
  }
  destroy() { this.unsub && this.unsub(); this.app.ui.setBanner(null); }

  onCraft(c) {
    const { rm, ui } = this.app, s = rm.state;
    if (!s || s.phase !== 'playing') return;
    if (rm.startsInMs() > 0) { ui.toast('Hold on - wait for GO!', 'warn'); return; }
    this.queue.push(c); this.drain();
  }
  async drain() {
    if (this.draining) return; this.draining = true;
    const { rm, ui } = this.app;
    try {
      while (this.queue.length) {
        const c = this.queue.shift();
        try {
          const r = await rm.act('report_craft', { p_a: c.a, p_b: c.b, p_result: c.result, p_emoji: c.emoji });
          if (r.won) ui.toast(`You crafted ${c.result}!`, 'good');
          else if (r.new) ui.toast(`${c.emoji || ''} ${c.result} recorded`.trim(), 'info');
        } catch (e) {
          if (e.code === 'round_not_active') { this.queue = []; rm.refresh(); }
          else ui.toast(M.errText(e), e.code === 'network' ? 'warn' : 'bad');
          if (e.code === 'network') { this.queue.unshift(c); await M.sleep(1500); }
        }
        await M.sleep(60);
      }
    } finally { this.draining = false; }
  }

  onState(s) {
    const live = ['submit', 'vote', 'playing'].includes(s.phase);
    this.checkForeign(s, live);
    if (s.phase === 'playing') { this.dirty = true; this.syncInventory(); }
  }

  /** The server tracks the round inventory; a save slot that already contains other elements
      would let a player craft with things the round doesn't know about. Warn + offer a clean slot. */
  checkForeign(s, live) {
    const { ui, adapter } = this.app;
    if (!live) { ui.setBanner(null); return; }
    let foreign = [];
    try { foreign = adapter.foreign(s.items.map(i => i.name)); } catch { /* game not ready */ }
    const key = foreign.map(f => f.text).join('|') + '@' + adapter.currentSave();
    if (!foreign.length) { this.foreignKey = ''; ui.setBanner(null); return; }
    this.foreignKey = key;
    ui.setBanner({
      title: `Save ${((adapter.currentSave() || 0) + 1)} already has ${foreign.length} other element${foreign.length > 1 ? 's' : ''}`,
      text: 'Rounds start from Water, Fire, Wind and Earth. Switch to an empty save slot - Multiplayer never deletes or edits saves. If every slot has progress, open the game in a private/incognito window, or clear a slot yourself from the in-game menu.',
      actions: [
        { label: 'Use next save slot', run: async () => { await adapter.switchToNextSlot(); this.checkForeign(this.app.rm.state, true); this.dirty = true; this.syncInventory(); } },
        { label: 'Re-check', run: async () => this.checkForeign(this.app.rm.state, true) },
      ],
    });
  }

  /** Mirror server-known elements that this save lacks (shared mode: teammates' discoveries; both modes: after a refresh
      or save switch) by REALLY crafting the recorded pair through the game, then verify the game agrees. */
  async syncInventory() {
    if (this.syncing) return; this.syncing = true;
    const { rm, ui, adapter } = this.app;
    try {
      while (this.dirty) {
        this.dirty = false;
        const s = rm.state; if (!s || s.phase !== 'playing') break;
        let progress = true;
        while (progress) {
          progress = false;
          for (const it of s.items) {
            if (adapter.has(it.name)) continue;
            if (!adapter.has(it.a) || !adapter.has(it.b)) continue;   // wait until its ingredients arrive
            let r = null;
            try { r = await adapter.replay(it.a, it.b); } catch (e) { console.warn('[ICMP] replay failed', e); }
            progress = true;
            if (!r) { ui.toast(`Could not recreate ${it.name} locally - try crafting ${it.a} + ${it.b} yourself.`, 'warn'); }
            else if (M.norm(r.text) !== M.norm(it.name)) ui.toast(`Your game made "${r.text}" from ${it.a} + ${it.b}, but the room recorded "${it.name}".`, 'warn');
            if (r) { ui.refreshLocalCount && ui.refreshLocalCount(); }
          }
        }
      }
    } finally { this.syncing = false; }
  }
}
M.Round = Round;

/* ------------------------------------------------------------------ views */
M.views = M.views || {};

M.views.scoreboard = (ui, s, opts = {}) => {
  const { h } = M;
  const list = s.players.slice().sort((a, b) => opts.sort ? (b.discoveries - a.discoveries) || (a.name.localeCompare(b.name)) : 0);
  const max = Math.max(1, ...list.map(p => p.discoveries));
  return h('div', { class: 'players' }, list.map((p, i) => h('div', { class: 'player' + (p.id === s.me ? ' me' : '') + (p.online ? '' : ' off') },
    opts.sort ? h('span', { class: 'rank' }, '#' + (i + 1)) : h('span', { class: 'dot ' + (p.online ? 'on' : 'off'), title: p.online ? 'connected' : 'disconnected' }),
    h('span', { class: 'pname' }, p.name, p.host ? h('span', { class: 'crown', title: 'Host' }, ' 👑') : null, p.id === s.me ? h('span', { class: 'you' }, ' (you)') : null),
    h('span', { class: 'bar' }, h('i', { style: { width: Math.round(100 * p.discoveries / max) + '%' } })),
    h('span', { class: 'count', title: 'discoveries' }, String(p.discoveries)),
  )));
};

M.views.competitionPlay = (ui, s) => {
  const { h } = M;
  return h('div', {},
    ui.targetBanner(s),
    h('div', { class: 'section-title' }, 'Race ', h('small', {}, 'discoveries per player')),
    M.views.scoreboard(ui, s),
    h('p', { class: 'hint' }, 'Everyone crafts on their own board. You can see how many elements others found - not how they found them. First verified craft of the target wins.'),
    ui.tallyDetails(s),
  );
};

M.views.competitionResults = (ui, s) => {
  const { h } = M, r = s.result, g = s.game;
  const meWon = r.winnerId === s.me;
  let banner;
  if (r.outcome === 'win') banner = ui.resultBanner(meWon ? 'win' : 'lose', meWon ? '🏆 You win!' : `🏁 ${r.winnerName || 'Someone'} wins`, `${r.winnerName || 'A player'} was first to craft ${r.target}.`);
  else if (r.outcome === 'timeout') banner = ui.resultBanner('lose', '⏱ Time\'s up', `Nobody crafted ${r.target} in time.`);
  else banner = ui.resultBanner('lose', 'Round cancelled', 'Too few players stayed connected.');
  return h('div', {}, banner,
    r.targetRecipe ? h('p', { class: 'recipe' }, `Winning recipe: ${r.targetRecipe.a} + ${r.targetRecipe.b} → ${r.targetRecipe.emoji || ''} ${r.target}`) : null,
    h('div', { class: 'section-title' }, 'Final scoreboard'),
    M.views.scoreboard(ui, s, { sort: true }),
    h('div', { class: 'stats' }, s.players.map(p => h('span', { class: 'chip' }, `${p.name}: ${p.discoveries} found · ${p.crafts} combos`))),
    r.outcome === 'timeout' ? h('p', { class: 'hint' }, 'Closeness to the target cannot be measured (Infinite Craft has no distance metric), so players are ranked by discoveries only.') : null,
    ui.tallyDetails(s),
  );
};
