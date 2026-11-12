# Installing on a player's computer

No extension, no Tampermonkey, no userscript, no admin rights, no downloads.

## Console snippet (primary)
1. Open <https://neal.fun/infinite-craft/>.
2. Open DevTools → **Console**: `F12` / `Ctrl+Shift+J` (Windows/Linux/ChromeOS), `⌥⌘J` (Mac).
3. Paste the snippet from your install website (it has a **Copy** button) → `Enter`.
   * Chrome/Edge/Firefox may require typing `allow pasting` once. That is the browser's own protection;
     do it, then paste again.
4. A panel appears bottom-left. Enter a name → **Create room** (share the 5-letter code) or **Join**.

The snippet: loads one script from your host, only on neal.fun/infinite-craft, only once (running it again just
re-shows the panel), shows a clear alert if the script can't be loaded. It never runs anything else.
**Disconnect** = the ✕ button (leaves the room, restores the game's own `craft` function, removes the panel).

### After a page refresh
Refreshing removes injected scripts (browser behaviour). Open the console, press `↑` then `Enter` (or re-paste).
Your room is rejoined automatically (the seat is held for up to 10 minutes during a game, 2 in the lobby).

## Bookmarklet (also extension-free)
Drag the button on the install page to the bookmarks bar; click it on the Infinite Craft tab. Same code as the snippet.
Useful where pasting into the console is blocked but bookmarks are allowed.

## Standalone hosted launcher — investigated, not viable
A web page cannot control another origin's page. neal.fun additionally sends
`Content-Security-Policy: frame-ancestors 'self' https://*.neal.fun …`, so it cannot even be framed by another
site. Therefore the game can only be integrated from *inside* its own page (console / bookmarklet).

## Managed (school/work) browsers — what may block you
| Restriction | Effect | Workaround |
|---|---|---|
| DevTools disabled by policy | no console | try the bookmarklet |
| Pasting/`javascript:` blocked | snippet/bookmarklet won't run | none we provide |
| Web filter blocks `github.io` or `supabase.co` | alert "Could not load…" / "Cannot reach the multiplayer server" | none we provide; use another network |
| Infinite Craft blocked | game won't load | — |
We do not suggest bypassing security controls, and cannot know in advance what a given school allows —
the install page's green/red "script reachable" line tells you about the first two network cases.

## Saves
Use an **empty save slot** each round (the game has 3 slots in its Menu). Multiplayer never deletes, resets or
edits saves. If the current slot has elements that aren't part of the round, a yellow notice offers
**Use next save slot** (just selects another slot) — if all three have progress, open the game in a
private/incognito window or clear a slot yourself with the game's own menu.

## Privacy
The client stores a random anonymous id + your chosen name in the page's `localStorage`, sends room actions
(names, chat, discovered element names) to your Supabase project, and nothing to anyone else.
