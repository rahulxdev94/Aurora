/* Prismatic Observatory. Local, decorative geometry only. */
const instances = new WeakMap();
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hash = index => { const n = Math.sin(index * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

/** Perspective projection used by the glass hull and its orbital instruments. */
export function projectPrismPoint(point, {cx = 0, cy = 0, camera = 760, yaw = 0, pitch = 0, scale = 1} = {}) {
  if (!point || ![point.x, point.y, point.z, cx, cy, camera, yaw, pitch, scale].every(Number.isFinite) || camera <= 0) return null;
  const sy = Math.sin(yaw), co = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = point.x * co + point.z * sy;
  const z = point.z * co - point.x * sy;
  const y = point.y * cp - z * sp;
  const depth = z * cp + point.y * sp;
  const denominator = camera + depth;
  if (denominator < camera * .12) return null;
  const perspective = camera / denominator;
  return {x: cx + x * perspective * scale, y: cy + y * perspective * scale, z: depth, scale: perspective * scale};
}

export function prismMotionMode({motion = 'full', paused = false, hidden = false, reduced = false} = {}) {
  if (hidden || paused) return 'sleep';
  return motion === 'off' || motion === 'reduced' || reduced ? 'still' : 'full';
}

export function initAuroraPrism({root} = {}) {
  if (!root?.ownerDocument) return () => {};
  if (instances.has(root)) return instances.get(root);
  const doc = root.ownerDocument, win = doc.defaultView;
  const atmosphere = root.querySelector('.ah-atmosphere'), hero = root.querySelector('.ah-core-stage');
  if (!win?.requestAnimationFrame || !atmosphere || !hero) return () => {};
  const background = doc.createElement('canvas'), core = doc.createElement('canvas');
  background.className = 'au-prism-space'; core.className = 'au-prism-core';
  for (const canvas of [background, core]) {
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none;';
  }
  background.style.zIndex = '0'; core.style.zIndex = '1';
  const ctx = background.getContext('2d', {alpha: true}), cctx = core.getContext('2d', {alpha: true});
  if (!ctx || !cctx) return () => {};
  atmosphere.append(background); hero.append(core);
  const hadClass = root.classList.contains('au-prism'); root.classList.add('au-prism');
  const motionSurfaces = [atmosphere, root.querySelector('.ah-desktop')].filter(Boolean);
  const previousMotion = motionSurfaces.map(node => ({node, x: node.style.getPropertyValue('--prism-x'), y: node.style.getPropertyValue('--prism-y')}));
  const previousRenderer = root.dataset.prismRenderer;
  const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const abort = new win.AbortController();
  const options = {signal: abort.signal, passive: true};
  let disposed = false, visible = true, timer = 0, raf = 0, resizeFrame = 0;
  let width = 1, height = 1, heroWidth = 1, heroHeight = 1, dpr = 1, coreDpr = 1;
  let rootRect = null, heroRect = null, focal = {x: .37, y: .38}, focusVisible = true;
  let corePoint = {x: 1, y: 1}, coreRadius = 26, lastCore = null;
  let viewYaw = .45, viewPitch = -.12, orbitDrag = null;
  const originalTabIndex = hero.getAttribute('tabindex');
  const originalShortcuts = hero.getAttribute('aria-keyshortcuts');
  hero.tabIndex = 0;
  hero.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight ArrowUp ArrowDown Home');
  let target = {x: 0, y: 0}, pointer = {x: 0, y: 0}, card = null, cardRect = null;
  let clock = 0, lastTime = 0, frameInterval = 1000 / 30, renderAverage = 0;
  let pressEnergy = 0, ripples = [], lastRippleAt = -Infinity, lastPointerWrite = 0, writtenPointer = '';
  let theme = {accent: [117, 224, 255], secondary: [155, 146, 255], light: false};
  const stars = Array.from({length: 100}, (_, i) => ({x: hash(i * 5 + 1), y: hash(i * 5 + 2), z: hash(i * 5 + 3), size: .35 + hash(i + 73), phase: hash(i + 91) * TAU}));
  const shards = Array.from({length: 7}, (_, i) => ({x: [.08, .9, .14, .8, .66, .3, .94][i], y: [.28, .25, .8, .79, .12, .1, .56][i], z: .4 + hash(i + 41) * .8, size: 18 + hash(i + 62) * 29, phase: hash(i + 28) * TAU}));
  const rgba = (colour, alpha) => `rgba(${colour[0]},${colour[1]},${colour[2]},${clamp(alpha, 0, 1)})`;
  const mode = () => prismMotionMode({motion: root.dataset.motion, paused: root.dataset.paused === 'true', hidden: doc.hidden || !visible, reduced: Boolean(media?.matches)});
  const listen = (node, event, handler, capture = false) => node.addEventListener(event, handler, {...options, capture});

  function resize() {
    resizeFrame = 0;
    if (disposed) return;
    rootRect = root.getBoundingClientRect(); heroRect = hero.getBoundingClientRect();
    width = Math.max(1, rootRect.width); height = Math.max(1, rootRect.height);
    heroWidth = Math.max(1, heroRect.width); heroHeight = Math.max(1, heroRect.height);
    dpr = Math.min(win.devicePixelRatio || 1, 1.35, Math.sqrt(2100000 / (width * height)));
    coreDpr = Math.min(win.devicePixelRatio || 1, 1.5, Math.sqrt(700000 / (heroWidth * heroHeight)));
    background.width = Math.round(width * dpr); background.height = Math.round(height * dpr);
    core.width = Math.round(heroWidth * coreDpr); core.height = Math.round(heroHeight * coreDpr);
    const button = hero.querySelector('.ah-companion')?.getBoundingClientRect();
    if (button) { corePoint = {x: button.left - heroRect.left + button.width / 2, y: button.top - heroRect.top + button.height / 2}; coreRadius = clamp(button.width * .19, 16, 42); }
    else corePoint = {x: heroWidth / 2, y: heroHeight * .44};
    focal = {x: (heroRect.left - rootRect.left + corePoint.x) / width, y: (heroRect.top - rootRect.top + corePoint.y) / height};
    if (lastCore) updateCore(lastCore);
    cardRect = null; requestPaint();
  }
  function queueResize() { if (!resizeFrame) resizeFrame = win.requestAnimationFrame(resize); }
  function updateCore(detail) {
    if (!detail || !Number.isFinite(detail.x) || !Number.isFinite(detail.y)) return;
    const changed = !lastCore || Math.abs(detail.x - lastCore.x) > .0001 || Math.abs(detail.y - lastCore.y) > .0001 || Math.abs((detail.radius || 0) - (lastCore.radius || 0)) > .1 || detail.visible !== lastCore.visible;
    lastCore = detail; focusVisible = detail.visible !== false;
    focal = {x: clamp(detail.x, 0, 1), y: clamp(detail.y, 0, 1)};
    if (rootRect && heroRect) corePoint = {x: focal.x * width + rootRect.left - heroRect.left, y: focal.y * height + rootRect.top - heroRect.top};
    if (Number.isFinite(detail.radius)) coreRadius = clamp(detail.radius, 12, 80);
    if (changed && mode() === 'still') requestPaint();
  }
  function updateTheme(event) {
    const detail = event?.detail;
    const parse = value => /^#[\da-f]{6}$/i.test(value || '') ? [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) : null;
    if (detail?.tokens) {
      theme.accent = parse(detail.tokens.accent) || theme.accent;
      theme.secondary = parse(detail.tokens.accent2) || theme.secondary;
      theme.light = detail.mode === 'light';
    }
    requestPaint();
  }
  function polygon(context, points, fill, stroke, lineWidth = .7) {
    if (points.some(point => !point)) return;
    context.beginPath(); points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath();
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = lineWidth; context.stroke(); }
  }
  function crystal(context, cx, cy, radius, yaw, pitch, opacity, elongated = 1.4) {
    const project = point => projectPrismPoint(point, {cx, cy, camera: 680, yaw, pitch});
    const vertices = [{x: 0, y: -radius * elongated, z: 0}, {x: radius, y: 0, z: 0}, {x: 0, y: 0, z: radius}, {x: -radius, y: 0, z: 0}, {x: 0, y: 0, z: -radius}, {x: 0, y: radius * elongated, z: 0}].map(project);
    const faces = [];
    for (let i = 1; i <= 4; i++) { const next = i === 4 ? 1 : i + 1; faces.push([0, i, next], [5, next, i]); }
    faces.sort((a, b) => b.reduce((sum, index) => sum + vertices[index].z, 0) - a.reduce((sum, index) => sum + vertices[index].z, 0));
    for (let i = 0; i < faces.length; i++) {
      const points = faces[i].map(index => vertices[index]);
      const colour = i % 3 === 0 ? theme.secondary : theme.accent;
      const front = points.reduce((sum, p) => sum + p.z, 0) < 0;
      const gradient = context.createLinearGradient(points[0].x, points[0].y, (points[1].x + points[2].x) / 2, (points[1].y + points[2].y) / 2);
      const spectrum = [[87, 250, 225], [107, 186, 255], [160, 126, 255], [241, 167, 240]];
      const tint = spectrum[faces[i][1] - 1];
      const glint = .5 + .5 * Math.cos(yaw + faces[i][1] * Math.PI / 2);
      gradient.addColorStop(0, rgba(tint, opacity * (front ? .49 : .11)));
      gradient.addColorStop(.46, rgba(colour, opacity * (front ? .13 : .04)));
      gradient.addColorStop(.78, rgba(tint, opacity * (front ? .19 + glint * .2 : .08)));
      gradient.addColorStop(1, rgba([204, 255, 253], opacity * (front ? .47 : .1)));
      polygon(context, points, gradient, rgba(colour, opacity * (front ? .5 : .15)), front ? .9 : .55);
    }
    return vertices;
  }
  // Render fine auroral filaments once. Moving the resulting light sheet takes
  // one compositing operation per frame, including on integrated graphics.
  const veil = doc.createElement('canvas');
  veil.width = 1050;
  veil.height = 480;
  const silk = veil.getContext('2d');
  if (silk) {
    silk.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 850; i++) {
      const u = i / 849;
      const x = u * veil.width;
      const envelope = Math.pow(Math.sin(Math.PI * u), .8);
      const wave = Math.sin(u * 11.7 - .75) * 27 + Math.sin(u * 23.5 + .5) * 12;
      const y = 205 - 69 * Math.sin(u * Math.PI * 1.6 - .55) + wave;
      const reach = 45 + envelope * (44 + 40 * Math.sin(u * 20) ** 2);
      const gradient = silk.createLinearGradient(x, y - reach, x, y + 9);
      const hue = 166 + 88 * Math.sin(Math.PI * u * .67) ** 2;
      const alpha = envelope * (.12 + .22 * hash(i + 19));
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(.72, 'hsla(' + hue + ',90%,62%,' + alpha * .36 + ')');
      gradient.addColorStop(.92, 'hsla(' + hue + ',92%,69%,' + alpha + ')');
      gradient.addColorStop(1, 'transparent');
      silk.strokeStyle = gradient;
      silk.lineWidth = 2.2;
      silk.beginPath();
      silk.moveTo(x + 26 + wave * .5, y - reach);
      silk.quadraticCurveTo(x + 5, y - reach * .45, x, y + 9);
      silk.stroke();
    }
  }
  function drawSpace(time, full) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const px = pointer.x, py = pointer.y, lit = theme.light ? .45 : 1;
    const bloomX = width * focal.x + px * 16, bloomY = height * focal.y + py * 12;
    const glow = ctx.createRadialGradient(bloomX, bloomY, 0, bloomX, bloomY, Math.max(width * .38, height * .7));
    glow.addColorStop(0, rgba(theme.accent, .07 * lit)); glow.addColorStop(.32, rgba(theme.secondary, .055 * lit)); glow.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    if (silk) {
      ctx.save();
      ctx.globalAlpha = theme.light ? .32 : .86;
      const drift = Math.sin(time * .082) * .012;
      ctx.drawImage(veil, width * (-.08 + drift) + px * 14, height * (.105 + drift * .5) + py * 7, width * 1.15, height * .85);
      ctx.restore();
    }
    // A sloping volume of light grounds the glass in a single architectural space.
    const sheet = ctx.createLinearGradient(width * .12, 0, width * .86, height);
    sheet.addColorStop(0, rgba(theme.accent, 0)); sheet.addColorStop(.48, rgba(theme.accent, .025 * lit)); sheet.addColorStop(.55, rgba(theme.secondary, .035 * lit)); sheet.addColorStop(1, rgba(theme.secondary, 0));
    polygon(ctx, [{x: width * .14 + px * 7, y: 0}, {x: width * .4, y: 0}, {x: width * .92 + px * 18, y: height}, {x: width * .63, y: height}], sheet, null);
    const projected = stars.map(star => ({x: star.x * width + px * (7 + star.z * 21), y: star.y * height + py * (4 + star.z * 16), star}));
    ctx.lineWidth = .5;
    for (let i = 0; i < projected.length; i++) {
      const a = projected[i], b = projected[(i * 7 + 13) % projected.length];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (i % 3 === 0 && distance < Math.min(185, width * .14) && distance > 20) {
        ctx.strokeStyle = rgba(theme.accent, .055 * lit); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const alpha = (.16 + a.star.z * .32) * (full ? .8 + Math.sin(time * .35 + a.star.phase) * .2 : 1) * lit;
      ctx.fillStyle = rgba(i % 6 === 0 ? theme.secondary : theme.accent, alpha); ctx.beginPath(); ctx.arc(a.x, a.y, a.star.size * (.55 + a.star.z * .35), 0, TAU); ctx.fill();
      if (i % 23 === 0) { ctx.strokeStyle = rgba(theme.accent, alpha * .32); ctx.beginPath(); ctx.moveTo(a.x - 3, a.y); ctx.lineTo(a.x + 3, a.y); ctx.moveTo(a.x, a.y - 3); ctx.lineTo(a.x, a.y + 3); ctx.stroke(); }
    }
    for (const shard of shards) {
      const drift = full ? Math.sin(time * .13 + shard.phase) * 5 : 0;
      crystal(ctx, shard.x * width + px * 16 * shard.z, shard.y * height + drift + py * 12 * shard.z, shard.size * Math.min(1.2, width / 1500), shard.phase + time * .012, -.25 + Math.sin(shard.phase) * .24, .22 * lit, 1.65);
    }
    // Soft floor perspective avoids a flat wallpaper while keeping content quiet.
    const horizon = height * .74, vanish = width * .48 + px * 10;
    ctx.strokeStyle = rgba(theme.accent, .035 * lit); ctx.lineWidth = .65;
    ctx.beginPath();
    for (let i = -8; i <= 8; i++) { ctx.moveTo(vanish + i * width * .018, horizon); ctx.lineTo(vanish + i * width * .16, height); }
    for (let i = 1; i <= 6; i++) { const y = horizon + Math.pow(i / 6, 2.1) * (height - horizon); ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    for (const ripple of ripples) {
      const age = (time - ripple.born) / 1.35;
      if (age < 0 || age >= 1) continue;
      const radius = 12 + age * Math.min(width * .22, 350);
      ctx.strokeStyle = rgba(theme.accent, (1 - age) ** 2 * .22); ctx.lineWidth = 1 - age * .5;
      ctx.beginPath(); ctx.ellipse(ripple.x, ripple.y, radius, radius * .54, -.24, 0, TAU); ctx.stroke();
    }
  }
  function drawCore(time) {
    cctx.setTransform(coreDpr, 0, 0, coreDpr, 0, 0); cctx.clearRect(0, 0, heroWidth, heroHeight);
    if (!focusVisible || root.dataset.notificationPresence === 'away') return;
    const cx = corePoint.x, cy = corePoint.y;
    const available = Math.min(heroWidth * .34, heroHeight * .33);
    const radius = clamp(Math.max(coreRadius * 2.55, available * .68), 36, Math.max(40, available));
    const yaw = time * .12 + pointer.x * .16 + viewYaw, pitch = -.18 + pointer.y * .1 + viewPitch;
    const light = theme.light ? .65 : 1;
    const glow = cctx.createRadialGradient(cx, cy, radius * .4, cx, cy, radius * 1.9);
    glow.addColorStop(0, rgba(theme.accent, 0)); glow.addColorStop(.5, rgba(theme.accent, (.032 + pressEnergy * .035) * light)); glow.addColorStop(1, rgba(theme.secondary, 0));
    cctx.fillStyle = glow; cctx.fillRect(0, 0, heroWidth, heroHeight);
    const projection = {cx, cy, camera: 650, yaw: pointer.x * .08, pitch: -.22 + pointer.y * .08};
    // Three orbital instruments are physical circles seen through perspective.
    for (let ring = 0; ring < 3; ring++) {
      const ringRadius = radius * (1.15 + ring * .24), tilt = .55 + ring * .62;
      const points = [];
      for (let i = 0; i <= 100; i++) {
        const angle = i / 100 * TAU, x = Math.cos(angle) * ringRadius, y = Math.sin(angle) * ringRadius;
        points.push(projectPrismPoint({x: x * Math.cos(tilt), y: y * .77, z: x * Math.sin(tilt)}, {...projection, yaw: yaw * (ring === 1 ? -.4 : .3) + ring * .9}));
      }
      const colour = ring === 1 ? theme.secondary : theme.accent;
      for (const front of [false, true]) {
        cctx.beginPath(); let started = false;
        for (const point of points) {
          if (!point || (point.z < 0) !== front) { started = false; continue; }
          if (!started) cctx.moveTo(point.x, point.y); else cctx.lineTo(point.x, point.y); started = true;
        }
        cctx.strokeStyle = rgba(colour, (front ? .31 : .09) * light); cctx.lineWidth = front ? .9 : .6; cctx.stroke();
      }
      const orbit = (time * (.09 + ring * .014) + ring * .31) % 1, node = points[Math.floor(orbit * 100)];
      if (node) {
        cctx.fillStyle = rgba(colour, .8 * light); cctx.beginPath(); cctx.arc(node.x, node.y, ring === 1 ? 2.2 : 1.55, 0, TAU); cctx.fill();
        cctx.strokeStyle = rgba(colour, .22 * light); cctx.beginPath(); cctx.arc(node.x, node.y, 5.2, 0, TAU); cctx.stroke();
      }
    }
    crystal(cctx, cx, cy, radius * (.79 + pressEnergy * .025), yaw, pitch, .78 * light, 1.28);
    // Fine outer reference ticks, rather than text or simulated telemetry.
    const tickR = radius * 1.75;
    cctx.strokeStyle = rgba(theme.accent, .14 * light); cctx.lineWidth = .65; cctx.beginPath();
    for (let i = 0; i < 36; i++) {
      if (i > 4 && i < 13 || i > 22 && i < 31) continue;
      const angle = i / 36 * TAU + .04, length = i % 3 === 0 ? 5 : 2;
      cctx.moveTo(cx + Math.cos(angle) * tickR, cy + Math.sin(angle) * tickR * .88);
      cctx.lineTo(cx + Math.cos(angle) * (tickR + length), cy + Math.sin(angle) * (tickR + length) * .88);
    }
    cctx.stroke();
  }
  function draw(timestamp) {
    raf = 0;
    if (disposed) return;
    if (!root.isConnected) { cleanup(); return; }
    const currentMode = mode();
    if (currentMode === 'sleep') { lastTime = 0; return; }
    const started = win.performance.now();
    const full = currentMode === 'full';
    const delta = full && lastTime ? clamp((timestamp - lastTime) / 1000, 0, .1) : 0;
    lastTime = timestamp;
    if (full) clock += delta;
    const damping = full ? 1 - Math.exp(-delta * 4.8) : 1;
    pointer.x += ((full ? target.x : 0) - pointer.x) * damping;
    pointer.y += ((full ? target.y : 0) - pointer.y) * damping;
    pressEnergy = full ? Math.max(0, pressEnergy - delta * 1.8) : 0;
    if (timestamp - lastPointerWrite > 60 || !full) {
      const x = pointer.x.toFixed(3), y = pointer.y.toFixed(3), signature = `${x},${y}`;
      if (signature !== writtenPointer) {
        for (const node of motionSurfaces) { node.style.setProperty('--prism-x', x); node.style.setProperty('--prism-y', y); }
        writtenPointer = signature;
      }
      lastPointerWrite = timestamp;
    }
    drawSpace(clock, full); drawCore(clock);
    ripples = full ? ripples.filter(ripple => clock - ripple.born < 1.35) : [];
    renderAverage = renderAverage * .94 + (win.performance.now() - started) * .06;
    frameInterval = renderAverage > 13 ? 1000 / 20 : 1000 / 30;
    if (full) timer = win.setTimeout(() => { timer = 0; if (!disposed && mode() === 'full') raf = win.requestAnimationFrame(draw); }, Math.max(4, frameInterval - (win.performance.now() - started)));
  }
  function cancelPaint() { if (timer) win.clearTimeout(timer); if (raf) win.cancelAnimationFrame(raf); timer = 0; raf = 0; }
  function requestPaint() {
    if (disposed || mode() === 'sleep' || raf || timer) return;
    raf = win.requestAnimationFrame(draw);
  }
  function resetMotion() {
    cancelPaint(); lastTime = 0; ripples = [];
    if (mode() !== 'full') { target = {x: 0, y: 0}; pointer = {x: 0, y: 0}; clearCard(); }
    requestPaint();
  }
  function clearCard() {
    if (card) { card.style.removeProperty('--prism-local-x'); card.style.removeProperty('--prism-local-y'); card = null; cardRect = null; }
  }
  function move(event) {
    if (event.pointerType === 'touch' || mode() !== 'full' || !rootRect) return;
    target.x = clamp((event.clientX - rootRect.left) / width * 2 - 1, -1, 1);
    target.y = clamp((event.clientY - rootRect.top) / height * 2 - 1, -1, 1);
    const nextCard = event.target?.closest?.('.ah-surface');
    if (nextCard !== card) { clearCard(); card = nextCard && root.contains(nextCard) ? nextCard : null; }
    if (card) {
      cardRect ||= card.getBoundingClientRect();
      card.style.setProperty('--prism-local-x', `${clamp((event.clientX - cardRect.left) / Math.max(1, cardRect.width) * 100, 0, 100).toFixed(1)}%`);
      card.style.setProperty('--prism-local-y', `${clamp((event.clientY - cardRect.top) / Math.max(1, cardRect.height) * 100, 0, 100).toFixed(1)}%`);
    }
    requestPaint();
  }
  function leave() { target = {x: 0, y: 0}; clearCard(); requestPaint(); }
  function press(event) {
    if (event.button !== 0 || mode() !== 'full' || !rootRect || event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    const now = win.performance.now(); if (now - lastRippleAt < 120) return; lastRippleAt = now;
    ripples.push({x: event.clientX - rootRect.left, y: event.clientY - rootRect.top, born: clock});
    if (ripples.length > 4) ripples.shift();
    if (hero.contains(event.target)) pressEnergy = 1;
    requestPaint();
  }
  listen(root, 'pointermove', move); listen(root, 'pointerleave', leave); listen(root, 'pointerdown', press);
  listen(hero, 'pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button,a,input,select,[role="button"]')) return;
    orbitDrag = {id:event.pointerId,x:event.clientX,y:event.clientY};
  });
  listen(win, 'pointermove', event => {
    if (orbitDrag?.id !== event.pointerId) return;
    viewYaw += (event.clientX - orbitDrag.x) * .009;
    viewPitch = clamp(viewPitch + (event.clientY - orbitDrag.y) * .006, -.9, .9);
    orbitDrag.x = event.clientX;
    orbitDrag.y = event.clientY;
    requestPaint();
  });
  const endDrag = event => { if (event.pointerId === orbitDrag?.id) orbitDrag = null; };
  listen(win, 'pointerup', endDrag); listen(win, 'pointercancel', endDrag);
  listen(win, 'blur', () => { orbitDrag = null; });
  listen(hero, 'keydown', event => {
    if (event.target !== hero || event.ctrlKey || event.altKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft': viewYaw -= .15; break;
      case 'ArrowRight': viewYaw += .15; break;
      case 'ArrowUp': viewPitch = clamp(viewPitch - .12, -.9, .9); break;
      case 'ArrowDown': viewPitch = clamp(viewPitch + .12, -.9, .9); break;
      case 'Home': viewPitch = -.12; viewYaw = .45; break;
      default: return;
    }
    event.preventDefault();
    requestPaint();
  });
  listen(root, 'aurora:core-light', event => updateCore(event.detail));
  listen(root, 'aurora:palette-change', updateTheme);
  listen(doc, 'visibilitychange', resetMotion); listen(win, 'resize', queueResize);
  listen(root, 'scroll', () => {cardRect = null;}, true);
  media?.addEventListener?.('change', resetMotion);
  const observer = new win.MutationObserver(resetMotion);
  observer.observe(root, {attributes: true, attributeFilter: ['data-motion', 'data-paused', 'data-notification-presence']});
  const sizeObserver = win.ResizeObserver ? new win.ResizeObserver(queueResize) : null;
  sizeObserver?.observe(root); sizeObserver?.observe(hero);
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    const entry = entries.find(item => item.target === root); if (!entry) return;
    const next = entry.isIntersecting; if (next === visible) return; visible = next; resetMotion();
  }) : null;
  intersection?.observe(root);
  function cleanup() {
    if (disposed) return; disposed = true;
    cancelPaint(); if (resizeFrame) win.cancelAnimationFrame(resizeFrame); resizeFrame = 0;
    abort.abort(); observer.disconnect(); sizeObserver?.disconnect(); intersection?.disconnect(); media?.removeEventListener?.('change', resetMotion);
    clearCard(); background.remove(); core.remove();
    if (originalTabIndex === null) hero.removeAttribute('tabindex'); else hero.setAttribute('tabindex',originalTabIndex);
    if (originalShortcuts === null) hero.removeAttribute('aria-keyshortcuts'); else hero.setAttribute('aria-keyshortcuts',originalShortcuts);
    if (!hadClass) root.classList.remove('au-prism');
    for (const {node, x, y} of previousMotion) {
      if (x) node.style.setProperty('--prism-x', x); else node.style.removeProperty('--prism-x');
      if (y) node.style.setProperty('--prism-y', y); else node.style.removeProperty('--prism-y');
    }
    if (previousRenderer === undefined) delete root.dataset.prismRenderer; else root.dataset.prismRenderer = previousRenderer;
    instances.delete(root);
  }
  listen(win, 'pagehide', cleanup);
  root.dataset.prismRenderer = 'projected-3d';
  resize(); root.dispatchEvent(new win.CustomEvent('aurora:core-light-request'));
  instances.set(root, cleanup);
  return cleanup;
}
