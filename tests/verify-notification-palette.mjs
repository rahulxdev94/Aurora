import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {normaliseNotificationAccent,readNotificationAccent,applyNotificationAccent,DEFAULT_NOTIFICATION_ACCENT} from '../src/aurora-notification-presence.mjs';
import {PALETTES} from '../src/aurora-palettes.mjs';

assert.equal(normaliseNotificationAccent('#d6b466'),'#D6B466');
for(const value of [null,123,{},'#fff','#ffffff00',' #D6B466','#D6B466 ','rgb(214,180,102)','red','var(--accent)','#ffffff;display:none','url(https://invalid.example)'])assert.equal(normaliseNotificationAccent(value),null,'Only a six-digit hex colour may cross the window boundary');
let computed='#d6b466';const applied=[];
const root={ownerDocument:{defaultView:{getComputedStyle:()=>({getPropertyValue:name=>{assert.equal(name,'--ah-accent');return computed;}})}},style:{setProperty:(key,value)=>applied.push({key,value})}};
for(const [value,expected]of [['#d6b466','#D6B466'],[' rgb(214, 180, 102) ','#D6B466'],['rgb(216 220 227)','#D8DCE3'],['rgba(228, 206, 155, 1)','#E4CE9B'],['rgb(0,0,0)','#000000'],['rgb(255,255,255)','#FFFFFF']]){computed=value;assert.equal(readNotificationAccent(root),expected);}
for(const value of ['rgb(256,0,0)','rgb(-1,0,0)','rgba(1,2,3,.5)','rgb(1,2,3);color:red','var(--unknown)','', '#fff']){computed=value;assert.equal(readNotificationAccent(root),DEFAULT_NOTIFICATION_ACCENT);}
computed='rgb(214,180,102)';assert.equal(applyNotificationAccent(root,readNotificationAccent(root)),'#D6B466');assert.deepEqual(applied.at(-1),{key:'--ah-accent',value:'#D6B466'});
assert.equal(applyNotificationAccent(root,'#d8dce3'),'#D8DCE3','The next source palette replaces the previous theme');
assert.equal(applyNotificationAccent(root,'rgb(1,2,3)'),DEFAULT_NOTIFICATION_ACCENT,'Overlay input never accepts raw CSS');assert.equal(applied.at(-1).value,DEFAULT_NOTIFICATION_ACCENT,'Missing or invalid source colours clear any stale palette');
assert.ok(applied.every(({key,value})=>key==='--ah-accent'&&/^#[0-9A-F]{6}$/.test(value)));

// Exercise the actual source request and event payload without Windows or image data.
const listeners=new Map(),emitted=[],timers=new Map();let serial=0;
const monitor={position:{x:0,y:0},size:{width:1920,height:1080},scaleFactor:1.25};
const win={__TAURI_INTERNALS__:{},innerWidth:1536,innerHeight:864,getComputedStyle:()=>({getPropertyValue:()=>computed}),setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false})};
const desktop={ownerDocument:{defaultView:win},dataset:{motion:'full'},querySelector:selector=>selector==='.ah-core-stage'?{getBoundingClientRect:()=>({x:200,y:100,width:400,height:360})}:null};
globalThis.__notificationPaletteFixture={listen:async(type,fn)=>{listeners.set(type,fn);return()=>listeners.delete(type);},emit:async(type,payload)=>emitted.push({type,payload}),monitor};
const modules={
  '@tauri-apps/api/event':`const h=globalThis.__notificationPaletteFixture;export const listen=h.listen,emit=h.emit;`,
  '@tauri-apps/api/window':`const h=globalThis.__notificationPaletteFixture;export const currentMonitor=async()=>h.monitor,getCurrentWindow=()=>({innerPosition:async()=>({x:0,y:0}),innerSize:async()=>({width:1920,height:1080})});`,
  '@seelen-ui/lib':`export const Widget={self:{id:'@aurora/home'}};export const invoke=async()=>{};export const SeelenCommand={WriteFile:'write'};`
};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/aurora-notification-presence.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',target:'chrome120',write:false,plugins:[{name:'palette-fixture',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(modules,args.path)?{path:args.path,namespace:'fixture'}:null);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'js'}));}}]});
const bridge=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const stop=bridge.initNotificationPresence({root:desktop});
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve();}assert.fail('Palette source fixture did not settle');}
await until(()=>listeners.has(bridge.NOTIFICATION_PRESENCE_EVENTS.request));
computed='rgb(214, 180, 102)';listeners.get(bridge.NOTIFICATION_PRESENCE_EVENTS.request)({payload:{id:'palette-one',homeWidgetId:'@aurora/home'}});await until(()=>emitted.some(event=>event.payload.id==='palette-one'));
assert.equal(emitted.find(event=>event.payload.id==='palette-one').payload.accent,'#D6B466','The actual desktop event carries the normalised current accent');
assert.equal(emitted.find(event=>event.payload.id==='palette-one').payload.paletteId,'gold','An unconfigured source keeps the accepted default palette');
computed='#D8DCE3';listeners.get(bridge.NOTIFICATION_PRESENCE_EVENTS.request)({payload:{id:'palette-two',homeWidgetId:'@aurora/home'}});await until(()=>emitted.some(event=>event.payload.id==='palette-two'));assert.equal(emitted.find(event=>event.payload.id==='palette-two').payload.accent,'#D8DCE3','Each arrival samples the current theme again');
for(const palette of PALETTES){
  desktop.dataset.auroraPalette=palette.id;const id='source-'+palette.id;
  listeners.get(bridge.NOTIFICATION_PRESENCE_EVENTS.request)({payload:{id,homeWidgetId:'@aurora/home'}});await until(()=>emitted.some(event=>event.payload.id===id));
  assert.equal(emitted.find(event=>event.payload.id===id).payload.paletteId,palette.id,'Every source handoff carries the selected coordinated palette');
}
desktop.dataset.auroraPalette='unknown-palette';listeners.get(bridge.NOTIFICATION_PRESENCE_EVENTS.request)({payload:{id:'invalid-palette',homeWidgetId:'@aurora/home'}});await until(()=>emitted.some(event=>event.payload.id==='invalid-palette'));assert.equal(emitted.find(event=>event.payload.id==='invalid-palette').payload.paletteId,'gold','Invalid source state cannot inject a palette ID');
stop();assert.equal(listeners.size,0);assert.equal(timers.size,0);delete globalThis.__notificationPaletteFixture;
for(const name of ['aurora-notifications.css','notification-overlay.css'])await transform(await readFile(new URL('../src/'+name,import.meta.url),'utf8'),{loader:'css',target:'chrome120'});
console.log('Notification palette: strict source colour validation, computed rgb normalisation, real bridge payload refresh, safe overlay application and both CSS parses passed.');
