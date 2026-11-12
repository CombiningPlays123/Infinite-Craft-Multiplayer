# Supabase setup (free tier is enough)

You need **two public values** from Supabase: the *Project URL* and the *publishable (anon) key*.
You never need — and must never paste anywhere — the `service_role` / secret key. `tools/build.mjs`
refuses to build if it detects one.

## 1. Create the project
1. Sign up / log in at <https://supabase.com> → **New project**. Pick any name/region, set a database password
   (store it in your password manager; the app never needs it).
2. Wait until the project finishes provisioning.

## 2. Enable anonymous sign-ins (required)
Players get a secure, anonymous identity (a real Supabase JWT) so nobody can impersonate anybody else.
* Dashboard → **Authentication → Sign In / Providers** → switch on **Allow anonymous sign-ins**.
* Shared networks (a school!) share one IP. Supabase limits anonymous sign-ins per IP
  (default ~30/hour, see **Authentication → Rate Limits**). Each browser signs in only once and remembers
  its identity, so this is fine for a few friends; raise the limit if a whole class plays.

## 3. Create the database objects
Dashboard → **SQL Editor → New query** → paste the whole of
[`backend/migrations/0001_schema.sql`](../backend/migrations/0001_schema.sql) → **Run**.
It is safe to re-run (idempotent) after updates. This creates the tables, **Row Level Security**, every
server-side rule (voting, timers, win verification, host transfer…) and adds the `room_pulse` table to the
Realtime publication.

Check: *Table editor* shows `rooms, players, games, submissions, votes, game_items, …`, each with RLS
enabled and **no policies** except `room_pulse` (by design — clients only talk to the RPC functions).

## 4. (Optional) clean up abandoned rooms automatically
Rooms are already cleaned lazily whenever someone creates a room. For scheduled cleanup:
Dashboard → **Database → Extensions** → enable **pg_cron**, then run `backend/migrations/0002_optional_cron.sql`.

## 5. Copy the two public values
Dashboard → **Project Settings → API** (newer projects: **API Keys**):
* **Project URL** → `supabaseUrl` (looks like `https://abcdxyz.supabase.co`)
* **Publishable key** (`sb_publishable_…`) or the legacy **anon** key → `supabasePublishableKey`

Put them (plus your Pages URL) in `backend/config/config.json` (copy from `config.example.json`) for a local
build, **or** as GitHub repository variables for the automated deploy — see [DEPLOYMENT.md](DEPLOYMENT.md).

## Security model (what the SQL enforces)
| Risk | Defence |
|---|---|
| Direct table access | RLS on, no client policies; table privileges revoked from `anon`/`authenticated` |
| Impersonation | every function derives the actor from `auth.uid()`; no user id is ever accepted from the client (except a *target* id the server validates) |
| Seeing hidden info | `get_state` only returns submissions after reveal, votes after voting, other players' inventories never (competition) |
| Double votes / self votes / changed votes | primary key + explicit checks |
| Host manipulating the vote | host has no vote-related privileges; tie-break is `random()` on the server |
| Fake winner | only `report_craft` can finish a round, after server-side verification (see ARCHITECTURE.md) |
| Fake timers | `started_at`/`ends_at` are server timestamps; clients only display `remaining = server value − local elapsed` |
| Spam | chat 200 chars, 5 msgs/10 s, tags/control chars stripped server-side; craft reports rate-limited |

## Troubleshooting
* *"The backend refused anonymous sign-in"* → step 2.
* *404 / "function … not found"* → step 3 wasn't run (or ran with errors — read the SQL editor output).
* Free projects pause after ~1 week of inactivity: press **Restore** in the dashboard.
