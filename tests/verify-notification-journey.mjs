import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normaliseNotificationPriorityIds} from '../src/aurora-notifications.mjs';
import {PALETTES,PALETTE_EVENTS} from '../src/aurora-palettes.mjs';
import {notificationStarFrame,notificationPointerInside} from '../src/aurora-notification-stars.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<600;i++){if(predicate())return;await pause(5);}assert.fail('Notification journey did not settle');}
const calls=[],listeners=new Map(),windowListeners=new Map();
class Node{
  constructor(){this.children=[];this.dataset={};this.style={setProperty:(key,value)=>{this.style[key]=value;}};this.hidden=false;this.scrollHeight=180;}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this[key]=value;}
  removeAttribute(key){delete this[key];}
  getBoundingClientRect(){return{left:0,top:0,width:436,height:this.hidden?0:180};}
  animate(frames,options){calls.push({animation:options.duration,frames:structuredClone(frames),windowFrame:{...frame},baseWidth:Number.parseFloat(this.style.width)});let done;const finished=new Promise(resolve=>{done=resolve;});const timer=setTimeout(done,20);return{finished,cancel(){clearTimeout(timer);done();},finish(){clearTimeout(timer);done();}};}
  decode(){return h.decodeGate?h.decodeGate.promise:h.decodeFails?Promise.reject(new Error('Image unavailable')):Promise.resolve();}
}
const root=new Node(),media={matches:false,addEventListener(){},removeEventListener(){}},monitor={position:{x:0,y:0},size:{width:1920,height:1080},workArea:{position:{x:0,y:0},size:{width:1920,height:1020}},scaleFactor:1.25};
let cards=0,stack=null,notifications=null,motion='full',frame=null,nativeVisible=false,nativeTopmost=false;
root.querySelector=selector=>selector==='.anot-live-stack'?stack:null;root.querySelectorAll=()=>Array.from({length:cards},()=>({}));
const nativeWindow={setSize:async size=>{calls.push({size:{...size}});frame={...frame,width:size.width,height:size.height};globalThis.innerWidth=size.width/1.25;globalThis.innerHeight=size.height/1.25;},setPosition:async pos=>{calls.push({position:{...pos}});frame={...frame,x:pos.x,y:pos.y};},show:async()=>{nativeVisible=!h.forceHidden;calls.push({show:true});},hide:async()=>{nativeVisible=false;calls.push({hide:true});},setIgnoreCursorEvents:async value=>calls.push({ignore:value}),onScaleChanged:async()=>()=>{},isVisible:async()=>nativeVisible,isAlwaysOnTop:async()=>nativeTopmost,isMinimized:async()=>false,isFocused:async()=>false,outerPosition:async()=>({x:frame.x,y:frame.y}),outerSize:async()=>({width:frame.width,height:frame.height}),innerSize:async()=>({width:frame.width,height:frame.height})};
for(const name of ['setTitle','setFocusable','setResizable','setAlwaysOnTop','setSkipTaskbar'])nativeWindow[name]=async value=>{if(name==='setAlwaysOnTop')nativeTopmost=value;calls.push({[name]:value});};
const h={root,node:()=>new Node(),monitor,listeners,savedPalette:PALETTES.find(palette=>palette.mode==='light').id,window:nativeWindow,widget:{id:'@aurora/notifications',windowId:123456,window:nativeWindow,init:async()=>{},ready:async()=>{},show:nativeWindow.show},
  notifications:options=>{notifications=options;stack=new Node();stack.hidden=true;root.append(stack);void options.invoke('get-notifications');void options.invoke('get-focus');void options.invoke('get-mode');return{dispose(){calls.push({disposed:true});}};},
  invoke:async(command,args)=>{if(command==='get-notifications')return[{}];if(command==='get-focus')return false;if(command==='get-mode')return'All';if(command==='get-pointer')return h.pointer||[0,0];if(command==='write')calls.push({diagnostic:JSON.parse(args.content)});},
  listen:async(event,callback)=>{listeners.set(event,callback);return()=>listeners.delete(event);},
  emit:async(event,payload)=>{calls.push({event,payload});if(event===PALETTE_EVENTS.request)listeners.get(PALETTE_EVENTS.state)?.({payload:{homeWidgetId:'@aurora/home',paletteId:h.savedPalette||'gold'}});if(event==='aurora:notification-presence-request'){const paletteId=h.sourcePalette;setTimeout(()=>listeners.get('aurora:notification-presence-source')?.({payload:{id:payload.id,homeWidgetId:'@aurora/home',monitor,source:{x:.3,y:.15,width:.25,height:.4},frame:null,motion,paletteId}}),h.sourceDelay||1);}if(event==='aurora:notification-presence-state')setTimeout(()=>listeners.get('aurora:notification-presence-ack')?.({payload:{...payload,reason:'fixture'}}),1);}
};
h.frame=()=>frame;globalThis.__journeyHarness=h;globalThis.document={getElementById:()=>root,createElement:()=>new Node()};
globalThis.window={__TAURI_INTERNALS__:{},addEventListener:(name,fn)=>{const old=windowListeners.get(name);windowListeners.set(name,old?()=>{old();fn();}:fn);},removeEventListener(){}};globalThis.matchMedia=()=>media;globalThis.devicePixelRatio=1.25;globalThis.innerWidth=1536;globalThis.innerHeight=864;
globalThis.requestAnimationFrame=fn=>setTimeout(fn,1);globalThis.cancelAnimationFrame=clearTimeout;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const modules={
  '@seelen-ui/lib':`const h=globalThis.__journeyHarness;export const Widget={self:h.widget};export const invoke=h.invoke,subscribe=h.listen;export const SeelenCommand={GetNotifications:'get-notifications',GetFocusAssist:'get-focus',GetNotificationsMode:'get-mode',WriteFile:'write',TriggerWidget:'trigger',GetMousePosition:'get-pointer'};export const SeelenEvent={Notifications:'notifications',FocusAssistChanged:'focus',NotificationsModeChanged:'mode',GlobalMouseMove:'mouse-move'};export class IconPackManager{static async create(){return{onChange:async()=>()=>{},getIcon:()=>null};}static async requestIconExtraction(){}}`,
  '@tauri-apps/api/window':`const h=globalThis.__journeyHarness;export const currentMonitor=async()=>h.monitor,primaryMonitor=currentMonitor,getCurrentWindow=()=>h.window;export class PhysicalPosition{constructor(x,y){this.x=x;this.y=y;}}export class PhysicalSize{constructor(width,height){this.width=width;this.height=height;}}`,
  '@tauri-apps/api/event':`const h=globalThis.__journeyHarness;export const listen=h.listen,emit=h.emit;export const emitTo=async(target,event,payload)=>h.emit(event,{target,...payload});`,
  '@tauri-apps/api/webviewWindow':`const h=globalThis.__journeyHarness;export const getCurrentWebviewWindow=()=>({label:'fixture-notifications',listen:h.listen});`,
  './aurora-notification-stars.mjs':`const NOTIFICATION_STAR_HEADROOM=158;export const notificationStarFrame=${notificationStarFrame.toString()};export const notificationPointerInside=${notificationPointerInside.toString()};
    const h=globalThis.__journeyHarness;export function createNotificationStars({root,onChange}){let pending=false,epoch=0;return{prepare(){pending=true;onChange();},hasPending:()=>pending,interactiveRects:()=>pending||root.querySelector('.anot-live-stack')?.hidden?[]:[{left:12,top:12,right:468,bottom:192}],async reveal(){const token=epoch;h.starCalls??=[];h.starCalls.push({motion:root.dataset.motion,frame:{...globalThis.__journeyHarness.frame()}});root.dataset.starPhase=root.dataset.motion==='full'?'descent':'idle';if(root.dataset.motion==='full')await new Promise(r=>setTimeout(r,20));if(token===epoch){pending=false;root.dataset.starPhase='idle';onChange();}},finish(){epoch++;pending=false;root.dataset.starPhase='idle';onChange();},dispose(){this.finish();}};}`,
  './aurora-notifications.mjs':`export const initNativeNotifications=globalThis.__journeyHarness.notifications;export const normaliseNotificationPriorityIds=${normaliseNotificationPriorityIds.toString()};`
};
const result=await build({entryPoints:[path.join(project,'src/notification-overlay.mjs')],bundle:true,format:'esm',platform:'browser',target:'chrome120',write:false,define:{__AURORA_NOTIFICATION_OVERLAY_CONFIG__:JSON.stringify({homeWidgetId:'@aurora/home'})},plugins:[{name:'native-fixture',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(modules,args.path)?{path:args.path,namespace:'fixture'}:null);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
let expectedStarCalls=0;
function popup(show){cards=show?1:0;stack.hidden=!show;if(show){expectedStarCalls=(h.starCalls?.length||0)+1;notifications.onPopupLifecycle({action:'created',reason:'arrived'});}notifications.onPopupVisibilityChange(show);}
const settled=()=>root.dataset.overlayPhase==='docked'&&root.dataset.starPhase==='idle'&&(h.starCalls?.length||0)>=expectedStarCalls;
assert.equal(root.dataset.overlayPhase,'home');assert.ok(calls.some(call=>call.setFocusable===false));
assert.equal(typeof listeners.get('internal::liveness-ping'),'function','Native watchdog listener is registered before startup work');
listeners.get('internal::liveness-ping')({payload:{}});await pause(1);
assert.ok(calls.some(call=>call.event==='internal::liveness-pong'&&call.payload.target.kind==='WebviewWindow'&&call.payload.target.label==='fixture-notifications'));
assert.equal(root.dataset.auroraPalette,h.savedPalette,'Restart recovers the Home palette after subscribing');
for(const palette of PALETTES){listeners.get(PALETTE_EVENTS.state)({payload:{homeWidgetId:'@aurora/home',paletteId:palette.id}});assert.equal(root.dataset.auroraPalette,palette.id);assert.equal(root.style['--au-text'],palette.tokens.text);assert.equal(root.style.colorScheme,palette.mode);}
const lastPalette=root.dataset.auroraPalette;
for(const payload of [{homeWidgetId:'@other/home',paletteId:'gold'},{homeWidgetId:'@aurora/home',paletteId:'invalid'}])listeners.get(PALETTE_EVENTS.state)({payload});
assert.equal(root.dataset.auroraPalette,lastPalette,'Other profiles and malformed palettes are ignored');
h.sourcePalette=root.dataset.auroraPalette;popup(true);await until(settled);
assert.equal(frame.x+frame.width,1897);assert.equal(frame.y+frame.height,997);assert.equal(frame.width,600);assert.equal(frame.height,255);
assert.ok(calls.some(call=>call.size?.width===600&&call.size.height>255&&call.size.height<600),'Star arrival briefly adds bounded headroom above the same bottom-right cards');
assert.ok(!calls.some(call=>call.size?.width===1920&&call.size.height===1020),'Arrival never creates a fullscreen window');
assert.ok(!calls.some(call=>call.payload?.away===true),'Star arrival does not borrow the Home galaxy');
assert.ok(calls.some(call=>call.event==='aurora:notification-presence-request'&&call.payload.captureFrame===false),'Metadata handoff explicitly declines an unused atom capture');
const lastIgnore=()=>calls.filter(call=>typeof call.ignore==='boolean').at(-1)?.ignore;
assert.equal(lastIgnore(),true,'Transparent surface passes through until the pointer enters a card');
h.pointer=[frame.x+100,frame.y+100];listeners.get('mouse-move')({payload:h.pointer});await until(()=>lastIgnore()===false);
h.pointer=[frame.x+2,frame.y+2];listeners.get('mouse-move')({payload:h.pointer});await until(()=>lastIgnore()===true);
await pause(450);const diagnostic=calls.filter(call=>call.diagnostic).at(-1).diagnostic;
assert.equal(diagnostic.sourceStatus,'received');assert.equal(diagnostic.sourceRequests,1);assert.equal(diagnostic.sourceReplies,1);assert.equal(diagnostic.imageDecode,'not-requested');assert.equal(diagnostic.focusAssist,false);assert.equal(diagnostic.mode,'All');assert.equal(diagnostic.baselineCount,1);
assert.equal(diagnostic.visible,true);assert.equal(diagnostic.showRequested,true);assert.equal(diagnostic.nativeSurface.hwnd,123456);assert.equal(diagnostic.nativeSurface.focused,false);assert.equal(diagnostic.nativeSurface.alwaysOnTop,true);assert.deepEqual(diagnostic.nativeSurface.outerSize,{width:600,height:255});assert.ok(!JSON.stringify(diagnostic).includes('data:image'));
const before={shows:calls.filter(c=>c.show).length,requests:calls.filter(c=>c.event==='aurora:notification-presence-request').length,stars:h.starCalls.length};
for(const palette of PALETTES)listeners.get(PALETTE_EVENTS.state)({payload:{homeWidgetId:'@aurora/home',paletteId:palette.id}});
assert.equal(cards,1);assert.equal(calls.filter(c=>c.show).length,before.shows);assert.equal(calls.filter(c=>c.event==='aurora:notification-presence-request').length,before.requests);assert.equal(h.starCalls.length,before.stars,'Palette changes do not replay arrival');
popup(false);await until(()=>root.dataset.overlayPhase==='home');assert.equal(nativeVisible,false);assert.ok(calls.some(c=>c.payload?.away===false));
motion='reduced';h.sourcePalette=PALETTES.find(p=>p.id!=='gold').id;popup(true);await until(settled);assert.equal(root.dataset.auroraPalette,h.sourcePalette);assert.equal(h.starCalls.at(-1).motion,'reduced','Motion setting reaches the presentation gate');assert.equal(h.starCalls.at(-1).frame.height,255,'Reduced motion does not reserve star headroom');popup(false);await until(()=>root.dataset.overlayPhase==='home');
motion='full';h.sourceDelay=650;const requests=calls.filter(c=>c.event==='aurora:notification-presence-request').length;popup(true);await until(()=>calls.filter(c=>c.event==='aurora:notification-presence-request').length>requests);
const newer=PALETTES.find(p=>p.id!=='gold');listeners.get(PALETTE_EVENTS.state)({payload:{homeWidgetId:'@aurora/home',paletteId:newer.id}});await until(settled);assert.equal(root.dataset.auroraPalette,newer.id,'A newer preference wins over slow metadata');popup(false);await until(()=>root.dataset.overlayPhase==='home');
h.sourceDelay=80;const shows=calls.filter(c=>c.show).length,previousRequests=calls.filter(c=>c.event==='aurora:notification-presence-request').length;popup(true);await until(()=>calls.filter(c=>c.event==='aurora:notification-presence-request').length>previousRequests);popup(false);await pause(120);assert.equal(root.dataset.overlayPhase,'home');assert.equal(calls.filter(c=>c.show).length,shows,'Quiet suppression during metadata handoff cannot flash a window');
h.sourceDelay=1;popup(true);await until(()=>root.dataset.starPhase==='descent');popup(false);await until(()=>root.dataset.overlayPhase==='home');assert.equal(root.dataset.starPhase,'idle','Dismissal cancels active star work');
h.forceHidden=true;popup(true);await until(settled);await pause(450);const hidden=calls.filter(c=>c.diagnostic).at(-1).diagnostic;assert.equal(hidden.showRequested,true);assert.equal(hidden.visible,false,'A resolved native show is not proof that the window is visible');popup(false);await until(()=>root.dataset.overlayPhase==='home');h.forceHidden=false;
windowListeners.get('pagehide')();assert.ok(calls.some(c=>c.disposed));assert.equal(listeners.size,0,'All native listeners, including the scoped watchdog, are released');
// A crashed overlay cannot leave the desktop's own atom invisible.
const desktop=new Node();let leaseCallback=null,leaseDuration=0;
const desktopWindow={__TAURI_INTERNALS__:{},innerWidth:1536,innerHeight:864,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setTimeout:(fn,ms)=>{if(ms===25000){leaseCallback=fn;leaseDuration=ms;return -1;}return setTimeout(fn,ms);},clearTimeout:id=>{if(id===-1)leaseCallback=null;else clearTimeout(id);},addEventListener(){},removeEventListener(){},matchMedia:()=>media};
desktop.ownerDocument={defaultView:desktopWindow};desktop.dataset.motion='full';
desktop.dispatchEvent=event=>calls.push({desktopLight:event.detail});
desktop.querySelector=selector=>selector==='.ah-core-stage'?{getBoundingClientRect:()=>({x:200,y:100,width:400,height:360})}:null;
h.widget.id='@aurora/home';nativeWindow.innerPosition=async()=>({x:0,y:0});nativeWindow.innerSize=async()=>({width:1920,height:1080});
const bridge=await build({entryPoints:[path.join(project,'src/aurora-notification-presence.mjs')],bundle:true,format:'esm',platform:'browser',target:'chrome120',write:false,plugins:[{name:'native-bridge-fixture',setup(build){build.onResolve({filter:/.*/},args=>Object.hasOwn(modules,args.path)?{path:args.path,namespace:'fixture'}:null);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
const presence=await import('data:text/javascript;base64,'+Buffer.from(bridge.outputFiles[0].text).toString('base64'));
const cleanup=presence.initNotificationPresence({root:desktop});assert.equal(typeof cleanup,'function');
await until(()=>listeners.has('aurora:notification-presence-state'));
listeners.get('aurora:notification-presence-state')({payload:{id:'live-overlay',homeWidgetId:'@aurora/home',away:true}});
assert.equal(desktop.dataset.notificationPresence,'away');assert.equal(leaseDuration,25000);assert.equal(typeof leaseCallback,'function');
const lightPacket={id:'live-overlay',homeWidgetId:'@aurora/home',x:272.5,y:112.5,radius:25,intensity:.8,visible:true,at:Date.now()};
listeners.get('aurora:notification-presence-light')({payload:{...lightPacket,id:'wrong-owner'}});await pause(5);assert.equal(calls.filter(call=>call.desktopLight).length,0);
listeners.get('aurora:notification-presence-light')({payload:lightPacket});await until(()=>calls.some(call=>call.desktopLight));
assert.equal(calls.find(call=>call.desktopLight).desktopLight.x,.5);assert.equal(calls.find(call=>call.desktopLight).desktopLight.y,.5);assert.equal(calls.find(call=>call.desktopLight).desktopLight.radius,20);
leaseCallback();assert.equal(desktop.dataset.notificationPresence,undefined);
listeners.get('aurora:notification-presence-light')({payload:{...lightPacket,at:Date.now()}});await pause(5);assert.equal(calls.filter(call=>call.desktopLight).length,1,'An expired carrier cannot keep controlling desktop lighting');
assert.ok(calls.some(call=>call.event==='aurora:notification-presence-ack'&&call.payload.away===false&&call.payload.reason==='lease-expired'));
listeners.get('aurora:notification-presence-state')({payload:{id:'live-overlay',homeWidgetId:'@aurora/home',away:true}});cleanup();cleanup();assert.equal(desktop.dataset.notificationPresence,undefined);assert.equal(listeners.size,0);
delete globalThis.__journeyHarness;
console.log('Notification journey: bounded star headroom and fixed card anchor, scoped watchdog, native frame/focus/readbacks, pointer pass-through, palette races, metadata-only handoff, reduced motion, cancellation, hidden-show detection, legacy crash lease and cleanup passed. Presentation adapter is mocked here; real star/card DOM is verified separately in Chromium.');
