import assert from 'node:assert/strict';
import {initAtomStatus,atomStatusPlacement} from '../src/aurora-atom-status.mjs';

const intersections=(a,b)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+(a.height||a.maxHeight),b.top+b.height)-Math.max(a.top,b.top));
const coreBox={left:242,top:80,width:136,height:136};
const obstacles=[{left:45,top:60,width:80,height:35},{left:495,top:39,width:90,height:35},{left:480,top:174,width:90,height:35},{left:220,top:274,width:180,height:25}];
const placed=atomStatusPlacement({width:620,height:300,core:coreBox,obstacles});
assert.equal(intersections(placed,coreBox),0,'Bubble does not cover atom when side space is available');
assert.ok(obstacles.every(box=>intersections(placed,box)===0),'Bubble avoids satellite buttons and caption');
for(const [width,height] of [[320,230],[620,300],[1100,600],[160,140]]){
  const p=atomStatusPlacement({width,height});assert.ok(p.left>=0&&p.top>=0&&p.left+p.width<=width&&p.top+p.maxHeight<=height,'Placement fits the central stage');
}

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){event.stopPropagation??=()=>{};for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((total,set)=>total+set.size,0);}
}
class Element extends Events{
  constructor(tag='div'){
    super();this.tag=tag;this.children=[];this.dataset={};this.attrs=new Map();this.className='';this._text='';this.textWrites=0;this.isConnected=true;this.hidden=false;this.disabled=false;
    this.style={values:new Map(),setProperty:(name,value)=>this.style.values.set(name,value)};
    this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.classList.contains(name))this.className+=' '+name;}};
    this.box={left:0,top:0,width:100,height:30};
  }
  set textContent(value){this._text=String(value);this.textWrites++;}
  get textContent(){return this._text;}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name);}
  append(...nodes){for(const node of nodes){node.parent=this;node.ownerDocument=this.ownerDocument;this.children.push(node);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.isConnected=false;}
  contains(target){return this===target||this.children.some(node=>node.contains(target));}
  matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector==='[data-live-weather-refresh]')return this.dataset.liveWeatherRefresh!==undefined;return this.tag===selector;}
  querySelectorAll(selector){const selectors=selector.split(',');return this.children.flatMap(node=>[...(selectors.some(s=>node.matches(s))?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getBoundingClientRect(){return this.hidden?{left:0,top:0,width:0,height:0}:this.box;}
  getClientRects(){return this.hidden?[]:[this.box];}
  focus(){this.ownerDocument.activeElement=this;this.fire('focus');}
}
const doc=new Events(),win=new Events(),root=new Element('main');
root.ownerDocument=doc;doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>{const el=new Element(tag);el.ownerDocument=doc;return el;};
const stage=doc.createElement('section');stage.className='ah-core-stage';stage.box={left:300,top:200,width:620,height:300};root.append(stage);
const core=doc.createElement('button');core.className='ah-companion';core.box={left:542,top:280,width:136,height:136};stage.append(core);
const focus=doc.createElement('span');focus.className='ah-timer-label';focus.textContent='Ready';root.append(focus);
const toast=doc.createElement('div');toast.className='ah-toast';root.append(toast);
const weather=doc.createElement('section');weather.className='ah-weather';root.append(weather);
const status=doc.createElement('p');status.className='ah-live-weather-status';status.textContent='Weather disabled';weather.append(status);
const refresh=doc.createElement('button');refresh.dataset.liveWeatherRefresh='true';weather.append(refresh);
const observers=[],frames=new Map(),timers=new Map();let sequence=0,time=1000000;
win.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};win.cancelAnimationFrame=id=>frames.delete(id);
win.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}};
win.ResizeObserver=class{constructor(fn){this.fn=fn;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.disconnected=true;}};
const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout,oldNow=Date.now;
globalThis.setTimeout=(fn,delay)=>{timers.set(++sequence,{fn,at:time+delay});return sequence;};globalThis.clearTimeout=id=>timers.delete(id);Date.now=()=>time;
const flush=()=>{for(const [id,fn] of [...frames]){frames.delete(id);fn();}};
const advance=ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}flush();};
const mutate=target=>{for(const observer of observers)if(observer.target===target&&!observer.disconnected)observer.fn();flush();};
try{
  const cleanup=initAtomStatus({root});assert.equal(initAtomStatus({root}),cleanup,'Initialisation is idempotent');
  const bubble=stage.querySelector('.aas-bubble'),toggle=stage.querySelector('.aas-toggle'),message=bubble.querySelector('.aas-message'),dismiss=bubble.querySelector('.aas-dismiss');
  bubble.box={left:310,top:350,width:224,height:76};
  advance(900);assert.equal(message.textContent,'Your space is ready.');assert.equal(bubble.hidden,false);assert.equal(toggle.hidden,true);assert.equal(message.getAttribute('aria-live'),'polite');
  advance(7000);assert.equal(bubble.hidden,true);assert.equal(toggle.hidden,false);assert.equal(timers.size,0,'No idle polling or repeating timer');
  refresh.disabled=true;mutate(refresh);assert.equal(bubble.hidden,true,'A disabled weather integration is not reported as refreshing');refresh.disabled=false;mutate(refresh);
  toggle.fire('click');flush();assert.equal(bubble.hidden,false);
  dismiss.fire('click');assert.equal(bubble.hidden,true);assert.equal(doc.activeElement,toggle);core.fire('pointerenter');assert.equal(bubble.hidden,true,'Dismiss is respected while moving over the atom');
  root.fire('aurora:activity',{detail:{message:'Opening <img src=x onerror=run()>',kind:'busy'}});flush();assert.equal(message.textContent,'Opening <img src=x onerror=run()>');assert.equal(message.children.length,0,'Activity text is never interpreted as HTML');
  root.fire('aurora:file-index-updated',{detail:{folderType:'Desktop',count:12,status:'ready'}});assert.match(message.textContent,/Opening/,'Background indexing does not replace an explicit action');
  root.fire('aurora:activity',{detail:{message:'The app could not be opened.',kind:'error'}});assert.equal(message.textContent,'The app could not be opened.');
  const errorWrites=message.textWrites;root.fire('aurora:activity',{detail:{message:'The app could not be opened.',kind:'error'}});assert.equal(message.textWrites,errorWrites,'Repeated identical status does not announce again');
  advance(7000);assert.equal(bubble.hidden,true);
  focus.textContent='Focusing';mutate(focus);assert.equal(message.textContent,'Your focus timer is running.');assert.equal(bubble.hidden,false);
  const focusWrites=message.textWrites;for(let i=0;i<5;i++)mutate(focus);assert.equal(message.textWrites,focusWrites,'One-second focus renders do not repeat status');assert.equal(timers.size,0,'Focus is persistent without timer polling');
  status.textContent='Now 06:00 · Sydney';mutate(status);assert.equal(message.textContent,'Your focus timer is running.','Low priority weather update does not interrupt focus');
  focus.textContent='Paused';mutate(focus);assert.equal(message.textContent,'Your focus timer is paused.');
  focus.textContent='Complete';mutate(focus);assert.equal(message.textContent,'Focus session complete. Time for a break.');
  advance(7000);toast.textContent='Opened Calendar.';toast.classList.add('ah-show');mutate(toast);assert.equal(message.textContent,'Opened Calendar.');
  const toastWrites=message.textWrites;mutate(toast);assert.equal(message.textWrites,toastWrites);
  advance(7000);refresh.disabled=true;mutate(refresh);assert.equal(message.textContent,'Refreshing the weather.');
  refresh.disabled=false;status.textContent='Current unavailable · Sydney';mutate(refresh);assert.match(message.textContent,/could not refresh/);
  doc.hidden=true;doc.fire('visibilitychange');assert.equal(bubble.hidden,true);root.fire('aurora:activity',{detail:{message:'A hidden update'}});assert.equal(bubble.hidden,true,'Hidden desktop does not announce new bubbles');
  doc.hidden=false;doc.fire('visibilitychange');flush();assert.equal(frames.size,0);
  let chatClicks=0;core.addEventListener('click',()=>chatClicks++);core.fire('click');assert.equal(chatClicks,1,'Core click behavior is untouched');
  cleanup();assert.equal(timers.size,0);assert.equal(frames.size,0);assert.equal(root.count(),0);assert.equal(win.count(),0);assert.equal(doc.count(),0);assert.equal(stage.querySelector('.aas-bubble'),null);assert.equal(stage.querySelector('.aas-toggle'),null);assert.ok(observers.every(observer=>observer.disconnected));cleanup();
  assert.doesNotThrow(()=>initAtomStatus({root:new Element()}));
}finally{globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;Date.now=oldNow;}
console.log('Atom status: real activity, safe text, priority, focus transitions, weather/index state, bounded geometry, dismissal, deduplication and complete cleanup passed. No native calls or polling.');
