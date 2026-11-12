/* voting.js - target submission + voting views. All rules (one submission, one vote, no self-vote,
   hidden votes, random tie-break, host can't influence anything) are enforced by the server; these
   views only present them. */
M.views = M.views || {};

M.views.submit = (ui, s) => {
  const { h } = M, mine = s.game.mySubmission;
  const waiting = s.players.filter(p => p.online && !p.submitted).length;
  let form;
  if (mine) {
    form = h('div', { class: 'locked' }, h('span', { class: 'lock' }, '🔒'), h('div', {}, h('small', {}, 'You submitted'), h('b', {}, mine.text)),
      h('p', { class: 'hint' }, waiting ? `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}… Everything is revealed at once.` : 'Revealing…'));
  } else {
    const input = h('input', { id: 'submit-input', class: 'input', maxlength: '40', placeholder: 'e.g. Dragon, Minecraft, Time Machine', autocomplete: 'off', value: ui.draft.submit || '' });
    input.addEventListener('input', () => { ui.draft.submit = input.value; });
    const btn = h('button', { class: 'btn primary', onclick: () => ui.run(btn, () => ui.app.rm.act('submit_target', { p_text: input.value })) }, 'Lock in');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    form = h('div', {}, h('div', { class: 'row' }, input, btn),
      h('p', { class: 'hint' }, 'Everyone submits ONE element they want the group to craft. Nobody sees any entry until all are in.'));
  }
  return h('div', {}, h('div', { class: 'section-title' }, 'Step 1 · Submit a target'), form,
    h('div', { class: 'players compact' }, s.players.map(p => h('div', { class: 'player' + (p.online ? '' : ' off') },
      h('span', { class: 'dot ' + (p.online ? 'on' : 'off') }), h('span', { class: 'pname' }, p.name),
      h('span', { class: 'tag ' + (p.submitted ? 'ok' : '') }, p.submitted ? '✓ submitted' : 'thinking…')))));
};

M.views.vote = (ui, s) => {
  const { h } = M, myVote = s.game.myVote;
  const waiting = s.players.filter(p => p.online && !p.voted).length;
  const cards = s.submissions.map(sub => {
    const own = sub.author === s.me, picked = myVote === sub.author;
    return h('button', { class: 'card' + (picked ? ' picked' : '') + (own ? ' own' : ''), disabled: own || !!myVote,
      onclick: ev => ui.run(ev.currentTarget, () => ui.app.rm.act('cast_vote', { p_candidate: sub.author })) },
      h('b', {}, sub.text), h('small', {}, own ? 'your submission' : 'by ' + (sub.authorName || '?')),
      picked ? h('span', { class: 'check' }, '✓ your vote') : null);
  });
  return h('div', {}, h('div', { class: 'section-title' }, 'Step 2 · Vote'),
    h('p', { class: 'hint' }, myVote ? `Vote locked in. Waiting for ${waiting} more…` : 'One vote each, final, hidden until everyone has voted. You can\'t vote for your own. Ties are broken randomly by the server.'),
    h('div', { class: 'cards' }, cards),
    h('div', { class: 'players compact' }, s.players.map(p => h('div', { class: 'player' + (p.online ? '' : ' off') },
      h('span', { class: 'dot ' + (p.online ? 'on' : 'off') }), h('span', { class: 'pname' }, p.name),
      h('span', { class: 'tag ' + (p.voted ? 'ok' : '') }, p.voted ? '✓ voted' : 'deciding…')))));
};
