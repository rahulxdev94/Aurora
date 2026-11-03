import {config} from './config.mjs';
/* Windows notification snapshots from the Seelen host. Memory only and read only. */
const instances=new WeakMap();
export const NOTIFICATION_STALE_MS=150000;
export const MAX_DISPLAYED_NOTIFICATIONS=200;
const MAX_SOURCE_NOTIFICATIONS=5000;
const cleanText=(value,max)=>typeof value==='string'?value.replaceAll('\u0000','').trim().slice(0,max):'';
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
    const key=item.appUmid+'|'+item.id;if(ids.has(key))continue;ids.add(key);
    items.push({id:item.id,appId:cleanText(item.appUmid,2048),appName:cleanText(item.appName,160)||'Application',at:item.date,...notificationText(item.content)});
  }
  if(raw.length&&!items.length)throw new Error('Notification snapshot could not be read');
  items.sort((a,b)=>b.at-a.at||b.id-a.id);
  return{items:items.slice(0,MAX_DISPLAYED_NOTIFICATIONS),count:items.length,invalid,truncated:items.length>MAX_DISPLAYED_NOTIFICATIONS};
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
#aurora-home-preview .ah-window[data-panel=notifications]{width:560px;max-width:calc(100% - 32px);min-height:0;overflow:hidden;border:1px solid #8fdced8c;box-shadow:0 10px 30px #02071166,inset 0 1px 0 #cdf5ff14}
#aurora-home-preview .ah-window[data-panel=notifications] .ah-window-content{display:flex;flex:1 1 auto;min-height:0;overflow:hidden}
#aurora-home-preview .anot-panel{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
#aurora-home-preview .anot-panel> :not(.ah-notice-list){flex:none}
#aurora-home-preview .anot-panel>.ah-notice-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior-y:contain;scrollbar-width:thin;scrollbar-color:#648ca4 #101d30;scrollbar-gutter:stable;padding-right:5px;margin:12px 0}
#aurora-home-preview .anot-panel>.ah-notice-list:focus-visible{outline:1px solid #8fdced8c;outline-offset:-1px;border-radius:10px}
#aurora-home-preview .anot-panel>.ah-notice-list>.ah-notice{flex:none}
#aurora-home-preview .anot-panel>.ah-panel-actions{margin-top:0;padding-top:12px;border-top:1px solid #9ac5e426}
#aurora-home-preview .anot-status{margin:10px 0 4px;padding:10px 12px;border:1px solid #9ac5e421;border-radius:9px;background:#8ebad509;color:#afc8dc;font-size:11px;line-height:1.5}
#aurora-home-preview .anot-status[data-state=error],#aurora-home-preview .anot-status[data-state=stale]{border-color:#d1b67b43;color:#dfcfa9}
#aurora-home-preview .anot-status strong,#aurora-home-preview .anot-status small{display:block;font-size:inherit}
#aurora-home-preview .anot-status small{color:#9eb5ca;margin-top:3px}
#aurora-home-preview .anot-app-mark{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;border:1px solid #9adcfb2b;background:#91cceb12;color:var(--ah-accent);font-size:11px;font-weight:600}
#aurora-home-preview .ah-notice .anot-app-name{font-size:10px;color:#9ebed5;font-weight:600}
#aurora-home-preview .ah-notice .anot-title{font-size:12px;color:#d4e5f0;line-height:1.45;overflow-wrap:anywhere}
#aurora-home-preview .ah-notice .anot-body{font-size:12px;color:#b5ccdf;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
#aurora-home-preview .anot-empty{padding:18px 4px;color:#9eb7cc;font-size:12px;line-height:1.5}
`;

export function initNativeNotifications({root,invoke,subscribe,SeelenCommand={},SeelenEvent={},nativeStatus}={}){
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
  function accept(raw){state.snapshot=normaliseNotifications(raw);state.lastSuccess=Date.now();state.error=false;state.loading=false;revision++;paint();}
  async function refresh(force=false){
    if(disposed||refreshing||(!force&&doc.hidden)||Date.now()-requestAt<500)return;
    requestAt=Date.now();refreshing=true;state.loading=true;paint();const startedRevision=revision;
    try{
      if(!SeelenCommand.GetNotifications)throw new Error('Notification command unavailable');
      const value=await bounded(Promise.resolve().then(()=>invoke(SeelenCommand.GetNotifications)));
      if(!disposed&&startedRevision===revision)accept(value);
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
      const actions=make('div','ah-panel-actions'),refreshButton=make('button','ah-secondary cursor-interaction','Refresh'),openButton=make('button','ah-secondary cursor-interaction','Open notification controls');
      refreshButton.type='button';refreshButton.dataset.anotAction='refresh';openButton.type='button';openButton.dataset.anotAction='open';actions.append(refreshButton,openButton);marker.append(actions);
      content.replaceChildren(marker);mounted={content,marker,status,label,detail,time,list,refresh:refreshButton};listKey='';
      const panel=root.querySelector('.ah-window');if(panel?.dataset.panel==='notifications'){panel.setAttribute('aria-label','Windows notifications');const name=root.querySelector('.ah-window-name');if(name)name.textContent='Windows notifications';}
    }
    paint();if(isNew)void refresh(true);
  }
  const onClick=event=>{
    const button=event.target?.closest?.('[data-anot-action]');if(disposed||!button||!root.contains(button))return;
    if(button.dataset.anotAction==='refresh'){void refresh(true);return;}
    if(button.dataset.anotAction==='open'){
      if(!SeelenCommand.TriggerWidget){nativeStatus?.('The Windows notification panel is unavailable.');return;}
      button.disabled=true;
      void bounded(Promise.resolve().then(()=>invoke(SeelenCommand.TriggerWidget,{payload:{id:'@seelen/notifications'}}))).catch(()=>{if(!disposed)nativeStatus?.('The Windows notification panel could not open.');}).finally(()=>{if(!disposed)button.disabled=false;});
    }
  };
  const visible=()=>{paint();if(!doc.hidden)void refresh();};
  root.addEventListener('click',onClick);doc.addEventListener('visibilitychange',visible);
  if(SeelenEvent.Notifications&&typeof subscribe==='function'){
    void Promise.resolve().then(()=>subscribe(SeelenEvent.Notifications,event=>{
      if(disposed)return;try{accept(event?.payload);}catch{state.error=true;state.loading=false;revision++;paint();}
    })).then(stop=>{if(typeof stop==='function'){if(disposed)stop();else unsubscribe=stop;}}).catch(()=>{});
  }
  function dispose(){
    if(disposed)return;disposed=true;win.clearInterval(poll);for(const [timer,reject] of timers){win.clearTimeout(timer);reject(new Error('Notification view disposed'));}timers.clear();
    try{unsubscribe?.();}catch{}root.removeEventListener('click',onClick);doc.removeEventListener('visibilitychange',visible);win.removeEventListener('pagehide',dispose);style.remove();mounted?.marker.remove();mounted=null;state.snapshot=null;
    if(badge){badge.textContent='0';badge.hidden=true;}instances.delete(root);
  }
  const api={renderPanel,renderBadge,dispose};instances.set(root,api);win.addEventListener('pagehide',dispose,{once:true});
  renderBadge();void refresh();poll=win.setInterval(()=>{paint();void refresh();},60000);return api;
}
