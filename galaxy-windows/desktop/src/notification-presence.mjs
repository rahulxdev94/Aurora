/* The desktop supplies its actual transparent atom frame to the local overlay. */
import {getPalette} from './palettes.mjs';
const instances=new WeakMap();
export const NOTIFICATION_PRESENCE_EVENTS=Object.freeze({request:'galaxy-atlas:notification-presence-request',source:'galaxy-atlas:notification-presence-source',state:'galaxy-atlas:notification-presence-state',ack:'galaxy-atlas:notification-presence-ack',light:'galaxy-atlas:notification-presence-light'});
// Convert actual native carrier coordinates into this desktop's CSS coordinate space.
export function notificationSunlightSample(sample,geometry,now=Date.now()){
  if(!sample||!geometry||!['x','y','radius','intensity','at'].every(key=>Number.isFinite(sample[key]))||typeof sample.visible!=='boolean'||sample.at>now+1000||now-sample.at>2000||sample.radius<=0||sample.radius>10000||sample.intensity<0||sample.intensity>1)return null;
  const {position,nativeSize,viewport,rootRect}=geometry;
  if(!position||!nativeSize||!viewport||!rootRect||!['x','y'].every(key=>Number.isFinite(position[key]))||![nativeSize.width,nativeSize.height,viewport.width,viewport.height,rootRect.width,rootRect.height].every(value=>Number.isFinite(value)&&value>0)||![rootRect.left,rootRect.top].every(Number.isFinite))return null;
  const sx=nativeSize.width/viewport.width,sy=nativeSize.height/viewport.height;
  const x=((sample.x-position.x)/sx-rootRect.left)/rootRect.width,y=((sample.y-position.y)/sy-rootRect.top)/rootRect.height;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<-.5||x>1.5||y<-.5||y>1.5)return null;
  return{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y)),radius:Math.max(1,Math.min(600,sample.radius/Math.max(sx,sy))),intensity:sample.intensity,visible:sample.visible,at:sample.at,source:'notification'};
}
export function notificationAtomLight(core,captureRect,rootRect){
  if(!core||!captureRect||!rootRect||!['x','y','radius','intensity'].every(key=>Number.isFinite(core[key]))||![captureRect.x,captureRect.y,rootRect.left,rootRect.top].every(Number.isFinite)||!(captureRect.width>0&&captureRect.height>0&&rootRect.width>0&&rootRect.height>0))return{x:.5,y:.5,radiusRatio:.075,intensity:1};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  return{x:clamp((rootRect.left+core.x*rootRect.width-captureRect.x)/captureRect.width,0,1),y:clamp((rootRect.top+core.y*rootRect.height-captureRect.y)/captureRect.height,0,1),radiusRatio:clamp(core.radius/captureRect.width,.02,.4),intensity:clamp(core.intensity,0,1)};
}
export const DEFAULT_NOTIFICATION_ACCENT='#E8CA83';
/** Cross-window colours accept one opaque six-digit hex value, never CSS syntax. */
export function normaliseNotificationAccent(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toUpperCase():null;}
export function readNotificationAccent(root){
  const win=root?.ownerDocument?.defaultView;let value='';
  try{value=win?.getComputedStyle(root).getPropertyValue('--ah-accent').trim()||'';}catch{}
  const hex=normaliseNotificationAccent(value);if(hex)return hex;
  // Computed CSS can serialise a colour as rgb(), including modern space syntax.
  const rgb=value.match(/^rgb\(\s*(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})\s*(?:,\s*|\s+)(\d{1,3})\s*\)$/i)||value.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*1(?:\.0+)?\s*\)$/i);
  if(!rgb)return DEFAULT_NOTIFICATION_ACCENT;const channels=rgb.slice(1).map(Number);
  return channels.every(channel=>channel>=0&&channel<=255)?'#'+channels.map(channel=>channel.toString(16).padStart(2,'0')).join('').toUpperCase():DEFAULT_NOTIFICATION_ACCENT;
}
export function applyNotificationAccent(root,value){const accent=normaliseNotificationAccent(value)||DEFAULT_NOTIFICATION_ACCENT;root.style.setProperty('--ah-accent',accent);return accent;}
export function captureNotificationAtom(root,{maxPixels=1048576,maxDataLength=1400000}={}){
  const map=root?.dataset?.desktopDesign==='universe'&&root.querySelector('#au-starmap');
  const detail=root?.dataset?.desktopDesign==='observatory'&&root.querySelector('.au-prism-core');
  const canvas=map?map.querySelector('.ag-sky'):root?.querySelector?.('.ah-dyson-canvas'),hero=map||root?.querySelector?.('.ah-core-stage');
  if(!canvas||!hero||!canvas.width||!canvas.height)return null;
  const rect=canvas.getBoundingClientRect(),width=hero.clientWidth,height=hero.clientHeight;
  if(!(rect.width>0&&rect.height>0&&width>0&&height>44))return null;
  const type=root.querySelector('[data-core-shape][aria-pressed="true"]')?.dataset.coreShape;
  const radius=Math.min(type==='dyson'?252:240,width*.28,(height-44)*.32),diameter=radius*3.3;
  const scene=map&&map.querySelector('.ag-stage')?.__auroraDeepSky;
  scene?.redrawForCapture?.();
  const galaxy=scene?.geometry;
  const side=galaxy?Math.min(galaxy.width,width,height)*.65:diameter;
  const left=(galaxy?.x??width/2)-side/2,top=(galaxy?.y??(height-44)/2)-side/2;
  // Transparent padding preserves the actual nucleus centre even near a clipped stage edge.
  const capture=root.ownerDocument.createElement('canvas');
  let pixels=Math.min(1024,Math.sqrt(maxPixels),Math.max(1,Math.round(side*Math.min(2,root.ownerDocument.defaultView?.devicePixelRatio||1))));
  let png=null;
  for(let attempt=0;attempt<3;attempt++){
    capture.width=capture.height=Math.max(1,Math.round(pixels));const context=capture.getContext('2d',{alpha:true});if(!context)break;
    try{for(const layer of [canvas,detail].filter(Boolean)){context.drawImage(layer,left*layer.width/width,top*layer.height/height,side*layer.width/width,side*layer.height/height,0,0,capture.width,capture.height);}const result=capture.toDataURL('image/png');if(result.length<=maxDataLength){png=result;break;}}catch{break;}
    pixels*=.65;
  }
  return{rect:{x:rect.left+left*rect.width/width,y:rect.top+top*rect.height/height,width:side*rect.width/width,height:side*rect.height/height},png};
}
export function initNotificationPresence({root}={}){
  if(!root?.ownerDocument||root.dataset.browserQa==='true')return()=>{};
  if(instances.has(root))return instances.get(root);
  const win=root.ownerDocument.defaultView;
  if(!win?.__TAURI_INTERNALS__)return()=>{};
  let disposed=false,lease=0,owner=null,homeId=null,diagnosticTimer=0,writeDiagnostic=null,acknowledge=null,lightGeometry=null,geometryPending=null,lastCoreLight=null;const stops=[];
  const status={version:2,ready:false,sourceRequests:0,sourceTransfers:0,frameSource:'none',desktopAway:false,restores:0,lightSamples:0,error:null};
  const rememberCoreLight=event=>{const value=event.detail;if(value?.source==='core'&&['x','y','radius','intensity'].every(key=>Number.isFinite(value[key]))&&value.radius>0&&value.intensity>=0&&value.intensity<=1)lastCoreLight={x:value.x,y:value.y,radius:value.radius,intensity:value.intensity};};
  root.addEventListener?.('galaxy-atlas:core-light',rememberCoreLight);stops.push(()=>root.removeEventListener?.('galaxy-atlas:core-light',rememberCoreLight));
  const diagnostic=()=>{
    root.dataset.notificationPresenceReady=String(status.ready);
    win.clearTimeout(diagnosticTimer);diagnosticTimer=win.setTimeout(()=>{if(!disposed&&writeDiagnostic)void writeDiagnostic({at:new Date().toISOString(),...status}).catch(()=>{});},200);
  };
  const restore=(reason='returned')=>{const previousOwner=owner;win.clearTimeout(lease);lease=0;owner=null;delete root.dataset.notificationPresence;if(status.desktopAway)status.restores++;status.desktopAway=false;diagnostic();if(previousOwner)void acknowledge?.(previousOwner,false,reason);};
  const cleanup=()=>{if(disposed)return;restore('disposed');disposed=true;win.clearTimeout(diagnosticTimer);for(const stop of stops)stop();instances.delete(root);delete root.dataset.notificationPresenceReady;win.removeEventListener('pagehide',cleanup);};
  instances.set(root,cleanup);win.addEventListener('pagehide',cleanup,{once:true});
  void(async()=>{
    const [{listen,emit},{getCurrentWindow,currentMonitor},{Widget,invoke,SeelenCommand}]=await Promise.all([import('@tauri-apps/api/event'),import('@tauri-apps/api/window'),import('@seelen-ui/lib')]);
    if(disposed)return;homeId=Widget.self.id;const nativeWindow=getCurrentWindow();
    const saveLightGeometry=(position,nativeSize)=>{const rect=root.getBoundingClientRect?.();lightGeometry={position,nativeSize,viewport:{width:win.innerWidth,height:win.innerHeight},rootRect:rect?{left:rect.left,top:rect.top,width:rect.width,height:rect.height}:{left:0,top:0,width:win.innerWidth,height:win.innerHeight}};return lightGeometry;};
    const getLightGeometry=()=>{if(lightGeometry)return Promise.resolve(lightGeometry);if(!geometryPending)geometryPending=Promise.all([nativeWindow.innerPosition(),nativeWindow.innerSize()]).then(([position,size])=>saveLightGeometry(position,size)).finally(()=>{geometryPending=null;});return geometryPending;};
    const invalidateLightGeometry=()=>{lightGeometry=null;};win.addEventListener('resize',invalidateLightGeometry);stops.push(()=>win.removeEventListener('resize',invalidateLightGeometry));
    writeDiagnostic=value=>invoke(SeelenCommand.WriteFile,{filename:'notification-presence-startup.json',content:JSON.stringify(value)});
    acknowledge=(id,away,reason)=>emit(NOTIFICATION_PRESENCE_EVENTS.ack,{id,homeWidgetId:homeId,away,reason}).catch(()=>{});
    const add=stop=>{if(disposed)stop();else stops.push(stop);};
    add(await listen(NOTIFICATION_PRESENCE_EVENTS.request,event=>{
      const request=event.payload;if(disposed||request?.homeWidgetId!==homeId||typeof request.id!=='string'||request.id.length>100)return;
      status.sourceRequests++;diagnostic();
      void(async()=>{
        const [monitor,position,nativeSize]=await Promise.all([currentMonitor(),nativeWindow.innerPosition(),nativeWindow.innerSize()]);
        if(disposed)return;if(!monitor?.size)throw new Error('display');
        saveLightGeometry(position,nativeSize);
        const captured=captureNotificationAtom(root),rect=captured?.rect||(root.querySelector('#au-starmap [data-body="core"]')||root.querySelector('.ah-core-stage'))?.getBoundingClientRect();if(!rect)throw new Error('core');
        const sx=nativeSize.width/Math.max(1,win.innerWidth),sy=nativeSize.height/Math.max(1,win.innerHeight);
        const source={x:(position.x+rect.x*sx-monitor.position.x)/monitor.size.width,y:(position.y+rect.y*sy-monitor.position.y)/monitor.size.height,width:rect.width*sx/monitor.size.width,height:rect.height*sy/monitor.size.height};
        const rootRect=root.getBoundingClientRect?.()||{left:0,top:0,width:win.innerWidth,height:win.innerHeight};
        await emit(NOTIFICATION_PRESENCE_EVENTS.source,{id:request.id,homeWidgetId:homeId,source,light:notificationAtomLight(lastCoreLight,rect,rootRect),paletteId:getPalette(root.dataset.auroraPalette)?.id||'gold',accent:readNotificationAccent(root),monitor:{position:monitor.position,size:monitor.size,workArea:monitor.workArea,scaleFactor:monitor.scaleFactor},frame:captured?.png||null,motion:root.dataset.motion==='full'&&root.dataset.paused!=='true'&&!win.matchMedia('(prefers-reduced-motion: reduce)').matches?'full':'reduced'});
        if(!disposed){status.sourceTransfers++;status.frameSource=captured?.png?'PNG':'SVG';status.error=null;diagnostic();}
      })().catch(()=>{if(!disposed){status.error='Atom frame unavailable';diagnostic();}});
    }));
    add(await listen(NOTIFICATION_PRESENCE_EVENTS.state,event=>{
      const state=event.payload;if(disposed||state?.homeWidgetId!==homeId||typeof state.id!=='string'||state.id.length>100)return;
      if(state.away===true){owner=state.id;root.dataset.notificationPresence='away';status.desktopAway=true;win.clearTimeout(lease);lease=win.setTimeout(()=>restore('lease-expired'),25000);diagnostic();void acknowledge(state.id,true,'carrying');}
      else if(state.away===false&&(!owner||owner===state.id))restore();
    }));
    add(await listen(NOTIFICATION_PRESENCE_EVENTS.light,event=>{
      const value=event.payload,expectedOwner=owner;if(disposed||!expectedOwner||value?.id!==expectedOwner||value.homeWidgetId!==homeId)return;
      void getLightGeometry().then(geometry=>{
        if(disposed||owner!==expectedOwner)return;const sample=notificationSunlightSample(value,geometry);if(!sample)return;
        if(typeof win.CustomEvent==='function'&&typeof root.dispatchEvent==='function'){root.dispatchEvent(new win.CustomEvent('galaxy-atlas:core-light',{detail:sample}));status.lightSamples++;}
      }).catch(()=>{});
    }));
    if(!disposed){status.ready=true;diagnostic();}
  })().catch(()=>{if(!disposed){status.error='Atom bridge unavailable';restore('unavailable');}});
  return cleanup;
}
