const instances = new WeakMap();
const storageKey = 'galaxy-atlas.clock-city.v1';
export const WORLD_CLOCK_CITIES = Object.freeze([
  Object.freeze({id: 'sydney', label: 'Sydney', timeZone: 'Australia/Sydney'}),
  Object.freeze({id: 'utc', label: 'UTC', timeZone: 'UTC'}),
  Object.freeze({id: 'london', label: 'London', timeZone: 'Europe/London'}),
  Object.freeze({id: 'dhaka', label: 'Dhaka', timeZone: 'Asia/Dhaka'}),
  Object.freeze({id: 'tokyo', label: 'Tokyo', timeZone: 'Asia/Tokyo'}),
  Object.freeze({id: 'new-york', label: 'New York', timeZone: 'America/New_York'})
]);
const formatters = new Map();
function getFormatters(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, {
    clock: new Intl.DateTimeFormat('en-AU', {timeZone, hour: '2-digit', minute: '2-digit', hour12: true}),
    numeric: new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}),
    date: new Intl.DateTimeFormat('en-AU', {timeZone, weekday: 'short', day: 'numeric', month: 'short'}),
    fullDate: new Intl.DateTimeFormat('en-AU', {timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}),
    zone: new Intl.DateTimeFormat('en-AU', {timeZone, timeZoneName: 'short'})
  });
  return formatters.get(timeZone);
}

/** Real wall time and date in an IANA zone, including its daylight-saving rules. */
export function getWorldClockState(cityId = 'sydney', instant = new Date()) {
  const city = WORLD_CLOCK_CITIES.find(item => item.id === cityId) || WORLD_CLOCK_CITIES[0];
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Clock instant must be a valid date');
  const formatter = getFormatters(city.timeZone), numeric = Object.fromEntries(formatter.numeric.formatToParts(date).map(part => [part.type, part.value]));
  const displayParts = formatter.clock.formatToParts(date);
  const hours = Number(numeric.hour), minutes = Number(numeric.minute);
  return {
    cityId: city.id, label: city.label, timeZone: city.timeZone, hours, minutes,
    dayFraction: (hours * 60 + minutes) / 1440,
    dateISO: `${numeric.year}-${numeric.month}-${numeric.day}`,
    time: displayParts.filter(part => ['hour', 'literal', 'minute'].includes(part.type)).map(part => part.value).join('').trim(),
    period: (displayParts.find(part => part.type === 'dayPeriod')?.value || '').toUpperCase(),
    time24: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    date: formatter.date.format(date), fullDate: formatter.fullDate.format(date),
    zone: formatter.zone.formatToParts(date).find(part => part.type === 'timeZoneName')?.value || city.label
  };
}

export function initWorldClock({root} = {}) {
  if (!root?.ownerDocument) return () => {};
  if (instances.has(root)) return instances.get(root);
  const doc = root.ownerDocument, win = doc.defaultView, clock = root.querySelector('.ah-clock');
  const sourceTime = clock?.querySelector('.ah-time'), sourcePeriod = clock?.querySelector('.ah-period'), sourceDate = clock?.querySelector('.ah-date');
  const sourceFace = sourceTime?.closest('.ah-clock-face'), header = clock?.querySelector('.ah-section-head');
  if (!clock || !sourceTime || !sourcePeriod || !sourceFace || !sourceDate || !header || !win?.MutationObserver) return () => {};
  let disposed = false, selectedCity = 'sydney', storage, previousMinute = '', state = null;
  try { storage = win.localStorage; const saved = storage.getItem(storageKey); if (WORLD_CLOCK_CITIES.some(item => item.id === saved)) selectedCity = saved; } catch {}
  const oldLabel = clock.getAttribute('aria-label'), oldState = clock.__auroraWorldClock;
  const oldReady = clock.dataset.worldClock;
  const sourceLabel = header.querySelector('.ah-eyebrow');
  const addedSourceClasses = [];
  for (const [node, className] of [[sourceFace, 'awc-source-face'], [sourceDate, 'awc-source-date'], [sourceLabel, 'awc-source-label']]) {
    if (node && !node.classList.contains(className)) { node.classList.add(className); addedSourceClasses.push([node, className]); }
  }
  const zone = doc.createElement('div'); zone.className = 'awc-zone';
  const select = doc.createElement('select'); select.className = 'awc-select cursor-interaction';
  select.setAttribute('aria-label', 'Clock city and time zone'); select.title = 'Choose the city shown by this clock';
  for (const city of WORLD_CLOCK_CITIES) { const option = doc.createElement('option'); option.value = city.id; option.textContent = city.label; select.append(option); }
  const zoneName = doc.createElement('span'); zoneName.className = 'awc-zone-name'; zoneName.setAttribute('aria-hidden', 'true');
  zone.append(select, zoneName); header.prepend(zone);
  const face = doc.createElement('div'); face.className = 'awc-face ah-clock-face';
  const time = doc.createElement('time'); time.className = 'awc-time';
  const period = doc.createElement('span'); period.className = 'awc-period'; face.append(time, period); sourceFace.after(face);
  const meta = doc.createElement('div'); meta.className = 'awc-meta';
  const date = doc.createElement('span'); date.className = 'awc-date';
  const secondary = doc.createElement('button'); secondary.type = 'button'; secondary.className = 'awc-secondary cursor-interaction';
  const secondaryLabel = doc.createElement('span'), secondaryTime = doc.createElement('span');
  secondary.append(secondaryLabel, secondaryTime); meta.append(date, secondary); sourceDate.after(meta);
  clock.dataset.worldClock = 'ready';

  function render(force = false) {
    if (disposed || doc.hidden && !force) return;
    const now = new Date(), minute = `${selectedCity}:${Math.floor(now.getTime() / 60000)}`;
    if (!force && minute === previousMinute) return;
    previousMinute = minute; state = getWorldClockState(selectedCity, now);
    const other = getWorldClockState(selectedCity === 'sydney' ? 'utc' : 'sydney', now);
    select.value = state.cityId; zoneName.textContent = state.zone;
    zoneName.title = state.timeZone; time.textContent = state.time; time.dateTime = now.toISOString();
    period.textContent = state.period; date.textContent = state.date; date.title = state.fullDate;
    secondaryLabel.textContent = other.label; secondaryTime.textContent = other.time24;
    secondary.title = `Show ${other.label}: ${other.time24}, ${other.fullDate} (${other.zone})`;
    secondary.setAttribute('aria-label', secondary.title); secondary.dataset.city = other.cityId;
    clock.setAttribute('aria-label', `Current time in ${state.label}: ${state.time} ${state.period}, ${state.fullDate}, ${state.zone}`);
    clock.__auroraWorldClock = {...state};
    clock.dispatchEvent(new win.CustomEvent('galaxy-atlas:clock-change', {bubbles: true, detail: {...state}}));
  }
  function choose(cityId) {
    if (!WORLD_CLOCK_CITIES.some(city => city.id === cityId)) return;
    selectedCity = cityId; try { storage?.setItem(storageKey, selectedCity); } catch {}
    render(true);
  }
  const change = () => choose(select.value), switchClock = () => choose(secondary.dataset.city);
  const visible = () => { if (!doc.hidden) render(true); };
  const stored = event => { if (event.key === storageKey && WORLD_CLOCK_CITIES.some(city => city.id === event.newValue)) { selectedCity = event.newValue; render(true); } };
  const observer = new win.MutationObserver(() => render());
  for (const node of [sourceTime, sourcePeriod, sourceDate]) observer.observe(node, {childList: true, characterData: true, subtree: true});
  select.addEventListener('change', change); secondary.addEventListener('click', switchClock);
  doc.addEventListener('visibilitychange', visible); win.addEventListener('storage', stored);
  // The existing Sydney clock owns the one-second tick. This display adds no timer.
  render(true);
  function cleanup() {
    if (disposed) return; disposed = true; observer.disconnect();
    select.removeEventListener('change', change); secondary.removeEventListener('click', switchClock);
    doc.removeEventListener('visibilitychange', visible); win.removeEventListener('storage', stored); win.removeEventListener('pagehide', cleanup);
    zone.remove(); face.remove(); meta.remove();
    for (const [node, className] of addedSourceClasses) node.classList.remove(className);
    if (oldLabel === null) clock.removeAttribute('aria-label'); else clock.setAttribute('aria-label', oldLabel);
    if (oldState === undefined) delete clock.__auroraWorldClock; else clock.__auroraWorldClock = oldState;
    if (oldReady === undefined) delete clock.dataset.worldClock; else clock.dataset.worldClock = oldReady;
    instances.delete(root);
  }
  win.addEventListener('pagehide', cleanup, {once: true}); instances.set(root, cleanup); return cleanup;
}
