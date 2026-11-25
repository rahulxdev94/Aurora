import {gravityWaveSpeed} from './gravity-wave.mjs';

// Home and the system dock live in different windows. Both use the same wall clock.
export function connectGalaxyInput(root) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const preference = win.matchMedia('(prefers-reduced-motion: reduce)');
  const native = win.__auroraNative;
  let running = false, disposed = false, cycle = 0, session = null, reader = null;
  let press = null;
  const full = () => !disposed && !doc.hidden && root.dataset.desktopDesign === 'universe'
    && root.dataset.motion === 'full' && root.dataset.paused !== 'true' && !preference.matches;
  function wave(x, y, startedAt) {
    root.dispatchEvent(new win.CustomEvent('galaxy-atlas:gravity-wave', {detail: {
      x, y, startedAt, speed:gravityWaveSpeed(win.innerWidth, win.innerHeight)
    }}));
  }
  function send(connection, path, options = {}) {
    return win.fetch('http://127.0.0.1:' + connection.port + path, {
      ...options, headers:{Authorization:'Bearer ' + connection.token}, cache:'no-store', credentials:'omit',
      referrerPolicy:'no-referrer', redirect:'error'
    });
  }
  async function subscribe(epoch) {
    let after = 0;
    while (running && cycle === epoch) {
      try {
        if (!session) {
          const connection = JSON.parse(await native.readGalaxyMotion());
          if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535
              || !/^[a-f0-9]{64}$/.test(connection.token)) throw Error('Invalid local session');
          if (cycle !== epoch) return;
          session = connection;
          after = 0;
        }
        reader = new win.AbortController();
        const reply = await send(session, '/waves?after=' + after, {signal:reader.signal});
        if (!reply.ok) throw Error('Local motion unavailable');
        const packet = await reply.json();
        if (cycle !== epoch || !full()) return;
        root.dataset.galaxyDockLink = 'connected';
        for (const event of packet.waves) {
          if (event.id <= after) continue;
          after = event.id;
          if (event.u >= 0 && event.u <= 1 && event.v >= 0 && event.v <= 1
              && Number.isFinite(event.at) && Date.now() - event.at < 2050)
            wave(event.u * win.innerWidth, event.v * win.innerHeight, event.at);
        }
        if (Number.isSafeInteger(packet.cursor)) after = Math.max(after, packet.cursor);
      } catch {
        if (cycle !== epoch) return;
        session = null;
        root.dataset.galaxyDockLink = 'waiting';
        await new Promise(resolve => win.setTimeout(resolve, 3000));
      }
    }
  }
  function reconcile() {
    const active = full();
    if (running === active) return;
    running = active;
    cycle++;
    if (active && native?.readGalaxyMotion) {
      root.dataset.galaxyDockLink = 'connecting';
      void subscribe(cycle);
    } else {
      press = null;
      reader?.abort();
      if (session) void send(session, '/off', {method:'POST',keepalive:true}).catch(()=>{});
      session = null;
      delete root.dataset.galaxyDockLink;
    }
  }
  function down(e) {
    if (full() && e.isPrimary !== false && e.button >= 0 && e.button <= 2)
      press = {id:e.pointerId, x:e.clientX, y:e.clientY, button:e.button};
  }
  function move(e) {
    if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x,e.clientY - press.y) > 6) press = null;
  }
  function up(e) {
    const start = press;
    press = null;
    if (!full() || !start || start.id !== e.pointerId || start.button !== e.button
        || Math.hypot(e.clientX - start.x,e.clientY - start.y) > 6) return;
    const at = Date.now();
    wave(e.clientX, e.clientY, at);
    if (session) {
      const args = new URLSearchParams({u:e.clientX / win.innerWidth, v:e.clientY / win.innerHeight, at});
      void send(session, '/desktop?' + args, {method:'POST'}).catch(()=>{});
    }
  }
  const cancel = () => {press = null;};
  const listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel]];
  for (const [name, fn] of listeners) doc.addEventListener(name, fn, {capture:true,passive:true});
  const observer = new win.MutationObserver(reconcile);
  observer.observe(root, {attributes:true,attributeFilter:['data-motion','data-paused','data-desktop-design']});
  doc.addEventListener('visibilitychange', reconcile);
  preference.addEventListener('change', reconcile);
  function dispose() {
    disposed = true;
    reconcile();
    observer.disconnect();
    for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true);
    doc.removeEventListener('visibilitychange', reconcile);
    preference.removeEventListener('change', reconcile);
    win.removeEventListener('pagehide', dispose);
  }
  win.addEventListener('pagehide', dispose, {once:true});
  reconcile();
  return dispose;
}
