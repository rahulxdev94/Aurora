import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const fragment=await fs.readFile(new URL('../src/fragments/aurora-dyson-background.html',import.meta.url),'utf8');
function actualFunction(name,next){
  const start=fragment.indexOf(`  function ${name}(`);
  const end=fragment.indexOf(`\n  function ${next}(`,start);
  assert.ok(start>=0&&end>start,`Actual ${name} function is present`);
  return fragment.slice(start,end);
}
const functions=[['rotate','project'],['project','updateColours'],['positionCoreTarget','canvasSize'],['drawPlaybackSphere','drawCore'],['drawCore','drawDyson'],['drawDyson','drawAtom'],['drawAtom','drawSphere'],['drawSphere','fullMotion'],['fullMotion','audioPeak'],['audioPeak','active'],['active','draw'],['draw','requestFrame'],['requestFrame','updateState']].map(pair=>actualFunction(...pair)).join('\n');
const stateStart=fragment.indexOf('  function updateState(');
const stateEnd=fragment.indexOf("\n  const excluded=",stateStart);
assert.ok(stateStart>=0&&stateEnd>stateStart);

function canvas(){
  const fills=[],strokes=[];let path=[];
  const gradient=(kind,args)=>({kind,args,stops:[],addColorStop(...stop){this.stops.push(stop);}});
  return{fills,strokes,reset(){fills.length=0;strokes.length=0;},
    createRadialGradient(...args){return gradient('radial',args);},createLinearGradient(...args){return gradient('linear',args);},
    beginPath(){path=[];},arc(...args){path.push(['arc',...args]);},ellipse(...args){path.push(['ellipse',...args]);},moveTo(...args){path.push(['moveTo',...args]);},lineTo(...args){path.push(['lineTo',...args]);},
    fill(){fills.push({path:structuredClone(path),style:this.fillStyle});},stroke(){strokes.push({path:structuredClone(path),style:this.strokeStyle,width:this.lineWidth});},
    fillRect(){},clearRect(){},save(){},restore(){},clip(){},translate(){},rotate(){},closePath(){}
  };
}
function fixture({motion='full',osReduced=false,scene='atom'}={}){
  const ctx=canvas(),root={dataset:{motion},isConnected:true},win={},doc={hidden:false};
  const target={style:{}};let now=100000,frameTime=0;
  const context=vm.createContext({sctx:ctx,root,window:win,document:doc,coreButton:target,Date:{now:()=>now},Math,
    reducedMotion:{matches:osReduced},TAU:Math.PI*2,accent:[130,232,249],secondary:[163,147,246],
    heroWidth:620,heroHeight:300,pointer:{x:0,y:0,targetX:0,targetY:0},yawOffset:.2,pitchOffset:-.2,
    energy:0,audioEnergy:0,playbackPhase:0,playbackPainted:false,focusEnergy:0,focusRunning:false,clock:.35,lastDraw:0,lastTime:0,raf:0,
    disposed:false,rootVisible:true,bgVisible:false,heroVisible:true,sceneType:scene,hint:null,ripples:[],panels:[],guides:[],satellites:[],
    clamp:(n,min,max)=>Math.min(max,Math.max(min,n)),rgba:(c,a)=>`rgba(${c[0]},${c[1]},${c[2]},${a})`,
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},updateColours(){},drawBackground(){},drawGuides(){},drawPanel(){},cleanup(){throw new Error('Unexpected disposal');}
  });
  vm.runInContext(functions+'\n'+fragment.slice(stateStart,stateEnd),context);
  context.positionCoreTarget();const initialTarget={...target.style};
  function render(peak,frames=60){
    for(let i=0;i<frames;i++){
      frameTime+=40;now+=40;win.__auroraPlaybackAudio={peak,at:now,status:peak>0?'active':'idle'};ctx.reset();context.draw(frameTime);
    }
    return nucleus();
  }
  function nucleus(){
    const shape=ctx.fills.find(fill=>fill.style?.stops?.some(([,colour])=>colour==='#fffce9'));
    assert.ok(shape,'Real drawCore produced its nucleus');
    assert.equal(shape.path.length,1,'Nucleus uses one circle, not stretched axes');
    const [type,x,y,r,start,end]=shape.path[0];
    assert.equal(type,'arc');assert.equal(start,0);assert.equal(end,Math.PI*2);
    return{x,y,r};
  }
  return{context,ctx,root,win,doc,target,initialTarget,render,nucleus,
    get now(){return now;},advance(ms){now+=ms;frameTime+=ms;ctx.reset();context.draw(frameTime);},
    orbits(){return ctx.strokes.filter(stroke=>stroke.path.length>3&&stroke.path.every(command=>['moveTo','lineTo'].includes(command[0]))).map(stroke=>stroke.path);},
    haloAlpha(){const fill=ctx.fills.find(fill=>fill.style?.stops?.some(([,colour])=>colour.startsWith('rgba(255,235,178,')));assert.ok(fill);return Number(fill.style.stops[0][1].split(',').at(-1).slice(0,-1));}
  };
}

const idle=fixture(),base=idle.render(0),low=fixture(),soft=low.render(.1),ordinary=fixture(),speech=ordinary.render(.43),maximum=fixture(),loud=maximum.render(1);
assert.ok(soft.r-base.r>3,'Quiet speech must move the visible edge by more than three logical pixels');
assert.ok(speech.r-base.r>7&&speech.r-base.r<8,'Ordinary speech must visibly expand the small nucleus');
assert.ok(loud.r/base.r<=1.4000001&&loud.r/base.r>1.399,'Maximum audio expansion stays capped at 40%');
for(const shape of [soft,speech,loud])assert.deepEqual({x:shape.x,y:shape.y},{x:base.x,y:base.y},'Playback keeps the centre fixed');
assert.deepEqual(ordinary.orbits(),idle.orbits(),'Measured playback never moves the orbital paths');
ordinary.context.positionCoreTarget();assert.deepEqual(ordinary.target.style,ordinary.initialTarget,'The actual click target is unchanged');
assert.ok(ordinary.haloAlpha()>idle.haloAlpha(),'Existing halo brightness follows playback');
assert.equal(ordinary.ctx.strokes.length-idle.ctx.strokes.length,9,'Speech adds only three radial waves and six spherical surface curves');
assert.ok(ordinary.ctx.fills.length>idle.ctx.fills.length&&ordinary.ctx.fills.length-idle.ctx.fills.length<=6,'Speech adds a bounded set of surface light points');
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
assert.equal(firstWaveAlpha(0),0);assert.ok(firstWaveAlpha(.5/.22)>.15);
assert.ok(firstWaveAlpha(.0001/.22)<.000001&&firstWaveAlpha(.9999/.22)<.000001,'Waves fade smoothly at both ends of their radial cycle');
const overshoot=fixture();assert.ok(overshoot.render(2).r/base.r<=1.4000001,'Out-of-range finite input cannot exceed the visual cap');
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
const release=fixture();release.render(.43);release.advance(2100);assert.equal(release.context.audioPeak(),null);
for(let i=0;i<60;i++)release.advance(40);
assert.equal(release.context.audioEnergy,0,'Stale playback fully releases to idle');assert.equal(release.nucleus().r,base.r);
const dysonIdle=fixture({scene:'dyson'}),dysonVoice=fixture({scene:'dyson'});
assert.ok(dysonVoice.render(.43).r-dysonIdle.render(0).r>4,'Dyson uses the same responsive circular core');
assert.equal(idle.context.audioEnergy,0,'Silence has no artificial voice oscillator');
console.log('Actual atom renderer: bounded spherical speech curves, light points and radial waves, measured-phase gating and exact idle recovery, visible capped nucleus, fixed orbits/target, reduced glow, off/pause/stale rejection and Dyson path passed.');
