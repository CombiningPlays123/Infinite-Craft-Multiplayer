/* infinite-craft-adapter.js - the ONLY file that knows about neal.fun's internals.
 *
 * What was found by inspecting https://neal.fun/infinite-craft/ (Nuxt 2 / Vue 2 app):
 *   - The game publishes a public console API: window.IC with getItems(), craft(a, b),
 *     switchSave(n), getCurrentSave(), exportSave(), ...   (components/addAPI)
 *   - window.IC.getItems() -> [{id, text, emoji, saveId, recipes?}] : the current save's inventory.
 *   - window.IC.craft('Water','Fire') performs a REAL craft through the game (same code path as
 *     dragging two elements together) and resolves to the resulting item {text, emoji, id, recipes}.
 *   - Drag-and-drop crafts call the page component's `craft(a, b)` method, which resolves to
 *     {instance: {text, emoji, id, recipes}}. We wrap that method to observe crafts (no network
 *     sniffing, no private storage access).
 *   - Saves live in IndexedDB ("infinite-craft"); we never read or write them directly.
 *
 * Everything here has a fallback so that a future site change degrades gracefully:
 *   1. wrap component.craft            (preferred, sees every craft incl. duplicates)
 *   2. poll IC.getItems() growth       (sees newly discovered items + their recipe pair)
 * If neither window.IC nor the component can be found, ready() rejects with a clear message.
 */
class Adapter {
  constructor() {
    this.vm = null; this.listeners = []; this.replaying = 0; this.seenIds = new Set(); this.pollTimer = null;
    this.recent = new Map();
  }
  static onGame() { return /(^|\.)neal\.fun$/.test(location.hostname) && /^\/infinite-craft\/?/.test(location.pathname); }

  async ready(timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (window.IC && typeof window.IC.getItems === 'function' && typeof window.IC.craft === 'function' && window.IC.getItems().length) break;
      await M.sleep(250);
    }
    if (!(window.IC && window.IC.getItems)) throw new Error('Infinite Craft has not finished loading, or its console API (window.IC) changed.');
    this.vm = this._findVm();
    window.IC.getItems().forEach(i => this.seenIds.add(i.id));
    this._hook();
    return true;
  }

  _findVm() {
    try {
      const root = window.$nuxt && window.$nuxt.$root; if (!root) return null;
      const walk = vm => {
        const m = vm.$options && vm.$options.methods;
        if (m && m.craft && m.switchSave && vm.$data && Array.isArray(vm.$data.items)) return vm;
        for (const c of vm.$children || []) { const r = walk(c); if (r) return r; }
        return null;
      };
      return walk(root);
    } catch { return null; }
  }

  _hook() {
    const self = this;
    if (this.vm && !this.vm.__icmpWrapped) {
      const orig = this.vm.craft;
      this.vm.__icmpOrig = orig;
      this.vm.craft = async function (a, b) {
        const r = await orig.apply(this, arguments);
        try {
          const inst = r && r.instance;
          if (inst && inst.text && a && b) self._observed({ a: a.text, b: b.text, result: inst.text, emoji: inst.emoji || '', src: 'hook' });
        } catch (e) { console.warn('[ICMP] craft observer failed', e); }
        return r;
      };
      this.vm.__icmpWrapped = true;
    }
    // fallback: notice brand-new items (with the recipe the game recorded) even if the wrapper is bypassed
    this.pollTimer = setInterval(() => {
      try {
        const items = window.IC.getItems();
        const cs = this.currentSave();
        if (cs !== this.saveAtSeen) { this.saveAtSeen = cs; this.seenIds = new Set(items.map(i => i.id)); return; }
        for (const it of items) {
          if (this.seenIds.has(it.id)) continue;
          this.seenIds.add(it.id);
          const rec = it.recipes && it.recipes[it.recipes.length - 1];
          if (!rec) continue;
          const a = items.find(x => x.id === rec[0]), b = items.find(x => x.id === rec[1]);
          if (a && b) this._observed({ a: a.text, b: b.text, result: it.text, emoji: it.emoji || '', src: 'poll' });
        }
      } catch { /* ignore */ }
    }, 400);
  }

  /** De-duplicate between the two observation paths, ignore replays and the game's "Nothing" result. */
  _observed(c) {
    if (this.replaying) return;
    if (M.norm(c.result) === 'nothing') return;
    const key = [M.norm(c.a), M.norm(c.b), M.norm(c.result)].join('|');
    const now = Date.now();
    const last = this.recent.get(key);
    if (last && now - last < 1500) return;
    this.recent.set(key, now);
    this.listeners.forEach(fn => { try { fn(c); } catch (e) { console.error('[ICMP]', e); } });
  }
  onCraft(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter(f => f !== fn); }; }

  items() { return window.IC.getItems().map(i => ({ id: i.id, text: i.text, emoji: i.emoji })); }
  has(name) { const n = M.norm(name); return window.IC.getItems().some(i => M.norm(i.text) === n); }
  currentSave() { try { return window.IC.getCurrentSave(); } catch { return null; } }
  saveCount() { return this.vm && this.vm.$data.saves ? this.vm.$data.saves.length : 3; }

  /** Elements in this save that are not part of the round (base 4 + `allowed` names). */
  foreign(allowedNames) {
    const ok = new Set(M.BASE_ITEMS.concat(allowedNames.map(M.norm)));
    return this.items().filter(i => !ok.has(M.norm(i.text)));
  }
  async switchToNextSlot() {
    const n = this.saveCount(), cur = this.currentSave() || 0;
    await window.IC.switchSave((cur + 1) % n);
    await M.sleep(500);
  }

  /** Really craft through the game (used to mirror another player's discovery locally).
      Returns the resulting item or null. Never reported back to the server (replaying flag). */
  async replay(a, b) {
    this.replaying++;
    try { const r = await window.IC.craft(a, b); if (r && r.id != null) this.seenIds.add(r.id); return r; }
    finally { setTimeout(() => { this.replaying = Math.max(0, this.replaying - 1); }, 300); }
  }

  destroy() {
    clearInterval(this.pollTimer);
    if (this.vm && this.vm.__icmpWrapped) { this.vm.craft = this.vm.__icmpOrig; this.vm.__icmpWrapped = false; }
    this.listeners = [];
  }
}
M.Adapter = Adapter;
