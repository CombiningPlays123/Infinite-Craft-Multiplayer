-- =====================================================================
-- Infinite Craft Multiplayer - schema, row level security, server logic
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Security model
--   * Every table has RLS enabled and NO client policies, except
--     room_pulse (a tiny "something changed" counter used by Realtime).
--   * Clients never write tables directly. All mutations go through the
--     SECURITY DEFINER functions at the bottom, which derive the caller from
--     auth.uid() (never from a parameter), so players cannot impersonate
--     anyone, vote twice, pick their own winner, or send timer values.
--   * Hidden information (other players' submissions before reveal, votes
--     before voting ends, other players' inventories in competition mode) is
--     only ever returned by get_state(), which applies the visibility rules.
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  host_id          uuid not null,
  mode             text not null default 'competition' check (mode in ('competition','shared')),
  timer_seconds    int  default 300 check (timer_seconds is null or timer_seconds in (60,180,300,600,900,1800)), -- null = unlimited
  current_game_id  uuid,
  game_counter     int  not null default 0,
  created_at       timestamptz not null default now(),
  last_activity    timestamptz not null default now()
);

create table if not exists public.players (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  client_id  text,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  status     text not null default 'active' check (status in ('active','left','kicked')),
  primary key (room_id, user_id)
);
create index if not exists players_user_idx on public.players(user_id);

create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  number         int  not null,
  mode           text not null,
  timer_seconds  int,
  phase          text not null default 'submit' check (phase in ('submit','vote','playing','finished')),
  target         text,
  target_norm    text,
  target_author  uuid,
  started_at     timestamptz,
  ends_at        timestamptz,
  finished_at    timestamptz,
  outcome        text check (outcome in ('win','timeout','abandoned')),
  winner_id      uuid,
  created_at     timestamptz not null default now()
);
create index if not exists games_room_idx on public.games(room_id);

create table if not exists public.submissions (
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null,
  text       text not null,
  norm       text not null,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table if not exists public.votes (
  game_id      uuid not null references public.games(id) on delete cascade,
  voter_id     uuid not null,
  candidate_id uuid not null,
  created_at   timestamptz not null default now(),
  primary key (game_id, voter_id),
  check (voter_id <> candidate_id)
);

-- Inventory of discovered elements. owner = the player (competition) or the
-- all-zero uuid (shared world). The four base elements are implicit.
create table if not exists public.game_items (
  game_id       uuid not null references public.games(id) on delete cascade,
  owner         uuid not null,
  norm          text not null,
  name          text not null,
  emoji         text,
  discovered_by uuid not null,
  a             text not null,
  b             text not null,
  seq           bigint generated always as identity,
  created_at    timestamptz not null default now(),
  primary key (game_id, owner, norm)
);

-- Shared mode: one result per ingredient pair, so simultaneous/duplicate
-- combinations cannot disagree.
create table if not exists public.game_recipes (
  game_id     uuid not null references public.games(id) on delete cascade,
  a_norm      text not null,
  b_norm      text not null,
  result_norm text not null,
  primary key (game_id, a_norm, b_norm)
);

create table if not exists public.game_stats (
  game_id         uuid not null references public.games(id) on delete cascade,
  user_id         uuid not null,
  crafts          int  not null default 0,
  last_craft_at   timestamptz,
  primary key (game_id, user_id)
);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_room_idx on public.chat_messages(room_id, id);

create table if not exists public.room_pulse (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  v       bigint not null default 0
);

-- ------------------------------------------------------------------ RLS
alter table public.rooms         enable row level security;
alter table public.players       enable row level security;
alter table public.games         enable row level security;
alter table public.submissions   enable row level security;
alter table public.votes         enable row level security;
alter table public.game_items    enable row level security;
alter table public.game_recipes  enable row level security;
alter table public.game_stats    enable row level security;
alter table public.chat_messages enable row level security;
alter table public.room_pulse    enable row level security;

-- ---------------------------------------------------------- helpers
create or replace function public._uid() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated'; end if;
  return v;
end $$;

create or replace function public._norm(t text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(t,'')), '\s+', ' ', 'g')) $$;

-- strips control characters and angle brackets (no HTML can survive), collapses spaces
create or replace function public._clean(t text, maxlen int) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t,''), '<[^>]*>', '', 'g'), '[[:cntrl:]<>]', '', 'g'), '\s+', ' ', 'g')), maxlen)
$$;

create or replace function public._base_items() returns text[]
language sql immutable as $$ select array['water','fire','wind','earth'] $$;

create or replace function public._zero() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create or replace function public._bump(p_room uuid) returns void
language sql as $$
  insert into public.room_pulse(room_id, v) select id, 1 from public.rooms where id = p_room
  on conflict (room_id) do update set v = public.room_pulse.v + 1;
  update public.rooms set last_activity = now() where id = p_room;
$$;

create or replace function public._is_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players p
                 where p.room_id = p_room and p.user_id = auth.uid() and p.status = 'active')
$$;

drop policy if exists room_pulse_member_read on public.room_pulse;
create policy room_pulse_member_read on public.room_pulse
  for select to authenticated using (public._is_member(room_id));

create or replace function public._finish(p_game uuid, p_outcome text, p_winner uuid) returns void
language plpgsql as $$
begin
  update public.games set phase = 'finished', finished_at = now(), outcome = p_outcome, winner_id = p_winner
  where id = p_game and phase <> 'finished';
end $$;

-- ------------------------------------------------- maintenance (the "tick")
-- Called (with the room row locked) by every RPC. This is what makes timers,
-- host transfer, disconnect handling and vote resolution server-authoritative
-- without needing cron: any connected client's polling advances the room.
create or replace function public._tick(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms%rowtype;
  g public.games%rowtype;
  v_new uuid;
  n_active int; n_online int; n_req int; n_done int;
  v_norm text; v_text text; v_author uuid; v_start timestamptz;
  v_changed boolean := false;
begin
  select * into r from public.rooms where id = p_room;
  if not found then return; end if;
  if r.current_game_id is not null then
    select * into g from public.games where id = r.current_game_id;
  end if;

  -- drop players that have been gone for a long time (keeps seats from leaking)
  update public.players set status = 'left'
   where room_id = p_room and status = 'active'
     and last_seen < now() - (case when g.id is null or g.phase = 'finished'
                                   then interval '2 minutes' else interval '10 minutes' end);
  if found then v_changed := true; end if;

  select count(*) into n_active from public.players where room_id = p_room and status = 'active';
  if n_active = 0 then
    delete from public.rooms where id = p_room;
    return;
  end if;

  -- host transfer: host gone or disconnected for 30s -> earliest-joined online player
  if not exists (select 1 from public.players where room_id = p_room and user_id = r.host_id and status = 'active'
                   and last_seen >= now() - interval '30 seconds') then
    select user_id into v_new from public.players
     where room_id = p_room and status = 'active' and user_id <> r.host_id
       and last_seen >= now() - interval '25 seconds'
     order by joined_at limit 1;
    if v_new is null and not exists (select 1 from public.players where room_id = p_room and user_id = r.host_id and status = 'active') then
      select user_id into v_new from public.players where room_id = p_room and status = 'active'
       order by last_seen desc limit 1;
    end if;
    if v_new is not null then
      update public.rooms set host_id = v_new where id = p_room;
      v_changed := true;
    end if;
  end if;

  if g.id is not null and g.phase <> 'finished' then
    select count(*) into n_online from public.players
     where room_id = p_room and status = 'active' and last_seen >= now() - interval '25 seconds';

    if g.phase in ('submit','vote') and n_online < 2 then
      perform public._finish(g.id, 'abandoned', null);
      v_changed := true;

    elsif g.phase = 'submit' then
      select count(*) into n_req from public.players p
       where p.room_id = p_room and p.status = 'active' and p.last_seen >= now() - interval '25 seconds';
      select count(*) into n_done from public.players p
       where p.room_id = p_room and p.status = 'active' and p.last_seen >= now() - interval '25 seconds'
         and exists (select 1 from public.submissions s where s.game_id = g.id and s.user_id = p.user_id);
      if n_req = n_done and (select count(*) from public.submissions where game_id = g.id) >= 2 then
        update public.games set phase = 'vote' where id = g.id;
        v_changed := true;
      end if;

    elsif g.phase = 'vote' then
      -- required voters: online players who have at least one other player's submission to vote for
      select count(*) into n_req from public.players p
       where p.room_id = p_room and p.status = 'active' and p.last_seen >= now() - interval '25 seconds'
         and exists (select 1 from public.submissions s where s.game_id = g.id and s.user_id <> p.user_id);
      select count(*) into n_done from public.players p
       where p.room_id = p_room and p.status = 'active' and p.last_seen >= now() - interval '25 seconds'
         and exists (select 1 from public.votes v where v.game_id = g.id and v.voter_id = p.user_id);
      if n_done >= n_req then
        -- tally by normalised text; ties broken randomly (server side)
        select t.norm into v_norm from (
          select s.norm, count(v.voter_id) c
            from public.submissions s
            left join public.votes v on v.game_id = s.game_id and v.candidate_id = s.user_id
           where s.game_id = g.id group by s.norm
        ) t order by t.c desc, random() limit 1;
        select s.text, s.user_id into v_text, v_author from public.submissions s
         where s.game_id = g.id and s.norm = v_norm order by random() limit 1;
        v_start := now() + interval '6 seconds';
        update public.games set phase = 'playing', target = v_text, target_norm = v_norm, target_author = v_author,
               started_at = v_start,
               ends_at = case when g.timer_seconds is null then null else v_start + make_interval(secs => g.timer_seconds) end
         where id = g.id;
        v_changed := true;
      end if;

    elsif g.phase = 'playing' then
      if g.ends_at is not null and now() >= g.ends_at then
        perform public._finish(g.id, 'timeout', null);
        v_changed := true;
      end if;
    end if;
  end if;

  if v_changed then perform public._bump(p_room); end if;
end $$;

create or replace function public._cleanup_rooms() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.rooms r
   where r.last_activity < now() - interval '6 hours'
      or not exists (select 1 from public.players p where p.room_id = r.id and p.status = 'active'
                       and p.last_seen > now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public._lock_room(p_code text) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) for update;
  if not found then raise exception 'room_not_found'; end if;
  return r;
end $$;

-- membership check + heartbeat + tick; returns the (re-read) room, or raises
create or replace function public._enter(p_code text, p_client text default null) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; me public.players%rowtype; v uuid := public._uid();
begin
  r := public._lock_room(p_code);
  select * into me from public.players where room_id = r.id and user_id = v;
  if not found then raise exception 'not_in_room'; end if;
  if me.status = 'kicked' then raise exception 'kicked'; end if;
  if me.status <> 'active' then raise exception 'not_in_room'; end if;
  if p_client is not null and me.client_id is distinct from p_client then raise exception 'superseded'; end if;
  update public.players set last_seen = now() where room_id = r.id and user_id = v;
  perform public._tick(r.id);
  select * into r from public.rooms where id = r.id;
  if not found then raise exception 'room_not_found'; end if;
  return r;
end $$;

-- ------------------------------------------------------------ public RPCs
create or replace function public.create_room(p_name text, p_client text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := public._uid(); v_name text := public._clean(p_name, 16);
  v_code text; v_room uuid; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; tries int := 0;
  old record;
begin
  if length(v_name) < 1 then raise exception 'invalid_name'; end if;
  perform public._cleanup_rooms();
  loop
    v_code := '';
    for i in 1..5 loop v_code := v_code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
    tries := tries + 1; if tries > 50 then raise exception 'try_again'; end if;
  end loop;
  insert into public.rooms(code, host_id) values (v_code, v) returning id into v_room;
  insert into public.players(room_id, user_id, name, client_id) values (v_room, v, v_name, p_client);
  for old in select room_id from public.players where user_id = v and status = 'active' and room_id <> v_room loop
    update public.players set status = 'left' where room_id = old.room_id and user_id = v;
    perform public._tick(old.room_id);
  end loop;
  perform public._bump(v_room);
  return jsonb_build_object('code', v_code);
end $$;

create or replace function public.join_room(p_code text, p_name text, p_client text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := public._uid(); v_name text := public._clean(p_name, 16);
  r public.rooms%rowtype; me public.players%rowtype; g public.games%rowtype;
  n int; v_try text; k int := 1; old record;
begin
  if length(v_name) < 1 then raise exception 'invalid_name'; end if;
  r := public._lock_room(p_code);
  perform public._tick(r.id);
  select * into r from public.rooms where id = r.id;
  if not found then raise exception 'room_not_found'; end if;
  select * into me from public.players where room_id = r.id and user_id = v;
  if found and me.status = 'kicked' then raise exception 'kicked'; end if;

  if found and me.status = 'active' then
    -- reconnect (refresh / new tab): the newest client takes over the seat
    update public.players set client_id = p_client, last_seen = now() where room_id = r.id and user_id = v;
  else
    select count(*) into n from public.players where room_id = r.id and status = 'active';
    if n >= 4 then raise exception 'room_full'; end if;
    if r.current_game_id is not null then
      select * into g from public.games where id = r.current_game_id;
      if g.phase <> 'finished' then raise exception 'game_in_progress'; end if;
    end if;
    v_try := v_name;
    while exists (select 1 from public.players where room_id = r.id and status = 'active' and lower(name) = lower(v_try)) loop
      k := k + 1; v_try := left(v_name, 14) || k::text;
    end loop;
    insert into public.players(room_id, user_id, name, client_id) values (r.id, v, v_try, p_client)
      on conflict (room_id, user_id) do update
        set name = excluded.name, client_id = excluded.client_id, status = 'active', joined_at = now(), last_seen = now();
    for old in select room_id from public.players where user_id = v and status = 'active' and room_id <> r.id loop
      update public.players set status = 'left' where room_id = old.room_id and user_id = v;
      perform public._tick(old.room_id);
    end loop;
  end if;
  perform public._bump(r.id);
  return jsonb_build_object('code', r.code);
end $$;

create or replace function public.leave_room(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid();
begin
  r := public._lock_room(p_code);
  update public.players set status = 'left' where room_id = r.id and user_id = v and status = 'active';
  perform public._tick(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
exception when others then
  if sqlerrm = 'room_not_found' then return jsonb_build_object('ok', true); end if;
  raise;
end $$;

create or replace function public.kick_player(p_code text, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid();
begin
  r := public._enter(p_code);
  if r.host_id <> v then raise exception 'not_host'; end if;
  if p_target = v then raise exception 'cannot_kick_self'; end if;
  update public.players set status = 'kicked' where room_id = r.id and user_id = p_target and status = 'active';
  if not found then raise exception 'player_not_found'; end if;
  perform public._tick(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

-- p_timer: seconds (60,180,300,600,900,1800) or 0 for unlimited
create or replace function public.update_settings(p_code text, p_mode text, p_timer int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype;
begin
  r := public._enter(p_code);
  if r.host_id <> v then raise exception 'not_host'; end if;
  if r.current_game_id is not null then
    select * into g from public.games where id = r.current_game_id;
    if g.phase <> 'finished' then raise exception 'game_in_progress'; end if;
  end if;
  if p_mode not in ('competition','shared') then raise exception 'invalid_mode'; end if;
  if p_timer not in (0,60,180,300,600,900,1800) then raise exception 'invalid_timer'; end if;
  update public.rooms set mode = p_mode, timer_seconds = nullif(p_timer, 0) where id = r.id;
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

-- start a new game (from the lobby) or a rematch (from results). Host only.
create or replace function public.start_game(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype; v_id uuid; n int;
begin
  r := public._enter(p_code);
  if r.host_id <> v then raise exception 'not_host'; end if;
  if r.current_game_id is not null then
    select * into g from public.games where id = r.current_game_id;
    if g.phase <> 'finished' then raise exception 'game_in_progress'; end if;
  end if;
  select count(*) into n from public.players where room_id = r.id and status = 'active' and last_seen >= now() - interval '25 seconds';
  if n < 2 then raise exception 'need_players'; end if;
  insert into public.games(room_id, number, mode, timer_seconds)
    values (r.id, r.game_counter + 1, r.mode, r.timer_seconds) returning id into v_id;
  update public.rooms set current_game_id = v_id, game_counter = game_counter + 1 where id = r.id;
  perform public._bump(r.id);
  return jsonb_build_object('game', v_id);
end $$;

create or replace function public.back_to_lobby(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype;
begin
  r := public._enter(p_code);
  if r.host_id <> v then raise exception 'not_host'; end if;
  if r.current_game_id is not null then
    select * into g from public.games where id = r.current_game_id;
    -- the host may also abort a running game
    if g.phase <> 'finished' then perform public._finish(g.id, 'abandoned', null); end if;
  end if;
  update public.rooms set current_game_id = null where id = r.id;
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.submit_target(p_code text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype; t text := public._clean(p_text, 40); nn text;
begin
  r := public._enter(p_code);
  select * into g from public.games where id = r.current_game_id;
  if not found or g.phase <> 'submit' then raise exception 'not_submit_phase'; end if;
  if length(t) < 1 then raise exception 'invalid_element'; end if;
  nn := public._norm(t);
  if nn = any(public._base_items()) then raise exception 'base_element'; end if;
  if nn in ('nothing') then raise exception 'invalid_element'; end if;
  insert into public.submissions(game_id, user_id, text, norm) values (g.id, v, t, nn);
  perform public._tick(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
exception when unique_violation then
  raise exception 'already_submitted';
end $$;

create or replace function public.cast_vote(p_code text, p_candidate uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype;
begin
  r := public._enter(p_code);
  select * into g from public.games where id = r.current_game_id;
  if not found or g.phase <> 'vote' then raise exception 'not_vote_phase'; end if;
  if p_candidate = v then raise exception 'cannot_vote_self'; end if;
  if not exists (select 1 from public.submissions where game_id = g.id and user_id = p_candidate) then
    raise exception 'invalid_candidate';
  end if;
  if exists (select 1 from public.votes where game_id = g.id and voter_id = v) then raise exception 'already_voted'; end if;
  insert into public.votes(game_id, voter_id, candidate_id) values (g.id, v, p_candidate);
  perform public._tick(r.id);
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

-- A client reports a combination the original game just produced. The server
-- cannot ask neal.fun what a pair makes, so it verifies everything it can:
-- phase + server clock, ingredient ownership (replayed from the server's own
-- record of the round), shared-world pair consistency, rate, and exact target
-- match. Only the server decides that the round is won.
create or replace function public.report_craft(p_code text, p_a text, p_b text, p_result text, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms%rowtype; v uuid := public._uid(); g public.games%rowtype;
  v_a text := public._clean(p_a, 60); v_b text := public._clean(p_b, 60); res text := public._clean(p_result, 60);
  emo text := left(coalesce(p_emoji,''), 16);
  an text; bn text; rn text; v_owner uuid; v_last timestamptz; ins int; ex_res text; won boolean := false;
begin
  r := public._enter(p_code);
  select * into g from public.games where id = r.current_game_id;
  if not found or g.phase <> 'playing' then raise exception 'round_not_active'; end if;
  if now() < g.started_at then raise exception 'round_not_started'; end if;
  if length(v_a) = 0 or length(v_b) = 0 or length(res) = 0 then raise exception 'invalid_craft'; end if;
  an := public._norm(v_a); bn := public._norm(v_b); rn := public._norm(res);
  if rn in ('nothing') then raise exception 'invalid_craft'; end if;
  v_owner := case when g.mode = 'shared' then public._zero() else v end;

  insert into public.game_stats(game_id, user_id) values (g.id, v) on conflict do nothing;
  select last_craft_at into v_last from public.game_stats where game_id = g.id and user_id = v for update;
  if v_last is not null and clock_timestamp() - v_last < interval '25 milliseconds' then raise exception 'too_fast'; end if;

  if not (an = any(public._base_items()) or exists (select 1 from public.game_items where game_id = g.id and owner = v_owner and norm = an)) then
    raise exception 'ingredient_not_owned:%', v_a;
  end if;
  if not (bn = any(public._base_items()) or exists (select 1 from public.game_items where game_id = g.id and owner = v_owner and norm = bn)) then
    raise exception 'ingredient_not_owned:%', v_b;
  end if;

  if g.mode = 'shared' then
    select result_norm into ex_res from public.game_recipes where game_id = g.id and a_norm = least(an,bn) and b_norm = greatest(an,bn);
    if found and ex_res <> rn then raise exception 'recipe_conflict'; end if;
    insert into public.game_recipes(game_id, a_norm, b_norm, result_norm) values (g.id, least(an,bn), greatest(an,bn), rn) on conflict do nothing;
  end if;

  update public.game_stats set crafts = crafts + 1, last_craft_at = clock_timestamp() where game_id = g.id and user_id = v;

  ins := 0;
  if not (rn = any(public._base_items())) then
    insert into public.game_items(game_id, owner, norm, name, emoji, discovered_by, a, b)
      values (g.id, v_owner, rn, res, emo, v, v_a, v_b) on conflict do nothing;
    get diagnostics ins = row_count;
  end if;

  if rn = g.target_norm then
    perform public._finish(g.id, 'win', v);
    won := true;
  end if;
  perform public._bump(r.id);
  return jsonb_build_object('new', ins = 1, 'won', won);
end $$;

create or replace function public.send_chat(p_code text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.rooms%rowtype; v uuid := public._uid(); t text := public._clean(p_text, 200); nm text;
begin
  r := public._enter(p_code);
  if length(t) = 0 then raise exception 'empty_message'; end if;
  if (select count(*) from public.chat_messages where room_id = r.id and user_id = v and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'rate_limited';
  end if;
  select name into nm from public.players where room_id = r.id and user_id = v;
  insert into public.chat_messages(room_id, user_id, name, text) values (r.id, v, nm, t);
  delete from public.chat_messages where room_id = r.id and id <= (select max(id) - 200 from public.chat_messages where room_id = r.id);
  perform public._bump(r.id);
  return jsonb_build_object('ok', true);
end $$;

-- Single read endpoint. Also acts as the client's heartbeat and advances the room.
create or replace function public.get_state(p_code text, p_client text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := public._uid();
  r public.rooms%rowtype; me public.players%rowtype; g public.games%rowtype;
  v_phase text; v_players jsonb; v_subs jsonb := '[]'; v_my_sub jsonb; v_my_vote uuid; v_items jsonb := '[]';
  v_tally jsonb; v_chat jsonb; v_result jsonb; v_starts int; v_rem int; v_nvoted int; v_nsub int;
begin
  select * into r from public.rooms where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'room_not_found'; end if;
  select * into me from public.players where room_id = r.id and user_id = v;
  if not found or me.status = 'left' then raise exception 'not_in_room'; end if;
  if me.status = 'kicked' then raise exception 'kicked'; end if;
  if p_client is not null and me.client_id is distinct from p_client then
    return jsonb_build_object('superseded', true);
  end if;
  update public.players set last_seen = now() where room_id = r.id and user_id = v;
  -- advance the room if nobody else is mid-transaction on it
  perform 1 from public.rooms where id = r.id for update skip locked;
  if found then perform public._tick(r.id); end if;
  select * into r from public.rooms where id = r.id;
  if not found then raise exception 'room_not_found'; end if;

  if r.current_game_id is not null then select * into g from public.games where id = r.current_game_id; end if;
  v_phase := case when g.id is null then 'lobby' when g.phase = 'finished' then 'results' else g.phase end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.user_id, 'name', p.name, 'host', p.user_id = r.host_id,
      'online', p.last_seen >= now() - interval '25 seconds',
      'submitted', exists (select 1 from public.submissions s where s.game_id = g.id and s.user_id = p.user_id),
      'voted', exists (select 1 from public.votes x where x.game_id = g.id and x.voter_id = p.user_id),
      'discoveries', (select count(*) from public.game_items i where i.game_id = g.id and i.discovered_by = p.user_id),
      'crafts', coalesce((select st.crafts from public.game_stats st where st.game_id = g.id and st.user_id = p.user_id), 0)
    ) order by p.joined_at), '[]'::jsonb)
    into v_players from public.players p where p.room_id = r.id and p.status = 'active';

  if g.id is not null then
    select count(*) into v_nsub from public.submissions where game_id = g.id;
    if g.phase <> 'submit' then
      select coalesce(jsonb_agg(jsonb_build_object('author', s.user_id,
               'authorName', (select name from public.players where room_id = r.id and user_id = s.user_id), 'text', s.text)
               order by s.created_at), '[]'::jsonb)
        into v_subs from public.submissions s where s.game_id = g.id;
    end if;
    select jsonb_build_object('text', s.text) into v_my_sub from public.submissions s where s.game_id = g.id and s.user_id = v;
    select candidate_id into v_my_vote from public.votes where game_id = g.id and voter_id = v;

    if g.phase in ('playing','finished') then
      select coalesce(jsonb_agg(jsonb_build_object('author', s.user_id, 'text', s.text,
               'votes', (select count(*) from public.votes x where x.game_id = g.id and x.candidate_id = s.user_id),
               'voters', (select coalesce(jsonb_agg(pl.name), '[]'::jsonb) from public.votes x join public.players pl
                           on pl.room_id = r.id and pl.user_id = x.voter_id where x.game_id = g.id and x.candidate_id = s.user_id))
               order by s.created_at), '[]'::jsonb)
        into v_tally from public.submissions s where s.game_id = g.id;

      select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'emoji', i.emoji, 'by', i.discovered_by,
               'byName', (select name from public.players where room_id = r.id and user_id = i.discovered_by),
               'a', i.a, 'b', i.b, 'seq', i.seq) order by i.seq), '[]'::jsonb)
        into v_items from public.game_items i
       where i.game_id = g.id and i.owner = case when g.mode = 'shared' then public._zero() else v end;
    end if;

    if g.phase = 'playing' then
      v_starts := greatest(0, floor(extract(epoch from (g.started_at - clock_timestamp())) * 1000))::int;
      v_rem := case when g.ends_at is null then null
                    else greatest(0, floor(extract(epoch from (g.ends_at - clock_timestamp())) * 1000))::int end;
    end if;

    if g.phase = 'finished' then
      v_result := jsonb_build_object('outcome', g.outcome, 'winnerId', g.winner_id,
        'winnerName', (select name from public.players where room_id = r.id and user_id = g.winner_id),
        'target', g.target,
        'targetRecipe', (select jsonb_build_object('a', i.a, 'b', i.b, 'emoji', i.emoji, 'by', i.discovered_by)
                           from public.game_items i where i.game_id = g.id and i.norm = g.target_norm
                            and i.owner = case when g.mode = 'shared' then public._zero() else g.winner_id end limit 1),
        'closest', null);
    end if;
  end if;

  select coalesce(jsonb_agg(m order by m.id), '[]'::jsonb) into v_chat from (
    select c.id, c.user_id as "userId", c.name, c.text, c.created_at as "at"
      from public.chat_messages c where c.room_id = r.id order by c.id desc limit 60) m;

  return jsonb_build_object(
    'serverNow', now(),
    'me', v,
    'room', jsonb_build_object('id', r.id, 'code', r.code, 'hostId', r.host_id, 'mode', r.mode, 'timerSeconds', r.timer_seconds,
                               'game', r.game_counter),
    'phase', v_phase,
    'game', case when g.id is null then null else jsonb_build_object(
        'id', g.id, 'number', g.number, 'mode', g.mode, 'timerSeconds', g.timer_seconds,
        'target', case when g.phase in ('playing','finished') then g.target end,
        'startsInMs', v_starts, 'remainingMs', v_rem,
        'submittedCount', v_nsub, 'mySubmission', v_my_sub, 'myVote', v_my_vote) end,
    'players', v_players,
    'submissions', case when g.id is not null and g.phase <> 'submit' then v_subs else '[]'::jsonb end,
    'tally', coalesce(v_tally, '[]'::jsonb),
    'items', v_items,
    'result', v_result,
    'chat', v_chat
  );
end $$;

-- ------------------------------------------------------------ privileges
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select on public.room_pulse to authenticated;
grant execute on function public._is_member(uuid) to authenticated;
grant execute on function
  public.create_room(text,text), public.join_room(text,text,text), public.leave_room(text),
  public.kick_player(text,uuid), public.update_settings(text,text,int), public.start_game(text),
  public.back_to_lobby(text), public.submit_target(text,text), public.cast_vote(text,uuid),
  public.report_craft(text,text,text,text,text), public.send_chat(text,text), public.get_state(text,text)
  to authenticated;
-- (internal helpers keep no grants; SECURITY DEFINER functions call them as the owner)

-- Realtime: broadcast the pulse table (RLS above limits it to room members).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.room_pulse; exception when duplicate_object then null; end;
  end if;
end $$;
