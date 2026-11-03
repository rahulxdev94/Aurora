import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext,Script} from 'node:vm';
import {initNativeNotifications,normaliseNotifications,notificationText,notificationView,NOTIFICATION_STALE_MS} from '../src/aurora-notifications.mjs';
const toast=(id=1,lines=['Title','Body'],at=1804230000000)=>({id,appUmid:'test.app',appName:'Test App',appDescription:'Not rendered',date:at,content:{visual:{binding:{$value:lines.map(text=>({text:{$value:text}}))}}}});
assert.deepEqual(notificationText({visual:{binding:{$value:[{text:{$value:'Heading'}},{image:{'@src':'https://example.invalid/tracker'}},{group:{subgroup:[{$value:[{text:{$value:'Nested body'}},{image:{'@src':'file:///private'}}]}]}}]}}}),{title:'Heading',body:'Nested body'});
assert.deepEqual(notificationText({visual:{binding:{$value:[]}}}),{title:'Notification',body:''});
const parsed=normaliseNotifications([toast(1,['<img src=x onerror=alert(1)>','<script>bad()</script>']),toast(1),toast(2,['Second'],1804231000000)]);
assert.equal(parsed.count,2);assert.equal(parsed.items[0].id,2);assert.equal(parsed.items[1].title,'<img src=x onerror=alert(1)>');
assert.equal(Object.hasOwn(parsed.items[0],'appDescription'),false);
assert.throws(()=>normaliseNotifications({}),/unavailable/);assert.throws(()=>normaliseNotifications([{id:'invalid'}]),/could not be read/);
assert.equal(normaliseNotifications([toast(),{id:-1}]).invalid,1);
assert.equal(normaliseNotifications(Array.from({length:205},(_,i)=>toast(i))).items.length,200);
assert.equal(notificationView({snapshot:{items:[],count:0},lastSuccess:1000},1000).state,'empty');
assert.match(notificationView({snapshot:{items:[],count:0},lastSuccess:1000},1000).detail,/access is not verified/);
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000},1000).state,'available');
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000},1000+NOTIFICATION_STALE_MS+1).state,'stale');
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000,error:true},1000).state,'error');

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
class Element extends Events{
  constructor(tag='div'){super();this.tag=tag;this.dataset={};this.attrs=new Map();this.children=[];this.textContent='';this.className='';this.disabled=false;}
  set innerHTML(value){throw new Error('Notification content must not use HTML');}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parent=this;}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));if(selector==='[data-anot-action]')return this.dataset.anotAction!==undefined;return this.tag===selector;}
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
}
const doc=new Events(),win=new Events(),root=new Element(),bell=new Element('button'),badge=new Element('span'),panel=new Element(),content=new Element(),title=new Element('span');
bell.className='ah-notification-button';badge.className='ah-notification-count';panel.className='ah-window';panel.dataset.panel='notifications';title.className='ah-window-name';
root.ownerDocument=doc;root.append(bell,panel);bell.append(badge);panel.append(title,content);doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>new Element(tag);
let time=1804230000000,nextTimer=0;
const timers=new Map(),intervals=new Map(),callbacks=new Map(),calls=[],messages=[];
win.setTimeout=(fn,ms)=>{timers.set(++nextTimer,{fn,at:time+ms});return nextTimer;};win.clearTimeout=id=>timers.delete(id);win.setInterval=fn=>{intervals.set(++nextTimer,fn);return nextTimer;};win.clearInterval=id=>intervals.delete(id);
let data=[],failRead=false,failOpen=false,holdRead=false,releaseRead,unsubscribed=0;
const invoke=(command,args)=>{calls.push({command,args});if(command==='get'&&failRead)return Promise.reject(new Error('Unavailable'));if(command==='get'&&holdRead)return new Promise(resolve=>{releaseRead=resolve;});if(command==='trigger'&&failOpen)throw new Error('Popup failed');return Promise.resolve(command==='get'?data:undefined);};
const subscribe=async(event,fn)=>{callbacks.set(event,fn);return()=>{callbacks.delete(event);unsubscribed++;};};
const drain=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const oldNow=Date.now;Date.now=()=>time;
try{
  const api=initNativeNotifications({root,invoke,subscribe,SeelenCommand:{GetNotifications:'get',TriggerWidget:'trigger'},SeelenEvent:{Notifications:'notices'},nativeStatus:message=>messages.push(message)});
  assert.equal(initNativeNotifications({root,invoke}),api);await drain();api.renderPanel(content);await drain();
  assert.equal(content.querySelector('.anot-status').dataset.state,'empty');assert.match(content.querySelector('.anot-status').children[1].textContent,/access is not verified/);assert.equal(badge.hidden,true);
  assert.equal(title.textContent,'Windows notifications');assert.equal(content.querySelectorAll('button').length,2,'Read-only controls have no clear/delete action');
  const malicious=toast(2,['<img src=x onerror=alert(1)>','<script>bad()</script>']);callbacks.get('notices')({payload:[malicious]});
  assert.equal(badge.textContent,'1');assert.equal(badge.hidden,false);assert.equal(content.querySelector('.anot-title').textContent,malicious.content.visual.binding.$value[0].text.$value);assert.equal(content.querySelector('.anot-body').textContent,'<script>bad()</script>');
  assert.equal(content.querySelectorAll('img').length,0,'Toast images are not fetched');assert.equal(content.querySelectorAll('a').length,0,'Toast text cannot create navigation');assert.match(bell.getAttribute('aria-label'),/^Windows notifications, 1$/);
  const longHistory=Array.from({length:200},(_,i)=>toast(i,['Notification '+i,('Long notification body '+i+'\n').repeat(40)],1804230000000+i));
  callbacks.get('notices')({payload:longHistory});
  const history=content.querySelector('.ah-notice-list'),actions=content.querySelector('.ah-panel-actions');
  assert.equal(history.children.length,200,'The bounded list retains the complete displayed history');
  assert.equal(history.children[0].querySelector('.anot-title').textContent,'Notification 199');
  assert.equal(history.children.at(-1).querySelector('.anot-title').textContent,'Notification 0','The oldest displayed notification remains accessible');
  assert.equal(history.children.at(-1).querySelector('.anot-body').textContent,longHistory[0].content.visual.binding.$value[1].text.$value.trim(),'Long bodies are not visually shortened in the source');
  assert.equal(history.tabIndex,0,'Keyboard users can focus the scrolling history');
  assert.ok(actions.parent===history.parent&&!history.contains(actions),'Refresh and native controls remain outside the scrolling list');
  callbacks.get('notices')({payload:[toast(4,['Replacement'])]});assert.equal(content.querySelectorAll('.ah-notice').length,1);assert.equal(content.querySelector('.anot-title').textContent,'Replacement','Events replace the full snapshot, not append');
  time+=1000;failRead=true;doc.fire('visibilitychange');await drain();assert.equal(content.querySelector('.anot-status').dataset.state,'error');assert.equal(content.querySelector('.anot-title').textContent,'Replacement','Read failures retain last good data with a visible error');assert.match(bell.getAttribute('aria-label'),/last read/);
  callbacks.get('notices')({payload:[{bad:'shape'}]});assert.equal(content.querySelector('.anot-title').textContent,'Replacement','Malformed nonempty data cannot erase the good snapshot');
  failRead=false;holdRead=true;time+=1000;doc.fire('visibilitychange');await drain();callbacks.get('notices')({payload:[toast(5,['New event'])]});releaseRead([toast(6,['Old request'])]);holdRead=false;await drain();assert.equal(content.querySelector('.anot-title').textContent,'New event','Late query does not overwrite newer event');
  callbacks.get('notices')({payload:[]});assert.equal(content.querySelectorAll('.ah-notice').length,0,'A valid empty snapshot clears old alerts');assert.equal(content.querySelector('.anot-status').dataset.state,'empty');assert.equal(badge.hidden,true);
  const open=content.querySelectorAll('button').find(button=>button.dataset.anotAction==='open');root.fire('click',{target:open});await drain();assert.deepEqual(calls.at(-1),{command:'trigger',args:{payload:{id:'@seelen/notifications'}}});assert.equal(open.disabled,false);
  failOpen=true;root.fire('click',{target:open});await drain();assert.match(messages.at(-1),/could not open/);assert.equal(open.disabled,false);failOpen=false;
  doc.hidden=true;time+=NOTIFICATION_STALE_MS+1;const before=calls.length;for(const fn of intervals.values())fn();await drain();assert.equal(calls.length,before,'Hidden view makes no polling call');assert.equal(content.querySelector('.anot-status').dataset.state,'stale');
  doc.hidden=false;time+=1000;holdRead=true;doc.fire('visibilitychange');await drain();api.dispose();await drain();releaseRead([toast(99,['Late private content'])]);await drain();assert.equal(content.children.length,0,'Disposal removes in-memory rendered notification content');assert.equal(timers.size,0);assert.equal(intervals.size,0);assert.equal(unsubscribed,1);assert.equal(root.count(),0);assert.equal(doc.count(),0);assert.equal(win.count(),0);assert.equal(badge.hidden,true);api.dispose();
  assert.ok(calls.every(call=>['get','trigger'].includes(call.command)),'No notification mutations or permission changes');
}finally{Date.now=oldNow;}

// Exercise the actual placement function against changing footer and viewport
// geometry. These fixtures test bounds logic, not a fabricated browser layout.
const windowSource=await readFile(new URL('../src/fragments/aurora-window-actions.html',import.meta.url),'utf8');
new Script(windowSource.match(/<script>([\s\S]*?)<\/script>/)[1]);
const fitSource=windowSource.slice(windowSource.indexOf('  function fitPanel()'),windowSource.indexOf('  function updateFavourites()'));
function boundsFixture({width=1536,height=864,footerHeight=100,scale=1,rootTop=0,mobile=false,panelKind='notifications',intrinsicHeight=9000}={}){
  const classes=new Set(),style={removeProperty(name){delete this[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}};
  const fixtureRoot={clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({top:rootTop,height:height*scale}),querySelector:()=>footerHeight?{getBoundingClientRect:()=>({top:rootTop+(height-footerHeight)*scale,height:footerHeight*scale})}:null};
  const fixturePanel={dataset:{panel:panelKind},style,classList:{add:name=>classes.add(name),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on)=>on?classes.add(name):classes.delete(name)},get offsetHeight(){return Math.min(intrinsicHeight,Number.parseFloat(style.maxHeight)||intrinsicHeight);},get offsetWidth(){return Math.min(560,width-32);}};
  const fixture={root:fixtureRoot,panel:fixturePanel,layer:{hidden:false},bar:{offsetHeight:50},content:{scrollHeight:intrinsicHeight-50},snap:{hidden:false},mobile:{matches:mobile},placement:{mode:'free',x:99999,y:99999},clamp:(value,min,max)=>Math.max(min,Math.min(max,value))};
  const fit=runInNewContext('('+fitSource+')',fixture);fit();
  return{...fixture,fit,classes,footerTop:rootTop+(height-footerHeight)*scale,scale,rootTop};
}
for(const shape of [{},{height:720,footerHeight:90},{height:900,footerHeight:146},{width:390,height:720,footerHeight:90,mobile:true},{width:1365,height:768,footerHeight:92,scale:1.5,rootTop:27},{footerHeight:0}]){
  const f=boundsFixture(shape),top=Number.parseFloat(f.panel.style.top),left=Number.parseFloat(f.panel.style.left),bottom=f.rootTop+(top+f.panel.offsetHeight)*f.scale;
  assert.ok(top>=16&&left>=16,'Dragging cannot cross the upper or side boundary');
  assert.ok(left+f.panel.offsetWidth<=f.root.clientWidth-15,'The right edge stays inside the viewport');
  assert.ok(bottom<=f.footerTop-15*f.scale,'A long history ends above the actual footer reserve, including scaling');
  assert.ok(f.classes.has('ah-wa-placed'),'Narrow notifications retain bounded placement even without snap controls');
}
const resizeCase=boundsFixture({height:864,footerHeight:100,intrinsicHeight:450});
resizeCase.root.clientHeight=650;resizeCase.root.getBoundingClientRect=()=>({top:0,height:650});resizeCase.root.querySelector=()=>({getBoundingClientRect:()=>({top:510,height:140})});resizeCase.placement.y=99999;resizeCase.fit();
assert.ok(Number.parseFloat(resizeCase.panel.style.top)+resizeCase.panel.offsetHeight<=494,'Changing the footer reserve refits a previously positioned window');
const unchanged=boundsFixture({panelKind:'folder'});
assert.equal(Number.parseFloat(unchanged.panel.style.maxHeight),832,'Other desktop panels keep their previous height bound');
assert.equal(Number.parseFloat(unchanged.panel.style.top)+unchanged.panel.offsetHeight,848,'Other panels keep their previous bottom bound');
const narrowOther=boundsFixture({panelKind:'folder',width:390,mobile:true});
assert.equal(narrowOther.panel.style.maxHeight,undefined);assert.ok(!narrowOther.classes.has('ah-wa-placed'),'Other narrow panels keep their existing layout');
console.log('Notifications: safe read-only data handling, all 200 long-history cards, keyboard list access, controls outside history, actual notification placement logic with footer resize, scaled/narrow viewports, and unchanged other panels passed. Geometry uses local fixtures; browser layout and native appearance require visual verification. No real notifications were read.');
