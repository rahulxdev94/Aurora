import { initAuroraPrism } from './aurora-prism.mjs';
import { initDeskTools } from './aurora-desk-tools.mjs';
import { initWorldClock } from './aurora-world-clock.mjs';
import { initStarMap } from './aurora-starmap.mjs';
import { connectDesignSurface, validDesign } from './aurora-design-bridge.mjs';

const designKey = 'aurora.home.design.v1';
const fullscreenIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>';

// The rail follows the same displayed wall clock, including its selected time zone.
function addDayTrack(root) {
  const clock = root.querySelector('.ah-clock');
  const face = clock?.querySelector('.ah-time');
  const period = clock?.querySelector('.ah-period');
  if (!face || !period) return () => {};
  const track = root.ownerDocument.createElement('div');
  track.className = 'prism-day-track';
  track.setAttribute('aria-hidden', 'true');
  track.innerHTML = '<div class="prism-day-ticks"><i></i></div><div class="prism-day-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>';
  (clock.querySelector('.ah-date') || face).after(track);
  function readTime() {
    const zoned = clock.__auroraWorldClock;
    if (zoned && Number.isFinite(zoned.dayFraction)) {
      setPosition(Math.max(0, Math.min(100, zoned.dayFraction * 100)));
      return;
    }
    const match = face.textContent.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (!match) { track.hidden = true; return; }
    const suffix = period.textContent.trim().replaceAll('.', '').toUpperCase();
    let hours = Number(match[1]);
    if (suffix === 'AM' || suffix === 'PM') hours = hours % 12 + (suffix === 'PM' ? 12 : 0);
    setPosition((hours * 60 + Number(match[2])) / 14.4);
  }
  function setPosition(value) {
    track.hidden = false;
    if (track.dataset.minute !== String(value)) {
      track.dataset.minute = String(value);
      track.style.setProperty('--prism-day', value + '%');
    }
  }
  const observer = new MutationObserver(readTime);
  for (const target of [face, period]) observer.observe(target, {childList: true, characterData: true, subtree: true});
  readTime();
  root.addEventListener('aurora:clock-change', readTime);
  return () => { root.removeEventListener('aurora:clock-change', readTime); observer.disconnect(); track.remove(); };
}

function mountDesktop(root, design, onSwitch) {
  if (design === 'universe') {
    root.classList.add('au-starmap-active');
    try {
      const dispose = initStarMap({root, onSwitch});
      return () => { dispose(); root.classList.remove('au-starmap-active'); };
    } catch (error) {
      root.classList.remove('au-starmap-active');
      throw error;
    }
  }
  const doc = root.ownerDocument;
  const scene = root.querySelector('.ah-core-stage');
  const title = root.querySelector('.ah-welcome h1');
  const previousTitle = title?.textContent;
  if (title) title.textContent = 'Prismatic Observatory';
  root.classList.add('au-prism');
  const disposeScene = initAuroraPrism({root});
  const disposeZones = initWorldClock({root});
  const disposeClock = addDayTrack(root);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'prism-view-toggle';
  toggle.innerHTML = fullscreenIcon + '<span>Expand scene</span>';
  toggle.setAttribute('aria-pressed', 'false');
  scene.append(toggle);
  const hint = doc.createElement('small');
  hint.className = 'prism-orbit-hint';
  hint.id = 'prism-orbit-hint';
  hint.textContent = 'Drag to rotate, or focus the scene and use the arrow keys.';
  scene.append(hint);
  const previousDescription = scene.getAttribute('aria-describedby');
  scene.setAttribute('aria-describedby', [previousDescription, hint.id].filter(Boolean).join(' '));
  let expanded = false;
  const hiddenFromTab = new Map();
  function setExpanded(value) {
    expanded = value;
    root.classList.toggle('prism-expanded', value);
    toggle.setAttribute('aria-pressed', String(value));
    toggle.lastElementChild.textContent = value ? 'Exit scene' : 'Expand scene';
    if (value) {
      for (const el of root.querySelectorAll('.ah-topbar,.ah-welcome,.ah-workspace-switch,.ah-widget-rail,.ah-bottom,.ah-main > .ah-library,.an-lower-grid,.ah-frequent')) {
        hiddenFromTab.set(el, el.inert);
        el.inert = true;
      }
    } else {
      for (const [el, previous] of hiddenFromTab) el.inert = previous;
      hiddenFromTab.clear();
    }
  }
  const onClick = () => setExpanded(!expanded);
  const onKey = event => {
    const dialogVisible = event.key === 'Escape' && [...root.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length > 0);
    if (event.key === 'Escape' && expanded && !event.defaultPrevented && !dialogVisible) {
      setExpanded(false);
      toggle.focus({preventScroll:true});
    }
  };
  toggle.addEventListener('click', onClick);
  doc.addEventListener('keydown', onKey);
  return () => {
    if (expanded) setExpanded(false);
    doc.removeEventListener('keydown', onKey);
    toggle.removeEventListener('click', onClick);
    toggle.remove();
    hint.remove();
    if (previousDescription) scene.setAttribute('aria-describedby', previousDescription);
    else scene.removeAttribute('aria-describedby');
    disposeClock();
    disposeZones();
    disposeScene();
    root.classList.remove('au-prism');
    if (title) title.textContent = previousTitle;
  };
}

export function initObservatoryDesign({root,homeWidgetId = '@aurora/home'}) {
  if (!root?.querySelector('.ah-core-stage')) return () => {};
  let store;
  let active = 'universe';
  try {
    store = root.ownerDocument.defaultView.localStorage;
    const saved = store.getItem(designKey);
    if (validDesign(saved)) active = saved;
  } catch {}
  root.dataset.desktopDesign = active;
  const disconnect = connectDesignSurface(root,homeWidgetId,true);
  const disposeTools = initDeskTools({root});
  const returnToObservatory = () => choose('observatory');
  let unmount = active !== 'classic' ? mountDesktop(root,active,returnToObservatory) : null;
  const group = root.ownerDocument.createElement('fieldset');
  group.className = 'prism-design-picker';
  group.innerHTML = '<legend>Desktop</legend><label><input type="radio" name="aurora-home-design" value="observatory">Prismatic Observatory</label><label><input type="radio" name="aurora-home-design" value="universe">Universe</label><label><input type="radio" name="aurora-home-design" value="classic">Classic orbit</label>';
  group.querySelector('[value="' + active + '"]').checked = true;
  root.querySelector('.au-theme-menu')?.prepend(group);
  const switcher = root.ownerDocument.createElement('button');
  switcher.type = 'button';
  switcher.className = 'au-desktop-switch';
  function label() {
    const destination = active === 'universe' ? 'Observatory' : 'Universe';
    switcher.textContent = destination;
    switcher.title = 'Switch to ' + destination;
    switcher.setAttribute('aria-label',switcher.title + ' desktop');
  }
  label();
  root.querySelector('.au-theme-selector')?.before(switcher);
  function choose(design) {
    if (active === design || !validDesign(design)) return;
    const controller = root.__auroraPaletteController;
    try { if (controller?.id) store?.setItem(designKey + '.palette.' + active, controller.id); } catch {}
    unmount?.();
    root.dataset.desktopDesign = design;
    unmount = design !== 'classic' ? mountDesktop(root,design,returnToObservatory) : null;
    active = design;
    group.querySelector('[value="' + active + '"]').checked = true;
    label();
    try { store?.setItem(designKey, active); } catch {}
    let colour = ({universe:'violet',observatory:'arctic',classic:'gold'})[design];
    try { colour = store?.getItem(designKey + '.palette.' + design) || colour; } catch {}
    if (controller) void controller.select(colour);
    root.dispatchEvent(new CustomEvent('aurora:design-changed',{detail:{design}}));
  }
  const toggle = () => choose(active === 'universe' ? 'observatory' : 'universe');
  const change = event => choose(event.target.value);
  switcher.addEventListener('click',toggle);
  group.addEventListener('change', change);
  return () => { disconnect(); disposeTools(); switcher.removeEventListener('click',toggle); switcher.remove(); group.removeEventListener('change', change); group.remove(); unmount?.(); };
}
