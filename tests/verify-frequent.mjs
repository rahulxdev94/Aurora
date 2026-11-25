import assert from 'node:assert/strict';
import {initAuroraFrequent,normaliseFrequentUsage,frequentUsageMetric} from '../src/aurora-frequent.mjs';

class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  fire(type,event={}){const value={target:this,key:'',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...event};for(const handler of this.listeners.get(type)||[])handler(value);return value;}
  count(){return [...this.listeners.values()].reduce((sum,handlers)=>sum+handlers.size,0);}
}
class Element extends Events{
  constructor(tag='div'){super();this.tagName=tag;this.children=[];this.parentNode=null;this.ownerDocument=null;this.dataset={};this.attrs=new Map();this.className='';this.hidden=false;this.disabled=false;this._text='';this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.classList.contains(name))this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');}};}
  set textContent(value){this._text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){throw new Error('Usage text must never be interpreted as HTML');}
  append(...values){for(const value of values)this.insertBefore(value,null);}
  insertBefore(value,before){value.remove();value.parentNode=this;value.ownerDocument=this.ownerDocument;const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,value);return value;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}
  get nextSibling(){if(!this.parentNode)return null;const siblings=this.parentNode.children;return siblings[siblings.indexOf(this)+1]||null;}
  contains(value){return this===value||this.children.some(child=>child.contains(value));}
  matches(selector){return selector.split(',').some(value=>{if(value.startsWith('.'))return this.classList.contains(value.slice(1));const data=value.match(/^\[data-([^=\]]+)(?:="([^"]*)")?\]$/);if(data){const current=this.dataset[data[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())];return data[2]===undefined?current!==undefined:current===data[2];}return value===this.tagName;});}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  focus(){this.ownerDocument.activeElement=this;}
}
function environment(){
  const doc=new Events(),win=new Events(),root=new Element('main'),parent=new Element('div'),weather=new Element('section'),next=new Element('aside'),timers=new Map(),intervals=new Map();let id=0;
  root.ownerDocument=doc;doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>{const element=new Element(tag);element.ownerDocument=doc;return element;};
  for(const element of [parent,weather,next])element.ownerDocument=doc;weather.className='ah-weather ah-surface';root.append(parent);parent.append(weather,next);
  win.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};win.clearTimeout=key=>timers.delete(key);win.setInterval=(fn,delay)=>{intervals.set(++id,{fn,delay});return id;};win.clearInterval=key=>intervals.delete(key);
  return{root,doc,win,parent,weather,next,timers,intervals};
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const snapshot=(extra={})=>({version:1,enabled:true,status:'ready',coverage:{apps:'foreground-while-running',websites:'aurora-launches-only'},apps:[],websites:[],...extra});
const app={id:'app-1',kind:'app',label:'<img onerror=run()>',activeMs:125000,opens:3,launchable:true};
const website={id:'site-1',kind:'website',label:'example.org',domain:'example.org',activeMs:99999999,opens:4,launchable:true};
const normal=normaliseFrequentUsage(snapshot({apps:[app,{...app,label:'duplicate'},{...app,id:'bad',kind:'website'}],websites:[website,{...website,id:'app-1'}]}));
assert.equal(normal.apps.length,1);assert.equal(normal.websites.length,1);assert.equal(normal.websites[0].activeMs,0,'Website time is never presented as measured foreground time');
assert.equal(frequentUsageMetric(normal.apps[0]),'2 min');assert.equal(frequentUsageMetric(normal.websites[0]),'4 opens');assert.equal(frequentUsageMetric({...normal.apps[0],activeMs:0,opens:1}),'1 visit','Observed app activations are not labelled process launches');
assert.throws(()=>normaliseFrequentUsage({...snapshot(),version:2}));assert.throws(()=>normaliseFrequentUsage({...snapshot(),enabled:'true'}));
assert.equal(normaliseFrequentUsage(snapshot({apps:Array.from({length:20},(_,i)=>({...app,id:'app-'+i}))})).apps.length,3,'The view remains bounded to the top ranked rows');

const env=environment(),calls={read:0,tracking:[],clear:0,launch:[]};let current=snapshot({apps:[app],websites:[website]}),readOverride=null;
const service={
  readFrequentUsage(options){calls.read++;return readOverride?readOverride(options):Promise.resolve(current);},
  async setUsageTracking(enabled){calls.tracking.push(enabled);current=snapshot({...current,enabled,status:enabled?'ready':'paused'});return current;},
  async clearUsage(){calls.clear++;current=snapshot({enabled:current.enabled,status:current.enabled?'ready':'paused'});return current;}
};
const api=initAuroraFrequent({root:env.root,service,openItem:async id=>{calls.launch.push(id);}});
assert.equal(initAuroraFrequent({root:env.root,service}),api,'Initialisation is idempotent');await api.refresh();
const widget=env.root.querySelector('.ah-frequent'),status=widget.querySelector('.afq-status'),action=name=>widget.querySelector(`[data-afq-action="${name}"]`),click=element=>widget.fire('click',{target:element});
assert.equal(env.parent.children[1],widget,'The widget is adjacent to Weather, before the existing next sibling');assert.equal(env.root.classList.contains('afq-enabled'),true);assert.equal(widget.classList.contains('ah-surface'),true,'Existing Sunlight target discovery sees the new widget');
assert.equal(calls.read,1,'Mount and concurrent refresh share one request');assert.equal(calls.launch.length,0,'Reading usage never launches an app or a website');
assert.equal(widget.querySelectorAll('.afq-item').length,2);assert.equal(widget.querySelector('.afq-item-name').textContent,app.label);assert.equal(widget.querySelector('.afq-item-name').children.length,0);assert.equal(widget.querySelectorAll('img').length,0,'Icons use local initials and no remote favicon requests');
assert.equal(status.getAttribute('aria-live'),'polite');assert.equal(widget.getAttribute('aria-live'),null,'Ranking changes do not re-announce the entire panel');assert.match(status.textContent,/Websites opened from Aurora only/);
const row=widget.querySelector('.afq-item');row.focus();await api.refresh();assert.equal(widget.querySelector('.afq-item'),row,'Unchanged ranked items reuse their controls');assert.equal(env.doc.activeElement,row,'Routine refresh preserves the focused item');
click(row);await flush();assert.deepEqual(calls.launch,['app-1'],'Only a clicked opaque ID crosses the native launch boundary');
env.root.dataset.browserQa='true';click(widget.querySelectorAll('.afq-item')[1]);await flush();assert.equal(calls.launch.length,1);assert.match(status.textContent,/disabled in this preview/);delete env.root.dataset.browserQa;
click(action('options'));assert.equal(action('options').getAttribute('aria-expanded'),'true');click(action('tracking'));await flush();assert.deepEqual(calls.tracking,[false]);assert.match(status.textContent,/paused/);assert.equal(widget.querySelector('.afq-menu').hidden,true);
click(action('options'));click(action('tracking'));await flush();assert.deepEqual(calls.tracking,[false,true]);
click(action('options'));click(action('confirm-clear'));assert.equal(calls.clear,0,'Selecting clear first exposes the specific local action');assert.equal(widget.querySelector('.afq-confirm').hidden,false);click(action('cancel-clear'));assert.equal(calls.clear,0);
click(action('confirm-clear'));click(action('clear'));await flush();assert.equal(calls.clear,1);assert.equal(widget.querySelectorAll('.afq-item').length,0);assert.equal(widget.querySelectorAll('.afq-entry').length,0,'Clearing removes whole ranked rows');assert.match(status.textContent,/rankings cleared/);
assert.ok([...env.intervals.values()].every(value=>value.delay===60000));const previousReads=calls.read;env.doc.hidden=true;for(const value of env.intervals.values())value.fn();await flush();assert.equal(calls.read,previousReads,'Hidden desktop skips periodic refresh');env.doc.hidden=false;env.doc.fire('visibilitychange');await flush();assert.equal(calls.read,previousReads+1);
current=snapshot({apps:[app],websites:[website]});await api.refresh();readOverride=async()=>{throw new Error('private backend text must not leak');};await api.refresh();assert.equal(widget.querySelectorAll('.afq-item').length,2,'A disconnection keeps the last loaded ranking');assert.match(status.textContent,/Disconnected/);assert.doesNotMatch(status.textContent,/private backend/);assert.equal(action('tracking').disabled,true);
readOverride=null;await api.refresh();let release,signal;readOverride=options=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});};const pending=api.refresh();const beforeCoalesced=calls.read;void api.refresh();assert.equal(calls.read,beforeCoalesced);click(action('options'));click(action('tracking'));await flush();assert.equal(signal.aborted,true);assert.match(status.textContent,/paused/);release(snapshot({apps:[app],enabled:true}));await pending;assert.match(status.textContent,/paused/,'A pre-mutation read cannot overwrite a newer tracking choice');
readOverride=null;await api.refresh();readOverride=()=>new Promise(()=>{});const timedOut=api.refresh();for(const timer of [...env.timers.values()])if(timer.delay===30000)timer.fn();await timedOut;assert.match(status.textContent,/Disconnected/,'An unresponsive usage source reaches a visible disconnected state');
readOverride=options=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});};const late=api.refresh();api.dispose();api.dispose();assert.equal(signal.aborted,true);assert.equal(env.root.querySelector('.ah-frequent'),null);assert.equal(env.root.classList.contains('afq-enabled'),false);assert.equal(env.intervals.size,0);assert.equal(env.timers.size,0,'Disposal cancels the read deadline immediately, even if the service ignores abort');assert.equal(env.doc.count(),0);assert.equal(env.win.count(),0);release(snapshot({apps:[app]}));await late;assert.equal(env.root.querySelector('.ah-frequent'),null,'Disposed views ignore late responses');assert.equal(env.timers.size,0);

for(const value of [snapshot(),snapshot({status:'loading'}),null]){
  const emptyEnv=environment(),empty=initAuroraFrequent({root:emptyEnv.root,service:value?{readFrequentUsage:async()=>value}:undefined});await empty.refresh();const mounted=emptyEnv.root.querySelector('.ah-frequent');assert.equal(mounted.querySelectorAll('.afq-item').length,0,'Empty, initialising and disconnected sources never get sample rankings');if(value?.status==='loading')assert.match(mounted.querySelector('.afq-empty').textContent,/Starting/);empty.dispose();
}
assert.doesNotThrow(()=>initAuroraFrequent({root:new Element()}));
console.log('Frequent usage UI: real empty/loading/disconnected states, safe text/local initials, bounded ranked rows, preserved focus, explicit native/QA launch boundary, pause/clear controls, hidden refresh, timeout/race/disposal cleanup passed. No app or website was opened.');
