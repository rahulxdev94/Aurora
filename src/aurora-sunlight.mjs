// Light geometry comes only from the actual atom renderer or notification carrier.
export const SUNLIGHT_EVENT='aurora:core-light';
export const SUNLIGHT_REQUEST_EVENT='aurora:core-light-request';
export const SUNLIGHT_SELECTOR='.ah-surface,.ah-satellite,.ap-speech,.ah-window.afx-window[data-panel="files"]';
export const SUNLIGHT_STALE_MS=2500;
const SAMPLE_INTERVAL=100,MAX_FUTURE_MS=1000,MAX_COORD=16384;
const instances=new WeakMap();
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const sameLight=(a,b)=>Boolean(a&&b&&['source','visible','x','y','radius','intensity'].every(key=>a[key]===b[key]));
const ZERO=Object.freeze({x:0,y:0,strength:0,shadowX:10,shadowY:16,rimTop:0,rimRight:0,rimBottom:0,rimLeft:0});
const VARIABLES=Object.freeze({x:['--aurora-sun-x','px'],y:['--aurora-sun-y','px'],strength:['--aurora-sun-strength',''],shadowX:['--aurora-shadow-x','px'],shadowY:['--aurora-shadow-y','px'],rimTop:['--aurora-rim-top',''],rimRight:['--aurora-rim-right',''],rimBottom:['--aurora-rim-bottom',''],rimLeft:['--aurora-rim-left','']});

export function normaliseCoreLightSample(value,{now=Date.now(),staleMs=SUNLIGHT_STALE_MS}={}){
  if(!value||!['core','notification'].includes(value.source)||typeof value.visible!=='boolean'||!Number.isSafeInteger(now)||!Number.isSafeInteger(value.at)||value.at<=0)return null;
  const lifetime=clamp(Number(staleMs)||SUNLIGHT_STALE_MS,500,10000);
  if(now-value.at>lifetime||value.at-now>MAX_FUTURE_MS)return null;
  if(!value.visible)return Object.freeze({source:value.source,visible:false,at:value.at,x:0,y:0,radius:1,intensity:0});
  if(![value.x,value.y,value.radius,value.intensity].every(Number.isFinite)||value.x<0||value.x>1||value.y<0||value.y>1||value.radius<=0||value.radius>4096||value.intensity<0||value.intensity>1)return null;
  return Object.freeze({source:value.source,visible:true,at:value.at,x:value.x,y:value.y,radius:Math.max(1,value.radius),intensity:value.intensity});
}

function rect(value){
  if(!value)return null;
  const left=value.left??value.x,top=value.top??value.y,width=value.width,height=value.height;
  return[left,top,width,height].every(Number.isFinite)&&Math.abs(left)<=1e7&&Math.abs(top)<=1e7&&width>0&&height>0&&width<=MAX_COORD&&height<=MAX_COORD?{left,top,width,height}:null;
}

/** Local gradient position, distance falloff and shadows opposite the real light. */
export function calculateSunlight(light,rootBounds,targetBounds){
  const host=rect(rootBounds),surface=rect(targetBounds);
  if(!light?.visible||!host||!surface||![light.x,light.y,light.radius,light.intensity].every(Number.isFinite)||light.x<0||light.x>1||light.y<0||light.y>1||light.radius<=0||light.radius>4096||light.intensity<=0||light.intensity>1)return ZERO;
  const x=host.left+light.x*host.width-surface.left,y=host.top+light.y*host.height-surface.top;
  const dx=x-surface.width/2,dy=y-surface.height/2,distance=Math.hypot(dx,dy);
  const edgeDistance=Math.hypot(Math.max(0,-x,x-surface.width),Math.max(0,-y,y-surface.height));
  const reach=clamp(light.radius*5.5,200,2400),strength=clamp(light.intensity/(1+(edgeDistance/reach)**2),0,1);
  const denominator=Math.max(distance,light.radius*.25,1),nx=dx/denominator,ny=dy/denominator,shadow=24*Math.sqrt(strength);
  return{x:clamp(x,-MAX_COORD,MAX_COORD),y:clamp(y,-MAX_COORD,MAX_COORD),strength,shadowX:clamp(-nx*shadow,-24,24),shadowY:clamp(-ny*shadow,-24,24),rimTop:strength*(.1+.9*Math.max(0,-ny)),rimRight:strength*(.1+.9*Math.max(0,nx)),rimBottom:strength*(.1+.9*Math.max(0,ny)),rimLeft:strength*(.1+.9*Math.max(0,-nx))};
}

export function initAuroraSunlight({root,now=()=>Date.now(),staleMs=SUNLIGHT_STALE_MS}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView;if(!win)return()=>{};
  const lifetime=clamp(Number(staleMs)||SUNLIGHT_STALE_MS,500,10000),records=new Map(),latest={core:null,notification:null};
  let disposed=false,timer=0,expiry=0,lastPaint=-Infinity,lastGeometry=-Infinity,rootBounds=null,targetsDirty=true,geometryDirty=true,staticSample=null,staticCore=null,lastVisibleCore=null,returnCore=null,coreRequested=false;
  let away=root.dataset.notificationPresence==='away';
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const mode=()=>doc.hidden?'hidden':root.dataset.paused==='true'||root.dataset.motion!=='full'||media?.matches?'static':'dynamic';
  let currentMode=mode();
  const cancelTimer=()=>{win.clearTimeout(timer);timer=0;};
  const cancelExpiry=()=>{win.clearTimeout(expiry);expiry=0;};
  const requestCore=reason=>{if(disposed||doc.hidden)return;coreRequested=true;staticSample=null;try{root.dispatchEvent(new win.CustomEvent(SUNLIGHT_REQUEST_EVENT,{detail:{reason}}));}catch{}};
  function restore(record){for(const [name]of Object.values(VARIABLES)){const previous=record.original.get(name);if(previous.value)record.element.style.setProperty(name,previous.value,previous.priority);else record.element.style.removeProperty(name);}}
  const resize=win.ResizeObserver?new win.ResizeObserver(()=>invalidateGeometry('resize')):null;
  function refreshTargets(){
    if(!targetsDirty)return;targetsDirty=false;
    const next=new Set(root.querySelectorAll(SUNLIGHT_SELECTOR));
    for(const [element,record]of records)if(!next.has(element)){resize?.unobserve(element);restore(record);records.delete(element);}
    for(const element of next)if(!records.has(element)){
      const original=new Map(Object.values(VARIABLES).map(([name])=>[name,{value:element.style.getPropertyValue(name),priority:element.style.getPropertyPriority?.(name)||''}]));
      records.set(element,{element,original,written:new Map(),bounds:null});resize?.observe(element);
    }
    geometryDirty=true;
  }
  function write(record,value){for(const [field,[name,unit]]of Object.entries(VARIABLES)){const text=String(Math.round(value[field]*1000)/1000)+unit;if(record.written.get(name)!==text){record.element.style.setProperty(name,text);record.written.set(name,text);}}}
  function clear(){for(const record of records.values())write(record,ZERO);}
  function selected(time){
    const source=away?'notification':'core',sample=source==='core'?(returnCore||latest.core):latest.notification;
    if(!sample?.visible)return null;
    // A static accepted core remains a fixed light, with no heartbeat or animation.
    if(source==='core'&&currentMode==='static'&&sample===staticCore)return sample;
    return time-sample.at<=lifetime&&sample.at-time<=MAX_FUTURE_MS?sample:null;
  }
  function armExpiry(){
    cancelExpiry();if(disposed||currentMode==='hidden')return;
    const time=now(),sample=selected(time);if(!sample||(sample.source==='core'&&currentMode==='static'))return;
    expiry=win.setTimeout(()=>{expiry=0;flush(true);},Math.max(1,sample.at+lifetime-time+1));
  }
  function sampleGeometry(time){
    if(rootBounds&&time-lastGeometry<SAMPLE_INTERVAL)return;
    rootBounds=rect(root.getBoundingClientRect());
    for(const record of records.values())record.bounds=rect(record.element.getBoundingClientRect());
    lastGeometry=time;geometryDirty=false;
  }
  function flush(immediate=false){
    if(disposed)return;cancelTimer();refreshTargets();
    const time=now(),sample=selected(time);
    if(currentMode==='hidden'||!sample){clear();staticSample=null;cancelExpiry();return;}
    if(!immediate&&time-lastPaint<SAMPLE_INTERVAL){schedule();return;}
    sampleGeometry(time);
    for(const record of records.values())write(record,calculateSunlight(sample,rootBounds,record.bounds));
    lastPaint=time;staticSample=currentMode==='static'?sample:null;armExpiry();
    // A restore can paint immediately with cached rects, then sample a dirty layout once.
    if(geometryDirty)schedule();
  }
  function schedule(){if(disposed||timer||currentMode==='hidden')return;timer=win.setTimeout(()=>{timer=0;flush();},Math.max(0,SAMPLE_INTERVAL-(now()-lastPaint)));}
  function invalidateGeometry(reason){
    if(disposed)return;geometryDirty=true;staticSample=null;
    if(currentMode==='hidden')return;
    schedule();if(currentMode==='static'&&!away)requestCore(reason);
  }
  function receive(event){
    if(disposed)return;const sample=normaliseCoreLightSample(event?.detail,{now:now(),staleMs:lifetime});if(!sample)return;
    if(latest[sample.source]&&sample.at<latest[sample.source].at)return;
    const requested=sample.source==='core'&&coreRequested;
    latest[sample.source]=sample;
    if(sample.source==='core'){
      if(sample.visible){lastVisibleCore=sample;if(currentMode==='static')staticCore=sample;}
      else if(!away)staticCore=null;
      returnCore=null;coreRequested=false;
    }
    if(currentMode==='hidden'||sample.source!==(away?'notification':'core'))return;
    if(!sample.visible){flush(true);return;}
    armExpiry();
    if(requested&&currentMode==='static'){flush(true);return;}
    // Timestamp-only heartbeats are idle; a late real resize/shape update still paints once.
    if(currentMode==='static'&&sameLight(staticSample,sample)&&!geometryDirty&&!targetsDirty)return;
    schedule();
  }
  function stateChanged(){
    if(disposed)return;
    const wasAway=away,previousMode=currentMode;away=root.dataset.notificationPresence==='away';currentMode=mode();
    if(wasAway===away&&previousMode===currentMode)return;
    staticSample=null;cancelTimer();cancelExpiry();
    if(currentMode==='dynamic')staticCore=null;
    if(currentMode==='static'&&previousMode!=='static'&&latest.core?.visible&&now()-latest.core.at<=lifetime)staticCore=latest.core;
    if(wasAway&&!away&&currentMode==='static'&&latest.core?.visible!==true)returnCore=staticCore||(lastVisibleCore&&now()-lastVisibleCore.at<=lifetime?lastVisibleCore:null);
    if(currentMode==='hidden'){clear();return;}
    flush(true);
    if(!away&&(wasAway||previousMode==='hidden'||currentMode==='static'))requestCore(wasAway?'returned':'state');
  }
  const stateObserver=win.MutationObserver?new win.MutationObserver(stateChanged):null;
  stateObserver?.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused','data-notification-presence']});
  const relevantNode=node=>node?.nodeType===1&&(node.matches?.(SUNLIGHT_SELECTOR)||node.querySelector?.(SUNLIGHT_SELECTOR));
  const targetObserver=win.MutationObserver?new win.MutationObserver(changes=>{
    if(disposed)return;
    if(!changes.some(change=>change.type==='attributes'||[...(change.addedNodes||[]),...(change.removedNodes||[])].some(relevantNode)))return;
    targetsDirty=true;invalidateGeometry('targets');
  }):null;
  targetObserver?.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-panel']});
  const onResize=()=>invalidateGeometry('resize'),onScroll=()=>invalidateGeometry('scroll');
  const onPointer=event=>{if(event.buttons&&event.target?.closest?.('.ah-window'))invalidateGeometry('drag');};
  root.addEventListener(SUNLIGHT_EVENT,receive);root.addEventListener('scroll',onScroll,{capture:true,passive:true});root.addEventListener('pointermove',onPointer,{passive:true});
  doc.addEventListener('visibilitychange',stateChanged);win.addEventListener('resize',onResize);media?.addEventListener?.('change',stateChanged);
  resize?.observe(root);refreshTargets();requestCore('initialise');
  const cleanup=()=>{
    if(disposed)return;disposed=true;cancelTimer();cancelExpiry();stateObserver?.disconnect();targetObserver?.disconnect();resize?.disconnect();
    root.removeEventListener(SUNLIGHT_EVENT,receive);root.removeEventListener('scroll',onScroll,true);root.removeEventListener('pointermove',onPointer);
    doc.removeEventListener('visibilitychange',stateChanged);win.removeEventListener('resize',onResize);media?.removeEventListener?.('change',stateChanged);win.removeEventListener('pagehide',cleanup);
    for(const record of records.values())restore(record);records.clear();instances.delete(root);
  };
  instances.set(root,cleanup);win.addEventListener('pagehide',cleanup,{once:true});
  return cleanup;
}
