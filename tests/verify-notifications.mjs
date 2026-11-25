import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext,Script} from 'node:vm';
import {initNativeNotifications,normaliseNotifications,notificationText,notificationView,NOTIFICATION_STALE_MS,createNotificationArrivalTracker,notificationIdentity,notificationPopupAllowed,notificationActivation,notificationIconSrc,MAX_NOTIFICATION_POPUPS} from '../src/aurora-notifications.mjs';
const toast=(id=1,lines=['Title','Body'],at=1804230000000)=>({id,appUmid:'test.app',appName:'Test App',appDescription:'Not rendered',date:at,content:{visual:{binding:{$value:lines.map(text=>({text:{$value:text}}))}}}});
assert.deepEqual(notificationText({visual:{binding:{$value:[{text:{$value:'Heading'}},{image:{'@src':'https://example.invalid/tracker'}},{group:{subgroup:[{$value:[{text:{$value:'Nested body'}},{image:{'@src':'file:///private'}}]}]}}]}}}),{title:'Heading',body:'Nested body'});
assert.deepEqual(notificationText({visual:{binding:{$value:[]}}}),{title:'Notification',body:''});
const parsed=normaliseNotifications([toast(1,['<img src=x onerror=alert(1)>','<script>bad()</script>']),toast(1),toast(2,['Second'],1804231000000)]);
assert.equal(parsed.count,2);assert.equal(parsed.items[0].id,2);assert.equal(parsed.items[1].title,'<img src=x onerror=alert(1)>');
assert.equal(Object.hasOwn(parsed.items[0],'appDescription'),false);
const sameSenderVariants=[{...toast(303,['Same notification']),appUmid:'Test.App'},{...toast(303,['Same notification']),appUmid:' test.app '},{...toast(303,['Same notification']),appUmid:'TEST.APP'}];
const canonicalSnapshot=normaliseNotifications(sameSenderVariants);
assert.equal(canonicalSnapshot.count,1,'Casing or surrounding whitespace cannot duplicate the same Windows sender and ID within a snapshot');
assert.equal(canonicalSnapshot.items[0].appId,'Test.App','Native activation retains the original cleaned sender spelling');
assert.equal(notificationActivation(canonicalSnapshot.items[0]).umid,'Test.App');
assert.equal(new Set(sameSenderVariants.map(value=>notificationIdentity(normaliseNotifications([value]).items[0]))).size,1,'Event identities canonicalise sender spelling consistently');
assert.throws(()=>normaliseNotifications({}),/unavailable/);assert.throws(()=>normaliseNotifications([{id:'invalid'}]),/could not be read/);
assert.equal(normaliseNotifications([toast(),{id:-1}]).invalid,1);
assert.equal(normaliseNotifications(Array.from({length:205},(_,i)=>toast(i))).items.length,200);
assert.equal(notificationView({snapshot:{items:[],count:0},lastSuccess:1000},1000).state,'empty');
assert.match(notificationView({snapshot:{items:[],count:0},lastSuccess:1000},1000).detail,/access is not verified/);
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000},1000).state,'available');
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000},1000+NOTIFICATION_STALE_MS+1).state,'stale');
assert.equal(notificationView({snapshot:parsed,lastSuccess:1000,error:true},1000).state,'error');
const arrivalNow=1804230000000,arrivalTracker=createNotificationArrivalTracker({now:()=>arrivalNow});
const arrivalItems=raw=>normaliseNotifications(raw).items;
const senderTracker=createNotificationArrivalTracker({now:()=>arrivalNow});senderTracker.accept([]);
assert.equal(senderTracker.accept(arrivalItems([sameSenderVariants[0]]),{liveEvent:true}).length,1);
for(const variant of sameSenderVariants)assert.equal(senderTracker.accept(arrivalItems([variant]),{liveEvent:true}).length,0,'Repeated/reconnected callbacks with sender spelling variations cannot duplicate an arrival');
const separateSameText={...sameSenderVariants[0],id:304};
assert.equal(senderTracker.accept(arrivalItems([separateSameText]),{liveEvent:true}).length,1,'Distinct Windows notification IDs with identical text remain separate notifications');
assert.equal(senderTracker.accept(arrivalItems([separateSameText]),{liveEvent:true}).length,0);
const senderRevision={...toast(303,['Same notification','New content']),appUmid:' TEST.APP '};
assert.equal(senderTracker.accept(arrivalItems([senderRevision]),{liveEvent:true}).length,1,'A same-ID content revision still emits once after sender spelling changes');
assert.equal(senderTracker.accept(arrivalItems([{...senderRevision,appUmid:'test.app'}]),{liveEvent:true}).length,0);
senderTracker.dispose();
const oldSenderTracker=createNotificationArrivalTracker({now:()=>arrivalNow}),oldSenderDate=arrivalNow-3600000;
oldSenderTracker.accept(arrivalItems([{...toast(305,['Old content'],oldSenderDate),appUmid:'Test.App'}]));
const oldSenderRevision={...toast(305,['Updated content'],oldSenderDate),appUmid:' TEST.APP '};
assert.equal(oldSenderTracker.accept(arrivalItems([oldSenderRevision]),{liveEvent:true}).length,1,'Stable sender identity also recognises an old-date same-ID revision across casing changes');
assert.equal(oldSenderTracker.accept(arrivalItems([{...oldSenderRevision,appUmid:'test.app'}]),{liveEvent:true}).length,0);oldSenderTracker.dispose();
// Synthetic fixture for the installed Windows WhatsApp identity, never a sent message.
const whatsappFixture={...toast(700,['Test group','Test message'],arrivalNow),appName:'WhatsApp',appUmid:'5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'};
const whatsappTracker=createNotificationArrivalTracker({now:()=>arrivalNow});
whatsappTracker.accept([]);
const whatsappArrival=whatsappTracker.accept(arrivalItems([whatsappFixture]),{liveEvent:true});
assert.equal(whatsappArrival.length,1,'WhatsApp uses the same live arrival feed as other Windows apps');
assert.equal(whatsappArrival[0].appName,'WhatsApp');
assert.equal(notificationActivation(whatsappArrival[0]).umid,whatsappFixture.appUmid);
assert.equal(whatsappTracker.accept(arrivalItems([whatsappFixture]),{liveEvent:true}).length,0,'A repeated WhatsApp snapshot cannot duplicate its popup');
whatsappTracker.dispose();
assert.deepEqual(arrivalTracker.accept(arrivalItems([toast(1,['Existing history'],arrivalNow-1000)])),[],'Initial history never floods the desktop');
assert.equal(arrivalTracker.accept(arrivalItems([toast(1,['Existing history'],arrivalNow-1000),toast(2,['New chat','First message'],arrivalNow)])).length,1);
assert.equal(arrivalTracker.accept(arrivalItems([toast(2,['New chat','First message'],arrivalNow),toast(1,['Existing history'],arrivalNow-1000)])).length,0,'Repeated or reordered snapshots do not repeat popups');
assert.equal(arrivalTracker.accept(arrivalItems([toast(2,['New chat','Second message'],arrivalNow)])).length,1,'A meaningful same-ID conversation update can create a new popup');
assert.equal(arrivalTracker.accept(arrivalItems([toast(2,['New chat','Second message'],arrivalNow)])).length,0);
assert.equal(arrivalTracker.accept(arrivalItems([toast(3,['Old history'],arrivalNow-31000),toast(4,['Invalid future'],arrivalNow+6000)])).length,0,'Stale/future history is never presented as a live arrival');
arrivalTracker.dispose();
const oldDateTracker=createNotificationArrivalTracker({now:()=>arrivalNow}),originalDate=arrivalNow-3600000;
oldDateTracker.accept(arrivalItems([toast(8,['Conversation','Earlier message'],originalDate)]));
assert.equal(oldDateTracker.accept(arrivalItems([toast(8,['Conversation','New message retaining the original date'],originalDate)]),{liveEvent:true}).length,1,'A genuine same-ID chat update may retain its original old timestamp');
assert.equal(oldDateTracker.accept(arrivalItems([toast(8,['Conversation','New message retaining the original date'],originalDate)]),{liveEvent:true}).length,0,'The changed chat version is only shown once');
assert.equal(oldDateTracker.accept(arrivalItems([toast(8,['Conversation','Earlier message'],originalDate)]),{liveEvent:true}).length,0,'Replaying an already-seen old version cannot alert');
assert.equal(oldDateTracker.accept(arrivalItems([toast(9,['Unseen old history'],originalDate)]),{liveEvent:true}).length,0,'A native history snapshot cannot turn a new old ID into a live alert');
assert.equal(oldDateTracker.accept(arrivalItems([toast(8,['Conversation','Manual history refresh'],originalDate)])).length,0,'A manual refresh cannot create an old-date update alert');
assert.equal(oldDateTracker.accept(arrivalItems([toast(8,['Future revision'],arrivalNow+6000)]),{liveEvent:true}).length,0,'Future-date rejection also applies to known IDs');oldDateTracker.dispose();
const tracedTracker=createNotificationArrivalTracker({now:()=>arrivalNow}),trackerReports=[];
const tracked=(rows,liveEvent=false)=>tracedTracker.accept(arrivalItems(rows),{liveEvent,onDiagnostics:value=>trackerReports.push(value)});
tracked([toast(610,['Private diagnostic title','Private diagnostic body'],arrivalNow-1000)]);assert.equal(trackerReports.at(-1).baselined,false);assert.equal(trackerReports.at(-1).source,'read');assert.equal(trackerReports.at(-1).dropped.baseline,1);
tracked([toast(610,['Private diagnostic title','Private diagnostic body'],arrivalNow-1000),toast(611,['Fresh'],arrivalNow),toast(612,['Stale'],arrivalNow-31000),toast(613,['Future'],arrivalNow+6000)],true);
assert.deepEqual(trackerReports.at(-1).dropped,{baseline:0,duplicate:1,stale:1,future:1,invalid:0,quiet:0});assert.equal(trackerReports.at(-1).candidates,1);assert.equal(trackerReports.at(-1).source,'native');assert.equal(trackerReports.at(-1).minimumAgeMs,-6000);assert.equal(trackerReports.at(-1).maximumAgeMs,31000);
assert.ok(!JSON.stringify(trackerReports).includes('Private diagnostic'));assert.ok(!JSON.stringify(trackerReports).includes('test.app'));assert.ok(!JSON.stringify(trackerReports).includes('610'));tracedTracker.dispose();
let coldTrackerNow=arrivalNow;const coldTracker=createNotificationArrivalTracker({now:()=>coldTrackerNow});coldTrackerNow+=6001;
const startupFresh=toast(620,['Created after receiver startup'],arrivalNow+300),startupOld=toast(621,['Recent but predating receiver startup'],arrivalNow-500),startupFuture=toast(622,['Invalid future creation'],coldTrackerNow+6000);
assert.deepEqual(coldTracker.accept(arrivalItems([startupOld,startupFresh,startupFuture]),{liveEvent:true}).map(item=>item.id),[620],'A first native snapshot surfaces only new notifications created since tracker startup');
assert.equal(coldTracker.accept(arrivalItems([startupOld,startupFresh]),{liveEvent:true}).length,0,'The cold-start notification cannot replay in repeated native snapshots');
assert.equal(coldTracker.accept(arrivalItems([startupOld,startupFresh])).length,0,'A later history read cannot duplicate the first native arrival');coldTracker.dispose();
const readFirst=createNotificationArrivalTracker({now:()=>coldTrackerNow});assert.equal(readFirst.accept(arrivalItems([toast(623,['Fresh but already in the initial read'],coldTrackerNow)])).length,0,'An initial read always establishes history without flooding');readFirst.dispose();
const staleFirst=createNotificationArrivalTracker({now:()=>coldTrackerNow});coldTrackerNow+=31001;assert.equal(staleFirst.accept(arrivalItems([toast(624,['Created during startup but already stale'],coldTrackerNow-31000)]),{liveEvent:true}).length,0,'The cold-start exception still respects the normal freshness window');staleFirst.dispose();
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'All'}),true);
for(const settings of [{focusAssist:true,mode:'All'},{focusAssist:false,mode:'PriorityOnly'},{focusAssist:false,mode:'AlarmsOnly'},{focusAssist:null,mode:'All'},{focusAssist:false,mode:null},{focusAssist:false,mode:'All',hidden:true},{focusAssist:false,mode:'All',paused:true}])assert.equal(notificationPopupAllowed(settings),false,'Quiet or unverified settings suppress popups');
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'All',hidden:true,popupOnly:true}),true,'A hidden overlay can receive the first real arrival and show itself');
const activatable=toast(40,['Message'],arrivalNow);activatable.content['@launch']='conversation=40';activatable.content['@activationType']='Foreground';
assert.deepEqual(notificationActivation(normaliseNotifications([activatable]).items[0]),{id:40,umid:'test.app',args:'conversation=40',activationType:'Foreground',inputData:{}});
for(const [source,expected]of [['foreground','Foreground'],['Foreground','Foreground'],['protocol','Protocol'],['Protocol','Protocol'],['background','Background'],['system','System']]){activatable.content['@activationType']=source;assert.equal(notificationActivation(normaliseNotifications([activatable]).items[0]).activationType,expected);}
activatable.content['@activationType']='unrecognised';assert.equal(notificationActivation(normaliseNotifications([activatable]).items[0]),null,'Unknown activation never silently becomes a foreground action');
assert.equal(notificationIconSrc('http://asset.localhost/C%3A/icon.png'),'http://asset.localhost/C%3A/icon.png');
assert.equal(notificationIconSrc('asset://localhost/icon.png'),'asset://localhost/icon.png');
for(const uri of ['https://tracker.invalid/pixel.png','file:///private/photo.png','javascript:alert(1)','data:text/html;base64,YQ=='])assert.equal(notificationIconSrc(uri),null,'Notification content cannot supply external or executable icons');

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
  assert.equal(title.textContent,'Windows notifications');assert.equal(content.querySelectorAll('button').length,3,'History has Refresh, explicit live-alert enable and native controls, with no clear/delete action');
  assert.equal(content.querySelectorAll('button').find(button=>button.dataset.anotAction==='enable-live').disabled,true,'An unsupported host cannot expose an active mode-change control');
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

// The explicit history control requests the verified application command once.
{
  const alertRoot=new Element(),alertContent=new Element();alertRoot.ownerDocument=doc;alertRoot.append(alertContent);
  const requested=[],alertMessages=[];let finishEnable;
  win.__auroraHandleSearchCommand=id=>{requested.push(id);return new Promise(resolve=>finishEnable=resolve);};
  const alertApi=initNativeNotifications({root:alertRoot,popups:false,invoke:async()=>[],SeelenCommand:{GetNotifications:'get',SetNotificationsMode:'set-mode',GetNotificationsMode:'mode'},nativeStatus:value=>alertMessages.push(value)});
  await drain();alertApi.renderPanel(alertContent);await drain();
  const enable=alertContent.querySelectorAll('button').find(button=>button.dataset.anotAction==='enable-live');assert.equal(enable.disabled,false);
  alertRoot.fire('click',{target:enable});alertRoot.fire('click',{target:enable});assert.deepEqual(requested,['notifications-all']);assert.equal(enable.disabled,true);
  finishEnable(true);await drain();assert.equal(enable.disabled,false);assert.equal(alertMessages.length,0,'The action handler owns verified success reporting');
  alertRoot.fire('click',{target:enable});finishEnable(false);await drain();assert.match(alertMessages.at(-1),/could not be enabled/);assert.equal(enable.disabled,false);
  alertApi.dispose();delete win.__auroraHandleSearchCommand;assert.equal(alertRoot.count(),0);assert.equal(timers.size,0);assert.equal(intervals.size,0);
}
// A separate overlay listens for real host arrivals without polling history.
// These local fixtures do not request notification access or open any app.
{
  const popupDoc=new Events(),popupWin=new Events(),popupRoot=new Element();popupRoot.ownerDocument=popupDoc;popupDoc.defaultView=popupWin;popupDoc.hidden=true;popupDoc.createElement=tag=>new Element(tag);
  const popupTimers=new Map(),popupIntervals=new Map(),popupCallbacks=new Map(),popupCalls=[],visibility=[],arrivalReports=[],lifecycleReports=[];
  let popupNow=1804230000000,popupTimerId=0,historyOpened=0,stopped=0,failQuiet=false,holdQuiet=false,resolveFocus,resolveMode;
  popupWin.setTimeout=(fn,ms)=>{popupTimers.set(++popupTimerId,{fn,at:popupNow+ms});return popupTimerId;};popupWin.clearTimeout=id=>popupTimers.delete(id);popupWin.setInterval=fn=>{popupIntervals.set(++popupTimerId,fn);return popupTimerId;};popupWin.clearInterval=id=>popupIntervals.delete(id);
  const initial=[toast(10,['Existing Windows history'],popupNow-60000)];
  const popupInvoke=(command,args)=>{popupCalls.push({command,args});if(command==='get')return Promise.resolve(initial);if(command==='focus'){if(failQuiet)return Promise.reject(new Error('Temporary quiet-state read failure'));if(holdQuiet)return new Promise(resolve=>resolveFocus=resolve);return Promise.resolve(false);}if(command==='mode'){if(failQuiet)return Promise.reject(new Error('Temporary mode read failure'));if(holdQuiet)return new Promise(resolve=>resolveMode=resolve);return Promise.resolve('All');}return Promise.resolve();};
  const popupSubscribe=async(event,fn)=>{popupCallbacks.set(event,fn);return()=>{popupCallbacks.delete(event);stopped++;};};
  const event=(id,body='A new message')=>popupCallbacks.get('notices')({payload:[toast(id,['Chat title',body],popupNow)]});
  const runTimer=id=>{const item=popupTimers.get(id);popupTimers.delete(id);item.fn();};
  Date.now=()=>popupNow;
  let popupApi;
  try{
    popupApi=initNativeNotifications({root:popupRoot,invoke:popupInvoke,subscribe:popupSubscribe,SeelenCommand:{GetNotifications:'get',GetFocusAssist:'focus',GetNotificationsMode:'mode',ActivateNotification:'activate'},SeelenEvent:{Notifications:'notices',FocusAssistChanged:'focus-event',NotificationsModeChanged:'mode-event'},popupOnly:true,popupDuration:15000,openHistory:()=>historyOpened++,onPopupVisibilityChange:value=>visibility.push(value),onArrivalDiagnostics:value=>arrivalReports.push(value),onPopupLifecycle:value=>lifecycleReports.push(value),resolveAppIcon:()=>Promise.resolve('https://tracker.invalid/never-fetch.png')});
    await drain();assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'Initial history creates no popups');assert.equal(popupIntervals.size,1,'Popup-only mode schedules quiet-state recovery, not notification history polling');
    assert.equal(arrivalReports.at(-1).source,'read');assert.equal(arrivalReports.at(-1).baselined,false);assert.equal(arrivalReports.at(-1).dropped.baseline,1);assert.equal(arrivalReports.at(-1).accepted,0);
    event(11);await drain();assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,1);assert.equal(visibility.at(-1),true,'A hidden overlay becomes visible for an arrival');assert.equal(arrivalReports.at(-1).source,'native');assert.equal(arrivalReports.at(-1).accepted,1);assert.equal(arrivalReports.at(-1).created,1);assert.equal(arrivalReports.at(-1).quiet.allowed,true);
    popupCallbacks.get('notices')({payload:[{...toast(11,['Chat title','A new message'],popupNow),appUmid:' TEST.APP '}]});assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,1,'Production callbacks cannot create another card merely by changing sender casing');assert.equal(arrivalReports.at(-1).dropped.duplicate,1);
    event(11);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,1,'Identical snapshots cannot duplicate a live card');assert.equal(arrivalReports.at(-1).dropped.duplicate,1);event(11,'A second message on the same Windows notification');assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,2,'Fresh same-ID chat content can notify');assert.equal(arrivalReports.at(-1).changedKnown,1);
    for(let id=12;id<28;id++)event(id);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,MAX_NOTIFICATION_POPUPS,'Live cards remain bounded');
    const liveCard=popupRoot.querySelector('.anot-live-popup');liveCard.fire('pointerenter');assert.equal([...popupTimers.values()].filter(timer=>timer.at===popupNow+15000).length,1,'Hovering pauses that card expiry');liveCard.fire('pointerleave');
    assert.equal(popupRoot.querySelectorAll('img').length,0,'Untrusted remote icon resolver output is ignored');
    popupNow+=1800;popupCallbacks.get('focus-event')({payload:true});assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'Focus Assist clears and suppresses queued banners');assert.equal(lifecycleReports.at(-1).reason,'quiet-event-focusAssist');assert.equal(lifecycleReports.at(-1).maximumAgeMs,1800);assert.equal(lifecycleReports.at(-1).quiet.focusAssist,true);assert.equal(lifecycleReports.at(-1).liveAfter,0);event(28);assert.equal(arrivalReports.at(-1).candidates,1);assert.equal(arrivalReports.at(-1).accepted,0);assert.equal(arrivalReports.at(-1).dropped.quiet,1);assert.equal(arrivalReports.at(-1).quiet.reason,'focus-assist');popupCallbacks.get('focus-event')({payload:false});event(28);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'Quiet-period arrivals are not replayed after quiet mode ends');
    popupCallbacks.get('mode-event')({payload:'PriorityOnly'});event(29);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0);popupCallbacks.get('mode-event')({payload:'All'});event(30);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,1);
    holdQuiet=true;for(const fn of popupIntervals.values())fn();await drain();popupCallbacks.get('focus-event')({payload:true});popupCallbacks.get('mode-event')({payload:'PriorityOnly'});resolveFocus(false);resolveMode('All');holdQuiet=false;await drain();event(31);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'Late getters cannot override newer quiet-state events');
    popupCallbacks.get('focus-event')({payload:false});popupCallbacks.get('mode-event')({payload:'All'});
    failQuiet=true;for(const fn of popupIntervals.values())fn();await drain();event(32);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'A failed quiet-state refresh suppresses popups conservatively');const retry=[...popupTimers].find(([,timer])=>timer.at===popupNow+2000);assert.ok(retry,'Unknown quiet state schedules a bounded retry');failQuiet=false;runTimer(retry[0]);await drain();event(33);assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,1,'The overlay recovers after a transient quiet getter failure');assert.equal(popupCalls.filter(call=>call.command==='get').length,1,'Quiet-state recovery does not add history polls');
    const history=popupRoot.querySelectorAll('button').find(button=>button.dataset.anotAction==='live-history');popupRoot.fire('click',{target:history});await drain();assert.equal(historyOpened,1);
    popupCallbacks.get('focus-event')({payload:true});popupCallbacks.get('focus-event')({payload:false});const specific=toast(40,['<img onerror=bad>','Message text'],popupNow);specific.content['@launch']='conversation=40';specific.content['@activationType']='protocol';popupCallbacks.get('notices')({payload:[specific]});await drain();const open=popupRoot.querySelectorAll('button').find(button=>button.dataset.anotAction==='live-open');popupRoot.fire('click',{target:open});await drain();assert.deepEqual(popupCalls.at(-1),{command:'activate',args:{id:40,umid:'test.app',args:'conversation=40',activationType:'Protocol',inputData:{}}});assert.equal(popupRoot.querySelectorAll('.anot-live-popup').length,0,'Explicit Open delegates to the host and closes only its local card');
    event(41);const dismiss=popupRoot.querySelectorAll('button').find(button=>button.dataset.anotAction==='live-dismiss');const beforeDismiss=popupCalls.length;popupRoot.fire('click',{target:dismiss});assert.equal(popupCalls.length,beforeDismiss,'Dismiss does not delete the Windows notification');
    assert.equal(lifecycleReports.at(-1).reason,'user');event(42);const expiry=[...popupTimers].find(([,timer])=>timer.at===popupNow+15000);assert.ok(expiry);popupNow+=15000;runTimer(expiry[0]);assert.equal(lifecycleReports.at(-1).reason,'timeout');assert.equal(lifecycleReports.at(-1).maximumAgeMs,15000);assert.equal(lifecycleReports.at(-1).quiet.allowed,true,'Expiry metadata distinguishes an actual timer from a quiet-state clear');
    popupCallbacks.get('notices')({payload:[{id:'invalid',appName:'Never log this app',body:'Never log this body'}]});assert.equal(arrivalReports.at(-1).dropped.invalid,1);assert.equal(arrivalReports.at(-1).accepted,0);assert.equal(arrivalReports.at(-1).source,'native');assert.ok(!JSON.stringify(arrivalReports).includes('Never log'));assert.ok(!JSON.stringify(arrivalReports).includes('Chat title'));assert.ok(!JSON.stringify(arrivalReports).includes('test.app'));
    event(43);const lateCallback=popupCallbacks.get('notices');popupApi.dispose();assert.equal(lifecycleReports.at(-1).reason,'disposed');assert.ok(!JSON.stringify(lifecycleReports).includes('Chat title'));assert.ok(!JSON.stringify(lifecycleReports).includes('test.app'));await drain();lateCallback({payload:[toast(99,['Late content'],popupNow)]});assert.equal(popupRoot.querySelectorAll('.anot-live-stack').length,0);assert.equal(popupTimers.size,0);assert.equal(popupIntervals.size,0);assert.equal(stopped,3);assert.equal(popupRoot.count(),0);assert.equal(popupDoc.count(),0);assert.equal(popupWin.count(),0);assert.ok(!popupCalls.some(call=>/close|delete|set_/i.test(call.command)),'No Windows notification deletion, settings change or automatic action occurs');
  }finally{popupApi?.dispose();Date.now=oldNow;}
  console.log('Live notification popups: initial-history suppression, chat revisions/deduplication, bounded queue, quiet-state recovery/races, explicit native activation, local dismissal and cleanup passed. No app was opened or user notification read.');
}

// Cold native getters can exceed the UI deadline. Fresh native events must not
// become history, and a late getter must neither get lost nor replace an event.
{
  function coldReadFixture(){
    const coldDoc=new Events(),coldWin=new Events(),coldRoot=new Element(),coldTimers=new Map(),coldIntervals=new Map(),coldCallbacks=new Map(),reports=[];
    coldRoot.ownerDocument=coldDoc;coldDoc.defaultView=coldWin;coldDoc.hidden=true;coldDoc.createElement=tag=>new Element(tag);
    let now=1804230000000,serial=0,resolveRead,reads=0;const started=now;
    coldWin.setTimeout=(fn,ms)=>{coldTimers.set(++serial,{fn,at:now+ms});return serial;};coldWin.clearTimeout=id=>coldTimers.delete(id);coldWin.setInterval=fn=>{coldIntervals.set(++serial,fn);return serial;};coldWin.clearInterval=id=>coldIntervals.delete(id);
    Date.now=()=>now;
    const api=initNativeNotifications({root:coldRoot,invoke:command=>command==='get'?(reads++,new Promise(resolve=>{resolveRead=resolve;})):Promise.resolve(command==='focus'?false:'All'),subscribe:async(event,fn)=>{coldCallbacks.set(event,fn);return()=>coldCallbacks.delete(event);},SeelenCommand:{GetNotifications:'get',GetFocusAssist:'focus',GetNotificationsMode:'mode'},SeelenEvent:{Notifications:'notices'},popupOnly:true,popupDuration:15000,onArrivalDiagnostics:value=>reports.push(value)});
    return{root:coldRoot,reports,started,get now(){return now;},get reads(){return reads;},event:rows=>coldCallbacks.get('notices')({payload:rows}),resolve:rows=>resolveRead(rows),api,
      timeout(){now+=6001;for(const [id,timer]of [...coldTimers])if(timer.at<=now){coldTimers.delete(id);timer.fn();}},
      assertDisposed(){assert.equal(coldTimers.size,0);assert.equal(coldIntervals.size,0);assert.equal(coldCallbacks.size,0);}
    };
  }
  let cold;
  try{
    cold=coldReadFixture();await drain();assert.equal(cold.reads,1);assert.equal(cold.reports.length,0);cold.timeout();await drain();assert.equal(cold.reports.length,0,'The bounded getter deadline does not falsely establish a baseline');
    const old=toast(710,['Cold existing history'],cold.started-60000),fresh=toast(711,['Genuine arrival after the timeout'],cold.now);
    cold.event([old,fresh]);await drain();assert.equal(cold.root.querySelectorAll('.anot-live-popup').length,1);assert.equal(cold.reports.at(-1).baselined,false);assert.equal(cold.reports.at(-1).accepted,1);assert.equal(cold.reports.at(-1).dropped.baseline,1);
    const acceptedReports=cold.reports.length;cold.resolve([old]);await drain();assert.equal(cold.reports.length,acceptedReports,'A late initial read cannot replace the newer native snapshot');
    cold.event([old,fresh]);assert.equal(cold.reports.at(-1).dropped.duplicate,2);assert.equal(cold.root.querySelectorAll('.anot-live-popup').length,1,'Repeated snapshots never replay the cold-start arrival');cold.api.dispose();cold.assertDisposed();
    cold=coldReadFixture();await drain();cold.timeout();await drain();cold.resolve([toast(720,['Late existing history'],cold.started-60000)]);await drain();assert.equal(cold.reports.length,1,'A valid native result still establishes the baseline after its UI deadline');assert.equal(cold.reports[0].source,'read');assert.equal(cold.reports[0].dropped.baseline,1);assert.equal(cold.root.querySelectorAll('.anot-live-popup').length,0);
    cold.event([toast(721,['Fresh notification after the late baseline'],cold.now)]);assert.equal(cold.reports.at(-1).baselined,true);assert.equal(cold.reports.at(-1).accepted,1);assert.equal(cold.root.querySelectorAll('.anot-live-popup').length,1);cold.api.dispose();cold.assertDisposed();
    cold=coldReadFixture();await drain();cold.timeout();await drain();cold.api.dispose();cold.resolve([toast(730,['Late private data after disposal'],cold.now)]);await drain();assert.equal(cold.reports.length,0);cold.assertDisposed();
  }finally{cold?.api.dispose();Date.now=oldNow;}
  console.log('Cold notification startup: timed-out history reads, first-native mixed history, late baseline acceptance, event precedence, deduplication and disposed late responses passed.');
}

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
