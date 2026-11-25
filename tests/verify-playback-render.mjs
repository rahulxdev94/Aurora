import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {PALETTES} from '../src/aurora-palettes.mjs';

const fragment=await fs.readFile(new URL('../src/fragments/aurora-dyson-background.html',import.meta.url),'utf8');
function actualFunction(name,next){
  const start=fragment.indexOf(`  function ${name}(`);
  const end=fragment.indexOf(`\n  function ${next}(`,start);
  assert.ok(start>=0&&end>start,`Actual ${name} function is present`);
  return fragment.slice(start,end);
}
const functions=[['rotate','project'],['project','updateColours'],['sceneGeometry','positionCoreTarget'],['positionCoreTarget','canvasSize'],['drawPlaybackSphere','drawCore'],['drawCore','drawDyson'],['drawDyson','drawAtom'],['drawAtom','drawSphere'],['drawSphere','fullMotion'],['fullMotion','audioPeak'],['audioPeak','active'],['active','draw'],['draw','requestFrame'],['requestFrame','updateState']].map(pair=>actualFunction(...pair)).join('\n');
const stateStart=fragment.indexOf('  function updateState(');
const stateEnd=fragment.indexOf("\n  const excluded=",stateStart);
assert.ok(stateStart>=0&&stateEnd>stateStart);
const cleanupStart=fragment.indexOf('  function cleanup(){');
const cleanupEnd=fragment.indexOf('\n  resize();updateColours();updateState();',cleanupStart);
assert.ok(cleanupStart>=0&&cleanupEnd>cleanupStart);

function canvas(){
  const fills=[],strokes=[],rectangles=[];let path=[];
  const gradient=(kind,args)=>({kind,args,stops:[],addColorStop(...stop){this.stops.push(stop);}});
  return{fills,strokes,rectangles,reset(){fills.length=0;strokes.length=0;rectangles.length=0;},
    createRadialGradient(...args){return gradient('radial',args);},createLinearGradient(...args){return gradient('linear',args);},
    beginPath(){path=[];},arc(...args){path.push(['arc',...args]);},ellipse(...args){path.push(['ellipse',...args]);},moveTo(...args){path.push(['moveTo',...args]);},lineTo(...args){path.push(['lineTo',...args]);},
    fill(){fills.push({path:structuredClone(path),style:this.fillStyle});},stroke(){strokes.push({path:structuredClone(path),style:this.strokeStyle,width:this.lineWidth});},
    fillRect(...bounds){rectangles.push({bounds,style:this.fillStyle});},clearRect(){},setTransform(){},save(){},restore(){},clip(){},translate(){},rotate(){},closePath(){}
  };
}
function fixture({motion='full',osReduced=false,scene='atom',trackProjection=false}={}){
  const ctx=canvas(),events=[],root={dataset:{motion},isConnected:true,dispatchEvent:event=>{events.push(structuredClone({type:event.type,detail:event.detail}));}},win={},doc={hidden:false};
  const colours=new Map();root.style={getPropertyValue:name=>colours.get(name)||''};
  const target={style:{}},projections=[],timers=new Map();let now=100000,frameTime=0,rafRequests=0,timerSerial=0;
  win.setTimeout=(fn,delay)=>{const id=++timerSerial;timers.set(id,{fn,at:now+delay});return id;};win.clearTimeout=id=>timers.delete(id);
  function runTimers(){for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}
  const disconnected={disconnect(){}},abort={abort(){}};
  const context=vm.createContext({sctx:ctx,root,window:win,document:doc,coreButton:target,Date:{now:()=>now},Math,
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},abort,mutation:disconnected,focusObserver:disconnected,companionObserver:disconnected,resizeObserver:disconnected,intersection:disconnected,
    reducedMotion:{matches:osReduced},TAU:Math.PI*2,accent:[130,232,249],secondary:[163,147,246],
    heroWidth:620,heroHeight:300,bgWidth:1536,bgHeight:864,heroCentreX:600,heroCentreY:350,pointer:{x:0,y:0,targetX:0,targetY:0},yawOffset:.2,pitchOffset:-.2,
    energy:0,audioEnergy:0,playbackPhase:0,playbackPainted:false,focusEnergy:0,focusRunning:false,clock:.35,lastDraw:0,lastTime:0,raf:0,
    disposed:false,rootVisible:true,bgVisible:false,heroVisible:true,sceneType:scene,hint:null,ripples:[],panels:[],guides:[],satellites:[],
    coreLightLastAt:-Infinity,coreLightTimer:0,coreLightPending:null,coreLightState:null,
    clamp:(n,min,max)=>Math.min(max,Math.max(min,n)),rgba:(c,a)=>`rgba(${c[0]},${c[1]},${c[2]},${a})`,tone:original=>original,themeColour:original=>original,paletteActive:false,sceneTones:{},paletteVariables:[],colourKey:'',staticSceneDirty:false,workspace:'work',paintNebula(){},
    requestAnimationFrame:()=>++rafRequests,cancelAnimationFrame(){},updateColours(){},drawBackground(){},drawGuides(){},drawPanel(){}
  });
  vm.runInContext(functions+'\n'+fragment.slice(stateStart,stateEnd)+'\n'+fragment.slice(cleanupStart,cleanupEnd),context);
  if(trackProjection){const project=context.project;context.project=(point,...args)=>{const screen=project(point,...args);projections.push({point:{...point},screen:{...screen}});return screen;};}
  context.positionCoreTarget();const initialTarget={...target.style};
  function render(peak,frames=60){
    for(let i=0;i<frames;i++){
      frameTime+=40;now+=40;runTimers();win.__auroraPlaybackAudio={peak,at:now,status:peak>0?'active':'idle'};ctx.reset();context.draw(frameTime);
    }
    return nucleus();
  }
  function nucleus(){
    const shape=ctx.fills.find(fill=>fill.style?.stops?.length===5&&fill.style.stops[1][0]===.22&&fill.style.stops[2][0]===.58);
    assert.ok(shape,'Real drawCore produced its nucleus');
    assert.equal(shape.path.length,1,'Nucleus uses one circle, not stretched axes');
    const [type,x,y,r,start,end]=shape.path[0];
    assert.equal(type,'arc');assert.equal(start,0);assert.equal(end,Math.PI*2);
    return{x,y,r};
  }
  return{context,ctx,root,win,doc,target,initialTarget,render,nucleus,projections,events,timers,get rafRequests(){return rafRequests;},
    resizeScene(width,height){root.clientWidth=1536;root.clientHeight=864;root.getBoundingClientRect=()=>({left:0,top:0,width:1536,height:864});context.hero={clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({left:300,top:100,width,height})};context.bg={width:1,height:1,style:{}};context.sphere={width:1,height:1,style:{}};context.bctx={setTransform(){}};context.dpr=1;vm.runInContext(actualFunction('canvasSize','resize')+'\n'+actualFunction('resize','drawDistantAtoms'),context);context.resize();},
    palette(id,tokens){root.dataset.auroraPalette=id;for(const [name,value]of Object.entries(tokens))colours.set('--au-'+name,value);colours.set('--ah-accent',tokens.accent);vm.runInContext(actualFunction('updateColours','paintNebula'),context);return context.updateColours(true);},
    get now(){return now;},advance(ms){now+=ms;frameTime+=ms;runTimers();ctx.reset();context.draw(frameTime);},flushTimers(ms=50){now+=ms;frameTime+=ms;runTimers();},
    orbits(){return ctx.strokes.filter(stroke=>stroke.path.length>40&&stroke.path.every(command=>['moveTo','lineTo'].includes(command[0]))).map(stroke=>stroke.path);},
    haloAlpha(){const fill=ctx.fills.find(fill=>fill.style?.stops?.some(([,colour])=>colour.startsWith('rgba(255,235,178,')));assert.ok(fill);return Number(fill.style.stops[0][1].split(',').at(-1).slice(0,-1));}
  };
}

const paletteScene=fixture({motion:'reduced'}),paletteColours=new Set();let goldDrawing=null,goldGeometry=null;
for(const selected of PALETTES){
  assert.equal(paletteScene.palette(selected.id,selected.tokens),true);
  const shape=paletteScene.render(0,1);
  const nucleus=paletteScene.ctx.fills.find(fill=>fill.style?.stops?.length===5&&fill.style.stops[1][0]===.22);
  const beads=paletteScene.ctx.fills.filter(fill=>fill.style?.stops?.length===3&&fill.style.stops[1][0]===.4);
  assert.equal(beads.length,9,'Every palette retains nine electron beads');
  const colours=JSON.stringify(nucleus.style.stops);paletteColours.add(colours);
  if(selected.id==='gold'){goldGeometry=shape;goldDrawing=JSON.stringify({fills:paletteScene.ctx.fills,strokes:paletteScene.ctx.strokes});assert.equal(nucleus.style.stops[0][1],'#FFFDF1');}
  else{assert.deepEqual(shape,goldGeometry,'Palette switching cannot change the circular nucleus geometry');assert.notEqual(nucleus.style.stops[0][1],'#FFFDF1','Non-gold nuclei use coordinated colour');}
  assert.equal(paletteScene.context.updateColours(),false,'Unchanged palette/workspace values reuse cached scene colours');
}
assert.equal(paletteColours.size,5,'All five palettes render different nucleus colour schemes');
paletteScene.palette('gold',PALETTES[0].tokens);paletteScene.render(0,1);assert.equal(JSON.stringify({fills:paletteScene.ctx.fills,strokes:paletteScene.ctx.strokes}),goldDrawing,'Returning to Gold restores the exact original drawing');
for(const mode of ['full','off']){
  const fixed=fixture({motion:mode});fixed.root.dataset.paused='true';fixed.palette('arctic',PALETTES.find(p=>p.id==='arctic').tokens);
  fixed.context.audioEnergy=.8;fixed.context.playbackPhase=2;const clock=fixed.context.clock,requests=fixed.rafRequests;
  fixed.context.onPaletteChange();assert.ok(fixed.ctx.fills.length>0,'Palette changes paint the visible atom once even before its first paused frame');
  const shape=fixed.nucleus();assert.equal(fixed.ctx.fills.filter(fill=>fill.style?.stops?.length===3&&fill.style.stops[1][0]===.4).length,9);
  assert.equal(fixed.context.audioEnergy,0);assert.equal(fixed.context.playbackPhase,0);assert.equal(fixed.context.clock,clock);assert.equal(fixed.rafRequests,requests);assert.equal(fixed.context.raf,0);assert.equal(fixed.root.dataset.paused,'true');assert.equal(fixed.root.dataset.motion,mode);
  fixed.ctx.reset();fixed.context.onPaletteChange();assert.deepEqual(fixed.nucleus(),shape,'Repeated static colour paints retain nucleus geometry');
  fixed.ctx.reset();fixed.context.staticSceneDirty=true;fixed.context.paintStaticScene();assert.deepEqual(fixed.nucleus(),shape,'A cleared resized backing buffer is repainted synchronously while paused');assert.equal(fixed.context.staticSceneDirty,false);assert.equal(fixed.rafRequests,requests);
  fixed.ctx.reset();fixed.resizeScene(480,280);assert.equal(fixed.nucleus().x,240);assert.equal(fixed.context.sphere.width,480);assert.equal(fixed.context.staticSceneDirty,false);assert.equal(fixed.rafRequests,requests,'Actual resize path repaints immediately without relying on a blocked frame request');
  for(const gate of ['hidden','away','root']){
    fixed.ctx.reset();fixed.doc.hidden=gate==='hidden';fixed.root.dataset.notificationPresence=gate==='away'?'away':'home';fixed.context.rootVisible=gate!=='root';fixed.context.onPaletteChange();assert.equal(fixed.ctx.fills.length,0,'Static palette repaint respects '+gate+' visibility/ownership');
  }
}

const electrons=fixture({trackProjection:true});electrons.render(0,1);
const beads=electrons.ctx.fills.filter(fill=>fill.style?.stops?.[0]?.[1]==='#f1fcff');
assert.equal(beads.length,9,'The central atom draws nine visible electron beads');
// Three unchanged sampled orbit paths, nine bead projections, and the three
// existing main-electron trails. Added satellites must not introduce trails.
assert.equal(electrons.projections.length,420,'Extra electrons keep projection work bounded with no added trails');
const beadPoints=electrons.projections.slice(339,348);
for(const {screen} of beadPoints)assert.ok(beads.some(bead=>Math.abs(bead.path[0][1]-screen.x)<1e-9&&Math.abs(bead.path[0][2]-screen.y)<1e-9),'Each projected electron is actually painted');
for(let plane=0;plane<3;plane++){
  const points=beadPoints.slice(plane*3,plane*3+3).map(item=>item.point);
  for(const axis of ['x','y','z'])assert.ok(Math.abs(points.reduce((sum,point)=>sum+point[axis],0))<1e-9,'Three positions on each centred orbital ellipse remain evenly spaced at 120 degrees');
}
assert.equal(electrons.rafRequests,1,'Electron additions use the single existing frame loop');
const idle=fixture(),base=idle.render(0),veryQuiet=fixture(),faint=veryQuiet.render(.01),low=fixture(),soft=low.render(.1),ordinary=fixture(),speech=ordinary.render(.43),maximum=fixture(),loud=maximum.render(1);
assert.ok(faint.r-base.r>3.8,'A genuine one-percent playback peak must visibly move the nucleus edge');
assert.ok(soft.r-base.r>12.5&&soft.r-base.r<13.5,'Quiet PC playback visibly expands the nucleus without requiring a loud output');
assert.ok(speech.r-base.r>26&&speech.r-base.r<27.5,'Ordinary playback produces a substantially larger circular response');
assert.ok(loud.r/base.r<=2.5000001&&loud.r/base.r>2.499,'Maximum measured-audio expansion stays capped at 150%');
assert.ok(base.r<faint.r&&faint.r<soft.r&&soft.r<speech.r&&speech.r<loud.r,'The stronger perceptual response retains useful amplitude differences');
for(const shape of [faint,soft,speech,loud])assert.deepEqual({x:shape.x,y:shape.y},{x:base.x,y:base.y},'Playback keeps the centre fixed');
assert.deepEqual(ordinary.orbits(),idle.orbits(),'Measured playback never moves the orbital paths');
ordinary.context.positionCoreTarget();assert.deepEqual(ordinary.target.style,ordinary.initialTarget,'The actual click target is unchanged');
assert.ok(ordinary.haloAlpha()-idle.haloAlpha()>.3,'Ordinary measured playback produces a substantially brighter halo');
assert.equal(ordinary.ctx.strokes.length-idle.ctx.strokes.length,9,'Speech adds only three radial waves and six spherical surface curves');
assert.ok(ordinary.ctx.fills.length>idle.ctx.fills.length&&ordinary.ctx.fills.length-idle.ctx.fills.length<=6,'Speech adds a bounded set of surface light points');
const measuredPeak=.16656494,measured=fixture(),measuredShape=measured.render(measuredPeak);
const priorExcursion=base.r*.85*Math.pow(measuredPeak*1.55,.42);
assert.ok(measuredShape.r-base.r>priorExcursion*1.6&&measuredShape.r-base.r<priorExcursion*1.7,'A native-observed 0.166565 PC output peak moves the edge over 60% further than the previous response');
const syllables=fixture();syllables.render(0,1);
const attack=syllables.render(measuredPeak,2).r-base.r;
assert.ok(attack>(measuredShape.r-base.r)*.9&&attack<(measuredShape.r-base.r),'The nucleus follows a fresh syllable within 80ms without overshoot');
const released=syllables.render(0,3).r-base.r;
assert.ok(released>attack*.15&&released<attack*.3,'A 120ms pause releases most of the swell smoothly instead of holding a nearly fixed expansion');
const reattack=syllables.render(measuredPeak,2).r-base.r;
assert.ok(reattack>released*3&&reattack<measuredShape.r-base.r,'The next measured syllable produces another visible response without an artificial oscillator');
ordinary.ctx.reset();ordinary.context.drawPlaybackSphere(base.x,base.y,speech.r,67.2);
const spherePaths=structuredClone(ordinary.ctx.strokes.map(stroke=>stroke.path));
for(const stroke of ordinary.ctx.strokes.slice(0,3)){
  const [type,x,y,r]=stroke.path[0];assert.equal(type,'arc');assert.equal(x,base.x);assert.equal(y,base.y);
  assert.ok(r>speech.r&&r<67.2,'Waves stay circular and inside the atom orbits');
}
const phaseBefore=ordinary.context.playbackPhase;const softerSphere=ordinary.render(.15,10);
assert.ok(ordinary.context.playbackPhase>phaseBefore,'Fresh speech advances spherical surface motion');
ordinary.ctx.reset();ordinary.context.drawPlaybackSphere(base.x,base.y,softerSphere.r,67.2);
assert.notDeepEqual(ordinary.ctx.strokes.map(stroke=>stroke.path),spherePaths,'Speech changes the spherical artwork, beyond simple expansion');
const releasePhase=ordinary.context.playbackPhase;ordinary.render(0,1);
assert.equal(ordinary.context.playbackPhase,releasePhase,'Silent release fades the existing shape without an artificial oscillator');
assert.ok(ordinary.context.audioEnergy>0,'Release remains smooth rather than cutting off');
ordinary.render(0,60);assert.equal(ordinary.context.audioEnergy,0);assert.equal(ordinary.context.playbackPhase,0);
ordinary.ctx.reset();ordinary.context.drawCore(base.x,base.y,67.2,1);
idle.ctx.reset();idle.context.drawCore(base.x,base.y,67.2,1);
const drawing=ctx=>JSON.parse(JSON.stringify({fills:ctx.fills,strokes:ctx.strokes}));
assert.deepEqual(drawing(ordinary.ctx),drawing(idle.ctx),'After speech decays, idle artwork is exactly unchanged');
const wrap=fixture();wrap.context.audioEnergy=1;
function firstWaveAlpha(phase){wrap.context.playbackPhase=phase;wrap.ctx.reset();wrap.context.drawPlaybackSphere(base.x,base.y,base.r,67.2);return Number(wrap.ctx.strokes[0].style.split(',').at(-1).slice(0,-1));}
assert.equal(firstWaveAlpha(0),0);assert.ok(firstWaveAlpha(.5/.26)>.5,'Peak radial waves are over three times as visible as the previous 0.17-alpha waves');
assert.ok(wrap.ctx.strokes[0].width>=1.8,'The existing waves gain a clearly visible stroke without additional paths');
assert.ok(firstWaveAlpha(.0001/.26)<.000001&&firstWaveAlpha(.9999/.26)<.000001,'Waves fade smoothly at both ends of their radial cycle');
const surface=fixture();surface.context.playbackPhase=1.25;
function sphericalSurface(amount){surface.context.audioEnergy=amount;surface.ctx.reset();surface.context.drawPlaybackSphere(base.x,base.y,base.r,67.2);return structuredClone(surface.ctx.strokes.slice(3));}
const gentleSurface=sphericalSurface(.15),strongSurface=sphericalSurface(1);
assert.equal(strongSurface.length,6);assert.notDeepEqual(strongSurface.map(stroke=>stroke.path),gentleSurface.map(stroke=>stroke.path),'Measured amplitude deforms the spherical surface at a fixed playback phase');
assert.ok(strongSurface[0].width>gentleSurface[0].width*1.8,'Surface deformation remains clear inside the brighter nucleus');
const overshoot=fixture();assert.ok(overshoot.render(2).r/base.r<=2.5000001,'Out-of-range finite input cannot exceed the visual cap');
overshoot.context.energy=1;overshoot.ctx.reset();overshoot.context.drawCore(base.x,base.y,67.2,1);
const combinedRadius=overshoot.nucleus().r;
assert.ok(combinedRadius*1.12<67.2*.97,'Even maximum playback plus the existing click pulse leaves circular waves inside the bounded orbit region');
for(const options of [{motion:'reduced'},{osReduced:true}]){
  const quiet=fixture(options),talking=fixture(options);
  assert.equal(talking.render(.43).r,quiet.render(0).r,'Reduced motion never expands the nucleus');
  assert.ok(talking.haloAlpha()>quiet.haloAlpha(),'Reduced motion retains glow feedback');
  assert.equal(talking.ctx.strokes.length,quiet.ctx.strokes.length,'Reduced motion adds no moving spherical paths');
  assert.equal(talking.context.playbackPhase,0);
}
const off=fixture({motion:'off'});assert.equal(off.render(.43).r,base.r);assert.equal(off.context.audioEnergy,0);
assert.equal(off.context.audioPeak(),null,'Motion off rejects the playback signal');
for(const invalid of [null,{peak:NaN,at:ordinary.now,status:'active'},{peak:.4,at:NaN,status:'active'},{peak:.4,at:ordinary.now-2001,status:'active'},{peak:.4,at:ordinary.now+1001,status:'active'},{peak:.4,at:ordinary.now,status:'unavailable'}]){
  ordinary.win.__auroraPlaybackAudio=invalid;assert.equal(ordinary.context.audioPeak(),null,'Invalid, unavailable or stale playback is rejected');
}
ordinary.win.__auroraPlaybackAudio={peak:.43,at:ordinary.now,status:'active'};
ordinary.render(.43,10);ordinary.ctx.reset();ordinary.root.dataset.paused='true';ordinary.context.updateState();assert.equal(ordinary.context.audioPeak(),null);assert.equal(ordinary.context.audioEnergy,0,'Pause immediately clears stored motion');
assert.equal(ordinary.nucleus().r,base.r,'Pause redraws once to remove the last speech expansion');assert.equal(ordinary.context.playbackPhase,0);
const pausedDraws={fills:ordinary.ctx.fills.length,strokes:ordinary.ctx.strokes.length};
for(let i=0;i<12;i++)ordinary.context.updateState();
assert.deepEqual({fills:ordinary.ctx.fills.length,strokes:ordinary.ctx.strokes.length},pausedDraws,'Repeated root style changes while paused must not redraw the already cleared atom');
assert.equal(ordinary.context.raf,0,'Pause clear never schedules a continuing render loop');
ordinary.ctx.reset();ordinary.advance(40);assert.equal(ordinary.ctx.fills.length,0,'Pause produces no drawing loop');
for(const gate of ['document','root','hero']){
  const hidden=fixture();hidden.render(.43);hidden.ctx.reset();
  if(gate==='document')hidden.doc.hidden=true;else hidden.context[gate==='root'?'rootVisible':'heroVisible']=false;
  hidden.context.updateState();assert.equal(hidden.context.audioEnergy,0,'Hidden renderers immediately clear measured energy');assert.equal(hidden.context.playbackPhase,0);assert.equal(hidden.context.raf,0);
  const requests=hidden.rafRequests;hidden.context.requestFrame();assert.equal(hidden.rafRequests,requests,'Hidden renderers do not restart the frame loop');hidden.advance(40);assert.equal(hidden.ctx.fills.length,0);
}
const release=fixture();release.render(.43);release.advance(2100);assert.equal(release.context.audioPeak(),null);
for(let i=0;i<60;i++)release.advance(40);
assert.equal(release.context.audioEnergy,0,'Stale playback fully releases to idle');assert.equal(release.nucleus().r,base.r);
const dysonIdle=fixture({scene:'dyson'}),dysonVoice=fixture({scene:'dyson'});
assert.ok(dysonVoice.render(.43).r-dysonIdle.render(0).r>4,'Dyson uses the same responsive circular core');
assert.equal(idle.context.audioEnergy,0,'Silence has no artificial voice oscillator');

const sunlight=fixture(),sunShape=sunlight.render(0,1);
const solarSurface=sunlight.ctx.fills.find(fill=>fill.style?.stops?.some(([,colour])=>colour==='#FFFDF1'));
const limb=solarSurface.style.stops.at(-1)[1],rgb=[1,3,5].map(index=>parseInt(limb.slice(index,index+2),16));
assert.ok(rgb[0]>140&&rgb[0]>rgb[1]&&rgb[1]>rgb[2]*2,'The painted limb emits warm amber instead of ending in a nearly black ball');
const corona=sunlight.ctx.fills.find(fill=>fill.style?.stops?.some(([,colour])=>colour.startsWith('rgba(255,235,178,')));
assert.ok(corona.path[0][3]>sunShape.r*3.25&&corona.path[0][3]<sunShape.r*3.4,'The actual corona is substantially broader while remaining bounded');
const solarRays=sunlight.ctx.strokes.filter(stroke=>stroke.path.length===40&&stroke.path.every(command=>['moveTo','lineTo'].includes(command[0])));
assert.equal(solarRays.length,1,'Twenty fine coronal rays share a single bounded canvas path');
for(const command of solarRays[0].path){const distance=Math.hypot(command[1]-sunShape.x,command[2]-sunShape.y);assert.ok(distance>=sunShape.r&&distance<=sunShape.r*1.5,'Coronal rays remain close to the emitting surface');}
assert.equal(sunlight.ctx.rectangles.length,2,'The wider light reuses the existing foreground ambient and bloom rectangles');

const positioned=fixture(),firstPaint=positioned.render(0,1);
let light=positioned.events.at(-1).detail;
assert.deepEqual(Object.keys(light).sort(),['at','intensity','radius','source','visible','x','y']);
assert.equal(positioned.events.at(-1).type,'aurora:core-light');assert.equal(light.source,'core');assert.equal(light.visible,true);assert.equal(light.at,positioned.now);
assert.ok(Math.abs(light.x*1536-(600+firstPaint.x-310))<1e-8&&Math.abs(light.y*864-(350+firstPaint.y-128))<1e-8,'Published root coordinates come from the actual painted nucleus');
assert.equal(light.radius,firstPaint.r,'Light radius is the actual nucleus radius in logical CSS pixels');
positioned.context.pointer.targetX=1;positioned.context.pointer.targetY=-1;
const parallaxPaint=positioned.render(0,8);positioned.flushTimers();light=positioned.events.at(-1).detail;
assert.ok(parallaxPaint.x>firstPaint.x&&parallaxPaint.y<firstPaint.y,'The real existing pointer parallax moves the rendered emitter');
assert.ok(Math.abs(light.x*1536-(600+parallaxPaint.x-310))<1e-8&&Math.abs(light.y*864-(350+parallaxPaint.y-128))<1e-8,'The light follows measured parallax without an invented trajectory');
assert.equal(light.radius,parallaxPaint.r);
const idleIntensity=light.intensity,talkingPaint=positioned.render(.43,20);positioned.flushTimers();light=positioned.events.at(-1).detail;
assert.ok(light.intensity>idleIntensity&&light.intensity<=1);assert.equal(light.radius,talkingPaint.r,'Measured audio updates the actual emitting radius and bounded intensity');
for(let i=1;i<positioned.events.length;i++)assert.ok(positioned.events[i].detail.at-positioned.events[i-1].detail.at>=50,'Core light publication never exceeds twenty events per second');
for(const event of positioned.events){assert.ok(event.detail.x>=0&&event.detail.x<=1&&event.detail.y>=0&&event.detail.y<=1&&event.detail.intensity>=0&&event.detail.intensity<=1);assert.ok(Object.values(event.detail).every(value=>!Array.isArray(value)),'The event carries only bounded light metadata, never audio samples');}
assert.ok(positioned.timers.size<=1,'Publication coalesces into at most one pending timer');

const staticLight=fixture({motion:'off'});staticLight.render(0,1);const staticGeometry={...staticLight.events.at(-1).detail};
staticLight.ctx.reset();staticLight.root.dataset.notificationPresence='away';staticLight.context.updateState();staticLight.flushTimers();assert.equal(staticLight.events.at(-1).detail.visible,false,'A static Off-mode source yields light ownership when its atom is away');
delete staticLight.root.dataset.notificationPresence;staticLight.context.updateState();staticLight.flushTimers();light=staticLight.events.at(-1).detail;
assert.equal(light.visible,true,'Returning from a notification republishes the visible source even with motion Off');
assert.deepEqual({x:light.x,y:light.y,radius:light.radius},{x:staticGeometry.x,y:staticGeometry.y,radius:staticGeometry.radius});assert.equal(staticLight.ctx.fills.length,0,'Static ownership publication does not redraw or invent movement');
const beforeRequest=staticLight.events.length;staticLight.context.publishCoreVisibility(true);staticLight.flushTimers();assert.equal(staticLight.events.length,beforeRequest+1,'A late light listener can request the last actual static geometry');
staticLight.doc.hidden=true;staticLight.context.updateState();staticLight.flushTimers();assert.equal(staticLight.events.at(-1).detail.visible,false,'Hidden desktops explicitly withdraw the source');
const disposal=fixture();disposal.render(0,2);assert.equal(disposal.timers.size,1);const beforeDisposal=disposal.events.length;disposal.context.cleanup();assert.equal(disposal.timers.size,0);disposal.flushTimers(100);assert.equal(disposal.events.length,beforeDisposal,'Disposal cancels the pending publisher and produces no late light events');
console.log('Actual Sun atom: over 60% larger response at the observed PC audio peak, syllable attack/release, 150% cap, warm emitting limb, bounded halo and corona, exact light coordinates, <=20Hz metadata-only coalescing, unchanged nine electrons/projection budget/orbits/target, reduced/off/pause/hidden/stale and Dyson checks passed.');
