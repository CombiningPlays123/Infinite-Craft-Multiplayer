// Backend tests: run the real SQL (PGlite) through the same RPC surface the client uses.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackend } from '../tools/dev-server.mjs';

const be = await createBackend();
const U = Array.from({ length: 6 }, () => crypto.randomUUID());
const rpc = (i, fn, args = {}) => be.rpc(fn, args, U[i]);
const fails = async (p, msg) => assert.rejects(p, e => (assert.match(e.message, new RegExp(msg)), true));
const age = (sql) => be.admin(sql);
const NAMES = ['Ann', 'Ben', 'Cy', 'Di', 'Ed', 'Flo'];

async function room(n, mode = 'competition', timer = 300) {
  const { code } = await rpc(0, 'create_room', { p_name: NAMES[0], p_client: 'c0' });
  for (let i = 1; i < n; i++) await rpc(i, 'join_room', { p_code: code, p_name: NAMES[i], p_client: 'c' + i });
  await rpc(0, 'update_settings', { p_code: code, p_mode: mode, p_timer: timer });
  return code;
}
const st = (i, code) => rpc(i, 'get_state', { p_code: code, p_client: 'c' + i });
async function toPlaying(n, mode, timer, subs, votes) {
  const code = await room(n, mode, timer);
  await rpc(0, 'start_game', { p_code: code });
  for (let i = 0; i < n; i++) {
    assert.equal((await st(i, code)).phase, 'submit');
    await rpc(i, 'submit_target', { p_text: subs[i], p_code: code });
  }
  assert.equal((await st(0, code)).phase, 'vote');
  for (let i = 0; i < n; i++) await rpc(i, 'cast_vote', { p_code: code, p_candidate: U[votes[i]] });
  const s = await st(0, code);
  assert.equal(s.phase, 'playing');
  await age(`update games set started_at = now() - interval '1 second', ends_at = case when timer_seconds is null then null else now() + make_interval(secs => timer_seconds) end where phase='playing'`);
  return { code, s };
}

test('rooms: create, join, full, invalid code, duplicate session', async () => {
  const code = await room(4);
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
  let s = await st(0, code);
  assert.equal(s.players.length, 4);
  assert.equal(s.players.filter(p => p.host).length, 1);
  await fails(rpc(4, 'join_room', { p_code: code, p_name: 'Ed', p_client: 'x' }), 'room_full');
  await fails(rpc(4, 'join_room', { p_code: 'ZZZZZ', p_name: 'Ed', p_client: 'x' }), 'room_not_found');
  // refresh / reconnect: same user re-joins, takes over seat, old client superseded
  await rpc(1, 'join_room', { p_code: code.toLowerCase(), p_name: 'Ben', p_client: 'c1-new' });
  s = await rpc(1, 'get_state', { p_code: code, p_client: 'c1' });
  assert.equal(s.superseded, true);
  s = await rpc(1, 'get_state', { p_code: code, p_client: 'c1-new' });
  assert.equal(s.players.length, 4);
  // duplicate names are disambiguated
  await rpc(3, 'leave_room', { p_code: code });
  await rpc(4, 'join_room', { p_code: code, p_name: 'Ann', p_client: 'z' });
  s = await st(0, code);
  assert.equal(new Set(s.players.map(p => p.name)).size, 4);
});

test('min 2 players to start; settings validated; non-host rejected', async () => {
  const { code } = await rpc(0, 'create_room', { p_name: 'Solo', p_client: 'c0' });
  await fails(rpc(0, 'start_game', { p_code: code }), 'need_players');
  await rpc(1, 'join_room', { p_code: code, p_name: 'Two', p_client: 'c1' });
  await fails(rpc(1, 'start_game', { p_code: code }), 'not_host');
  await fails(rpc(1, 'update_settings', { p_code: code, p_mode: 'shared', p_timer: 60 }), 'not_host');
  await fails(rpc(0, 'update_settings', { p_code: code, p_mode: 'shared', p_timer: 7 }), 'invalid_timer');
  await fails(rpc(0, 'update_settings', { p_code: code, p_mode: 'hax', p_timer: 60 }), 'invalid_mode');
  for (const t of [60, 180, 300, 600, 900, 1800, 0]) await rpc(0, 'update_settings', { p_code: code, p_mode: 'shared', p_timer: t });
  const s = await st(0, code);
  assert.equal(s.room.timerSeconds, null); // unlimited
  await rpc(0, 'start_game', { p_code: code });
});

test('submissions hidden until all submitted, then revealed together', async () => {
  const code = await room(3);
  await rpc(0, 'start_game', { p_code: code });
  await rpc(0, 'submit_target', { p_code: code, p_text: '  Dragon ' });
  let s = await st(1, code);
  assert.equal(s.phase, 'submit');
  assert.deepEqual(s.submissions, []);
  assert.equal(JSON.stringify(s).includes('Dragon'), false, 'other players must not see it before reveal');
  await fails(rpc(0, 'submit_target', { p_code: code, p_text: 'Other' }), 'already_submitted');
  await fails(rpc(1, 'submit_target', { p_code: code, p_text: 'Water' }), 'base_element');
  await fails(rpc(1, 'submit_target', { p_code: code, p_text: '<<>>' }), 'invalid_element');
  await rpc(1, 'submit_target', { p_code: code, p_text: '<b>Minecraft</b>' });
  s = await st(2, code);
  assert.equal(s.phase, 'submit');
  assert.equal(s.submissions.length, 0);
  await rpc(2, 'submit_target', { p_code: code, p_text: 'Universe' });
  s = await st(2, code);
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.submissions.map(x => x.text).sort(), ['Dragon', 'Minecraft', 'Universe']);
});

test('voting: own vote forbidden, one vote, hidden until end, majority wins', async () => {
  const code = await room(3);
  await rpc(0, 'start_game', { p_code: code });
  for (let i = 0; i < 3; i++) await rpc(i, 'submit_target', { p_code: code, p_text: ['Dragon', 'Steam', 'Lava'][i] });
  await fails(rpc(0, 'cast_vote', { p_code: code, p_candidate: U[0] }), 'cannot_vote_self');
  await fails(rpc(0, 'cast_vote', { p_code: code, p_candidate: U[5] }), 'invalid_candidate');
  await rpc(0, 'cast_vote', { p_code: code, p_candidate: U[1] });
  await fails(rpc(0, 'cast_vote', { p_code: code, p_candidate: U[2] }), 'already_voted');
  await rpc(1, 'cast_vote', { p_code: code, p_candidate: U[2] });
  let s = await st(2, code);
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.tally, [], 'tally hidden during voting');
  assert.equal(s.game.myVote, null);
  await rpc(2, 'cast_vote', { p_code: code, p_candidate: U[1] }); // Steam gets 2
  s = await st(0, code);
  assert.equal(s.phase, 'playing');
  assert.equal(s.game.target, 'Steam');
  assert.equal(s.tally.find(t => t.text === 'Steam').votes, 2);
  assert.ok(s.game.startsInMs > 0 && s.game.startsInMs <= 6000, 'synchronised countdown');
});

test('voting: two-player room (forced 1-1 tie) and random tie-break covers both', async () => {
  const seen = new Set();
  for (let k = 0; k < 14 && seen.size < 2; k++) {
    const code = await room(2);
    await rpc(0, 'start_game', { p_code: code });
    await rpc(0, 'submit_target', { p_code: code, p_text: 'Dragon' });
    await rpc(1, 'submit_target', { p_code: code, p_text: 'Steam' });
    await rpc(0, 'cast_vote', { p_code: code, p_candidate: U[1] });
    await rpc(1, 'cast_vote', { p_code: code, p_candidate: U[0] });
    const s = await st(0, code);
    assert.equal(s.phase, 'playing');
    seen.add(s.game.target);
    await rpc(0, 'leave_room', { p_code: code }); await rpc(1, 'leave_room', { p_code: code });
  }
  assert.deepEqual([...seen].sort(), ['Dragon', 'Steam']);
});

test('4-player tie between 2 submissions resolves to one of them', async () => {
  const { s } = await toPlaying(4, 'competition', 300, ['Dragon', 'Steam', 'Lava', 'Plant'], [1, 0, 1, 0]);
  assert.ok(['Dragon', 'Steam'].includes(s.game.target));
});

test('competition: separate inventories, ownership enforced, first verified craft wins', async () => {
  const { code } = await toPlaying(3, 'competition', 300, ['Steam', 'Lava', 'Plant'], [1, 0, 0]);
  // Steam = target? votes: u0->1(Lava), u1->0(Steam), u2->0(Steam): target Steam
  let s = await st(0, code);
  assert.equal(s.game.target, 'Steam');
  await rpc(0, 'report_craft', { p_code: code, p_a: 'Fire', p_b: 'Earth', p_result: 'Lava', p_emoji: '🌋' });
  await fails(rpc(1, 'report_craft', { p_code: code, p_a: 'Lava', p_b: 'Water', p_result: 'Obsidian', p_emoji: '' }), 'ingredient_not_owned');
  s = await st(1, code);
  assert.deepEqual(s.items, [], 'cannot see other players\' crafts');
  assert.equal(s.players.find(p => p.id === U[0]).discoveries, 1, 'but can see counts');
  await new Promise(r => setTimeout(r, 60));
  const r = await rpc(0, 'report_craft', { p_code: code, p_a: 'Lava', p_b: 'Water', p_result: 'Obsidian', p_emoji: '' });
  assert.equal(r.won, false);
  await new Promise(r => setTimeout(r, 60));
  const w = await rpc(1, 'report_craft', { p_code: code, p_a: 'Water', p_b: 'Fire', p_result: 'steam', p_emoji: '💨' });
  assert.equal(w.won, true);
  s = await st(2, code);
  assert.equal(s.phase, 'results');
  assert.equal(s.result.outcome, 'win');
  assert.equal(s.result.winnerName, 'Ben');
  await fails(rpc(2, 'report_craft', { p_code: code, p_a: 'Water', p_b: 'Fire', p_result: 'Steam', p_emoji: '' }), 'round_not_active');
  assert.equal(s.result.closest, null, 'no fake closeness');
});

test('crafts before the synchronized start are rejected; "Nothing" ignored', async () => {
  const code = await room(2);
  await rpc(0, 'start_game', { p_code: code });
  await rpc(0, 'submit_target', { p_code: code, p_text: 'Dragon' });
  await rpc(1, 'submit_target', { p_code: code, p_text: 'Steam' });
  await rpc(0, 'cast_vote', { p_code: code, p_candidate: U[1] });
  await rpc(1, 'cast_vote', { p_code: code, p_candidate: U[0] });
  await fails(rpc(0, 'report_craft', { p_code: code, p_a: 'Water', p_b: 'Fire', p_result: 'Steam', p_emoji: '' }), 'round_not_started');
  await age(`update games set started_at = now() - interval '1 second' where phase='playing'`);
  await fails(rpc(0, 'report_craft', { p_code: code, p_a: 'Water', p_b: 'Fire', p_result: 'Nothing', p_emoji: '' }), 'invalid_craft');
});

test('competition timeout: nobody wins, stats kept, server clock decides', async () => {
  const { code } = await toPlaying(3, 'competition', 60, ['Steam', 'Lava', 'Plant'], [1, 0, 0]);
  await rpc(0, 'report_craft', { p_code: code, p_a: 'Fire', p_b: 'Earth', p_result: 'Lava', p_emoji: '' });
  let s = await st(1, code);
  assert.ok(s.game.remainingMs > 55000 && s.game.remainingMs <= 60000);
  const rems = (await Promise.all([0, 1, 2].map(i => st(i, code)))).map(x => x.game.remainingMs);
  assert.ok(Math.max(...rems) - Math.min(...rems) < 1500, 'all players see the same remaining time');
  await age(`update games set ends_at = now() - interval '1 second' where phase='playing'`);
  s = await st(2, code);
  assert.equal(s.phase, 'results');
  assert.equal(s.result.outcome, 'timeout');
  assert.equal(s.result.winnerId, null);
  assert.equal(s.players.find(p => p.id === U[0]).discoveries, 1);
  await fails(rpc(0, 'report_craft', { p_code: code, p_a: 'Water', p_b: 'Fire', p_result: 'Steam', p_emoji: '' }), 'round_not_active');
});

test('unlimited timer never times out', async () => {
  const { code } = await toPlaying(2, 'competition', 0, ['Steam', 'Lava'], [1, 0]);
  await age(`update games set started_at = now() - interval '5 hours' where phase='playing'`);
  const s = await st(0, code);
  assert.equal(s.phase, 'playing');
  assert.equal(s.game.remainingMs, null);
});

test('shared: one world, discoverer shown, duplicates + conflicts handled, group win', async () => {
  const { code } = await toPlaying(3, 'shared', 300, ['Plant', 'Steam', 'Lava'], [1, 0, 0]);
  let s = await st(0, code);
  const target = s.game.target;
  const [a, b, res] = { Plant: ['Water', 'Earth', 'Plant'], Steam: ['Water', 'Fire', 'Steam'], Lava: ['Fire', 'Earth', 'Lava'] }[target];
  // Two players race the same new pair: exactly one insert, second reports duplicate
  const [r1, r2] = await Promise.all([
    rpc(0, 'report_craft', { p_code: code, p_a: 'Fire', p_b: 'Wind', p_result: 'Smoke', p_emoji: '🌫️' }),
    rpc(1, 'report_craft', { p_code: code, p_a: 'Wind', p_b: 'Fire', p_result: 'Smoke', p_emoji: '🌫️' }),
  ]);
  assert.equal([r1, r2].filter(r => r.new).length, 1);
  await fails(rpc(2, 'report_craft', { p_code: code, p_a: 'Fire', p_b: 'Wind', p_result: 'Ash', p_emoji: '' }), 'recipe_conflict');
  // shared inventory: player 2 can use Smoke discovered by someone else
  await new Promise(r => setTimeout(r, 60));
  await rpc(2, 'report_craft', { p_code: code, p_a: 'Smoke', p_b: 'Water', p_result: 'Cloud', p_emoji: '☁️' });
  for (const i of [0, 1, 2]) {
    s = await st(i, code);
    assert.deepEqual(s.items.map(x => x.name), ['Smoke', 'Cloud'], 'identical shared inventory for everyone');
  }
  assert.deepEqual(s.items.map(x => x.byName), [s.items[0].byName, 'Cy']);
  await new Promise(r => setTimeout(r, 60));
  const w = await rpc(2, 'report_craft', { p_code: code, p_a: a, p_b: b, p_result: res, p_emoji: '' });
  assert.equal(w.won, true);
  s = await st(0, code);
  assert.equal(s.phase, 'results');
  assert.equal(s.result.outcome, 'win');
  assert.equal(s.result.targetRecipe.a, a);
});

test('shared timeout: group loses', async () => {
  const { code } = await toPlaying(2, 'shared', 60, ['Steam', 'Lava'], [1, 0]);
  await age(`update games set ends_at = now() - interval '1 second' where phase='playing'`);
  const s = await st(1, code);
  assert.equal(s.phase, 'results');
  assert.equal(s.result.outcome, 'timeout');
});

test('rematch and return to lobby (host only)', async () => {
  const { code } = await toPlaying(2, 'competition', 60, ['Steam', 'Lava'], [1, 0]);
  await age(`update games set ends_at = now() - interval '1 second' where phase='playing'`);
  await st(0, code);
  await fails(rpc(1, 'start_game', { p_code: code }), 'not_host');
  await rpc(0, 'start_game', { p_code: code });
  assert.equal((await st(1, code)).phase, 'submit');
  assert.equal((await st(1, code)).game.number, 2);
  await rpc(0, 'back_to_lobby', { p_code: code });
  assert.equal((await st(1, code)).phase, 'lobby');
});

test('host disconnect transfers host; disconnected player does not block voting', async () => {
  const code = await room(3);
  await rpc(0, 'start_game', { p_code: code });
  for (let i = 0; i < 3; i++) await rpc(i, 'submit_target', { p_code: code, p_text: ['Dragon', 'Steam', 'Lava'][i] });
  // host (u0) vanishes for 40s
  await age(`update players set last_seen = now() - interval '40 seconds' where user_id = '${U[0]}'`);
  let s = await st(1, code);
  assert.equal(s.room.hostId, U[1], 'earliest-joined online player becomes host');
  assert.equal(s.players.find(p => p.id === U[0]).online, false);
  // remaining two vote; offline player is not awaited
  await rpc(1, 'cast_vote', { p_code: code, p_candidate: U[2] });
  await rpc(2, 'cast_vote', { p_code: code, p_candidate: U[1] });
  s = await st(1, code);
  assert.equal(s.phase, 'playing');
  // returning player reconnects (no new seat needed) and is not host
  s = await st(0, code);
  assert.equal(s.me, U[0]);
  assert.equal(s.room.hostId, U[1]);
  assert.equal(s.players.find(p => p.id === U[0]).online, true);
});

test('players leaving mid-lobby/submit abandons gracefully; kick works; empty rooms deleted', async () => {
  const code = await room(3);
  await rpc(0, 'kick_player', { p_code: code, p_target: U[2] });
  await fails(st(2, code), 'kicked');
  await fails(rpc(2, 'join_room', { p_code: code, p_name: 'Cy', p_client: 'q' }), 'kicked');
  await fails(rpc(1, 'kick_player', { p_code: code, p_target: U[0] }), 'not_host');
  await rpc(0, 'start_game', { p_code: code });
  await rpc(1, 'leave_room', { p_code: code });   // only host left -> game abandoned
  let s = await st(0, code);
  assert.equal(s.phase, 'results');
  assert.equal(s.result.outcome, 'abandoned');
  await rpc(0, 'leave_room', { p_code: code });
  await fails(rpc(1, 'get_state', { p_code: code }), 'room_not_found');
});

test('host leaves -> host transferred, room survives', async () => {
  const code = await room(3);
  await rpc(0, 'leave_room', { p_code: code });
  const s = await st(1, code);
  assert.equal(s.room.hostId, U[1]);
  assert.equal(s.players.length, 2);
});

test('abandoned rooms are cleaned up', async () => {
  const code = await room(2);
  await age(`update players set last_seen = now() - interval '2 hours'`);
  await age(`update rooms set last_activity = now() - interval '7 hours'`);
  await rpc(5, 'create_room', { p_name: 'New', p_client: 'n' }); // triggers lazy cleanup
  const rows = await be.admin(`select 1 from rooms where code = '${code}'`);
  assert.equal(rows.length, 0);
});

test('chat: sanitised, length-limited, rate-limited, members only', async () => {
  const code = await room(2);
  await rpc(0, 'send_chat', { p_code: code, p_text: '<img src=x onerror=alert(1)>hello' });
  await rpc(0, 'send_chat', { p_code: code, p_text: 'x'.repeat(500) });
  const s = await st(1, code);
  assert.equal(s.chat[0].text.includes('<'), false);
  assert.equal(s.chat[1].text.length, 200);
  assert.equal(s.chat[0].name, 'Ann');
  await fails(rpc(0, 'send_chat', { p_code: code, p_text: '   ' }), 'empty_message');
  for (let i = 0; i < 3; i++) await rpc(0, 'send_chat', { p_code: code, p_text: 'm' + i });
  await fails(rpc(0, 'send_chat', { p_code: code, p_text: 'spam' }), 'rate_limited');
  await fails(rpc(4, 'send_chat', { p_code: code, p_text: 'outsider' }), 'not_in_room');
});

test('security: no direct table access, no internal functions, no impersonation', async () => {
  const code = await room(2);
  for (const t of ['rooms', 'players', 'games', 'submissions', 'votes', 'game_items', 'chat_messages']) {
    await assert.rejects(be.db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query(`select * from public.${t}`);
    }), /permission denied/, t);
    await assert.rejects(be.db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query(`delete from public.${t}`);
    }), /permission denied/, t);
  }
  await assert.rejects(be.db.transaction(async tx => {
    await tx.exec('set local role anon');
    await tx.query(`select public.get_state('${code}')`);
  }), /permission denied/);
  await fails(rpc(0, '_tick', { p_room: crypto.randomUUID() }), 'Not found');
  await assert.rejects(be.db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query(`select public._tick('${crypto.randomUUID()}')`);
  }), /permission denied/);
  // callers can only ever act as auth.uid(): a stranger is not in the room
  await fails(rpc(3, 'cast_vote', { p_code: code, p_candidate: U[0] }), 'not_in_room');
  // pulse table readable only by members
  const rows = async (i) => be.db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [U[i]]);
    await tx.exec('set local role authenticated');
    return (await tx.query(`select * from public.room_pulse`)).rows.length;
  });
  assert.ok((await rows(0)) >= 1);
  const stranger = crypto.randomUUID();
  const none = await be.db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [stranger]);
    await tx.exec('set local role authenticated');
    return (await tx.query(`select * from public.room_pulse`)).rows.length;
  });
  assert.equal(none, 0, 'non-members see no pulse rows');
});
