/* shared.js - Shared (co-op) mode views. One world: every discovery is in the server inventory, every
   client mirrors it into its own local game (see Round.syncInventory in competition.js). */
M.views = M.views || {};

M.views.sharedHistory = (ui, s) => {
  const { h } = M;
  if (!s.items.length) return h('p', { class: 'hint' }, 'Nothing discovered yet. Combine elements - anything any of you finds appears for everyone.');
  return h('div', { class: 'history' }, s.items.slice().reverse().map(it => h('div', { class: 'hitem' },
    h('span', { class: 'emo' }, it.emoji || '•'), h('b', {}, it.name),
    h('small', {}, `${it.a} + ${it.b}`), h('span', { class: 'by' }, it.byName || '?'))));
};

M.views.contributions = (ui, s) => {
  const { h } = M, total = s.items.length;
  return h('div', { class: 'contrib' }, s.players.map(p => h('div', { class: 'crow' },
    h('span', { class: 'pname' }, p.name), h('span', { class: 'bar' }, h('i', { style: { width: (total ? Math.round(100 * p.discoveries / total) : 0) + '%' } })),
    h('span', { class: 'count' }, `${p.discoveries} found · ${p.crafts} combos`))));
};

M.views.sharedPlay = (ui, s) => {
  const { h } = M;
  return h('div', {},
    ui.targetBanner(s),
    h('div', { class: 'section-title' }, 'Team ', h('small', {}, `${s.items.length} shared discoveries`)),
    M.views.contributions(ui, s),
    h('div', { class: 'section-title' }, 'Discovery history'),
    M.views.sharedHistory(ui, s),
    ui.tallyDetails(s),
  );
};

M.views.sharedResults = (ui, s) => {
  const { h } = M, r = s.result;
  let banner;
  if (r.outcome === 'win') banner = ui.resultBanner('win', '🎉 Team victory!', `${r.winnerName || 'A teammate'} crafted ${r.target} for the whole group.`);
  else if (r.outcome === 'timeout') banner = ui.resultBanner('lose', '💀 Team defeat', `The group did not craft ${r.target} in time.`);
  else banner = ui.resultBanner('lose', 'Round cancelled', 'Too few players stayed connected.');
  return h('div', {}, banner,
    r.targetRecipe ? h('p', { class: 'recipe' }, `Final recipe: ${r.targetRecipe.a} + ${r.targetRecipe.b} → ${r.targetRecipe.emoji || ''} ${r.target}`) : h('p', { class: 'recipe' }, `Target was: ${r.target}`),
    h('div', { class: 'section-title' }, 'Player contributions'),
    M.views.contributions(ui, s),
    h('div', { class: 'section-title' }, `Group discoveries (${s.items.length})`),
    M.views.sharedHistory(ui, s),
    ui.tallyDetails(s),
  );
};
