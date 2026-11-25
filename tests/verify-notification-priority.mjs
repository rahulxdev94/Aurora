import assert from 'node:assert/strict';
import {
  initNativeNotifications, normaliseNotificationPriorityIds, notificationIsPriority,
  notificationPopupAllowed, MAX_NOTIFICATION_POPUPS,
} from '../src/aurora-notifications.mjs';

const WHATSAPP='5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App';
const INSTAGRAM='Facebook.InstagramBeta_8xx8rvfyw5nnt!App';
const CHATGPT='OpenAI.Codex_2p2nqsd0c76g0!App';
const CLASSIC='OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT';
const FACEBOOK='Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!https://www.facebook.com/';
const configured=[WHATSAPP,INSTAGRAM,CHATGPT,CLASSIC,FACEBOOK];
const priorityIds=normaliseNotificationPriorityIds(configured);

assert.deepEqual(normaliseNotificationPriorityIds([`  ${WHATSAPP}  `,WHATSAPP.toLowerCase(),'',null,12,'bad identity','bad\tidentity','bad*identity','bad?identity','x'.repeat(2049)]),[WHATSAPP.toLowerCase()]);
assert.deepEqual(normaliseNotificationPriorityIds(null),[]);
assert.deepEqual(normaliseNotificationPriorityIds(WHATSAPP),[]);
const bounded=normaliseNotificationPriorityIds(Array.from({length:100},(_,i)=>`App.${i}!App`));
assert.equal(bounded.length,64,'Priority configuration has a fixed identity bound');
assert.equal(new Set(bounded).size,64);
for(const appId of configured)assert.equal(notificationIsPriority({appId:appId.toUpperCase()},priorityIds),true);
for(const appId of ['other.app',FACEBOOK+'?other',FACEBOOK.replace('www.facebook.com','www.facebook.com.attacker.invalid'),'Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App',WHATSAPP+'.other'])assert.equal(notificationIsPriority({appId,appName:'WhatsApp',title:'ChatGPT',body:FACEBOOK},priorityIds),false,'Only the complete configured application identity qualifies');
assert.equal(notificationIsPriority({},priorityIds),false);
assert.equal(notificationIsPriority({appId:WHATSAPP},[]),false);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'PriorityOnly',priority:true}),true);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'PriorityOnly',priority:false}),false);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'PriorityOnly',priority:'true'}),false);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'AlarmsOnly',priority:true}),false,'A public priority list alone never enables an alarms-only exception');
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'AlarmsOnly',priority:true,priorityDuringDnd:true}),true,'The extra explicit opt-in admits selected senders during alarms-only DND');
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'AlarmsOnly',priority:true,priorityDuringDnd:'true'}),false);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'AlarmsOnly',priority:false,priorityDuringDnd:true}),false);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'AlarmsOnly',priority:'true',priorityDuringDnd:true}),false);
for(const state of [{focusAssist:true,mode:'PriorityOnly'},{focusAssist:true,mode:'AlarmsOnly'},{focusAssist:null,mode:'PriorityOnly'},{focusAssist:null,mode:'AlarmsOnly'},{focusAssist:false,mode:null},{focusAssist:false,mode:'unknown'},{focusAssist:false,mode:'PriorityOnly',paused:true},{focusAssist:false,mode:'AlarmsOnly',paused:true},{focusAssist:false,mode:'PriorityOnly',hidden:true},{focusAssist:false,mode:'AlarmsOnly',hidden:true}])assert.equal(notificationPopupAllowed({...state,priority:true,priorityDuringDnd:true}),false,'Priority never overrides an active or unknown Focus session, unknown mode, pause or regular hidden surface');
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'PriorityOnly',priority:true,hidden:true,popupOnly:true}),true);
assert.equal(notificationPopupAllowed({focusAssist:false,mode:'All',priority:false}),true);

class Events {
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
class Element extends Events {
  constructor(tag='div'){super();this.tag=tag;this.dataset={};this.attrs=new Map();this.children=[];this.textContent='';this.className='';this.disabled=false;}
  set innerHTML(value){throw new Error('Notification content must remain plain text');}
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
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function scenario(options,run) {
  const doc=new Events(),win=new Events(),root=new Element(),content=new Element(),panel=new Element();
  root.ownerDocument=doc;doc.defaultView=win;doc.hidden=true;doc.createElement=tag=>new Element(tag);panel.className='ah-window';panel.dataset.panel='notifications';root.append(panel);panel.append(content);
  const timers=new Map(),intervals=new Map(),callbacks=new Map(),calls=[],reports=[],lifecycles=[],history=[];
  let now=1804230000000,timerId=0,subscriptions=0,stopped=0,mode=options.mode||'All',focus=false;
  win.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,at:now+ms});return timerId;};win.clearTimeout=id=>timers.delete(id);
  win.setInterval=fn=>{intervals.set(++timerId,fn);return timerId;};win.clearInterval=id=>intervals.delete(id);
  const invoke=async(command,args)=>{calls.push({command,args});return command==='get'?[...history]:command==='focus'?focus:command==='mode'?mode:undefined;};
  const subscribe=async(event,fn)=>{assert.ok(!callbacks.has(event),'One subscription per existing native event');subscriptions++;callbacks.set(event,fn);return()=>{callbacks.delete(event);stopped++;};};
  const oldNow=Date.now;Date.now=()=>now;
  let api;
  const cards=()=>root.querySelectorAll('.anot-live-popup');
  const names=()=>cards().map(card=>card.querySelector('.anot-live-title').textContent);
  const options_={root,invoke,subscribe,priorityAppIds:options.priorityAppIds??configured,prioritySites:options.prioritySites??[],priorityDuringDnd:options.priorityDuringDnd??false,popupAppIds:options.popupAppIds??null,SeelenCommand:{GetNotifications:'get',GetFocusAssist:'focus',GetNotificationsMode:'mode',ActivateNotification:'activate'},SeelenEvent:{Notifications:'notices',FocusAssistChanged:'focus-event',NotificationsModeChanged:'mode-event'},popupOnly:true,popupDuration:15000,onArrivalDiagnostics:value=>reports.push(value),onPopupLifecycle:value=>lifecycles.push(value)};
  try {
    api=initNativeNotifications(options_);await drain();api.renderPanel(content);await drain();
    assert.equal(initNativeNotifications(options_),api,'Repeated initialisation reuses the same pipeline');
    assert.equal(subscriptions,3);assert.equal(cards().length,0);
    const emit=(id,appId='ordinary.app',title=`Notice ${id}`,appName='Fixture app',args=undefined)=>{
      now++;
      const item={id,appUmid:appId,appName,date:now,content:{'@launch':args,visual:{binding:{$value:[{text:{$value:title}},{text:{$value:'Synthetic local fixture'}}]}}}};
      history.push(item);callbacks.get('notices')({payload:[...history]});return item;
    };
    const dismiss=title=>{const card=cards().find(card=>card.querySelector('.anot-live-title').textContent===title);assert.ok(card,`Expected live card ${title}`);root.fire('click',{target:card.querySelector('.anot-live-dismiss')});};
    await run({root,content,cards,names,emit,dismiss,reports,lifecycles,calls,history,callbacks,timers,intervals,
      mode(value){mode=value;callbacks.get('mode-event')({payload:value});},focus(value){focus=value;callbacks.get('focus-event')({payload:value});},
      replay(){callbacks.get('notices')({payload:[...history]});},
      advance(ms){now+=ms;},
    });
    assert.ok(calls.every(call=>['get','focus','mode'].includes(call.command)),'Priority presentation never deletes notifications, launches an app or changes Windows settings');
    assert.equal(calls.filter(call=>call.command==='get').length,1,'The same native event feed is used, without extra polling');
    assert.ok(!JSON.stringify(reports).includes('Synthetic local fixture'),'Diagnostics contain no private message text');
    const late=callbacks.get('notices');api.dispose();await drain();late({payload:[...history]});
    assert.equal(stopped,3);assert.equal(callbacks.size,0);assert.equal(timers.size,0);assert.equal(intervals.size,0);
    assert.equal(root.count(),0);assert.equal(doc.count(),0);assert.equal(win.count(),0);assert.equal(root.querySelectorAll('.anot-live-stack').length,0);
  } finally {api?.dispose();Date.now=oldNow;}
}

await scenario({mode:'PriorityOnly',priorityDuringDnd:true},async h=>{
  h.emit(1,'ordinary.app','Spoofed title ChatGPT','WhatsApp');assert.deepEqual(h.names(),[]);
  h.emit(2,WHATSAPP,'Selected WhatsApp');assert.deepEqual(h.names(),['Selected WhatsApp']);
  h.replay();assert.deepEqual(h.names(),['Selected WhatsApp'],'Identical snapshots do not duplicate a priority banner');
  h.emit(3,FACEBOOK.replace('www.facebook.com','www.other.example'),'Other Edge site','Facebook');assert.deepEqual(h.names(),['Selected WhatsApp']);
  h.emit(4,FACEBOOK,'Selected Facebook');assert.deepEqual(h.names(),['Selected WhatsApp','Selected Facebook']);
  assert.equal(h.content.querySelectorAll('.ah-notice').length,4,'Suppressed apps remain in read-only history');
  h.focus(true);assert.deepEqual(h.names(),[]);h.emit(5,CHATGPT,'During focus');assert.deepEqual(h.names(),[]);
  h.focus(false);h.replay();assert.deepEqual(h.names(),[],'Priority messages received during Focus are not replayed');
  h.emit(6,INSTAGRAM,'After focus');assert.deepEqual(h.names(),['After focus']);
  h.mode('AlarmsOnly');assert.deepEqual(h.names(),['After focus'],'A selected app stays visible when Windows enters alarms-only DND');
  h.emit(7,CLASSIC,'During alarms');assert.deepEqual(h.names(),['After focus','During alarms']);
  h.emit(8,'ordinary.app','Ordinary during alarms','ChatGPT');assert.deepEqual(h.names(),['After focus','During alarms'],'The alarms-only exception never applies to display-name spoofs or ordinary senders');
  h.mode('PriorityOnly');h.replay();assert.deepEqual(h.names(),['After focus','During alarms'],'Switching DND modes cannot duplicate priority cards');
  h.dismiss('After focus');h.dismiss('During alarms');
  h.emit(9,CHATGPT,'After alarms');assert.deepEqual(h.names(),['After alarms']);
});

await scenario({mode:'PriorityOnly',priorityAppIds:[],priorityDuringDnd:true},async h=>{
  h.emit(1,WHATSAPP,'No configured exception');assert.deepEqual(h.names(),[],'Portable defaults grant no priority exception');
  h.mode('AlarmsOnly');h.emit(3,WHATSAPP,'No alarms-only exception');assert.deepEqual(h.names(),[],'Alarms-only also remains strict with no explicit configured identities');
  h.mode('All');h.emit(2,'ordinary.app','All mode ordinary');assert.deepEqual(h.names(),['All mode ordinary']);
});

await scenario({mode:'AlarmsOnly'},async h=>{
  h.emit(1,WHATSAPP,'Selected app without DND opt-in');assert.deepEqual(h.names(),[],'Production defaults keep selected apps quiet during alarms-only');
  h.mode('All');h.emit(2,CHATGPT,'Selected app in All');assert.deepEqual(h.names(),['Selected app in All']);
  h.mode('AlarmsOnly');assert.deepEqual(h.names(),[],'Without opt-in, entering alarms-only clears an existing selected card');
  h.emit(3,INSTAGRAM,'Still no DND opt-in');assert.deepEqual(h.names(),[]);
  h.mode('PriorityOnly');h.emit(4,WHATSAPP,'Existing priority behaviour');assert.deepEqual(h.names(),['Existing priority behaviour'],'PriorityOnly retains its existing explicit-app semantics');
});

await scenario({mode:'AlarmsOnly',priorityAppIds:[],prioritySites:[{appId:'Chrome',origin:'https://www.facebook.com'}]},async h=>{
  const args='0|0|Default|Chrome|0|https://www.facebook.com/|fixture-id';
  h.emit(1,'Chrome','Selected site without opt-in','Google Chrome',args);assert.deepEqual(h.names(),[],'A selected site alone cannot enable the alarms-only exception');
  h.mode('PriorityOnly');h.emit(2,'Chrome','Selected site in priority-only','Google Chrome',args);assert.deepEqual(h.names(),['Selected site in priority-only']);
});

await scenario({mode:'PriorityOnly',priorityAppIds:[],priorityDuringDnd:true,prioritySites:[{appId:'Chrome',origin:'https://www.facebook.com'},{appId:'Chrome',origin:'https://www.instagram.com'}]},async h=>{
  const chromeLaunch=origin=>`0|0|Default|Chrome|0|${origin}|opaque-fixture-id`;
  h.emit(1,'Chrome','Facebook https://www.facebook.com','Facebook',chromeLaunch('https://other.example/'));
  assert.deepEqual(h.names(),[],'Chrome display text cannot turn an unrelated site into a priority sender');
  h.emit(2,'Chrome','Chrome with no origin metadata','Facebook');assert.deepEqual(h.names(),[],'The browser is not an app-wide priority exception');
  h.emit(3,'Chrome','Facebook site arrival','Google Chrome',chromeLaunch('https://www.facebook.com/'));
  h.emit(4,'Chrome','Instagram site arrival','Google Chrome',chromeLaunch('https://www.instagram.com/'));
  assert.deepEqual(h.names(),['Facebook site arrival','Instagram site arrival'],'Site-only configuration activates the production priority-only gate');
  h.replay();assert.deepEqual(h.names(),['Facebook site arrival','Instagram site arrival'],'Site arrivals share the existing deduplication pipeline');
  h.focus(true);assert.deepEqual(h.names(),[]);
  h.emit(5,'Chrome','Site during focus','Google Chrome',chromeLaunch('https://www.facebook.com/'));
  h.focus(false);h.replay();assert.deepEqual(h.names(),[],'Suppressed site notifications are not replayed after Focus');
  h.emit(6,'Chrome','Site after focus','Google Chrome',chromeLaunch('https://www.instagram.com/'));assert.deepEqual(h.names(),['Site after focus']);
  h.mode('AlarmsOnly');assert.deepEqual(h.names(),['Site after focus'],'A verified selected site remains visible through alarms-only DND');
  h.emit(7,'Chrome','Site during alarms','Google Chrome',chromeLaunch('https://www.facebook.com/'));
  assert.deepEqual(h.names(),['Site after focus','Site during alarms'],'Site-only policy can admit a new verified origin during alarms-only DND');
  h.emit(8,'Chrome','Other site during alarms','Facebook',chromeLaunch('https://other.example/'));assert.deepEqual(h.names(),['Site after focus','Site during alarms'],'Other Chrome sites remain suppressed');
  h.focus(true);assert.deepEqual(h.names(),[],'An active Focus session still clears selected site cards during alarms-only DND');
  h.emit(9,'Chrome','Site during alarms and focus','Google Chrome',chromeLaunch('https://www.facebook.com/'));
  h.focus(false);h.replay();assert.deepEqual(h.names(),[],'Focus-suppressed site arrivals are never replayed');
  h.mode('All');h.emit(10,'Chrome','Ordinary Chrome in All','Google Chrome',chromeLaunch('https://other.example/'));
  assert.deepEqual(h.names(),['Ordinary Chrome in All'],'All mode continues to accept ordinary Chrome notifications');
  h.mode('AlarmsOnly');assert.deepEqual(h.names(),[],'Alarms-only mode removes ordinary Chrome even with a site policy');
  h.emit(11,'Chrome','Selected Chrome site','Google Chrome',chromeLaunch('https://www.facebook.com/'));assert.deepEqual(h.names(),['Selected Chrome site']);
  h.emit(12,'other.app','Borrowed Chrome metadata','Facebook',chromeLaunch('https://www.facebook.com/'));assert.deepEqual(h.names(),['Selected Chrome site'],'The site policy still requires the verified Windows browser sender');
  h.mode(null);assert.deepEqual(h.names(),[],'An unknown native mode clears even selected sites');
  h.emit(13,'Chrome','Site during unknown mode','Google Chrome',chromeLaunch('https://www.facebook.com/'));assert.deepEqual(h.names(),[]);
  h.mode('AlarmsOnly');h.replay();assert.deepEqual(h.names(),[],'Unknown-state suppression is not replayed after recovery');
  h.emit(14,'Chrome','Site after mode recovery','Google Chrome',chromeLaunch('https://www.facebook.com/'));assert.deepEqual(h.names(),['Site after mode recovery']);
});

for(const restrictedMode of ['PriorityOnly','AlarmsOnly']){
await scenario({priorityDuringDnd:true},async h=>{
  h.emit(1,'ordinary.app','Normal oldest');h.emit(2,'ordinary.app','Normal newer');
  assert.deepEqual(h.names(),['Normal oldest','Normal newer'],'All mode continues serving unrelated notifications');
  h.emit(3,WHATSAPP,'Priority arrival');
  assert.deepEqual(h.names(),['Normal newer','Priority arrival'],'Priority immediately preempts the oldest ordinary local card');
  assert.equal(h.content.querySelectorAll('.ah-notice').length,3,'Preemption preserves the complete native history snapshot');
  h.emit(4,'ordinary.app','Queued normal');assert.equal(h.reports.at(-1).queued,1);
  h.mode(restrictedMode);assert.deepEqual(h.names(),['Priority arrival'],'Changing DND mode removes only ordinary visible cards');
  h.dismiss('Priority arrival');assert.deepEqual(h.names(),[],'Changing mode also removes ordinary queued cards');
  h.mode('All');h.replay();assert.deepEqual(h.names(),[],'Changing back cannot replay removed ordinary cards');
});

await scenario({priorityDuringDnd:true},async h=>{
  h.emit(1,WHATSAPP,'Priority first');h.emit(2,INSTAGRAM,'Priority second');
  for(let id=10;id<24;id++){h.emit(id,'ordinary.app',`Ordinary ${id}`);assert.ok(h.reports.at(-1).queued<=10);}
  h.emit(30,CHATGPT,'Queued priority first');h.emit(31,CLASSIC,'Queued priority second');
  assert.equal(h.cards().length,MAX_NOTIFICATION_POPUPS);assert.deepEqual(h.names(),['Priority first','Priority second'],'Priority does not preempt an already visible priority card');
  assert.ok(h.reports.at(-1).queued<=10,'The queue remains bounded when priority arrives during overflow');
  h.dismiss('Priority first');assert.deepEqual(h.names(),['Priority second','Queued priority first'],'Queued priority advances ahead of ordinary cards');
  h.mode(restrictedMode);h.dismiss('Priority second');assert.deepEqual(h.names(),['Queued priority first','Queued priority second'],'Both DND modes retain priority queue order');
  h.dismiss('Queued priority first');h.dismiss('Queued priority second');assert.deepEqual(h.names(),[],'No ordinary queue survives either restricted DND transition');
  assert.equal(h.content.querySelectorAll('.ah-notice').length,18,'Queue overflow affects only temporary banners, not history');
});
}

const ownedPolicy={priorityAppIds:[WHATSAPP,CHATGPT,FACEBOOK,INSTAGRAM],popupAppIds:[` ${WHATSAPP.toUpperCase()} `,CHATGPT],priorityDuringDnd:true};
for(const mode of ['All','PriorityOnly'])await scenario({...ownedPolicy,mode},async h=>{
  h.emit(1,FACEBOOK,'Windows Facebook');h.emit(2,INSTAGRAM,'Windows Instagram');
  assert.deepEqual(h.names(),[],'Selected but unowned senders retain Windows as their sole popup owner outside alarms-only');
  assert.equal(h.reports.at(-1).dropped.nativeOwned,1);assert.equal(h.reports.at(-1).dropped.quiet,0);
  h.emit(3,'Chrome','WhatsApp','ChatGPT');h.emit(4,'ordinary.app','Native app');assert.deepEqual(h.names(),[],'Other apps and display-name spoofs cannot enter the owned atom channel');
  h.emit(5,WHATSAPP,'Owned WhatsApp');h.emit(6,CHATGPT,'Owned ChatGPT');assert.deepEqual(h.names(),['Owned WhatsApp','Owned ChatGPT'],'Owned identities are canonical and continue through All and PriorityOnly');
  h.replay();assert.equal(h.cards().length,2);assert.equal(h.content.querySelectorAll('.ah-notice').length,6,'Every source stays in history without duplicated cards');
  h.mode('AlarmsOnly');h.emit(7,FACEBOOK,'DND Facebook queued');h.emit(8,INSTAGRAM,'DND Instagram queued');assert.equal(h.reports.at(-1).queued,2,'The explicit DND exception can queue selected unowned senders');
  h.mode(mode);
  h.dismiss('Owned WhatsApp');h.dismiss('Owned ChatGPT');assert.deepEqual(h.names(),[],'Leaving alarms-only removes unowned queued items before they can be displayed');
  h.mode('AlarmsOnly');h.replay();assert.deepEqual(h.names(),[],'Previously suppressed or removed items are never replayed on a mode change');
  h.emit(9,FACEBOOK,'Fresh DND Facebook');assert.deepEqual(h.names(),['Fresh DND Facebook']);
  h.mode(mode);assert.deepEqual(h.names(),[],'Leaving alarms-only removes an unowned visible card');
  h.replay();assert.deepEqual(h.names(),[]);assert.equal(h.content.querySelectorAll('.ah-notice').length,9,'Ownership changes never delete Windows history');
});

await scenario({...ownedPolicy,mode:'AlarmsOnly'},async h=>{
  h.emit(1,FACEBOOK,'DND Facebook');h.emit(2,INSTAGRAM,'DND Instagram');h.emit(3,WHATSAPP,'Owned queued');
  assert.deepEqual(h.names(),['DND Facebook','DND Instagram']);assert.equal(h.reports.at(-1).queued,1);
  h.mode('All');assert.deepEqual(h.names(),['Owned queued'],'A transition drops unowned visible cards and advances only an owned queued card');
  h.focus(true);assert.deepEqual(h.names(),[]);h.emit(4,CHATGPT,'During active Focus');
  h.focus(null);h.emit(5,WHATSAPP,'During unknown Focus');assert.deepEqual(h.names(),[]);
  h.focus(false);h.replay();assert.deepEqual(h.names(),[],'Active and unknown Focus remain strict vetoes with no replay');
  h.mode(null);h.emit(6,FACEBOOK,'Unknown mode');h.mode('AlarmsOnly');h.replay();assert.deepEqual(h.names(),[]);
  h.emit(7,INSTAGRAM,'Fresh after recovery');assert.deepEqual(h.names(),['Fresh after recovery']);
  assert.equal(h.content.querySelectorAll('.ah-notice').length,7);
});

await scenario({...ownedPolicy,popupAppIds:[]},async h=>{
  h.emit(1,WHATSAPP,'No All ownership');assert.deepEqual(h.names(),[]);assert.equal(h.reports.at(-1).quiet.allowed,false);assert.equal(h.reports.at(-1).quiet.reason,'native-owned');
  h.mode('PriorityOnly');h.emit(2,CHATGPT,'No PriorityOnly ownership');assert.deepEqual(h.names(),[]);assert.equal(h.reports.at(-1).quiet.allowed,false);
  h.mode('AlarmsOnly');h.emit(3,FACEBOOK,'Explicit DND only');assert.deepEqual(h.names(),['Explicit DND only'],'An empty normal ownership list does not disable the separately authorised DND exception');
  h.mode('All');assert.deepEqual(h.names(),[]);h.replay();assert.deepEqual(h.names(),[]);
});

await scenario({popupAppIds:['ordinary.app'],priorityDuringDnd:true},async h=>{
  h.emit(1,'ordinary.app','Owned non-priority');assert.deepEqual(h.names(),['Owned non-priority'],'Ownership alone permits an ordinary sender in All mode');
  h.mode('PriorityOnly');assert.deepEqual(h.names(),[]);h.emit(2,WHATSAPP,'Unowned priority');assert.deepEqual(h.names(),[]);assert.equal(h.reports.at(-1).quiet.allowed,false,'PriorityOnly channel requires an intersection of owned and priority senders');
  h.mode('All');h.replay();assert.deepEqual(h.names(),[]);h.emit(3,'ordinary.app','Fresh owned normal');assert.deepEqual(h.names(),['Fresh owned normal']);
});

console.log('Notification priority: exact bounded identities and popup ownership, Windows-only normal-mode fallbacks, opt-in alarms-only exceptions, owned-only transitions and queues, Chrome site routing, Focus/unknown vetoes, default All-mode compatibility, history preservation, deduplication and disposal passed. Synthetic local fixtures only; no service notification or Windows setting was read or changed.');
