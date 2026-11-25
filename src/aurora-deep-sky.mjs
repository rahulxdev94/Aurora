import {GALAXY_ART} from './aurora-galaxy-art.mjs';
import {createSkyGpu} from './aurora-sky-gpu.mjs';
import {GRAVITY_WAVE,gravityWaveSpeed,createGravityWavePool,createCanvasWaveFilter,refractCanvas} from './aurora-gravity-wave.mjs';

const instances = new WeakMap(), artwork = new WeakMap();
const TAU = Math.PI * 2, clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const DEEP_SKY_ORBIT_SECONDS = 300;
const ORBIT_RATE = TAU / DEEP_SKY_ORBIT_SECONDS;
function randomSource(seed = 527) {let value = seed >>> 0; return () => {value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296;};}
function starLight(star, time) {
  const wave = .5 + Math.sin(time * star.speed + star.phase) * .5;
  const normal = star.base * (1 - star.amplitude + star.amplitude * wave);
  const dip = star.dipDepth ? Math.max(0, ((.5 + .5 * Math.sin(time * star.dipSpeed + star.dipPhase)) - .91) / .09) ** 3 : 0;
  return normal * (1 - dip * star.dipDepth);
}

export function deepSkyGeometry(width, height) {
  return {x: width * .51, y: height * .48, width: Math.min(width * .79, height * 1.58), height: Math.min(height * .89, width * .55)};
}
function decodeImage(doc, uri) {
  return new Promise((resolve, reject) => {
    if (typeof uri !== 'string' || !uri.startsWith('data:image/')) {reject(new Error('Local scene image unavailable')); return;}
    const win = doc.defaultView, image = new win.Image(); let settled = false;
    const finish = error => {
      if (settled) return; settled = true; win.clearTimeout(timer); image.onload = image.onerror = null;
      error || !image.naturalWidth ? reject(error || new Error('Scene image has no dimensions')) : resolve(image);
    };
    const timer = win.setTimeout(() => finish(new Error('Scene image decode timed out')), 4500);
    image.decoding = 'async'; image.fetchPriority = 'high'; image.onload = () => finish(); image.onerror = () => finish(new Error('Scene image could not decode'));
    image.src = uri; if (image.decode) void image.decode().then(() => finish()).catch(finish);
  });
}
function makeDistantSpiral(doc) {
  const texture = doc.createElement('canvas'); texture.width = texture.height = 512;
  const brush = texture.getContext('2d', {alpha: false}), random = randomSource(39102), centre = 256;
  brush.fillStyle = '#000'; brush.fillRect(0, 0, 512, 512);
  const halo = brush.createRadialGradient(centre, centre, 0, centre, centre, 237);
  halo.addColorStop(0, '#ffe8c4'); halo.addColorStop(.055, '#d6b1ae'); halo.addColorStop(.16, '#796487'); halo.addColorStop(.5, '#231a3a'); halo.addColorStop(1, '#000');
  brush.fillStyle = halo; brush.fillRect(0, 0, 512, 512); brush.globalCompositeOperation = 'screen';
  for (let arm = 0; arm < 4; arm++) {
    for (let point = 2; point < 75; point++) {
      const radius = point / 75, angle = arm * TAU / 4 + 5.2 * (1 - Math.sqrt(radius));
      const x = centre + Math.cos(angle) * radius * 232, y = centre + Math.sin(angle) * radius * 232;
      brush.save(); brush.translate(x, y); brush.rotate(angle + .7);
      brush.fillStyle = point % 7 ? 'rgba(105,123,204,.10)' : 'rgba(211,104,169,.14)';
      brush.beginPath(); brush.ellipse(0, 0, 5 + radius * 9, 2 + radius * 3, 0, 0, TAU); brush.fill(); brush.restore();
    }
  }
  for (let i = 0; i < 4800; i++) {
    const r = Math.pow(random(), .74), arm = Math.floor(random() * 4);
    const jitter = (random() + random() - 1) * (.14 + r * .1), angle = arm * TAU / 4 + 5.2 * (1 - Math.sqrt(r)) + jitter;
    const x = centre + Math.cos(angle) * r * 232, y = centre + Math.sin(angle) * r * 232;
    const alpha = .1 + random() ** 4 * .7;
    brush.fillStyle = r < .2 ? `rgba(255,224,187,${alpha})` : i % 13 ? `rgba(167,187,255,${alpha})` : `rgba(255,156,206,${alpha})`;
    brush.fillRect(x, y, .25 + random() * .72, .25 + random() * .72);
  }
  return texture;
}
function prepareArtwork(doc) {
  if (!artwork.has(doc)) {
    const main = decodeImage(doc, GALAXY_ART); void main.catch(() => {});
    artwork.set(doc, {remote: makeDistantSpiral(doc), main});
  }
  return artwork.get(doc);
}
function featherImage(doc, image) {
  const canvas = doc.createElement('canvas'), scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Centre the actual luminous bulge before rotating the texture. A small
  // off-centre nucleus in the artwork must not orbit the scene's fixed centre.
  const region = Math.max(2, Math.floor(Math.min(canvas.width, canvas.height) * .3)), left = Math.floor((canvas.width - region) / 2), top = Math.floor((canvas.height - region) / 2);
  const pixels = context.getImageData(left, top, region, region).data;
  let weightSum = 0, weightedX = 0, weightedY = 0;
  for (let y = 0; y < region; y++) for (let x = 0; x < region; x++) {
    const i = (y * region + x) * 4, luminance = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
    const radius2 = ((x - region / 2) ** 2 + (y - region / 2) ** 2) / ((region * .35) ** 2);
    const weight = Math.max(0, luminance - 135) ** 3 * Math.exp(-radius2);
    weightSum += weight; weightedX += (left + x) * weight; weightedY += (top + y) * weight;
  }
  if (weightSum) {context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, canvas.width / 2 - weightedX / weightSum, canvas.height / 2 - weightedY / weightSum, canvas.width, canvas.height);}
  context.globalCompositeOperation = 'destination-in'; context.translate(canvas.width / 2, canvas.height / 2); context.scale(canvas.width / 2, canvas.height / 2);
  const mask = context.createRadialGradient(0, 0, .36, 0, 0, 1.06);
  mask.addColorStop(0, '#fff'); mask.addColorStop(.58, '#fff'); mask.addColorStop(.85, '#ffffffb0'); mask.addColorStop(1, '#fff0');
  context.fillStyle = mask; context.fillRect(-1, -1, 2, 2); return canvas;
}

export function initDeepSky({root, stage} = {}) {
  if (!root?.ownerDocument || !stage) return () => {};
  if (instances.has(stage)) return instances.get(stage);
  const doc = root.ownerDocument, win = doc.defaultView;
  const fallbackCanvas = doc.createElement('canvas');
  let canvas = fallbackCanvas, gpu = null, gpuFailure = null;
  canvas.className = 'ag-sky'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;user-select:none;';
  let context = canvas.getContext('2d', {alpha: false}); if (!context || !win?.requestAnimationFrame) return () => {};
  stage.prepend(canvas);
  const backdrop = doc.createElement('canvas'), bctx = backdrop.getContext('2d', {alpha: false});
  const waveSnapshot=doc.createElement('canvas'),waves=createGravityWavePool();
  const canvasWaveFilter=createCanvasWaveFilter(fallbackCanvas,stage);
  let waveFrames=0,waveTriangles=0,lastWaveNow=0;
  const flare = doc.createElement('canvas'); flare.width = flare.height = 40;
  const fctx = flare.getContext('2d'), flareGradient = fctx.createRadialGradient(20, 20, 0, 20, 20, 20);
  flareGradient.addColorStop(0, '#fff8ecfa'); flareGradient.addColorStop(.08, '#ffe8cbb0'); flareGradient.addColorStop(.24, '#f6bba542'); flareGradient.addColorStop(1, '#ddb5ef00'); fctx.fillStyle = flareGradient; fctx.fillRect(0, 0, 40, 40);
  const abort = new win.AbortController(), media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const oldTab = stage.getAttribute('tabindex'), oldLabel = stage.getAttribute('aria-label'), previousDiagnostics = stage.__auroraDeepSky;
  if (oldTab === null) stage.setAttribute('tabindex', '0');
  if (!oldLabel) stage.setAttribute('aria-label', 'Immersive galaxy scene. Drag empty space to orbit. Use arrow keys to rotate and Home to reset.');
  let disposed = false, inView = true, width = 1, height = 1, dpr = 1, bounds = null, geometry = deepSkyGeometry(1, 1);
  let mainImage = null, remoteImage = null, imageKind = 'vector', imageFade = 0;
  let frame = 0, resizeFrame = 0, previousTime = 0, nextPaint = 0, time = 0, frameCount = 0, lastCost = 0, meanCost = 0, interval = 1000 / 30, exporting = false;
  const cadence = new Float32Array(300);
  let cadenceCount = 0;
  let targetX = 0, targetY = 0, px = 0, py = 0, orbit = -.14, inclination = .84, drag = null, suppressCoreUntil = 0;
  let motionState = {main: {}, distant: {}, stars: {}, near: {}, dust: {}};
  const random = randomSource(), stars = Array.from({length: 3100}, () => {
    const depth = .1 + random() * .9, tint = random(), colour = tint < .2 ? 0 : tint < .58 ? 1 : tint < .78 ? 2 : tint < .9 ? 3 : tint < .98 ? 4 : 5;
    return {x: random(), y: random(), depth, size: .45 + random() ** 3 * 1.45, phase: random() * TAU, speed: ORBIT_RATE * (5 + Math.floor(random() * 55)), colour, base: .43 + depth * .37, amplitude: .1 + random() * .43, dipDepth: random() < .16 ? .5 + random() * .22 : 0, dipSpeed: ORBIT_RATE * (2 + Math.floor(random() * 10)), dipPhase: random() * TAU};
  });
  const nearStars = Array.from({length: 72}, () => ({x: random(), y: random(), z: .4 + random() * .6, cycles: random() < .65 ? 1 : 2, yCycles: random() < .7 ? 0 : random() < .5 ? -1 : 1, phase: random() * TAU}));
  const dust = Array.from({length: 90}, () => ({x: random(), y: random(), z: random(), phase: random() * TAU}));
  const remote = [
    {x: .105, y: .23, size: .105, flatten: .48, angle: .58, speed: -ORBIT_RATE, alpha: .9},
    {x: .88, y: .18, size: .11, flatten: .72, angle: -.58, speed: ORBIT_RATE * 2, alpha: .88},
    {x: .88, y: .77, size: .09, flatten: .46, angle: .45, speed: -ORBIT_RATE * 2, alpha: .76},
    {x: .12, y: .78, size: .075, flatten: .87, angle: -.12, speed: ORBIT_RATE, alpha: .74},
    {x: .63, y: .075, size: .04, flatten: .5, angle: -.65, speed: -ORBIT_RATE * 3, alpha: .65},
    {x: .39, y: .88, size: .045, flatten: .72, angle: .4, speed: ORBIT_RATE * 2, alpha: .66},
    {x: .965, y: .43, size: .038, flatten: .47, angle: .25, speed: -ORBIT_RATE * 2, alpha: .7},
    {x: .28, y: .10, size: .032, flatten: .8, angle: -.3, speed: ORBIT_RATE * 3, alpha: .63}
  ];
  const colours = ['#bfd7ff', '#f4f2ed', '#ffedce', '#f1d293', '#eeb088', '#da9993'];
  const buckets = Array.from({length: colours.length * 16}, () => []);
  const brightnessAudit = Object.freeze({colours: colours.map((colour, index) => ({colour, count: stars.filter(star => star.colour === index).length})), minimumNormalFloor: Math.min(...stars.map(star => star.base * (1 - star.amplitude))), minimumIndividualDipFloor: Math.min(...stars.map(star => star.base * (1 - star.amplitude) * (1 - star.dipDepth))), distantMinimumOpacity: Math.min(...remote.map(item => item.alpha)), individuallyDimmingStars: stars.filter(star => star.dipDepth).length});
  const listen = (node, event, handler, capture = false) => node.addEventListener(event, handler, {capture, signal: abort.signal});
  const asleep = () => disposed || doc.hidden || !inView || root.dataset.paused === 'true' || stage.hidden;
  const fullMotion = () => root.dataset.motion === 'full' && !media?.matches;
  const mode = () => asleep() ? 'sleep' : fullMotion() ? 'full' : 'still';
  const blocked = target => Boolean(target?.closest?.('button,a,input,textarea,select,summary,dialog,[role="dialog"],[contenteditable="true"],.ag-object,[data-ag-object]'));

  function paintBackdrop() {
    backdrop.width = canvas.width; backdrop.height = canvas.height;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.fillStyle = '#02040b'; bctx.fillRect(0, 0, width, height);
    const nebula = bctx.createRadialGradient(width * .5, height * .47, width * .04, width * .5, height * .47, width * .66);
    nebula.addColorStop(0, '#27202e'); nebula.addColorStop(.3, '#12121e'); nebula.addColorStop(.65, '#090c18'); nebula.addColorStop(1, '#02040b'); bctx.fillStyle = nebula; bctx.fillRect(0, 0, width, height);
    const noise = randomSource(762);
    for (let i = 0; i < 54; i++) {
      const x = width * noise(), y = height * (.16 + noise() * .7), r = width * (.035 + noise() * .09);
      const cloud = bctx.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, i % 3 ? '#49334a0b' : '#81634c0b'); cloud.addColorStop(1, '#0c102000'); bctx.fillStyle = cloud; bctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  function resize() {
    resizeFrame = 0; if (disposed) return;
    bounds = stage.getBoundingClientRect(); width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
    dpr = Math.min(win.devicePixelRatio || 1, 1.5, Math.sqrt(2600000 / (width * height)));
    const bw = Math.max(1, Math.round(width * dpr)), bh = Math.max(1, Math.round(height * dpr));
    if (canvas.width === bw && canvas.height === bh && backdrop.width === bw && backdrop.height === bh && geometry.x === width * .51 && geometry.y === height * .48 && frameCount) return;
    fallbackCanvas.width = bw; fallbackCanvas.height = bh;
    if (canvas !== fallbackCanvas) {canvas.width = bw;canvas.height = bh;}
    geometry = deepSkyGeometry(width, height);
    paintBackdrop(); if (gpu) {try {gpu.setBackdrop(backdrop);} catch {useFallback('backdrop upload failed');}} requestPaint();
  }
  function queueResize() { if (!resizeFrame) resizeFrame = win.requestAnimationFrame(resize); }
  function drawVectorSpiral(x, y, size, angle, flatten, alpha = 1) {
    context.save(); context.translate(x, y); context.rotate(angle); context.scale(1, flatten);
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, size * .52);
    glow.addColorStop(0, `rgba(255,220,171,${.8 * alpha})`); glow.addColorStop(.12, `rgba(232,175,147,${.3 * alpha})`); glow.addColorStop(.6, `rgba(149,110,166,${.075 * alpha})`); glow.addColorStop(1, '#66477700');
    context.fillStyle = glow; context.fillRect(-size * .6, -size * .6, size * 1.2, size * 1.2);
    for (let arm = 0; arm < 3; arm++) {
      for (let i = 0; i < 145; i++) {
        const r = (i + 4) / 150 * size * .45, a = arm * TAU / 3 + Math.log((i + 4) / 150 + .03) * 4.15;
        const x0 = Math.cos(a) * r, y0 = Math.sin(a) * r;
        context.fillStyle = `rgba(${i < 45 ? '255,202,158' : '190,174,229'},${alpha * (.08 + .28 * (1 - i / 150))})`;
        context.beginPath(); context.ellipse(x0, y0, Math.max(.5, size * .009 * i / 150), Math.max(.5, size * .003), a + Math.PI / 2, 0, TAU); context.fill();
      }
    }
    context.restore();
  }
  function drawDistant() {
    context.save(); context.globalCompositeOperation = 'screen';
    for (const item of remote) {
      const x = item.x * width + px * 5, y = item.y * height + py * 4, size = Math.min(width * item.size, height * .28), spin = time * item.speed;
      if (remoteImage) {
        context.save(); context.translate(x, y); context.rotate(item.angle); context.scale(1, item.flatten); context.rotate(spin); context.globalAlpha = item.alpha;
        context.drawImage(remoteImage, -size / 2, -size / 2, size, size); context.restore();
      } else drawVectorSpiral(x, y, size, item.angle, item.flatten, item.alpha);
    }
    context.restore();
    motionState.distant = {count: remote.length, sampleAngle: remote[0].angle + time * remote[0].speed, secondAngle: remote[1].angle + time * remote[1].speed, x: remote[0].x * width + px * 5, y: remote[0].y * height + py * 4};
  }
  function drawStars() {
    for (const bucket of buckets) bucket.length = 0;
    for (const star of stars) {
      const brightness = clamp(starLight(star, time), 0, .95);
      const index = star.colour * 16 + Math.min(15, Math.floor(brightness * 16)); buckets[index].push(star);
    }
    for (let index = 0; index < buckets.length; index++) {
      const bucket = buckets[index]; if (!bucket.length) continue;
      context.fillStyle = colours[Math.floor(index / 16)]; context.globalAlpha = (index % 16 + .5) / 16;
      context.beginPath();
      for (const star of bucket) {
        const x = star.x * width + px * star.depth * 22, y = star.y * height + py * star.depth * 17;
        context.rect(x, y, star.size, star.size);
      }
      context.fill();
    }
    context.globalAlpha = 1;
    for (let i = 0; i < stars.length; i += 97) {
      const star = stars[i], x = star.x * width + px * star.depth * 22, y = star.y * height + py * star.depth * 17;
      context.globalAlpha = starLight(star, time) * .8;
      context.drawImage(flare, x - 5, y - 5, 10, 10);
    }
    context.globalAlpha = 1;
    motionState.stars = {count: stars.length, sampleBrightness: starLight(stars[1], time), secondBrightness: starLight(stars[31], time)};
  }
  function drawMain(level) {
    const centre = {x: geometry.x + px * 24, y: geometry.y + py * 17};
    const spin = time * ORBIT_RATE, flatten = clamp(inclination + py * .055, .43, 1.03);
    const w = geometry.width, h = geometry.height * flatten;
    context.save(); context.globalCompositeOperation = 'screen';
    const halo = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, geometry.width * .48);
    halo.addColorStop(0, '#f1bd8540'); halo.addColorStop(.19, '#d29a8c18'); halo.addColorStop(.55, '#795a8807'); halo.addColorStop(1, '#502e6000'); context.fillStyle = halo; context.fillRect(0, 0, width, height);
    if (mainImage) {
      context.save(); context.translate(centre.x, centre.y); context.rotate(orbit); context.scale(1, h / w); context.rotate(spin); context.globalAlpha = imageFade;
      context.drawImage(mainImage, -w / 2, -w / 2, w, w); context.restore();
    } else drawVectorSpiral(centre.x, centre.y, w, orbit, h / w, 1);
    // Bright foreground stars rotate at their own radii, adding genuine depth
    // rather than moving the background panorama as one sheet.
    context.save(); context.translate(centre.x, centre.y); context.rotate(orbit); context.scale(1, h / w);
    for (let i = 0; i < 86; i++) {
      const star = stars[i], r = (.035 + star.x * .41) * w, a = Math.log(star.x + .03) * 4.15 + i % 3 * TAU / 3 + spin;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      context.fillStyle = i % 5 ? '#d9d0efb8' : '#ffe3b3d9'; context.beginPath(); context.arc(x, y, .35 + star.depth * .6, 0, TAU); context.fill();
    }
    context.restore();
    const nucleusRadius = Math.max(14, geometry.width * .035);
    context.save(); context.translate(centre.x, centre.y); context.rotate(orbit); context.scale(1, .6);
    const nucleus = context.createRadialGradient(0, 0, 0, 0, 0, nucleusRadius);
    nucleus.addColorStop(0, `rgba(255,244,217,${.62 + level * .2})`); nucleus.addColorStop(.14, '#ffe3b3a8'); nucleus.addColorStop(.4, '#f1b97e30'); nucleus.addColorStop(1, '#e3a76e00');
    context.fillStyle = nucleus; context.fillRect(-nucleusRadius * 2, -nucleusRadius * 2, nucleusRadius * 4, nucleusRadius * 4); context.restore();
    context.restore();
    motionState.main = {x: centre.x, y: centre.y, width: w, height: h, angle: spin, planeAngle: orbit, inclination: flatten, nucleusPulse: 0, artwork: imageKind, decoded: Boolean(mainImage), distantTextureReady: Boolean(remoteImage)};
  }
  function drawNear() {
    context.save(); context.globalCompositeOperation = 'screen';
    for (const speck of nearStars) {
      const x = (speck.x * (width + 20) + time / DEEP_SKY_ORBIT_SECONDS * (width + 20) * speck.cycles) % (width + 20) - 10 + px * speck.z * 55;
      const y = ((speck.y * (height + 20) + time / DEEP_SKY_ORBIT_SECONDS * (height + 20) * speck.yCycles) % (height + 20) + height + 20) % (height + 20) - 10 + py * speck.z * 39;
      const size = 3 + speck.z * 7; context.globalAlpha = .09 + speck.z * .23; context.drawImage(flare, x - size / 2, y - size / 2, size, size);
    }
    context.globalAlpha = 1;
    for (const mote of dust) {
      const x = (mote.x * (width + 80) + time / DEEP_SKY_ORBIT_SECONDS * (width + 80)) % (width + 80) - 40 + px * 18;
      const y = mote.y * height + py * 13;
      context.globalAlpha = .018 + mote.z * .025; context.drawImage(flare, x - 20, y - 10, 40, 20);
    }
    context.restore();
    motionState.near = {count: nearStars.length, sampleX: (nearStars[0].x * (width + 20) + time / DEEP_SKY_ORBIT_SECONDS * (width + 20) * nearStars[0].cycles) % (width + 20) - 10 + px * nearStars[0].z * 55, sampleY: nearStars[0].y * height + py * nearStars[0].z * 39};
    motionState.dust = {count: dust.length, phase: time / DEEP_SKY_ORBIT_SECONDS * TAU};
  }
  function playbackLevel() {
    if (!fullMotion()) return 0;
    const signal = win.__auroraPlaybackAudio, age = signal ? Date.now() - signal.at : Infinity;
    return signal && signal.status === 'active' && Number.isFinite(signal.peak) && age >= 0 && age < 1800 ? clamp(signal.peak, 0, .8) : 0;
  }
  function stop() {if (frame) win.cancelAnimationFrame(frame); frame = nextPaint = 0;}
  function useFallback(reason) {
    const old = gpu;
    gpu = null; gpuFailure = reason; interval = 1000 / 30; nextPaint = 0; cadenceCount = 0;
    if (canvas !== fallbackCanvas) {canvas.replaceWith(fallbackCanvas); canvas = fallbackCanvas;}
    try {old?.dispose();} catch {}
    if (!disposed) requestPaint();
  }
  function paintScene(level = 0,waveNow=Date.now()) {
    lastWaveNow=waveNow;const activeWaves=fullMotion()?waves.sample(waveNow):[];
    if (gpu) {
      try {
        gpu.draw({width,height,dpr,time,px,py,orbit,inclination,geometry,level,waves:activeWaves});
        const flatten = clamp(inclination + py * .055,.43,1.03);
        motionState.main = {x:geometry.x+px*24,y:geometry.y+py*17,width:geometry.width,height:geometry.height*flatten,angle:time*ORBIT_RATE,planeAngle:orbit,inclination:flatten,nucleusPulse:0,artwork:imageKind,decoded:true,distantTextureReady:true};
        motionState.distant = {count:remote.length,sampleAngle:remote[0].angle+time*remote[0].speed,secondAngle:remote[1].angle+time*remote[1].speed};
        motionState.stars = {count:stars.length,sampleBrightness:starLight(stars[1],time),secondBrightness:starLight(stars[31],time)};
        motionState.near = {count:nearStars.length,sampleX:(nearStars[0].x*(width+20)+time/DEEP_SKY_ORBIT_SECONDS*(width+20)*nearStars[0].cycles)%(width+20)-10+px*nearStars[0].z*55};
        motionState.dust = {count:dust.length,phase:time*ORBIT_RATE};if(activeWaves.length)waveFrames++;waveTriangles=0;frameCount++;return;
      } catch {useFallback('hardware drawing interrupted');}
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
    context.drawImage(backdrop, 0, 0, width, height); drawDistant(); drawStars(); drawMain(level); drawNear();
    if(canvasWaveFilter){canvasWaveFilter.draw(activeWaves,width,height);waveTriangles=0;}
    else waveTriangles=activeWaves.length?refractCanvas(context,canvas,waveSnapshot,activeWaves,width,height,dpr):0;
    if(activeWaves.length)waveFrames++;frameCount++;
  }
  function draw(timestamp) {
    frame = 0; if (asleep() || exporting) {previousTime = 0; return;}
    if (!stage.isConnected) {cleanup(); return;}
    const start = win.performance.now(), full = fullMotion();
    if (full && nextPaint && timestamp + .8 < nextPaint) {frame = win.requestAnimationFrame(draw);return;}
    const elapsed = previousTime ? timestamp - previousTime : 0, delta = full ? Math.min(Math.max(0,elapsed)/1000,.25) : 0;
    if (full && elapsed > 0) cadence[cadenceCount++ % cadence.length] = elapsed;
    previousTime = timestamp; if (full) time += delta;
    const damping = full ? 1 - Math.exp(-delta * 4) : 1;
    px += ((full ? targetX : 0) - px) * damping; py += ((full ? targetY : 0) - py) * damping;
    imageFade = 1; paintScene(playbackLevel());
    lastCost = win.performance.now() - start; meanCost = meanCost * .93 + lastCost * .07;
    interval = gpu ? 1000 / 60 : meanCost > 18 ? 1000 / 20 : 1000 / 30;
    if (full) {
      nextPaint = nextPaint ? nextPaint + interval * Math.max(1,Math.floor((timestamp+.8-nextPaint)/interval)+1) : timestamp+interval;
      frame = win.requestAnimationFrame(draw);
    }
  }
  function requestPaint() {if (!asleep() && !exporting && !frame) frame = win.requestAnimationFrame(draw);}
  function settle() {stop(); previousTime = 0; drag = null; if (!fullMotion()) {targetX = targetY = px = py = 0;waves.clear();} requestPaint();}
  function triggerWave(detail={}){
    if(disposed||!fullMotion())return false;
    const box=stage.getBoundingClientRect(),x=Number(detail.x),y=Number(detail.y),now=Date.now();
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>win.innerWidth||y<0||y>win.innerHeight)return false;
    const speed=Number.isFinite(detail.speed)&&detail.speed>0?Math.min(10,detail.speed):gravityWaveSpeed(win.innerWidth,win.innerHeight),startedAt=Number.isFinite(detail.startedAt)?Math.min(now,detail.startedAt):now;
    if(!waves.add({x:x-box.left,y:y-box.top,startedAt,speed},now))return false;
    requestPaint();return{x,y,localX:x-box.left,localY:y-box.top,startedAt,speed,durationMs:GRAVITY_WAVE.durationMs};
  }
  function pointerMove(event) {
    if (!bounds || asleep() || !fullMotion() || event.pointerType === 'touch' && !drag) return;
    targetX = clamp((event.clientX - bounds.left) / width * 2 - 1, -1, 1); targetY = clamp((event.clientY - bounds.top) / height * 2 - 1, -1, 1);
    if (drag?.id === event.pointerId) {
      if (drag.core && !drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 6) return;
        drag.moved = true; stage.focus({preventScroll: true});
        try {stage.setPointerCapture(event.pointerId);} catch {}
      }
      orbit += (event.clientX - drag.x) * .0028; inclination = clamp(inclination + (event.clientY - drag.y) * .0017, .43, 1.03);
      drag.x = event.clientX; drag.y = event.clientY; event.preventDefault(); event.stopPropagation();
    }
    requestPaint();
  }
  function pointerDown(event) {
    const core = event.target?.closest?.('.ag-object[data-body="core"]');
    if (event.button !== 0 || blocked(event.target) && !core || !fullMotion() || asleep()) return;
    if (core) suppressCoreUntil = 0;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, core: Boolean(core), moved: !core};
    if (core) return; // A simple click keeps the button's native activation.
    stage.focus({preventScroll: true}); try {stage.setPointerCapture(event.pointerId);} catch {}
    event.preventDefault(); event.stopPropagation(); requestPaint();
  }
  function pointerUp(event) {
    if (drag?.id !== event.pointerId) return;
    if (drag.core && drag.moved) suppressCoreUntil = win.performance.now() + 350;
    drag = null; try {stage.releasePointerCapture(event.pointerId);} catch {}
  }
  function key(event) {
    if (event.target !== stage || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') {orbit = -.14; inclination = .84;}
    if (event.key === 'ArrowLeft') orbit -= .07; if (event.key === 'ArrowRight') orbit += .07;
    if (event.key === 'ArrowUp') inclination = clamp(inclination - .055, .43, 1.03); if (event.key === 'ArrowDown') inclination = clamp(inclination + .055, .43, 1.03);
    requestPaint();
  }
  listen(stage, 'pointerdown', pointerDown, true); listen(stage, 'pointermove', pointerMove, true); listen(stage, 'pointerup', pointerUp, true); listen(stage, 'pointercancel', pointerUp, true);
  listen(stage, 'click', event => {
    if (event.detail > 0 && win.performance.now() < suppressCoreUntil && event.target?.closest?.('.ag-object[data-body="core"]')) {
      suppressCoreUntil = 0; event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  listen(stage, 'pointerleave', () => {if (!drag) {targetX = targetY = 0; requestPaint();}}); listen(stage, 'keydown', key);
  listen(root,'aurora:gravity-wave',event=>triggerWave(event.detail));
  listen(doc, 'visibilitychange', settle); listen(win, 'resize', queueResize); media?.addEventListener?.('change', settle);
  const mutation = new win.MutationObserver(settle); mutation.observe(root, {attributes: true, attributeFilter: ['data-motion', 'data-paused']}); mutation.observe(stage, {attributes: true, attributeFilter: ['hidden']});
  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(queueResize) : null; resizeObserver?.observe(stage);
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {const next = entries.find(entry => entry.target === stage)?.isIntersecting; if (next !== undefined && next !== inView) {inView = next; settle();}}) : null; intersection?.observe(stage);
  const diagnostics = Object.freeze({
    get geometry() {return {...geometry, ...motionState.main};},
    get state() {return {mode: mode(), engine: gpu ? 'webgl2' : 'canvas2d',hardware:gpu?.info||null,fallbackReason:gpuFailure, elapsed: time, orbitSeconds: DEEP_SKY_ORBIT_SECONDS, exporting, frameCount, frameCostMs: lastCost, meanCostMs: meanCost, targetFps: 1000 / interval, pixelRatio: dpr, buffer: [canvas.width, canvas.height], main: {...motionState.main}, distant: {...motionState.distant}, stars: {...motionState.stars}, near: {...motionState.near}, dust: {...motionState.dust}, pointer: {x: px, y: py}, orientation: {angle: orbit, inclination}, dragging: Boolean(drag),gravity:{...waves.state(exporting?lastWaveNow:Date.now()),frames:waveFrames,meshTriangles:waveTriangles,canvas:canvasWaveFilter?.info||null}};},
    get frameIntervalsMs() {const count=Math.min(cadenceCount,cadence.length), start=cadenceCount-count;return Array.from({length:count},(_,i)=>cadence[(start+i)%cadence.length]);},
    redrawForCapture() {if (gpu && !disposed) paintScene(playbackLevel(),exporting?lastWaveNow:Date.now());},
    get brightnessAudit() {return brightnessAudit;},
    triggerWave,
    renderAt(seconds,{waveNow=Date.now()}={}) {
      if (disposed || !Number.isFinite(seconds) || seconds < 0) return false;
      exporting = true; stop(); previousTime = 0; time = seconds; targetX = targetY = px = py = 0; orbit = -.14; inclination = .84; imageFade = 1;
      paintScene(0,waveNow); return true;
    },
    endExport() {exporting = false; previousTime = 0; requestPaint();},
    captureLayer(name) {
      const paint = {main: () => drawMain(0), distant: drawDistant, stars: drawStars, near: drawNear}[name];
      if (!paint || disposed) return null;
      // Reuse the actual painter in an isolated, bounded diagnostic canvas.
      // This never changes the displayed pixels, clock or native application.
      const sample = doc.createElement('canvas'), ratio = Math.min(.7, Math.sqrt(520000 / (width * height)));
      sample.width = Math.max(1, Math.round(width * ratio)); sample.height = Math.max(1, Math.round(height * ratio));
      const diagnosticContext = sample.getContext('2d', {alpha: false, willReadFrequently: true}), previousContext = context;
      try {
        context = diagnosticContext; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#000'; context.fillRect(0, 0, width, height); paint();
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        let hash = 2166136261, lit = 0;
        for (let index = 0; index < pixels.length; index += 28) {hash = Math.imul(hash ^ pixels[index], 16777619); hash = Math.imul(hash ^ pixels[index + 1], 16777619); hash = Math.imul(hash ^ pixels[index + 2], 16777619); if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 3) lit++;}
        return {hash: hash >>> 0, litSamples: lit, samplePixels: [sample.width, sample.height], elapsed: time};
      } finally {context = previousContext;}
    }
  });
  stage.__auroraDeepSky = diagnostics;
  const prepared = prepareArtwork(doc);
  remoteImage = prepared.remote;
  void prepared.main.then(image => {
    if (disposed) return;
    mainImage = featherImage(doc, image); imageKind = 'generated'; imageFade = 1;
    const next = fallbackCanvas.cloneNode(false);next.style.removeProperty('filter');
    try {
      gpu = createSkyGpu({canvas:next,stars,nearStars,dust,remote,colours,flare,onUnavailable:reason=>{gpuFailure=reason;},onLoss:()=>useFallback('WebGL context lost')});
      if (gpu) {
        gpu.setArtwork({main:mainImage,remote:remoteImage});gpu.setBackdrop(backdrop);
        fallbackCanvas.replaceWith(next);canvas = next;nextPaint = 0;cadenceCount = 0;interval = 1000 / 60;
      } else gpuFailure ||= 'hardware WebGL2 unavailable';
    } catch {useFallback('hardware initialisation failed');}
    requestPaint();
    root.dispatchEvent(new win.Event('aurora:sky-ready'));
  }).catch(() => {});
  function cleanup() {
    if (disposed) return; disposed = true; stop(); if (resizeFrame) win.cancelAnimationFrame(resizeFrame);
    if (drag) try {stage.releasePointerCapture(drag.id);} catch {} drag = null;
    abort.abort(); mutation.disconnect(); resizeObserver?.disconnect(); intersection?.disconnect(); media?.removeEventListener?.('change', settle);
    gpu?.dispose(); gpu = null;
    waves.clear();canvasWaveFilter?.dispose();waveSnapshot.width=waveSnapshot.height=1;
    canvas.remove(); if (oldTab === null) stage.removeAttribute('tabindex'); else stage.setAttribute('tabindex', oldTab);
    if (oldLabel === null) stage.removeAttribute('aria-label'); else stage.setAttribute('aria-label', oldLabel);
    if (previousDiagnostics === undefined) delete stage.__auroraDeepSky; else stage.__auroraDeepSky = previousDiagnostics;
    instances.delete(stage);
  }
  listen(win, 'pagehide', cleanup); instances.set(stage, cleanup); resize(); return cleanup;
}

if (typeof document !== 'undefined' && document.defaultView) prepareArtwork(document);
