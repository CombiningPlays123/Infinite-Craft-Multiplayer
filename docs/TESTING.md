# Testing - what was run, what was not

Environment note: no Supabase project/credentials were available, so the **same SQL** (`0001_schema.sql`) was
executed in PGlite (WASM PostgreSQL) behind an API with the same shape the client uses on Supabase
(`/auth/v1/signup`, `/rest/v1/rpc/<fn>`, errors as `{code,message}`). Public web pages can't call
`localhost` in current browsers, so for in-browser tests the PGlite backend runs **inside one real
neal.fun tab** (the "leader") and other tabs reach it over `BroadcastChannel` through a `fetch` shim
(`tools/make-test-kit.mjs`, `tests/browser/bridge.html`).

## A. Automated backend tests - `npm test` (19 tests, all passing)
Real SQL, called as role `authenticated` with a JWT-style user id:
| Area | Covered |
|---|---|
| Rooms | create, join by code (case-insens.), full room (5th player rejected), invalid code, duplicate session takeover (`superseded`), duplicate names, min 2 to start, non-host can't start/configure, all timer options incl. unlimited |
| Hidden info | submissions invisible before everyone submitted; tally hidden during voting; other players' crafts invisible in competition |
| Voting | no self-vote, one vote, final, invalid candidate, majority win, 2-player 1-1 tie (both outcomes observed), 4-player tie |
| Competition | ownership enforcement, first verified craft wins, nobody can craft before synchronized start, "Nothing" rejected, no craft after finish, timeout (nobody wins, counts kept), unlimited never times out, all players see ≈ same remaining time |
| Shared | one inventory for all, discoverer recorded, simultaneous identical craft → exactly 1 insert, recipe conflict rejected, teammate can use others' items, group win, group timeout |
| Lifecycle | rematch, back to lobby, host-only controls, host offline → host transferred, offline player doesn't block voting, reconnect, kick (kicked can't rejoin), leave → abandoned, host leaves → transfer, empty/abandoned rooms cleaned |
| Chat | HTML stripped, 200-char cap, empty rejected, 5 msgs/10 s limit, members only |
| Security | no table SELECT/DELETE for `authenticated`, no function access for `anon`, internal `_tick` not callable, outsiders can't act, `room_pulse` visible only to members |

## B. Real Infinite Craft in the browser (manual, via the bridge)
Run on the live game (neal.fun) with the built client:
* 4-player lobby (1 real tab + 3 scripted peers): create via UI, joins, **5th player rejected**, bad code rejected, kick via UI (×3).
* Submission/voting through the UI: own submission locked, others hidden until all in, reveal, vote locked, votes hidden, tally + voters revealed afterwards.
* **Competition**: synchronized countdown → GO; crafted *Lava* with the game's API → observed by the adapter hook and counted; peer wins with *Steam* → UI shows "Ben wins" + final scoreboard.
* **Shared**: peers' discoveries (*Smoke*, *Plant*) appeared in the real game's sidebar via real replay crafts (no desync warnings); **a genuine drag-and-drop craft (Water + Fire → Steam) was observed by the adapter, verified by the server and ended the round as a team victory**.
* Save-slot guard: a slot with extra elements raised the warning; *Use next save slot* switched the game's slot (original slots untouched).
* **Two independent real tabs** (separate identities) in one room: lobby, submit, vote (1-1 tie → random target), race, **timeout** shown on both with the closeness note, timers identical on both tabs (00:45 / 00:45).
* **Refresh/reconnect**: reloaded a tab in the lobby and during a running round; re-running the snippet rejoined automatically with the correct phase and timer.
* **Host leaves** → other tab became host and got the host buttons.
* **Network outage** (fetch failing for 3.5 s): status "Reconnecting…", then "Connected", still in the room.
* **Chat**: cross-tab delivery; `<img onerror>`/`<b>` stripped; nothing injected into the DOM.
* **Disconnect/duplicate install**: running the snippet twice created one panel; ✕ removed panel, restored the game's original `craft`, game still crafts normally; re-install works.

## C. NOT tested - needs your Supabase project
* Hosted GoTrue anonymous sign-in call and key handling (`sb_publishable_…` header only, no `Authorization`).
* PostgREST RPC exposure/`400` error mapping on the hosted service (shape follows PostgREST docs).
* The **Realtime WebSocket** accelerator (written to the documented Phoenix protocol; polling covers it if it fails).
* GitHub Pages deployment and the workflow.
* Four *separate machines* (all browser tests shared one browser profile; scripted peers stood in for 3 of 4 players).
* Behaviour on locked-down school networks/browsers.
First-run checklist after setup: create a room on two devices, vote, run a 1-minute Shared round, check Supabase
logs show no errors; if Realtime is reachable, DevTools → Network → WS shows an open `realtime/v1/websocket`.

## Re-running
```bash
npm install && npm test                 # A
npm run build:dev && node tools/make-test-kit.mjs && npm run dev   # then open
# http://127.0.0.1:54321/tests/browser/bridge.html  -> redirects to neal.fun with the kit in window.name
# in that tab's console:  const d=JSON.parse(window.name.slice(7)); (0,eval)(d.kit); await __kit.startLeader(); __kit.installShim(); __kit.clientCode=d.cli; __kit.runClient('p1')
# other tabs: same bridge, but skip startLeader(); use runClient('p2'), 'p3', ...
```
