import {Widget,invoke,subscribe,SeelenCommand,SeelenEvent,IconPackManager} from '@seelen-ui/lib';
import {currentMonitor,primaryMonitor,PhysicalPosition,PhysicalSize} from '@tauri-apps/api/window';
import {emit,listen} from '@tauri-apps/api/event';
import {initNativeNotifications,normaliseNotificationPriorityIds} from './aurora-notifications.mjs';
import {normaliseNotificationSiteRules} from './aurora-notification-sites.mjs';
import {notificationOverlayFrame} from './notification-overlay-layout.mjs';
import {createNotificationStars,notificationStarFrame,notificationPointerInside} from './aurora-notification-stars.mjs';
import {NOTIFICATION_PRESENCE_EVENTS,applyNotificationAccent} from './aurora-notification-presence.mjs';
import {PALETTE_EVENTS,getPalette,applyPalette} from './aurora-palettes.mjs';
import {connectWidgetLiveness} from './widget-liveness.mjs';

connectWidgetLiveness();

const config=__AURORA_NOTIFICATION_OVERLAY_CONFIG__;
const priorityAppIds=normaliseNotificationPriorityIds(config.priorityAppIds);
const prioritySites=normaliseNotificationSiteRules(config.prioritySites);
const priorityDuringDnd=config.priorityDuringDnd===true;
const popupAppIds=Array.isArray(config.popupAppIds)?normaliseNotificationPriorityIds(config.popupAppIds):null;
const root=document.getElementById('aurora-home-preview'),widget=Widget.self;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
root.dataset.notificationOverlay='true';root.dataset.motion=reducedMotion.matches?'reduced':'full';root.dataset.overlayPhase='home';
function applyOverlayPalette(id){
  const previous=root.dataset.auroraPalette,selected=applyPalette(root,id);
  if(selected){
    applyNotificationAccent(root,selected.tokens.accent);root.style.colorScheme=selected.mode;
    if(previous!==id&&carrier.dataset.frame==='png'){
      atomImage.removeAttribute('src');carrier.dataset.frame='svg';stats.atomFrameSource='SVG';stats.imageDecode='palette-changed';
    }
  }
  return selected;
}
const carrier=document.createElement('div');carrier.className='anp-carrier';carrier.setAttribute('aria-hidden','true');
carrier.innerHTML=`<svg class="anp-fallback" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="anp-glow"><stop stop-color="var(--anot-accent)" stop-opacity=".26"/><stop offset="1" stop-color="var(--anot-accent)" stop-opacity="0"/></radialGradient><radialGradient id="anp-core" cx="36%" cy="30%"><stop stop-color="#fffbe5"/><stop offset=".4" stop-color="var(--anot-accent-ink)"/><stop offset="1" stop-color="color-mix(in srgb,var(--anot-accent) 70%,var(--anp-core-shade))"/></radialGradient></defs><circle cx="120" cy="120" r="114" fill="url(#anp-glow)"/><g class="anp-orbits" fill="none" stroke-width="1.6"><ellipse cx="120" cy="120" rx="86" ry="31" stroke="var(--anot-accent)"/><ellipse cx="120" cy="120" rx="86" ry="31" transform="rotate(60 120 120)" stroke="var(--anp-secondary)"/><ellipse cx="120" cy="120" rx="86" ry="31" transform="rotate(-60 120 120)" stroke="var(--anot-accent)"/>${[0,60,-60].map((rotation,orbit)=>`<g transform="rotate(${rotation} 120 120)">${[0,1,2].map(index=>{const angle=index*Math.PI*2/3+orbit*.35;return`<circle class="anp-electron" data-orbit="${orbit}" cx="${120+86*Math.cos(angle)}" cy="${120+31*Math.sin(angle)}" r="${index===0?4:3}" fill="${orbit===1?'var(--anp-secondary)':'var(--anot-accent-ink)'}" stroke="none"/>`;}).join('')}</g>`).join('')}</g><circle cx="120" cy="120" r="25" fill="url(#anp-core)"/><circle cx="120" cy="120" r="34" fill="none" stroke="var(--anot-accent)" stroke-opacity=".28" stroke-width=".8"/></svg>`;
const atomImage=document.createElement('img');atomImage.className='anp-frame';atomImage.alt='';atomImage.draggable=false;carrier.append(atomImage);root.append(carrier);
applyOverlayPalette('gold');
const stops=[],iconWaiters=new Map(),nativeTimers=new Set();
const session=`overlay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
let api=null,disposed=false,pending=false,desiredVisible=false,revision=0,lastFrame=null,diagnosticTimer=0,resizeObserver=null,heartbeat=0,flightAnimation=null,dockProbeTimer=0,dockProbeScheduled=false;
let phase='home',source=null,monitor=null,dock=null,requestSerial=0,sourceRequest=null,ownershipRequest=null,iconManager=null;
let lightTimer=0,lightBusy=false,lastLight=null;
let paletteRevision=0;
const stats={ready:false,nativeEvents:0,baselineCount:null,popupCallbacks:0,showCount:0,showRequested:false,visible:null,error:null,focusAssist:null,mode:null,phase:'home',atomFrameSource:'SVG',sourceRequests:0,sourceReplies:0,sourceStatus:'not-requested',sourceLatencyMs:null,imageDecode:'not-requested',desktopAway:null,desktopAcks:0,arrivals:[],popupLifecycle:[],nativeSurface:null,nativeSamples:[]};
const validMode=value=>['All','PriorityOnly','AlarmsOnly'].includes(value)?value:null;

let pointer=null,hitFrame=0,hitBusy=false,desiredPass=true,committedPass=null;
async function setHitPass(value){
  desiredPass=value;if(hitBusy)return;hitBusy=true;
  try{while(committedPass!==desiredPass){const next=desiredPass;await widget.window.setIgnoreCursorEvents(next);committedPass=next;stats.cursorPassThrough=next;}}finally{hitBusy=false;}
}
function updateHitTest(){
  hitFrame=0;if(disposed)return;
  const rectangles=desiredVisible&&phase==='docked'?stars.interactiveRects():[];
  void setHitPass(!notificationPointerInside(pointer,lastFrame,rectangles)).catch(()=>{});
}
function scheduleHitTest(){if(disposed)return;if(!desiredVisible||phase==='home'){void setHitPass(true).catch(()=>{});return;}if(!hitFrame)hitFrame=requestAnimationFrame(updateHitTest);}
async function readPointer(){if(SeelenCommand.GetMousePosition)try{const value=await invoke(SeelenCommand.GetMousePosition);if(Array.isArray(value)&&value.length===2&&value.every(Number.isFinite))pointer=value;}catch{}updateHitTest();}
const stars=createNotificationStars({root,onChange:scheduleHitTest});

function carrierLight(visible=true){
  if(disposed||!lastFrame||(!visible&&!lastLight)||lightBusy)return;
  const rect=carrier.getBoundingClientRect();if(!(rect.width>0&&rect.height>0))return;
  const incoming=source?.light,clamp=(n,a,b,fallback)=>Number.isFinite(n)?Math.max(a,Math.min(b,n)):fallback;
  const light=visible?{x:lastFrame.x+(rect.left+rect.width*clamp(incoming?.x,0,1,.5))*lastFrame.scale,y:lastFrame.y+(rect.top+rect.height*clamp(incoming?.y,0,1,.5))*lastFrame.scale,radius:rect.width*lastFrame.scale*clamp(incoming?.radiusRatio,.02,.4,.075),intensity:clamp(incoming?.intensity,0,1,1)}:lastLight;
  lastLight=light;lightBusy=true;
  void emit(NOTIFICATION_PRESENCE_EVENTS.light,{id:session,homeWidgetId:config.homeWidgetId,...light,visible,at:Date.now()}).catch(()=>{}).finally(()=>{lightBusy=false;});
}
function startCarrierLight(interval=67){clearInterval(lightTimer);lightTimer=0;carrierLight();if(!disposed)lightTimer=setInterval(()=>carrierLight(),interval);}
function stopCarrierLight(){clearInterval(lightTimer);lightTimer=0;carrierLight(false);lastLight=null;}
function diagnostics(){
  clearTimeout(diagnosticTimer);
  diagnosticTimer=setTimeout(()=>{
    if(disposed)return;
    const snapshot={version:10,at:new Date().toISOString(),...stats,paletteId:root.dataset.auroraPalette,priorityPolicy:'explicit-app-identities-and-site-origins-v2',priorityDuringDnd,popupAppCount:popupAppIds?.length??null,deduplication:'canonical-sender-event-version-v1',priorityAppCount:priorityAppIds.length,prioritySiteCount:prioritySites.length,frame:lastFrame,cards:root.querySelectorAll('.anot-live-popup').length,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};
    // Only readiness, safe quiet-state values and geometry. Never message or image data.
    void invoke(SeelenCommand.WriteFile,{filename:config.statusFile||'notification-overlay-startup.json',content:JSON.stringify(snapshot)}).catch(()=>{});
    console.info('Aurora notification overlay',{ready:stats.ready,nativeEvents:stats.nativeEvents,phase,visible:stats.visible,cards:snapshot.cards,error:stats.error});
  },400);
}
function setPhase(value){phase=value;stats.phase=value;root.dataset.overlayPhase=value;diagnostics();}
function nativeRead(name){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{nativeTimers.delete(timer);reject(new Error('Native read timeout'));},900);nativeTimers.add(timer);
    Promise.resolve().then(()=>{if(typeof widget.window[name]!=='function')throw new Error('Native read unsupported');return widget.window[name]();}).then(resolve,reject).finally(()=>{clearTimeout(timer);nativeTimers.delete(timer);});
  });
}
function surfaceElement(element){
  if(!element)return null;const rect=element.getBoundingClientRect?.(),style=typeof window.getComputedStyle==='function'?window.getComputedStyle(element):null;
  const bounds=rect&&['left','top','width','height'].every(key=>Number.isFinite(rect[key]))?{x:rect.left,y:rect.top,width:rect.width,height:rect.height}:null;
  return{bounds,hidden:element.hidden===true,display:style?style.display:null,visibility:style?style.visibility:null,opacity:style&&Number.isFinite(Number(style.opacity))?Number(style.opacity):null};
}
async function nativeSurface(stage){
  if(disposed)return;
  const startedAt=Date.now(),requestedPhase=phase,requestedFrame=lastFrame?{...lastFrame}:null,showRequested=stats.showRequested;
  const names=['isVisible','isAlwaysOnTop','isMinimized','isFocused','outerPosition','outerSize','innerSize'];
  const results=await Promise.allSettled(names.map(nativeRead));if(disposed)return;
  const values={},unavailable=[];for(let i=0;i<names.length;i++){if(results[i].status==='fulfilled')values[names[i]]=results[i].value;else unavailable.push(names[i]);}
  const position=values.outerPosition&&['x','y'].every(key=>Number.isFinite(values.outerPosition[key]))?{x:values.outerPosition.x,y:values.outerPosition.y}:null;
  const size=value=>value&&['width','height'].every(key=>Number.isFinite(value[key]))?{width:value.width,height:value.height}:null;
  const boolean=value=>typeof value==='boolean'?value:null;
  const stack=root.querySelector('.anot-live-stack');
  const snapshot={stage,startedAt,at:Date.now(),requestedPhase,phaseOnReply:phase,showRequested,hwnd:Number.isSafeInteger(widget.windowId)&&widget.windowId>0?widget.windowId:null,visible:boolean(values.isVisible),alwaysOnTop:boolean(values.isAlwaysOnTop),minimized:boolean(values.isMinimized),focused:boolean(values.isFocused),outerPosition:position,outerSize:size(values.outerSize),innerSize:size(values.innerSize),requestedFrame,unavailable,dom:{documentHidden:document.hidden===true,root:surfaceElement(root),carrier:surfaceElement(carrier),stack:surfaceElement(stack),card:surfaceElement(root.querySelector('.anot-live-popup'))}};
  if(!stats.nativeSurface||startedAt>=stats.nativeSurface.startedAt){stats.visible=snapshot.visible;stats.nativeSurface=snapshot;}stats.nativeSamples.push(snapshot);if(stats.nativeSamples.length>16)stats.nativeSamples.splice(0,stats.nativeSamples.length-16);diagnostics();
}
function popupLifecycle(value){
  if(value?.action==='created')stars.prepare();
  const snapshot={action:['created','cleared','dismissed'].includes(value?.action)?value.action:null,reason:['arrived','timeout','user','activated','priority','quiet-read','quiet-event-focusAssist','quiet-event-mode','document-visibility','paused-state','quiet-gate','disposed'].includes(value?.reason)?value.reason:null,at:Number.isFinite(value?.at)?value.at:null,phase,quiet:{focusAssist:typeof value?.quiet?.focusAssist==='boolean'?value.quiet.focusAssist:null,mode:validMode(value?.quiet?.mode),paused:value?.quiet?.paused===true,hidden:value?.quiet?.hidden===true,popupOnly:value?.quiet?.popupOnly===true,allowed:value?.quiet?.allowed===true,reason:['disabled','paused','focus-unknown','focus-assist','mode-unknown','mode-PriorityOnly','mode-AlarmsOnly','hidden','native-owned'].includes(value?.quiet?.reason)?value.quiet.reason:null}};
  for(const key of ['durationMs','liveBefore','queuedBefore','liveAfter','queuedAfter','minimumAgeMs','maximumAgeMs'])snapshot[key]=Number.isFinite(value?.[key])?Math.max(0,value[key]):null;
  stats.popupLifecycle.push(snapshot);if(stats.popupLifecycle.length>16)stats.popupLifecycle.splice(0,stats.popupLifecycle.length-16);diagnostics();
}
function arrivalDiagnostics(value){
  // Keep an explicit numeric/enum allowlist, never notification identifiers or text.
  const count=value=>Number.isFinite(value)?Math.max(0,Math.min(5000,Math.trunc(value))):0;
  const snapshot={source:value?.source==='native'?'native':'read',at:Number.isFinite(value?.at)?value.at:null,baselined:value?.baselined===true,dropped:{},quiet:{focusAssist:typeof value?.quiet?.focusAssist==='boolean'?value.quiet.focusAssist:null,mode:validMode(value?.quiet?.mode),paused:value?.quiet?.paused===true,hidden:value?.quiet?.hidden===true,popupOnly:value?.quiet?.popupOnly===true,allowed:value?.quiet?.allowed===true,reason:['disabled','paused','focus-unknown','focus-assist','mode-unknown','mode-PriorityOnly','mode-AlarmsOnly','hidden','native-owned'].includes(value?.quiet?.reason)?value.quiet.reason:null}};
  for(const key of ['received','valid','totalValid','truncated','candidates','accepted','priorityCandidates','priorityAccepted','created','queued','live','changedKnown'])snapshot[key]=count(value?.[key]);
  for(const key of ['baseline','duplicate','stale','future','invalid','quiet','nativeOwned','queueOverflow'])snapshot.dropped[key]=count(value?.dropped?.[key]);
  for(const key of ['minimumAgeMs','maximumAgeMs'])snapshot[key]=Number.isFinite(value?.[key])?value[key]:null;
  stats.arrivals.push(snapshot);if(stats.arrivals.length>8)stats.arrivals.splice(0,stats.arrivals.length-8);diagnostics();
}
async function setFrame(next){
  if(!lastFrame||next.width!==lastFrame.width||next.height!==lastFrame.height)await widget.window.setSize(new PhysicalSize(next.width,next.height));
  if(!lastFrame||next.x!==lastFrame.x||next.y!==lastFrame.y)await widget.window.setPosition(new PhysicalPosition(next.x,next.y));
  lastFrame=next;
}
const paint=()=>new Promise(resolve=>{let frame=0,done=false;const finish=()=>{if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);resolve();};const timer=setTimeout(finish,80);frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(finish);});});
async function presence(away){
  const acknowledgement=new Promise(resolve=>{const timer=setTimeout(()=>{if(ownershipRequest?.away===away)ownershipRequest=null;resolve(false);},250);ownershipRequest={away,resolve:()=>{clearTimeout(timer);ownershipRequest=null;resolve(true);}};});
  try{await emit(NOTIFICATION_PRESENCE_EVENTS.state,{id:session,homeWidgetId:config.homeWidgetId,away});}catch{}
  await acknowledgement;
  if(!away){clearInterval(heartbeat);heartbeat=0;}
  else if(!heartbeat)heartbeat=setInterval(()=>{if(!disposed&&phase!=='home')void emit(NOTIFICATION_PRESENCE_EVENTS.state,{id:session,homeWidgetId:config.homeWidgetId,away:true}).catch(()=>{});},8000);
}
async function readSource(){
  const id=`${session}-${++requestSerial}`,started=Date.now(),requestedPaletteRevision=paletteRevision;stats.sourceRequests++;stats.sourceStatus='requesting';diagnostics();
  const response=await new Promise(resolve=>{
    const settle=(value,status)=>{clearTimeout(timer);if(sourceRequest?.id===id)sourceRequest=null;resolve({value,status});};
    // Native geometry, PNG encoding and the local event transfer share this cap.
    const timer=setTimeout(()=>settle(null,'timeout'),1200);
    sourceRequest={id,resolve:(value,status='received')=>settle(value,status)};
    void emit(NOTIFICATION_PRESENCE_EVENTS.request,{id,homeWidgetId:config.homeWidgetId,captureFrame:false}).catch(()=>{if(sourceRequest?.id===id)sourceRequest.resolve(null,'unavailable');});
  });
  const result=response.value;stats.sourceStatus=response.status;stats.sourceLatencyMs=Date.now()-started;if(result)stats.sourceReplies++;diagnostics();
  if(disposed||response.status==='cancelled')return;
  source=result;
  // A newer selection event wins over an older in-flight source response.
  if(requestedPaletteRevision===paletteRevision){
    if(getPalette(result?.paletteId))applyOverlayPalette(result.paletteId);
    else if(result&&!result.paletteId&&root.dataset.auroraPalette==='gold')applyNotificationAccent(root,result.accent);
  }
  monitor=result?.monitor||await currentMonitor().catch(()=>null)||await primaryMonitor();
  root.dataset.motion=!reducedMotion.matches&&(!result||result.motion==='full')?'full':'reduced';
  const framePalette=getPalette(result?.paletteId)?.id||(!result?.paletteId?'gold':null);
  const png=framePalette===root.dataset.auroraPalette&&typeof result?.frame==='string'&&result.frame.length<=1400000&&/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(result.frame)?result.frame:null;
  let decoded=false;stats.imageDecode='not-requested';
  if(png){atomImage.src=png;decoded=await Promise.race([atomImage.decode().then(()=>true,()=>false),new Promise(resolve=>setTimeout(()=>resolve(false),250))]);stats.imageDecode=decoded?'ready':'unavailable';}
  if(disposed){atomImage.removeAttribute('src');return;}
  if(framePalette!==root.dataset.auroraPalette){decoded=false;stats.imageDecode='palette-mismatch';}
  if(!decoded)atomImage.removeAttribute('src');stats.atomFrameSource=decoded?'PNG':'SVG';carrier.dataset.frame=decoded?'png':'svg';diagnostics();
}
function measureDock(){
  const width=480,initial=notificationOverlayFrame(monitor,{width,contentHeight:120});
  root.style.setProperty('--anp-bubble-width',`${Math.max(120,initial.width/initial.scale-24)}px`);
  const stack=root.querySelector('.anot-live-stack'),height=stack?Math.max(stack.scrollHeight,stack.getBoundingClientRect().height)+24:120;
  return notificationOverlayFrame(monitor,{width,contentHeight:Math.max(120,height)});
}

async function dockAtom(){
  dock=measureDock();const expanded=stars.hasPending()&&root.dataset.motion==='full'?notificationStarFrame(monitor,dock):dock;
  await setFrame(expanded);if(disposed)return;setPhase('docked');await paint();await readPointer();
  await stars.reveal();if(disposed)return;
  if(!stars.hasPending()||root.dataset.motion!=='full'){dock=measureDock();await setFrame(dock);await paint();}
  await readPointer();stats.showRequested=true;void nativeSurface('docked');diagnostics();
}
async function goHome(){
  stars.finish();stopCarrierLight();await presence(false);await setHitPass(true);await widget.window.hide();stats.showRequested=false;dockProbeScheduled=false;setPhase('home');source=null;atomImage.removeAttribute('src');void nativeSurface('home-hidden');
}
async function reconcile(){
  if(pending||disposed)return;pending=true;
  try{
    while(!disposed){
      const started=revision;
      if(desiredVisible){
        if(phase==='home'){
          await readSource();if(disposed)return;if(!desiredVisible)continue;
          await setHitPass(true);await setFrame(notificationOverlayFrame(monitor,{width:480,contentHeight:160}));await paint();
          setPhase('docked');await widget.show();stats.showCount++;stats.showRequested=true;
        }
        await dockAtom();
      }else if(phase!=='home')await goHome();
      diagnostics();if(started===revision)break;
    }
  }catch{
    stats.error='Notification overlay display unavailable';stars.finish();stopCarrierLight();await presence(false);stats.showRequested=false;setPhase('home');void setHitPass(true).catch(()=>{});void widget.window.hide().then(()=>nativeSurface('display-error-hidden')).catch(()=>{});diagnostics();
  }finally{pending=false;}
}
function layoutChanged(){if(disposed)return;revision++;void reconcile();}
function visibility(show){if(disposed)return;stats.popupCallbacks++;desiredVisible=Boolean(show);if(!desiredVisible)stars.finish();if(!desiredVisible&&phase==='home')sourceRequest?.resolve(null,'cancelled');layoutChanged();}
const observedInvoke=async(command,args)=>{
  const value=await invoke(command,args);
  if(command===SeelenCommand.GetNotifications)stats.baselineCount=Array.isArray(value)?value.length:null;
  if(command===SeelenCommand.GetFocusAssist)stats.focusAssist=typeof value==='boolean'?value:null;
  if(command===SeelenCommand.GetNotificationsMode)stats.mode=validMode(value);
  if([SeelenCommand.GetNotifications,SeelenCommand.GetFocusAssist,SeelenCommand.GetNotificationsMode].includes(command))diagnostics();return value;
};
const observedSubscribe=(event,handler)=>subscribe(event,payload=>{
  if(event===SeelenEvent.Notifications){
    stats.nativeEvents++;
    // Inspect only our explicitly labelled, recent local fixture. No real
    // message content, launch arguments or profile identifiers are recorded.
    const probe=Array.isArray(payload?.payload)?payload.payload.find(item=>item?.content?.visual?.binding?.$value?.[0]?.text?.$value==='Aurora local test: priority origin fixture'&&Number.isFinite(item.date)&&Date.now()-item.date>=0&&Date.now()-item.date<60000):null;
    if(probe)stats.localPriorityProbe={at:Date.now(),sender:typeof probe.appUmid==='string'?probe.appUmid.slice(0,160):null,hasLaunch:typeof probe.content?.['@launch']==='string'&&probe.content['@launch'].length>0,launchTokens:typeof probe.content?.['@launch']==='string'?probe.content['@launch'].split('|').length:0,contentKeys:Object.keys(probe.content||{}).slice(0,16),plainLaunch:typeof probe.content?.launch==='string'&&probe.content.launch.length>0,textLengths:(probe.content?.visual?.binding?.$value||[]).slice(0,6).map(value=>typeof value?.text?.$value==='string'?value.text.$value.length:null)};
  }
  if(event===SeelenEvent.FocusAssistChanged)stats.focusAssist=typeof payload?.payload==='boolean'?payload.payload:null;
  if(event===SeelenEvent.NotificationsModeChanged)stats.mode=validMode(payload?.payload);diagnostics();handler(payload);
});
function cachedIcon(item){const icon=iconManager?.getIcon({umid:item.appId});return icon?.dark||icon?.base||icon?.light||null;}
function resolveAppIcon(item){
  const cached=cachedIcon(item);if(cached||!iconManager||!item.appId)return cached;
  if(iconWaiters.has(item.appId))return iconWaiters.get(item.appId).promise;if(iconWaiters.size>=32)return null;
  let resolve;const promise=new Promise(done=>{resolve=done;});const timer=setTimeout(()=>{iconWaiters.delete(item.appId);resolve(cachedIcon(item));},3000);
  iconWaiters.set(item.appId,{promise,resolve,timer,item});void IconPackManager.requestIconExtraction({umid:item.appId}).catch(()=>{});return promise;
}
try{
  await widget.init({saveAndRestoreLastRect:false,hideOnFocusLoss:false,useThemes:false,closeOnHide:false});
  await widget.window.setTitle(config.windowTitle||'Aurora Notifications');await widget.window.setFocusable(false);await widget.window.setResizable(false);await widget.window.setAlwaysOnTop(true);await widget.window.setSkipTaskbar(true);await widget.window.setIgnoreCursorEvents(true);
  monitor=await currentMonitor().catch(()=>null)||await primaryMonitor();await setFrame(notificationOverlayFrame(monitor,{contentHeight:1}));
  if(SeelenEvent.GlobalMouseMove)stops.push(await subscribe(SeelenEvent.GlobalMouseMove,event=>{const value=event?.payload;if(Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)){pointer=value;scheduleHitTest();}}));
  stops.push(await listen(NOTIFICATION_PRESENCE_EVENTS.source,event=>{const value=event.payload;if(sourceRequest&&value?.id===sourceRequest.id&&value.homeWidgetId===config.homeWidgetId)sourceRequest.resolve(value);}));
  stops.push(await listen(NOTIFICATION_PRESENCE_EVENTS.ack,event=>{const value=event.payload;if(value?.id!==session||value.homeWidgetId!==config.homeWidgetId||typeof value.away!=='boolean')return;stats.desktopAway=value.away;stats.desktopAcks++;if(ownershipRequest?.away===value.away)ownershipRequest.resolve();diagnostics();}));
  stops.push(await listen(PALETTE_EVENTS.state,event=>{const value=event.payload;if(disposed||value?.homeWidgetId!==config.homeWidgetId||!getPalette(value.paletteId))return;paletteRevision++;applyOverlayPalette(value.paletteId);diagnostics();}));
  stops.push(await widget.window.onScaleChanged(()=>{if(phase==='docked')layoutChanged();}));
  const motionChange=()=>{if(reducedMotion.matches){root.dataset.motion='reduced';try{flightAnimation?.finish();}catch{}}};reducedMotion.addEventListener('change',motionChange);stops.push(()=>reducedMotion.removeEventListener('change',motionChange));
  void IconPackManager.create().then(async manager=>{
    if(disposed)return;iconManager=manager;const stop=await manager.onChange(()=>{for(const [id,waiter]of iconWaiters){const icon=cachedIcon(waiter.item);if(icon){clearTimeout(waiter.timer);iconWaiters.delete(id);waiter.resolve(icon);}}});if(disposed)stop();else stops.push(stop);
  }).catch(()=>{});
  if(typeof widget.window.setTitle==='function')await widget.window.setTitle(config.windowTitle||'Aurora Notifications');
  await widget.ready({show:false});stats.ready=true;
  void emit(PALETTE_EVENTS.request,{homeWidgetId:config.homeWidgetId}).catch(()=>{});
  api=initNativeNotifications({root,invoke:observedInvoke,subscribe:observedSubscribe,SeelenCommand,SeelenEvent,popups:true,popupOnly:true,popupDuration:15000,priorityAppIds,prioritySites,priorityDuringDnd,popupAppIds,resolveAppIcon,onArrivalDiagnostics:arrivalDiagnostics,onPopupLifecycle:popupLifecycle,
    openHistory:()=>invoke(SeelenCommand.TriggerWidget,{payload:{id:config.homeWidgetId,customArgs:{auroraCommand:'notifications'}}}),onPopupVisibilityChange:visibility,
    nativeStatus:()=>{stats.error='Notification action unavailable';diagnostics();}
  });
  if(globalThis.ResizeObserver){resizeObserver=new ResizeObserver(()=>{if(desiredVisible&&phase==='docked')layoutChanged();});const stack=root.querySelector('.anot-live-stack');if(stack)resizeObserver.observe(stack);}
  void nativeSurface('startup-hidden');
  diagnostics();
}catch{stats.error='Notification overlay startup unavailable';diagnostics();void presence(false);void widget.window.hide().catch(()=>{});}
window.addEventListener('pagehide',()=>{
  stopCarrierLight();
  disposed=true;stars.dispose();cancelAnimationFrame(hitFrame);desiredVisible=false;revision++;clearTimeout(diagnosticTimer);clearTimeout(dockProbeTimer);for(const timer of nativeTimers)clearTimeout(timer);nativeTimers.clear();clearInterval(heartbeat);flightAnimation?.cancel();sourceRequest?.resolve(null,'cancelled');ownershipRequest?.resolve();api?.dispose();resizeObserver?.disconnect();for(const stop of stops)stop?.();
  for(const waiter of iconWaiters.values()){clearTimeout(waiter.timer);waiter.resolve(null);}iconWaiters.clear();void presence(false);
},{once:true});

import {connectDesignSurface} from './aurora-design-bridge.mjs';
connectDesignSurface(document.getElementById('aurora-home-preview'),__AURORA_NOTIFICATION_OVERLAY_CONFIG__.homeWidgetId);
