# Architecture

## Infinite Craft integration (findings, inspected 2026-11)
neal.fun/infinite-craft is a **Nuxt 2 / Vue 2** app. Relevant facts, all observed in the live page:
* The game exposes a **public console API**, `window.IC`: `getItems()`, `craft(a, b)`, `switchSave(n)`,
  `getCurrentSave()`, `exportSave()`, `getInstances()`, …
* `IC.getItems()` → `[{id, text, emoji, recipes?}]` = the current save's inventory (new items carry `recipes: [[idA, idB]]`).
* `IC.craft('Water','Fire')` performs a **real** craft through the game's own pipeline and resolves to the
  result item. Drag-and-drop uses the page component's `craft(a, b)` method (resolves `{instance}`).
* Saves live in IndexedDB (`infinite-craft`). We never touch it directly.
* No CSP beyond `frame-ancestors`, so a same-origin console script can load external scripts.

`client/infinite-craft-adapter.js` therefore: (1) waits for `window.IC`; (2) finds the Vue component that owns
`craft`/`switchSave`/`items` and wraps `craft` to observe *every* craft (restored on disconnect); (3) as a fallback
polls `IC.getItems()` for new items and reads their recorded recipe; (4) mirrors server-known elements into the
local game by calling `IC.craft(a, b)` for real (flagged as a replay so it is not re-reported); (5) exposes
`foreign()`/`switchToNextSlot()` for the save-slot guard. If neal.fun changes, only this file changes.

## Data flow
```
 player A game ──drag──► craft() ──► adapter hook ─► Round.queue ─► RPC report_craft ─┐
                                                                                      ▼
                                          Postgres (Supabase): rooms/players/games/items… + RLS
                                                                                      │ room_pulse bump
 player B client ◄── get_state poll (1.5 s, or 5 s + Realtime wake-ups) ◄────────────┘
        └─► Round.syncInventory: replay unknown items via IC.craft (shared & after refresh)
```
* **Server-authoritative**: phase (`submit → vote → playing → finished`), vote tally, tie-break, target,
  `started_at` (now + 6 s countdown), `ends_at`, host, winner. Any client's `get_state` poll runs `_tick`, which
  advances timeouts/votes/host-transfer under a row lock, so no cron or edge function is needed.
* **Timers**: the server returns `startsInMs`/`remainingMs` computed from its own clock; the client counts down
  locally from the moment of receipt and re-syncs every poll. Unlimited = `ends_at null`.
* **Realtime** (`client/room-manager.js`): a small Phoenix-channel client subscribes to `postgres_changes` on
  `room_pulse` (RLS: members only). It only triggers an immediate re-fetch; polling is always on as the safety net.

## Rules of the round (server)
* Submit: exactly one per player, hidden until all *connected* players submitted (disconnected ones don't block).
* Vote: exactly one, final, not for yourself, hidden; ties → `random()`; same text from two players counts together.
* Competition: separate inventory per player. Shared: one inventory (`owner = 0-uuid`), one result per ingredient
  pair (`game_recipes`), so simultaneous or conflicting combinations can't diverge; discoverer is recorded.
* `report_craft` accepts a craft only if: round is `playing` and past `started_at`; both ingredients are base
  elements or already in the caller's (competition) / group's (shared) server inventory; not "Nothing"; not
  faster than 25 ms from the same player; and (shared) consistent with the recorded recipe. A result equal to the
  target (case/space-insensitive) ends the round — first transaction wins (row lock).
* Disconnect: online = heartbeat within 25 s. Host offline 30 s → earliest-joined online player becomes host.
  Seats are held 10 min in a game, 2 min in the lobby. <2 online during submit/vote → round abandoned.

## Trust model (be aware)
The server can't query neal.fun, so the result text of a craft is the **client's claim**. A player editing the
client could invent crafts of elements *reachable only through the claimed chain* — still bounded by ownership,
rate limits and (shared) recipe consistency, and visible in the final recipe shown to everyone. Fine for friends;
not tournament-grade. A future hardening is a Supabase Edge Function asking neal.fun for each pair, but that
would add load/ToS considerations on their API, so it is deliberately not done.

## Known limits
* Shared mode synchronises inventory + discoveries (not canvas element positions).
* Replays hit neal.fun's own craft API once per teammate discovery (same as a manual craft).
* Max 4 players is enforced server-side; the UI layout targets ≥ 320 px wide screens.
