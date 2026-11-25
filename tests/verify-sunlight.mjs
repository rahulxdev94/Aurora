import assert from 'node:assert/strict';
import {normaliseCoreLightSample,calculateSunlight,initAuroraSunlight,SUNLIGHT_EVENT,SUNLIGHT_REQUEST_EVENT,SUNLIGHT_STALE_MS} from '../src/aurora-sunlight.mjs';

const timestamp=10000,sample={source:'core',visible:true,x:.5,y:.25,radius:90,intensity:.9,at:timestamp};
assert.equal(normaliseCoreLightSample(sample,{now:timestamp}).source,'core');
for(const bad of [{...sample,x:NaN},{...sample,y:1.1},{...sample,radius:Infinity},{...sample,radius:0},{...sample,intensity:-1},{...sample,source:'voice'},{...sample,at:timestamp-SUNLIGHT_STALE_MS-1},{...sample,at:timestamp+1001}])assert.equal(normaliseCoreLightSample(bad,{now:timestamp}),null);
assert.equal(normaliseCoreLightSample({source:'notification',visible:false,at:timestamp},{now:timestamp}).visible,false);
const host={left:100,top:50,width:1000,height:800},surface={left:500,top:450,width:200,height:100};
const above=calculateSunlight(sample,host,surface);assert.equal(above.x,100);assert.equal(above.y,-200);assert.ok(above.shadowY>0);assert.ok(above.rimTop>above.rimBottom);
const left=calculateSunlight({...sample,x:0,y:.5625},host,surface);assert.ok(left.shadowX>0);assert.ok(left.rimLeft>left.rimRight);
const right=calculateSunlight({...sample,x:1,y:.5625},host,surface);assert.ok(right.shadowX<0);assert.ok(right.rimRight>right.rimLeft);
assert.ok(calculateSunlight({...sample,x:.5,y:.5625},host,surface).strength>calculateSunlight({...sample,x:0,y:0},host,surface).strength,'Light falls off with distance from a surface');
for(const value of Object.values(above))assert.ok(Number.isFinite(value));
for(const key of ['strength','rimTop','rimRight','rimBottom','rimLeft'])assert.ok(above[key]>=0&&above[key]<=1);
assert.equal(calculateSunlight({...sample,visible:false},host,surface).strength,0);assert.equal(calculateSunlight(sample,{...host,width:0},surface).shadowY,16,'Unavailable light preserves ambient raised shadows');

class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  dispatchEvent(event){for(const fn of [...this.listeners.get(event.type)||[]])fn(event);return true;}
  listenerCount(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
class Style{
  constructor(){this.values=new Map();this.writes=0;}
  getPropertyValue(name){return this.values.get(name)?.value||'';}
  getPropertyPriority(name){return this.values.get(name)?.priority||'';}
  setProperty(name,value,priority=''){this.values.set(name,{value,priority});this.writes++;}
  removeProperty(name){this.values.delete(name);this.writes++;}
}
class Surface extends Events{
  constructor(bounds){super();this.bounds=bounds;this.style=new Style();this.reads=0;this.nodeType=1;}
  getBoundingClientRect(){this.reads++;return this.bounds;}
  matches(){return true;}
  querySelector(){return null;}
}
function harness(motion='full'){
  let clock=timestamp,nextId=1;const timers=new Map(),mutations=[],resizes=[];
  const win=new Events(),doc=new Events(),root=new Surface({left:0,top:0,width:1000,height:800}),first=new Surface({left:200,top:300,width:200,height:100});
  root.dataset={motion};root.targets=[first];root.querySelectorAll=()=>root.targets;
  root.ownerDocument=doc;doc.defaultView=win;doc.hidden=false;
  win.CustomEvent=class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}};
  win.setTimeout=(fn,delay)=>{const id=nextId++;timers.set(id,{fn,at:clock+Math.max(0,delay)});return id;};win.clearTimeout=id=>timers.delete(id);
  const advance=ms=>{const end=clock+ms;let iterations=0;while(true){const next=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++iterations>1000)throw Error('Unexpected perpetual sunlight loop');clock=next[1].at;timers.delete(next[0]);next[1].fn();}clock=end;};
  win.MutationObserver=class{constructor(callback){this.callback=callback;this.closed=false;mutations.push(this);}observe(target,options){this.options=options;}disconnect(){this.closed=true;}};
  win.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=new Set();this.closed=false;resizes.push(this);}observe(target){this.targets.add(target);}unobserve(target){this.targets.delete(target);}disconnect(){this.closed=true;this.targets.clear();}};
  const media=new Events();media.matches=false;win.matchMedia=()=>media;
  const send=(data={})=>root.dispatchEvent(new win.CustomEvent(SUNLIGHT_EVENT,{detail:{...sample,at:clock,...data}}));
  const state=()=>mutations.find(observer=>observer.options?.attributeFilter?.includes('data-motion')).callback([]);
  const structure=changes=>mutations.find(observer=>observer.options?.childList).callback(changes);
  return{win,doc,root,first,send,state,structure,advance,timers,mutations,resizes,now:()=>clock};
}
const h=harness();h.first.style.setProperty('--aurora-sun-strength','.25','important');
let requests=0;h.root.addEventListener(SUNLIGHT_REQUEST_EVENT,()=>requests++);
const dispose=initAuroraSunlight({root:h.root,now:h.now});assert.equal(initAuroraSunlight({root:h.root,now:h.now}),dispose,'Repeated initialisation shares one engine');assert.equal(requests,1);assert.equal(h.root.reads,0,'No invented initial light or layout loop');
h.send();h.advance(0);assert.ok(Number(h.first.style.getPropertyValue('--aurora-sun-strength'))>0);assert.equal(h.root.reads,1);
for(let i=0;i<20;i++){h.advance(20);h.send({x:.2+i*.02});}h.advance(100);assert.ok(h.root.reads<=6,'Twenty-Hz input must sample layout at most ten Hz');
const beforeInvalid=h.first.style.writes;h.send({x:Infinity});h.advance(0);assert.equal(h.first.style.writes,beforeInvalid);
h.root.dataset.notificationPresence='away';h.state();assert.equal(h.first.style.getPropertyValue('--aurora-sun-strength'),'0');
h.send({source:'notification',x:.9});h.advance(100);const carried=h.first.style.getPropertyValue('--aurora-sun-x');h.send({source:'core',x:.1});h.advance(100);assert.equal(h.first.style.getPropertyValue('--aurora-sun-x'),carried,'Hidden core samples cannot move the carried light');
h.root.dataset.notificationPresence=undefined;h.state();assert.equal(h.first.style.getPropertyValue('--aurora-sun-x'),'-100px','Return immediately restores the latest cached actual core');
h.advance(SUNLIGHT_STALE_MS+1);assert.equal(h.first.style.getPropertyValue('--aurora-sun-strength'),'0');assert.equal(h.first.style.getPropertyValue('--aurora-shadow-x'),'10px');assert.equal(h.timers.size,0,'An expired source leaves no running loop');
h.root.dataset.motion='off';h.state();assert.equal(h.first.style.getPropertyValue('--aurora-sun-strength'),'0','Switching to Off must not resurrect an expired dynamic sample');h.send({x:.4});h.advance(0);const staticX=h.first.style.getPropertyValue('--aurora-sun-x'),staticReads=h.root.reads;
for(let i=0;i<20;i++){h.advance(100);h.send({x:.4});}assert.equal(h.first.style.getPropertyValue('--aurora-sun-x'),staticX);assert.equal(h.root.reads,staticReads);assert.equal(h.timers.size,0,'Timestamp-only Off samples keep static lighting without timers');
h.root.dataset.notificationPresence='away';h.state();h.send({source:'core',visible:false});h.send({source:'notification',x:.95});h.advance(100);h.advance(SUNLIGHT_STALE_MS+1);h.root.dataset.notificationPresence=undefined;h.state();assert.ok(Number(h.first.style.getPropertyValue('--aurora-sun-strength'))>0,'Static Off core survives a hand-off without a continuous heartbeat');
const added=new Surface({left:600,top:400,width:300,height:300});h.root.targets.push(added);h.structure([{type:'childList',addedNodes:[added],removedNodes:[]}]);h.advance(100);assert.ok(added.style.getPropertyValue('--aurora-sun-strength'));assert.ok(h.resizes[0].targets.has(added));
h.root.targets.pop();h.structure([{type:'childList',addedNodes:[],removedNodes:[added]}]);h.advance(100);assert.equal(added.style.getPropertyValue('--aurora-sun-strength'),'');assert.ok(!h.resizes[0].targets.has(added));
h.doc.hidden=true;h.doc.dispatchEvent({type:'visibilitychange'});const hiddenReads=h.root.reads;h.send({x:.5});h.advance(10000);assert.equal(h.root.reads,hiddenReads);assert.equal(h.timers.size,0);assert.equal(h.first.style.getPropertyValue('--aurora-sun-strength'),'0');
h.doc.hidden=false;h.doc.dispatchEvent({type:'visibilitychange'});h.send({x:.5});h.advance(100);assert.ok(Number(h.first.style.getPropertyValue('--aurora-sun-strength'))>0);
h.root.dataset.paused='true';h.state();const pausedReads=h.root.reads;for(let i=0;i<10;i++){h.send({x:.5});h.advance(100);}assert.equal(h.root.reads,pausedReads);assert.equal(h.timers.size,0);
dispose();assert.equal(h.first.style.getPropertyValue('--aurora-sun-strength'),'.25');assert.equal(h.first.style.getPropertyPriority('--aurora-sun-strength'),'important');assert.ok(h.mutations.every(observer=>observer.closed));assert.ok(h.resizes.every(observer=>observer.closed));assert.equal(h.timers.size,0);assert.equal(h.doc.listenerCount(),0);assert.equal(h.win.listenerCount(),0);const finalWrites=h.first.style.writes;h.send();h.advance(10000);assert.equal(h.first.style.writes,finalWrites);
const resized=harness('off'),stopResized=initAuroraSunlight({root:resized.root,now:resized.now});
resized.send({x:.4,y:.25,radius:90});resized.advance(200);
// The request first republishes the renderer's pre-resize cache, then the real draw arrives later.
resized.root.addEventListener(SUNLIGHT_REQUEST_EVENT,()=>resized.send({x:.4,y:.25,radius:90}));
resized.root.bounds={left:0,top:0,width:3840,height:2160};resized.first.bounds={left:1600,top:900,width:600,height:400};
resized.resizes[0].callback([]);resized.advance(0);assert.equal(resized.first.style.getPropertyValue('--aurora-sun-x'),'-64px');
resized.advance(50);resized.send({x:.5,y:.3,radius:140});resized.advance(50);
assert.equal(resized.first.style.getPropertyValue('--aurora-sun-x'),'320px','A fresh real draw after the stale resize flush must update the static position');
assert.equal(resized.first.style.getPropertyValue('--aurora-sun-y'),'-252px');
const beforeRadius=Number(resized.first.style.getPropertyValue('--aurora-sun-strength'));
resized.advance(100);resized.send({x:.5,y:.3,radius:220});resized.advance(0);
assert.ok(Number(resized.first.style.getPropertyValue('--aurora-sun-strength'))>beforeRadius,'Radius-only real geometry changes must update static attenuation too');
resized.advance(100);resized.send({x:.5,y:.3,radius:220,intensity:.5});resized.advance(0);
assert.ok(Number(resized.first.style.getPropertyValue('--aurora-sun-strength'))<beforeRadius,'A real intensity change is not a timestamp-only heartbeat');
const settledReads=resized.root.reads,settledWrites=resized.first.style.writes;
for(let i=0;i<20;i++){resized.advance(100);resized.send({x:.5,y:.3,radius:220,intensity:.5});}
assert.equal(resized.root.reads,settledReads);assert.equal(resized.first.style.writes,settledWrites);assert.equal(resized.timers.size,0,'A corrected Off sample returns to idle after one update');stopResized();
console.log('Sunlight: real-position validation, local geometry, directional rims/shadows, distance falloff, ten-Hz layout sampling, source hand-off, static Off/paused, freshness, hidden/idle suspension and resource cleanup passed.');
