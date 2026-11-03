import assert from 'node:assert/strict';
import {initSystemControls,nativeActionArgs,readPower,readConnection,readAudio,readFocus,SYSTEM_ACTIONS,STATUS_MAX_AGE} from '../src/aurora-system-controls.mjs';

assert.equal(readPower({batteryFlag:1,batteryLifePercent:96,acLineStatus:1}).label,'96%');
assert.equal(readPower({batteryFlag:128,batteryLifePercent:255,acLineStatus:1}).label,'Plugged in');
for(const value of [255,-1,101,NaN,'50'])assert.equal(readPower({batteryLifePercent:value}),null);
assert.equal(readConnection(false).label,'Offline');assert.equal(readConnection('false'),null);
assert.equal(readAudio([[],[{isDefaultMultimedia:true,volume:.58,muted:false}]]).label,'58%');
assert.equal(readAudio([[],[{isDefaultMultimedia:true,volume:.58,muted:true}]]).label,'Muted');
assert.equal(readAudio([[],[{isDefaultMultimedia:false,volume:.58,muted:false}]]),null);
assert.equal(readAudio([[],[{isDefaultMultimedia:true,volume:2,muted:false}]]),null);
assert.equal(readFocus({name:'Editor',title:'A file'}).description,'Editor · A file');
assert.equal(nativeActionArgs('unknown',{TriggerWidget:'trigger'}),null);
const commands={TriggerWidget:'trigger',OpenFile:'open',GetPowerStatus:'power',GetNetworkInternetConnection:'network',GetMediaDevices:'audio',GetFocusedApp:'focus'};
for(const [key,item] of Object.entries(SYSTEM_ACTIONS)){
  const expected=item.widget?{command:'trigger',args:{payload:{id:item.widget}}}:{command:'open',args:{path:'ms-settings:powersleep'}};
  assert.deepEqual(nativeActionArgs(key,commands),expected);
}

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
class Element extends Events{
  constructor(tag='div'){super();this.tag=tag;this.dataset={};this.attrs=new Map();this.children=[];this.textContent='';this.className='';this.disabled=false;}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  removeAttribute(name){this.attrs.delete(name);}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
  prepend(...nodes){for(const node of [...nodes].reverse()){this.children.unshift(node);node.parent=this;}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
    if(selector.includes(','))return selector.split(',').some(part=>this.matches(part));
    if(selector.includes(' '))return this.matches(selector.split(' ').at(-1));
    if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
    if(selector==='[data-asc-action]')return this.dataset.ascAction!==undefined;
    if(selector==='[data-action="notifications"]')return this.dataset.action==='notifications';
    return this.tag===selector;
  }
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const doc=new Events(),win=new Events(),root=new Element(),clock=new Element('section'),panel=new Element(),content=new Element(),bell=new Element('button');
clock.className='ah-clock';panel.className='ah-window';content.className='ah-window-content';bell.className='ah-notification-button';bell.dataset.action='notifications';bell.setAttribute('aria-label','Old activity');bell.setAttribute('data-tooltip','Old tooltip');
root.ownerDocument=doc;root.append(clock,panel,bell);panel.append(content);doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>new Element(tag);
let time=1000000,nextTimer=0;
const timers=new Map(),intervals=new Map(),observers=[];
win.setTimeout=(fn,ms)=>{timers.set(++nextTimer,{fn,at:time+ms});return nextTimer;};win.clearTimeout=id=>timers.delete(id);
win.setInterval=(fn,ms)=>{intervals.set(++nextTimer,{fn,ms});return nextTimer;};win.clearInterval=id=>intervals.delete(id);
win.MutationObserver=class{constructor(fn){this.fn=fn;this.watches=[];observers.push(this);}observe(node,options){this.watches.push([node,options]);}disconnect(){this.disconnected=true;}};
const events={PowerStatus:'power-event',NetworkInternetConnection:'network-event',MediaDevices:'audio-event',GlobalFocusChanged:'focus-event'};
const listeners=new Map(),calls=[],notices=[];
let unsubscribed=0,failNetwork=false,holdAudio=false,releaseAudio,failPopup=false;
const values={power:{batteryFlag:1,batteryLifePercent:96,acLineStatus:1},network:true,audio:[[],[{isDefaultMultimedia:true,volume:.58,muted:false}]],focus:{name:'Editor',title:'Current document'}};
const invoke=(command,args)=>{calls.push({command,args});if(command==='network'&&failNetwork)return Promise.reject(new Error('offline'));if(command==='audio'&&holdAudio)return new Promise(resolve=>{releaseAudio=resolve;});if(command==='trigger'&&failPopup)throw new Error('Unavailable popup');return Promise.resolve(values[command]);};
const subscribe=async(event,fn)=>{listeners.set(event,fn);return()=>{listeners.delete(event);unsubscribed++;};};
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const originalNow=Date.now;Date.now=()=>time;
try{
  const clean=await initSystemControls({root,invoke,subscribe,SeelenCommand:commands,SeelenEvent:events,nativeStatus:message=>notices.push(message),openPanel:kind=>{panel.dataset.panel=kind;content.append(new Element('input'));}});
  await drain();assert.equal(await initSystemControls({root,invoke}),clean,'Initialisation is idempotent');
  const chips=clock.querySelectorAll('.asc-chip');assert.equal(chips.length,4);assert.equal(chips[0].querySelector('.asc-chip-value').textContent,'96%');assert.equal(chips[1].querySelector('.asc-chip-value').textContent,'Online');assert.equal(chips[2].querySelector('.asc-chip-value').textContent,'58%');
  assert.equal(timers.size,0);assert.equal(intervals.size,1);assert.equal(listeners.size,4);assert.equal(calls.length,4);
  root.fire('click',{target:chips[3]});const section=content.querySelector('.asc-system-panel');assert.ok(section);assert.equal(content.children[1].tag,'input','Existing appearance controls retained');
  assert.equal(section.querySelectorAll('.asc-action').length,Object.keys(SYSTEM_ACTIONS).length);assert.match(section.querySelector('.asc-system-summary').textContent,/Editor · Current document/);
  observers[0].fn();assert.equal(content.querySelectorAll('.asc-system-panel').length,1,'Panel mounting does not cascade');
  const buttons=section.querySelectorAll('.asc-action');
  for(const button of buttons){root.fire('click',{target:button});await drain();assert.deepEqual(calls.at(-1),nativeActionArgs(button.dataset.ascAction,commands));assert.equal(button.disabled,false);}
  assert.ok(calls.filter(call=>call.command==='trigger').every(call=>Object.keys(call.args.payload).length===1),'Native popup positioning remains host-owned');
  assert.equal(calls.filter(call=>/set|clear|delete/.test(call.command)).length,0,'No native setting or notification writes');
  failPopup=true;root.fire('click',{target:buttons[0]});await drain();assert.equal(buttons[0].disabled,false);assert.match(notices.at(-1),/could not open/);failPopup=false;
  holdAudio=true;doc.fire('visibilitychange');await drain();listeners.get('audio-event')({payload:[[],[{isDefaultMultimedia:true,volume:.7,muted:false}]]});releaseAudio([[],[{isDefaultMultimedia:true,volume:.2,muted:false}]]);holdAudio=false;await drain();assert.equal(chips[2].querySelector('.asc-chip-value').textContent,'70%','A late query cannot overwrite a newer event');
  failNetwork=true;for(const interval of intervals.values())interval.fn();await drain();assert.equal(chips[1].dataset.state,'unavailable','A read failure clears old status');
  listeners.get('network-event')({payload:false});assert.equal(chips[1].querySelector('.asc-chip-value').textContent,'Offline','An offline connection is distinct from unavailable data');
  doc.hidden=true;time+=STATUS_MAX_AGE+1;const before=calls.length;for(const interval of intervals.values())interval.fn();await drain();assert.equal(calls.length,before,'Hidden page does not poll');assert.equal(chips[0].dataset.state,'unavailable','Old data expires');
  doc.hidden=false;failNetwork=false;doc.fire('visibilitychange');await drain();assert.equal(chips[0].querySelector('.asc-chip-value').textContent,'96%','Showing desktop refreshes readings');
  clean();await drain();assert.equal(intervals.size,0);assert.equal(timers.size,0);assert.equal(unsubscribed,4);assert.equal(root.count(),0);assert.equal(doc.count(),0);assert.equal(win.count(),0);assert.ok(observers[0].disconnected);assert.equal(clock.children.length,0);assert.equal(content.querySelector('.asc-system-panel'),null);assert.equal(bell.getAttribute('aria-label'),'Old activity');assert.equal(bell.getAttribute('data-tooltip'),'Old tooltip');clean();
}finally{Date.now=originalNow;}
console.log('System controls: native popup args, data validation, all controls, read failures, stale expiry, event races, preserved panel content and cleanup passed. No Windows calls were made.');
