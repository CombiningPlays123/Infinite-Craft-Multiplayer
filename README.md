# Infinite Craft Multiplayer

Play the **original** [Infinite Craft](https://neal.fun/infinite-craft/) with up to 4 friends — race to a
group-voted target (**Competition**) or build one shared world (**Shared**). **No browser extension, no
userscript manager, no install**: you paste one snippet into the page's developer console.

```
infinite-craft-multiplayer/
├── client/            browser client, concatenated into ONE file by tools/build.mjs
│   ├── injector.js            readable source of the console snippet
│   ├── infinite-craft-adapter.js   the ONLY file that knows neal.fun internals
│   ├── room-manager.js        Supabase auth/RPC/Realtime + polling + reconnect
│   ├── voting.js competition.js shared.js chat.js ui.js styles.css multiplayer.js util.js config.js
├── backend/
│   ├── migrations/0001_schema.sql   tables, RLS, all server logic (run once)
│   ├── migrations/0002_optional_cron.sql
│   └── config/config.example.json   the 3 values you fill in
├── website/           install page (GitHub Pages)
├── tools/             build, dev backend (PGlite), packaging
├── tests/             backend test-suite + in-browser test bridge
├── docs/              INSTALLATION · SUPABASE_SETUP · DEPLOYMENT · TESTING · ARCHITECTURE
└── .github/workflows/pages.yml    one-click deploy of the website + client script
```

## Your remaining setup (≈10 minutes, all account/authorisation steps)

1. **Supabase** (free): create a project, enable *anonymous sign-ins*, run `backend/migrations/0001_schema.sql`,
   copy the project URL + publishable key → [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)
2. **GitHub Pages** (free): push this folder to a repo, set 2 repository variables, enable Pages → [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
3. Open your Pages URL, **copy the snippet**, paste it into the console on neal.fun/infinite-craft.

Nothing has been published or deployed on your behalf, and no service-role/secret key is ever needed.

## What was verified (and what wasn't)

See [docs/TESTING.md](docs/TESTING.md) for the full matrix. In short: all server rules are covered by 19 automated
tests running the real SQL; the client was driven in the real Infinite Craft page with two independent tabs
plus scripted peers (4-player rooms, voting, both modes, real drag-and-drop crafts, timeouts, refresh-reconnect,
host transfer, outage recovery). **Not yet exercised against a real Supabase project** (needs your account):
the hosted auth endpoint, PostgREST, and the Realtime WebSocket accelerator (polling is the always-on fallback).

## Honest limitations

* **The server cannot ask neal.fun what a combination makes.** It verifies phase, server time, ingredient
  ownership (chain from the 4 base elements), shared-world consistency, rate limits and the exact target
  match — but a player who modifies the client code could *claim* a fake craft. This is a friends-game trust
  model, not anti-cheat. Details: docs/ARCHITECTURE.md.
* **Refreshing the page removes the snippet** (that is how console injection works). Press ↑ + Enter in the
  console to re-run it; the client re-joins your room automatically.
* **Closeness to the target is not measured** — Infinite Craft has no verifiable distance metric. Timeouts
  show discovery counts only.
* **Use an empty save slot per round.** Multiplayer never deletes or edits saves; it warns if the current slot
  has elements outside the round and can switch slots.
* **Shared mode syncs the inventory and discoveries, not canvas positions.** Each player's canvas stays their
  own; every shared discovery is recreated locally by really crafting the recorded pair through the game.
* If neal.fun changes its internals, only `client/infinite-craft-adapter.js` needs updating.
* Managed school browsers may block DevTools, console pasting or the network hosts — see docs/INSTALLATION.md.
