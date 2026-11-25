import {config} from './config.mjs';
import {normaliseNotificationSiteRules,notificationMatchesPrioritySite} from './aurora-notification-sites.mjs';
/* Windows notification snapshots from the Seelen host. Memory only and read only. */
const instances=new WeakMap();
export const NOTIFICATION_STALE_MS=150000;
export const MAX_DISPLAYED_NOTIFICATIONS=200;
export const NOTIFICATION_POPUP_MS=12000;
export const MAX_NOTIFICATION_POPUPS=2;
export const NOTIFICATION_ARRIVAL_MAX_AGE_MS=30000;
const MAX_SOURCE_NOTIFICATIONS=5000;
const cleanText=(value,max)=>typeof value==='string'?value.replaceAll('\u0000','').trim().slice(0,max):'';
// Windows sender identity comparisons are case-insensitive. Keep the original
// cleaned AUMID on the item for native activation, canonicalise dedup keys only.
const canonicalNotificationSender=value=>cleanText(value,2048).toLowerCase();
const activationTypeOf=value=>value===null||value===undefined||value===''?'Foreground':({foreground:'Foreground',background:'Background',protocol:'Protocol',system:'System'})[String(value).toLowerCase()]||null;
export function notificationText(content){
  const lines=[];
  const add=value=>{const line=cleanText(value,4000);if(line&&lines.length<16)lines.push(line);};
  const values=content?.visual?.binding?.$value;
  if(Array.isArray(values))for(const item of values.slice(0,80)){
    if(item?.text)add(item.text.$value);
    if(Array.isArray(item?.group?.subgroup))for(const subgroup of item.group.subgroup.slice(0,12)){
      if(Array.isArray(subgroup?.$value))for(const child of subgroup.$value.slice(0,40))if(child?.text)add(child.text.$value);
    }
  }
  return{title:lines[0]||'Notification',body:lines.slice(1).join('\n').slice(0,12000)};
}
export function normaliseNotifications(raw){
  if(!Array.isArray(raw)||raw.length>MAX_SOURCE_NOTIFICATIONS)throw new Error('Notification snapshot unavailable');
  const ids=new Set(),items=[];let invalid=0;
  for(const item of raw){
    if(!item||!Number.isInteger(item.id)||item.id<0||item.id>4294967295||typeof item.appName!=='string'||typeof item.appUmid!=='string'||!Number.isFinite(item.date)||item.date<=0||!Number.isFinite(new Date(item.date).getTime())){invalid++;continue;}
    const key=canonicalNotificationSender(item.appUmid)+'|'+item.id;if(ids.has(key))continue;ids.add(key);
    const activationType=activationTypeOf(item.content?.['@activationType']);
    items.push({id:item.id,appId:cleanText(item.appUmid,2048),appName:cleanText(item.appName,160)||'Application',at:item.date,...notificationText(item.content),activationType,args:cleanText(item.content?.['@launch'],4096)});
  }
  if(raw.length&&!items.length)throw new Error('Notification snapshot could not be read');
  items.sort((a,b)=>b.at-a.at||b.id-a.id);
  return{items:items.slice(0,MAX_DISPLAYED_NOTIFICATIONS),count:items.length,invalid,truncated:items.length>MAX_DISPLAYED_NOTIFICATIONS};
}
export function notificationIdentity(item){
  let hash=2166136261;for(const char of (item.title+'\n'+item.body)){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
  return canonicalNotificationSender(item.appId)+'|'+item.id+'|'+item.at+'|'+hash;
}
/** Baseline existing history once, then surface fresh unseen Windows arrivals only. */
export function createNotificationArrivalTracker({now=()=>Date.now(),maxSeen=2000}={}){
  let baselined=false;const startedAt=now(),seen=new Map(),knownItems=new Map(),seenLimit=Number.isInteger(maxSeen)&&maxSeen>0?Math.min(5000,maxSeen):2000;
  return{accept(items,{liveEvent=false,onDiagnostics}={}){
    const current=now(),arrivals=[],summary={source:liveEvent?'native':'read',at:current,baselined,valid:items.length,candidates:0,changedKnown:0,minimumAgeMs:null,maximumAgeMs:null,dropped:{baseline:0,duplicate:0,stale:0,future:0,invalid:0,quiet:0}};
    for(const item of items){
      const id=notificationIdentity(item),stableId=canonicalNotificationSender(item.appId)+'|'+item.id;
      const changedKnownItem=liveEvent&&knownItems.has(stableId)&&knownItems.get(stableId)!==id;
      const age=current-item.at,recent=age<=NOTIFICATION_ARRIVAL_MAX_AGE_MS;
      // The first native snapshot can arrive before a cold history read settles.
      // Only notifications created during this instance may bypass that baseline.
      const createdSinceStartup=liveEvent&&!baselined&&item.at>=startedAt;
      summary.minimumAgeMs=summary.minimumAgeMs===null?age:Math.min(summary.minimumAgeMs,age);summary.maximumAgeMs=summary.maximumAgeMs===null?age:Math.max(summary.maximumAgeMs,age);if(changedKnownItem)summary.changedKnown++;
      if(seen.has(id))summary.dropped.duplicate++;
      else if(item.at>current+5000)summary.dropped.future++;
      else if(!baselined&&!createdSinceStartup)summary.dropped.baseline++;
      else if(!recent&&!changedKnownItem)summary.dropped.stale++;
      else arrivals.push(item);
      seen.delete(id);seen.set(id,current);knownItems.delete(stableId);knownItems.set(stableId,id);
    }
    baselined=true;while(seen.size>seenLimit)seen.delete(seen.keys().next().value);while(knownItems.size>seenLimit)knownItems.delete(knownItems.keys().next().value);
    summary.candidates=arrivals.length;try{onDiagnostics?.(summary);}catch{}
    return arrivals.sort((a,b)=>a.at-b.at);
  },dispose(){seen.clear();knownItems.clear();baselined=false;}};
}
/** Explicit local preferences, never inferred from message text or app display names. */
export function normaliseNotificationPriorityIds(values){
  if(!Array.isArray(values))return[];
  return [...new Set(values.filter(value=>typeof value==='string').map(value=>value.trim().toLowerCase()).filter(value=>value.length>0&&value.length<=2048&&!/[\s*?\u0000-\u001f]/.test(value)))].slice(0,64);
}
export function notificationIsPriority(item,ids){
  const id=typeof item?.appId==='string'?item.appId.trim().toLowerCase():'';
  return id!==''&&(ids instanceof Set?ids.has(id):normaliseNotificationPriorityIds(ids).includes(id));
}
export function notificationPopupAllowed({focusAssist,mode,priority=false,priorityDuringDnd=false,hidden=false,paused=false,popupOnly=false}={}){
  // Seelen's focusAssist is an active Windows Focus session, separate from DND.
  // Crossing alarms-only is an additional explicit local opt-in. This never
  // changes Windows settings; active Focus and unknown states still block.
  return focusAssist===false&&(mode==='All'||priority===true&&(mode==='PriorityOnly'||mode==='AlarmsOnly'&&priorityDuringDnd===true))&&!paused&&(!hidden||popupOnly);
}
export function notificationActivation(item){
  const activationType=item.activationType===null?null:activationTypeOf(item.activationType);if(!activationType)return null;
  return{id:item.id,umid:item.appId,args:item.args||'',activationType,inputData:{}};
}
export function notificationIconSrc(value){
  if(typeof value!=='string'||value.length>512000)return null;
  if(/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(value))return value;
  try{const url=new URL(value);return url.protocol==='asset:'&&url.hostname==='localhost'||['http:','https:'].includes(url.protocol)&&url.hostname==='asset.localhost'?value:null;}catch{return null;}
}
export function notificationView({loading=false,error=false,lastSuccess=null,snapshot=null}={},now=Date.now()){
  const count=snapshot?.count||0;
  if(error)return{state:'error',label:'Notification refresh unavailable',detail:count?'Showing the last notifications read from Seelen.':'Windows notifications could not be read. Try Refresh or open the Windows notification panel.'};
  if(lastSuccess!==null&&(now-lastSuccess>NOTIFICATION_STALE_MS||now<lastSuccess))return{state:'stale',label:'Notification list may be out of date',detail:'This is the last snapshot read from Seelen. Use Refresh to try again.'};
  if(snapshot&&count)return{state:'available',label:'Windows notifications',detail:'Updated from Seelen. '+(snapshot.truncated?'Showing the newest '+MAX_DISPLAYED_NOTIFICATIONS+' of '+count+'.':'Read only.')+(snapshot.invalid?' Some unreadable notifications were omitted.':'')};
  if(snapshot)return{state:'empty',label:'No Windows notifications available',detail:'Seelen returned no notifications. Notification access is not verified.'};
  return{state:'loading',label:loading?'Reading Windows notifications':'Windows notifications unavailable',detail:'Reading the desktop notification feed.'};
}
const STYLE=`
#aurora-home-preview .ah-window-layer:has(.ah-window[data-panel=notifications]){overflow:hidden;overscroll-behavior:contain}
#aurora-home-preview .ah-window[data-panel=notifications]{width:560px;max-width:calc(100% - 32px);min-height:0;overflow:hidden;border:1px solid #d9c68b66;box-shadow:0 10px 30px #00000066,inset 0 1px 0 #f0e4bd1f}
#aurora-home-preview .ah-window[data-panel=notifications] .ah-window-content{display:flex;flex:1 1 auto;min-height:0;overflow:hidden}
#aurora-home-preview .anot-panel{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
#aurora-home-preview .anot-panel> :not(.ah-notice-list){flex:none}
#aurora-home-preview .anot-panel>.ah-notice-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;scrollbar-width:thin;scrollbar-color:#b69e5d66 transparent;scrollbar-gutter:stable;padding-right:5px;margin:12px 0}
#aurora-home-preview .anot-panel>.ah-notice-list:focus-visible{outline:1px solid #d9c68b66;outline-offset:-1px;border-radius:10px}
#aurora-home-preview .anot-panel>.ah-notice-list>.ah-notice{flex:none}
#aurora-home-preview .anot-panel>.ah-panel-actions{margin-top:0;padding-top:12px;border-top:1px solid #d6d9df24;flex-wrap:wrap}
#aurora-home-preview .anot-status{margin:10px 0 4px;padding:10px 12px;border:1px solid #d6d9df24;border-radius:9px;background:#ffffff05;color:#d4d5d9;font-size:11px;line-height:1.5}
#aurora-home-preview .anot-status[data-state=error],#aurora-home-preview .anot-status[data-state=stale]{border-color:#d1b67b43;color:#dfcfa9}
#aurora-home-preview .anot-status strong,#aurora-home-preview .anot-status small{display:block;font-size:inherit}
#aurora-home-preview .anot-status small{color:#adb0b7;margin-top:3px}
#aurora-home-preview .anot-app-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;border:1px solid #e8ca8338;background:#e8ca830e;color:var(--ah-accent);font-size:11px;font-weight:600}
#aurora-home-preview .ah-notice .anot-app-name{font-size:10px;color:#adb0b7;font-weight:600}
#aurora-home-preview .ah-notice .anot-title{font-size:12px;color:#eeeee9;line-height:1.45;overflow-wrap:anywhere}
#aurora-home-preview .ah-notice .anot-body{font-size:12px;color:#c2c5cc;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
#aurora-home-preview .anot-empty{padding:18px 4px;color:#b5b9c2;font-size:12px;line-height:1.5}
`;

export function initNativeNotifications({root,invoke,subscribe,SeelenCommand={},SeelenEvent={},nativeStatus,popups=true,popupOnly=false,popupDuration=NOTIFICATION_POPUP_MS,priorityAppIds=[],prioritySites=[],priorityDuringDnd=false,popupAppIds=null,openHistory,onPopupVisibilityChange,resolveAppIcon,onArrivalDiagnostics,onPopupLifecycle}={}){
  if(!root?.ownerDocument||typeof invoke!=='function')return{renderPanel(){},renderBadge(){},dispose(){}};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const style=make('style');style.textContent=STYLE;root.append(style);
  const badge=root.querySelector('.ah-notification-count'),bell=root.querySelector('.ah-notification-button');
  const state={loading:false,error:false,lastSuccess:null,snapshot:null};
  const clockFormat=new Intl.DateTimeFormat('en-AU',{timeZone:config.timezone,day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  let disposed=false,unsubscribe=null,revision=0,refreshing=false,poll=0,requestAt=-Infinity;
  let mounted=null,listKey='';
  const timers=new Map();
  const arrivals=createNotificationArrivalTracker(),live=new Map(),queue=[],quiet={focusAssist:null,mode:null},quietStops=[],quietRevision={focusAssist:0,mode:0},quietPending=new Map();
  const popupLifetime=Number.isFinite(popupDuration)?Math.max(12000,Math.min(30000,popupDuration)):NOTIFICATION_POPUP_MS;
  let popupSerial=0,stack=null,settingBusy=false,quietPoll=0,quietRetry=0,quietRetryDelay=2000,arrivalBaseline=false;
  if(popups){stack=make('section','anot-live-stack');stack.setAttribute('aria-label','New Windows notifications');stack.setAttribute('aria-live','polite');stack.setAttribute('aria-relevant','additions');stack.hidden=true;root.append(stack);}
  if(popupOnly)root.dataset.notificationOverlay='true';
  const priorityIds=new Set(normaliseNotificationPriorityIds(priorityAppIds));
  const popupIds=popupAppIds===null?null:new Set(normaliseNotificationPriorityIds(popupAppIds));
  const siteRules=normaliseNotificationSiteRules(prioritySites),hasPriority=priorityIds.size>0||siteRules.length>0;
  const hasOwnedPriority=popupIds===null?hasPriority:[...priorityIds].some(id=>popupIds.has(id))||siteRules.some(rule=>popupIds.has(rule.appId));
  const isPriority=item=>notificationIsPriority(item,priorityIds)||notificationMatchesPrioritySite(item,siteRules);
  const quietAllowsPopup=item=>popups&&notificationPopupAllowed({...quiet,priority:item?isPriority(item):hasPriority,priorityDuringDnd,hidden:doc.hidden,paused:root.dataset.paused==='true',popupOnly});
  // A configured list gives Aurora sole popup ownership only for these senders.
  // Other apps keep Windows banners. In alarms-only, Windows is already quiet,
  // so the separate explicit priority exception may still use the atom.
  const ownsPopup=item=>popupIds===null||notificationIsPriority(item,popupIds)||(quiet.mode==='AlarmsOnly'&&priorityDuringDnd===true&&isPriority(item));
  const ownershipAvailable=()=>quiet.mode==='AlarmsOnly'&&priorityDuringDnd===true&&hasPriority||(quiet.mode==='PriorityOnly'?hasOwnedPriority:popupIds===null||popupIds.size>0);
  const popupAllowed=item=>quietAllowsPopup(item)&&(item?ownsPopup(item):ownershipAvailable());
  function quietSnapshot(){return{focusAssist:quiet.focusAssist,mode:quiet.mode,paused:root.dataset.paused==='true',hidden:Boolean(doc.hidden),popupOnly,allowed:popupAllowed(),reason:quietReason()};}
  function popupLifecycle(action,reason,before,entries=[]){
    const at=Date.now(),ages=entries.map(entry=>Math.max(0,at-entry.createdAt));
    try{Promise.resolve(onPopupLifecycle?.({action,reason,at,durationMs:popupLifetime,liveBefore:before.live,queuedBefore:before.queued,liveAfter:live.size,queuedAfter:queue.length,minimumAgeMs:ages.length?Math.min(...ages):null,maximumAgeMs:ages.length?Math.max(...ages):null,quiet:quietSnapshot()})).catch(()=>{});}catch{}
  }
  function popupVisibility(){if(stack)stack.hidden=live.size===0;try{Promise.resolve(onPopupVisibilityChange?.(live.size>0)).catch(()=>{});}catch{}}
  function clearPopups(reason='quiet-gate'){const before={live:live.size,queued:queue.length},entries=[...live.values()];queue.length=0;for(const entry of entries){win.clearTimeout(entry.timer);entry.card.remove();}live.clear();if(before.live||before.queued)popupLifecycle('cleared',reason,before,entries);popupVisibility();}
  function reconcilePopupPolicy(reason='quiet-gate'){
    if(!popupAllowed()){clearPopups(reason);return;}
    const before={live:live.size,queued:queue.length},removed=[];
    for(let i=queue.length-1;i>=0;i--)if(!popupAllowed(queue[i]))queue.splice(i,1);
    for(const [id,entry]of live)if(!popupAllowed(entry.item)){win.clearTimeout(entry.timer);entry.card.remove();live.delete(id);removed.push(entry);}
    if(removed.length||queue.length!==before.queued)popupLifecycle('cleared',reason,before,removed);
    pumpPopups();
  }
  function dismissPopup(id,reason='user'){const entry=live.get(id);if(!entry)return;const before={live:live.size,queued:queue.length};win.clearTimeout(entry.timer);entry.card.remove();live.delete(id);popupLifecycle('dismissed',reason,before,[entry]);pumpPopups();popupVisibility();}
  function armPopup(entry,remaining=popupLifetime){if(disposed||!live.has(entry.id))return;win.clearTimeout(entry.timer);entry.paused=false;entry.remaining=remaining;entry.startedAt=Date.now();entry.timer=win.setTimeout(()=>dismissPopup(entry.id,'timeout'),remaining);}
  function holdPopup(entry){if(!live.has(entry.id)||entry.paused)return;entry.paused=true;win.clearTimeout(entry.timer);entry.remaining=Math.max(3000,entry.remaining-(Date.now()-entry.startedAt));}
  function pumpPopups(){
    if(disposed||!stack||!popupAllowed()){clearPopups(disposed?'disposed':'quiet-gate');return;}
    // A selected app can replace an ordinary local card immediately. The Windows
    // notification stays in history, and no dismissed card is replayed later.
    while(queue.filter(isPriority).length>MAX_NOTIFICATION_POPUPS-live.size){
      const ordinary=[...live.values()].find(entry=>!isPriority(entry.item));
      if(!ordinary)break;
      const before={live:live.size,queued:queue.length};win.clearTimeout(ordinary.timer);ordinary.card.remove();live.delete(ordinary.id);popupLifecycle('dismissed','priority',before,[ordinary]);
    }
    while(queue.length&&live.size<MAX_NOTIFICATION_POPUPS){
      const item=queue.shift();if(!popupAllowed(item))continue;
      const id=String(++popupSerial),card=make('article','anot-live-popup');card.dataset.anotPopup=id;card.dataset.priority=isPriority(item)?'high':'normal';
      const header=make('header','anot-live-header'),mark=make('span','anot-live-app-icon',item.appName.split(/\s+/).slice(0,2).map(word=>[...word][0]||'').join('').toUpperCase());mark.setAttribute('aria-hidden','true');
      const identity=make('div','anot-live-identity');identity.append(make('strong','anot-live-app',item.appName),make('time','anot-live-time',(isPriority(item)?'Priority · ':'')+clockFormat.format(new Date(item.at))));
      const close=make('button','anot-live-dismiss cursor-interaction','×');close.type='button';close.dataset.anotAction='live-dismiss';close.dataset.anotPopup=id;close.setAttribute('aria-label','Dismiss popup from '+item.appName);header.append(mark,identity,close);
      const title=make('h3','anot-live-title',item.title),body=make('p','anot-live-body',item.body),actions=make('footer','anot-live-actions');
      const open=make('button','anot-live-open cursor-interaction','Open');open.type='button';open.dataset.anotAction='live-open';open.dataset.anotPopup=id;open.disabled=!SeelenCommand.ActivateNotification||!notificationActivation(item);
      const history=make('button','anot-live-history cursor-interaction','History');history.type='button';history.dataset.anotAction='live-history';actions.append(open,history);card.append(header,title);if(item.body)card.append(body);card.append(actions);
      const before={live:live.size,queued:queue.length},entry={id,item,card,timer:0,remaining:popupLifetime,startedAt:Date.now(),createdAt:Date.now()};live.set(id,entry);stack.append(card);popupLifecycle('created','arrived',before,[entry]);
      if(typeof resolveAppIcon==='function')void Promise.resolve().then(()=>resolveAppIcon(item)).then(value=>{const src=notificationIconSrc(value);if(!src||disposed||live.get(id)!==entry)return;const image=make('img');image.alt='';image.setAttribute('aria-hidden','true');image.addEventListener('load',()=>{if(!disposed&&live.get(id)===entry){mark.textContent='';mark.replaceChildren(image);mark.className+=' anot-live-app-image';}});image.src=src;}).catch(()=>{});
      card.addEventListener('pointerenter',()=>holdPopup(entry));card.addEventListener('pointerleave',()=>{if(!card.contains(doc.activeElement))armPopup(entry,entry.remaining);});
      card.addEventListener('focusin',()=>holdPopup(entry));card.addEventListener('focusout',event=>{if(!card.contains(event.relatedTarget))armPopup(entry,entry.remaining);});armPopup(entry);
    }
    popupVisibility();
  }
  function quietReason(){return !popups?'disabled':root.dataset.paused==='true'?'paused':quiet.focusAssist===null?'focus-unknown':quiet.focusAssist?'focus-assist':quiet.mode===null?'mode-unknown':quiet.mode!=='All'&&!((quiet.mode==='PriorityOnly'||quiet.mode==='AlarmsOnly'&&priorityDuringDnd===true)&&hasPriority)?'mode-'+quiet.mode:doc.hidden&&!popupOnly?'hidden':!ownershipAvailable()?'native-owned':null;}
  function arrivalDiagnostic(summary){try{Promise.resolve(onArrivalDiagnostics?.(summary)).catch(()=>{});}catch{}}
  function receiveArrivals(snapshot,options){
    let summary;const fresh=arrivals.accept(snapshot.items,{...options,onDiagnostics:value=>{summary=value;}}),allowed=popupAllowed(),reason=quietReason(),beforeSerial=popupSerial;
    arrivalBaseline=true;let overflow=0,accepted=0,priorityAccepted=0;
    const quietEligible=fresh.filter(item=>quietAllowsPopup(item)),eligible=quietEligible.filter(ownsPopup);
    if(allowed){
      queue.push(...eligible);queue.sort((a,b)=>Number(isPriority(b))-Number(isPriority(a))||a.at-b.at);
      overflow=Math.max(0,queue.length-10);const dropped=overflow?queue.splice(10):[];
      const kept=eligible.filter(item=>!dropped.includes(item));accepted=kept.length;priorityAccepted=kept.filter(isPriority).length;pumpPopups();
    }
    summary.dropped.invalid=snapshot.invalid;summary.dropped.quiet=fresh.length-quietEligible.length;summary.dropped.nativeOwned=quietEligible.length-eligible.length;summary.dropped.queueOverflow=overflow;
    arrivalDiagnostic({...summary,received:snapshot.count+snapshot.invalid,totalValid:snapshot.count,truncated:snapshot.count-snapshot.items.length,accepted,priorityCandidates:fresh.filter(isPriority).length,priorityAccepted,created:popupSerial-beforeSerial,queued:queue.length,live:live.size,quiet:{focusAssist:quiet.focusAssist,mode:quiet.mode,paused:root.dataset.paused==='true',hidden:Boolean(doc.hidden),popupOnly,allowed,reason}});
  }
  async function readQuietSetting(key,command,valid){
    if(!command)return;let request=quietPending.get(key);
    if(!request){request={revision:quietRevision[key],promise:Promise.resolve().then(()=>invoke(command))};quietPending.set(key,request);const settled=()=>{if(quietPending.get(key)===request)quietPending.delete(key);};request.promise.then(settled,settled);}
    try{const value=await bounded(request.promise);if(!disposed&&request.revision===quietRevision[key])quiet[key]=valid(value)?value:null;}
    catch{if(!disposed&&request.revision===quietRevision[key])quiet[key]=null;}
  }
  async function readQuietState(){
    if(!popups||disposed||settingBusy)return;settingBusy=true;
    try{await Promise.all([
      readQuietSetting('focusAssist',SeelenCommand.GetFocusAssist,value=>typeof value==='boolean'),
      readQuietSetting('mode',SeelenCommand.GetNotificationsMode,value=>['All','PriorityOnly','AlarmsOnly'].includes(value))
    ]);if(!disposed)reconcilePopupPolicy('quiet-read');}finally{settingBusy=false;
      if(!disposed){if(quiet.focusAssist!==null&&quiet.mode!==null){quietRetryDelay=2000;win.clearTimeout(quietRetry);quietRetry=0;}else if(!quietRetry){quietRetry=win.setTimeout(()=>{quietRetry=0;void readQuietState();},quietRetryDelay);quietRetryDelay=Math.min(30000,quietRetryDelay*2);}}
    }
  }
  function bounded(promise){
    return new Promise((resolve,reject)=>{
      const timer=win.setTimeout(()=>{timers.delete(timer);reject(new Error('Notification feed unavailable'));},6000);timers.set(timer,reject);
      Promise.resolve(promise).then(value=>{win.clearTimeout(timer);timers.delete(timer);resolve(value);},error=>{win.clearTimeout(timer);timers.delete(timer);reject(error);});
    });
  }
  function renderBadge(){
    if(disposed)return;
    const view=notificationView(state),count=state.snapshot?.count||0;
    if(badge){badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;}
    if(bell){
      const label='Windows notifications'+(count?', '+count+(view.state==='available'?'':' last read'):'')+(view.state==='error'?', refresh unavailable':view.state==='stale'?', may be out of date':'');
      bell.setAttribute('aria-label',label);bell.setAttribute('data-tooltip',view.label);bell.title=view.label;
    }
  }
  function paint(){
    if(disposed)return;renderBadge();
    if(!mounted?.content.contains(mounted.marker))return;
    const view=notificationView(state),snapshot=state.snapshot;
    mounted.status.dataset.state=view.state;mounted.label.textContent=view.label;mounted.detail.textContent=view.detail;
    mounted.time.textContent=state.lastSuccess===null?'':'Last read '+clockFormat.format(new Date(state.lastSuccess))+' · '+config.clockLabel;
    mounted.refresh.disabled=state.loading;
    const key=JSON.stringify(snapshot?.items||[])+'|'+view.state;
    if(key===listKey)return;listKey=key;mounted.list.replaceChildren();
    if(!snapshot?.items.length){mounted.list.append(make('li','anot-empty',view.state==='loading'?'Reading notification history…':view.state==='empty'?'New notifications will appear here when Windows makes them available.':'No notification list is available.'));return;}
    for(const item of snapshot.items){
      const card=make('li','ah-notice');
      const mark=make('span','anot-app-mark',item.appName.split(/\s+/).slice(0,2).map(word=>[...word][0]||'').join('').toUpperCase());mark.setAttribute('aria-hidden','true');
      const text=make('div');text.append(make('span','anot-app-name',item.appName),make('strong','anot-title',item.title));if(item.body)text.append(make('span','anot-body',item.body));
      const time=make('time','',clockFormat.format(new Date(item.at))+' · '+config.clockLabel);time.setAttribute('datetime',new Date(item.at).toISOString());text.append(time);card.append(mark,text);mounted.list.append(card);
    }
  }
  function accept(raw,options){
    let snapshot;
    try{snapshot=normaliseNotifications(raw);}catch(error){const count=Array.isArray(raw)?Math.min(raw.length,MAX_SOURCE_NOTIFICATIONS):1;arrivalDiagnostic({source:options?.liveEvent?'native':'read',at:Date.now(),baselined:arrivalBaseline,received:count,valid:0,totalValid:0,truncated:0,candidates:0,accepted:0,created:0,queued:queue.length,live:live.size,changedKnown:0,minimumAgeMs:null,maximumAgeMs:null,dropped:{baseline:0,duplicate:0,stale:0,future:0,invalid:count,quiet:0,nativeOwned:0,queueOverflow:0},quiet:{focusAssist:quiet.focusAssist,mode:quiet.mode,paused:root.dataset.paused==='true',hidden:Boolean(doc.hidden),popupOnly,allowed:popupAllowed(),reason:quietReason()}});throw error;}
    state.snapshot=snapshot;state.lastSuccess=Date.now();state.error=false;state.loading=false;revision++;receiveArrivals(state.snapshot,options);paint();
  }
  async function refresh(force=false){
    if(disposed||refreshing||(!force&&doc.hidden&&!popupOnly)||Date.now()-requestAt<500)return;
    requestAt=Date.now();refreshing=true;state.loading=true;paint();const startedRevision=revision;
    try{
      if(!SeelenCommand.GetNotifications)throw new Error('Notification command unavailable');
      const request=Promise.resolve().then(()=>invoke(SeelenCommand.GetNotifications)).then(value=>{
        // A cold native read may resolve after the UI's six-second deadline.
        // Establish history then, provided no event or newer read replaced it.
        if(!disposed&&startedRevision===revision)accept(value);
        return value;
      });
      await bounded(request);
    }catch{if(!disposed&&startedRevision===revision){state.error=true;state.loading=false;paint();}}
    finally{refreshing=false;if(!disposed){state.loading=false;paint();}}
  }
  function renderPanel(content){
    if(disposed||!content)return;
    const isNew=!mounted||mounted.content!==content||!content.contains(mounted.marker);
    if(isNew){
      const marker=make('div','anot-panel');marker.append(make('span','ah-panel-badge','Windows notifications'),make('h3','','Your notifications.'));
      const status=make('div','anot-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const label=make('strong'),detail=make('span'),time=make('small');status.append(label,detail,time);marker.append(status);
      const list=make('ul','ah-notice-list');list.tabIndex=0;list.setAttribute('aria-label','Notification history. Scroll to read older notifications.');marker.append(list);
      const actions=make('div','ah-panel-actions'),refreshButton=make('button','ah-secondary cursor-interaction','Refresh'),enableButton=make('button','ah-secondary cursor-interaction','Enable live alerts'),openButton=make('button','ah-secondary cursor-interaction','Open notification controls');
      refreshButton.type='button';refreshButton.dataset.anotAction='refresh';enableButton.type='button';enableButton.dataset.anotAction='enable-live';enableButton.disabled=!SeelenCommand.SetNotificationsMode||!SeelenCommand.GetNotificationsMode;enableButton.title='Allow all Windows app notification pop-ups';openButton.type='button';openButton.dataset.anotAction='open';actions.append(refreshButton,enableButton,openButton);marker.append(actions);
      content.replaceChildren(marker);mounted={content,marker,status,label,detail,time,list,refresh:refreshButton};listKey='';
      const panel=root.querySelector('.ah-window');if(panel?.dataset.panel==='notifications'){panel.setAttribute('aria-label','Windows notifications');const name=root.querySelector('.ah-window-name');if(name)name.textContent='Windows notifications';}
    }
    paint();if(isNew)void refresh(true);
  }
  const onClick=event=>{
    const button=event.target?.closest?.('[data-anot-action]');if(disposed||!button||!root.contains(button))return;
    if(button.dataset.anotAction==='enable-live'){
      if(button.disabled||typeof win.__auroraHandleSearchCommand!=='function')return;
      button.disabled=true;
      void Promise.resolve(win.__auroraHandleSearchCommand('notifications-all')).then(success=>{if(!disposed&&!success)nativeStatus?.('Live alerts could not be enabled. Open notification controls to check Windows settings.');}).catch(()=>{if(!disposed)nativeStatus?.('Live alerts could not be enabled.');}).finally(()=>{if(!disposed)button.disabled=false;});return;
    }
    if(button.dataset.anotAction==='live-dismiss'){dismissPopup(button.dataset.anotPopup);return;}
    if(button.dataset.anotAction==='live-history'){
      if(typeof openHistory==='function'){try{Promise.resolve(openHistory()).catch(()=>nativeStatus?.('Notification history could not open.'));}catch{nativeStatus?.('Notification history could not open.');}}
      else if(typeof win.__auroraOpenPanel==='function')win.__auroraOpenPanel('notifications');
      else if(SeelenCommand.TriggerWidget)void bounded(Promise.resolve().then(()=>invoke(SeelenCommand.TriggerWidget,{payload:{id:'@seelen/notifications'}}))).catch(()=>nativeStatus?.('The Windows notification panel could not open.'));
      return;
    }
    if(button.dataset.anotAction==='live-open'){
      const entry=live.get(button.dataset.anotPopup);if(!entry||!SeelenCommand.ActivateNotification)return;
      const activation=notificationActivation(entry.item);if(!activation)return;
      button.disabled=true;void bounded(Promise.resolve().then(()=>invoke(SeelenCommand.ActivateNotification,activation))).then(()=>{if(!disposed)dismissPopup(entry.id,'activated');}).catch(()=>{if(!disposed)nativeStatus?.('This notification could not open. Use History to view it.');}).finally(()=>{if(!disposed)button.disabled=false;});return;
    }
    if(button.dataset.anotAction==='refresh'){void refresh(true);return;}
    if(button.dataset.anotAction==='open'){
      if(!SeelenCommand.TriggerWidget){nativeStatus?.('The Windows notification panel is unavailable.');return;}
      button.disabled=true;
      void bounded(Promise.resolve().then(()=>invoke(SeelenCommand.TriggerWidget,{payload:{id:'@seelen/notifications'}}))).catch(()=>{if(!disposed)nativeStatus?.('The Windows notification panel could not open.');}).finally(()=>{if(!disposed)button.disabled=false;});
    }
  };
  const visible=()=>{paint();reconcilePopupPolicy('document-visibility');if(!doc.hidden&&!popupOnly)void refresh();};
  root.addEventListener('click',onClick);doc.addEventListener('visibilitychange',visible);
  if(SeelenEvent.Notifications&&typeof subscribe==='function'){
    void Promise.resolve().then(()=>subscribe(SeelenEvent.Notifications,event=>{
      if(disposed)return;try{accept(event?.payload,{liveEvent:true});}catch{state.error=true;state.loading=false;revision++;paint();}
    })).then(stop=>{if(typeof stop==='function'){if(disposed)stop();else unsubscribe=stop;}}).catch(()=>{});
  }
  if(popups){
    void readQuietState();
    for(const [name,key,valid] of [[SeelenEvent.FocusAssistChanged,'focusAssist',value=>typeof value==='boolean'],[SeelenEvent.NotificationsModeChanged,'mode',value=>['All','PriorityOnly','AlarmsOnly'].includes(value)]]){
      if(!name||typeof subscribe!=='function')continue;
      void Promise.resolve().then(()=>subscribe(name,event=>{if(disposed)return;quietRevision[key]++;quiet[key]=valid(event?.payload)?event.payload:null;reconcilePopupPolicy('quiet-event-'+key);})).then(stop=>{if(typeof stop==='function'){if(disposed)stop();else quietStops.push(stop);}}).catch(()=>{});
    }
    quietPoll=win.setInterval(()=>{void readQuietState();},30000);
  }
  const popupObserver=popups&&win.MutationObserver?new win.MutationObserver(()=>{reconcilePopupPolicy('paused-state');}):null;
  popupObserver?.observe(root,{attributes:true,attributeFilter:['data-paused']});
  function dispose(){
    if(disposed)return;disposed=true;win.clearInterval(poll);win.clearInterval(quietPoll);win.clearTimeout(quietRetry);for(const [timer,reject] of timers){win.clearTimeout(timer);reject(new Error('Notification view disposed'));}timers.clear();
    try{unsubscribe?.();}catch{}for(const stop of quietStops)try{stop();}catch{}quietPending.clear();popupObserver?.disconnect();clearPopups('disposed');stack?.remove();arrivals.dispose();root.removeEventListener('click',onClick);doc.removeEventListener('visibilitychange',visible);win.removeEventListener('pagehide',dispose);style.remove();mounted?.marker.remove();mounted=null;state.snapshot=null;
    if(badge){badge.textContent='0';badge.hidden=true;}instances.delete(root);
  }
  const api={renderPanel,renderBadge,dispose};instances.set(root,api);win.addEventListener('pagehide',dispose,{once:true});
  renderBadge();void refresh();if(!popupOnly)poll=win.setInterval(()=>{paint();void refresh();if(popups)void readQuietState();},60000);return api;
}
