const key = 'aurora.home.design.v1';
const stateEvent = 'galaxy-atlas:desktop-design-state';
const requestEvent = 'galaxy-atlas:desktop-design-request';
export const validDesign = value => ['observatory', 'universe', 'classic'].includes(value);

// Widgets run in separate webviews. Only the desktop name crosses this bridge.
export function connectDesignSurface(root, homeWidgetId, publisher = false) {
  const win = root?.ownerDocument?.defaultView;
  if (!win || typeof root.addEventListener !== 'function') return () => {};
  let stopped = false;
  let transport;
  let unsubscribe;
  const accept = value => {
    if (!stopped && validDesign(value)) root.dataset.desktopDesign = value;
  };
  const publish = () => {
    const design = root.dataset.desktopDesign;
    if (publisher && validDesign(design)) void transport?.emit(stateEvent, {homeWidgetId, design}).catch(() => {});
  };
  const storage = event => { if (!publisher && event.key === key) accept(event.newValue); };
  if (!publisher) {
    try { accept(win.localStorage.getItem(key)); } catch {}
    win.addEventListener('storage', storage);
  }
  root.addEventListener('galaxy-atlas:design-changed',publish);
  if (win.__TAURI_INTERNALS__) void (async () => {
    transport = await import('@tauri-apps/api/event');
    if (stopped) return;
    const off = await transport.listen(publisher ? requestEvent : stateEvent, event => {
      if (event.payload?.homeWidgetId !== homeWidgetId) return;
      if (publisher) publish();
      else accept(event.payload.design);
    });
    if (stopped) { off(); return; }
    unsubscribe = off;
    if (publisher) publish();
    else await transport.emit(requestEvent,{homeWidgetId});
  })().catch(() => {});
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    root.removeEventListener('galaxy-atlas:design-changed',publish);
    win.removeEventListener('storage',storage);
    win.removeEventListener('pagehide',cleanup);
    unsubscribe?.();
  };
  win.addEventListener('pagehide',cleanup,{once:true});
  return cleanup;
}
