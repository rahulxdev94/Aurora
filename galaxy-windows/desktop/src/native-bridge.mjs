import { Widget, invoke, subscribe, SeelenCommand, SeelenEvent } from '@seelen-ui/lib';
import { currentMonitor, primaryMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import {createMouseCommandTrigger,MOUSE_COMMAND_FILE} from './mouse-commands.mjs';
import {initCompanionLaunchers} from './companion-launchers.mjs';
import {config,CHATGPT_APP} from './config.mjs';

const FOLDERS=['Work','Personal','Finance','Projects','Media','Documents','Apps','Archives'];
const DESKTOP=config.roots.Desktop;
const KNOWN_ROOTS=Object.freeze(config.roots);
const URLS=Object.freeze({YouTube:'https://www.youtube.com/',Netflix:'https://www.netflix.com/',Gmail:'https://mail.google.com/',Outlook:'https://outlook.live.com/mail/',ChatGPT:config.chatgptUrl});
const CHAT=config.chatgptUrl || CHATGPT_APP;
const STATE_KEY='galaxy-atlas.preferences.v1';
const TASKS_KEY='galaxy-atlas.tasks.v1';
const readJSON=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
let widget;
let statusTimer;
let fileBrowser=null;
export function attachFileBrowser(browser){fileBrowser=browser;}

export function nativeStatus(message){
  const root=document.getElementById('aurora-home-preview');
  const toast=root?.querySelector('.ah-toast');
  if(!toast)return;
  toast.textContent=message;toast.classList.add('ah-show');
  clearTimeout(statusTimer);statusTimer=setTimeout(()=>toast.classList.remove('ah-show'),4200);
}

// Count only successful explicit Galaxy Atlas website launches. Never retain paths or queries.
function websiteOpened(path){
  try{const url=new URL(path);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;
    const root=document.getElementById('aurora-home-preview');
    root?.dispatchEvent(new CustomEvent('galaxy-atlas:website-opened',{detail:{url:url.origin+'/'}}));
  }catch{}
}

async function openTarget(path,label){
  try {await invoke(SeelenCommand.OpenFile,{path});websiteOpened(path);nativeStatus(`Opened ${label}.`);return true;}
  catch(error){console.warn('Galaxy Atlas launch failed',error);nativeStatus(`${label} could not be opened. Check the Seelen permission prompt.`);}
}

export async function initialiseNative(){
  for(const [oldKey,newKey] of [
    ['rahul.aurora-home.preferences.v1','galaxy-atlas.preferences.v1'],['rahul.aurora-home.tasks.v1','galaxy-atlas.tasks.v1'],
    ['aurora.deskTools.v1','galaxy-atlas.deskTools.v1'],['aurora.home.clock-city.v1','galaxy-atlas.clock-city.v1'],
    ['aurora.palette.v1','galaxy-atlas.palette.v1']]){
    try{const value=localStorage.getItem(oldKey);if(value!==null && localStorage.getItem(newKey)===null)localStorage.setItem(newKey,value);}catch{}
  }
  widget=Widget.self;
  const mouseCommands=createMouseCommandTrigger({
    read:()=>invoke(SeelenCommand.ReadFile,{filename:MOUSE_COMMAND_FILE}),
    write:content=>invoke(SeelenCommand.WriteFile,{filename:MOUSE_COMMAND_FILE,content}),
    getHandler:()=>window.__auroraHandleSearchCommand
  });
  window.addEventListener('pagehide',()=>mouseCommands.dispose(),{once:true});
  // Register before init releases a pending cold-start trigger.
  widget.onTrigger(async(args={})=>{await widget.show();await widget.focus();await mouseCommands.handle(args);});
  await widget.init({saveAndRestoreLastRect:false,hideOnFocusLoss:false,useThemes:false,normalizeDevicePixelRatio:false});
  await widget.window.setFocusable(true);
  await widget.window.setResizable(false);
  await widget.window.setTitle('Galaxy Atlas');
  async function fitWorkArea(){
    const monitor=await currentMonitor()||await primaryMonitor();
    if(!monitor)throw new Error('No monitor available for Galaxy Atlas');
    const position=monitor.position;
    const size=monitor.size;
    await widget.window.setPosition(new PhysicalPosition(position.x,position.y));
    await widget.window.setSize(new PhysicalSize(size.width,size.height));
  }
  await fitWorkArea();
  widget.window.onScaleChanged(()=>{void fitWorkArea().catch(console.warn);});
  const saved=readJSON(STATE_KEY,{privateContent:{}});
  window.openai={
    widgetState:saved,
    async setWidgetState(value){
      const next={...value,privateContent:{...(this.widgetState?.privateContent||{}),...(value.privateContent||{})}};
      localStorage.setItem(STATE_KEY,JSON.stringify(next));this.widgetState=next;
    }
  };
  window.__auroraNative=Object.freeze({
    openLibrary:()=>openTarget('shell:Libraries','Windows Libraries'),
    readGalaxyMotion:()=>invoke(SeelenCommand.ReadFile,{filename:'galaxy-motion-session.json'}),
    handlesApp:name=>Object.prototype.hasOwnProperty.call(URLS,name)||name==='Projects',
    openApp:name=>name==='Projects'?(fileBrowser?fileBrowser.openFolder(3):openTarget(`${DESKTOP}\\Projects`,'Projects')):Object.prototype.hasOwnProperty.call(URLS,name)?openTarget(URLS[name],name):Promise.resolve(),
    openFolder:index=>Number.isInteger(index)&&index>=0&&index<FOLDERS.length?(fileBrowser?fileBrowser.openFolder(index):openTarget(`${DESKTOP}\\${FOLDERS[index]}`,FOLDERS[index])):Promise.resolve(),
    loadTasks:()=>{const items=readJSON(TASKS_KEY,[]);return Array.isArray(items)?items.filter(item=>Number.isInteger(item.id)&&typeof item.title==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)&&typeof item.time==='string').slice(0,1000):[];},
    saveTasks:items=>{try{localStorage.setItem(TASKS_KEY,JSON.stringify(items.slice(0,1000)));}catch{nativeStatus('Tasks could not be saved locally.');}},
    openDraft:()=>openTarget(CHAT,'Galaxy Atlas chat; copy your draft from Galaxy Atlas'),
    openDesktop:()=>fileBrowser?.openLocation?fileBrowser.openLocation(DESKTOP):openTarget(DESKTOP,'Desktop in File Explorer'),
    hide:()=>widget.hide()
  });
  return widget;
}

export async function finishNative(){
  const root=document.getElementById('aurora-home-preview');
  const disposeCompanions=initCompanionLaunchers({root,launchers:config.launchers,openTarget:async path=>{await invoke(SeelenCommand.OpenFile,{path});websiteOpened(path);return true;},status:nativeStatus});
  window.addEventListener('pagehide',disposeCompanions,{once:true});
  root.dataset.nativeDesktop='true';
  let startupUsage=null,startupFileIndex=null;
  const startedAt=new Date().toISOString();
  let diagnosticClosed=false;
  const captureRenderState=()=>({capturedAt:new Date().toISOString(),motion:root.dataset.motion??null,paused:root.dataset.paused??null,hidden:document.hidden,prefersReducedMotion:typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)').matches:null});
  const captureAtomStatus=()=>{
    const bubble=root.querySelector('.aas-bubble'),toggle=root.querySelector('.aas-toggle'),stage=root.querySelector('.ah-core-stage'),core=stage?.querySelector('.ah-companion');
    const t=toggle?.getBoundingClientRect(),s=stage?.getBoundingClientRect(),c=core?.getBoundingClientRect();
    return{mounted:!!bubble,control:!!toggle,insideStage:!!(t&&s&&t.left>=s.left-1&&t.top>=s.top-1&&t.right<=s.right+1&&t.bottom<=s.bottom+1),overlapsCore:!!(t&&c&&Math.min(t.right,c.right)>Math.max(t.left,c.left)&&Math.min(t.bottom,c.bottom)>Math.max(t.top,c.top))};
  };
  const renderStateStart=captureRenderState();
  const startupPlayback={source:'Windows playback',eventCount:0,maxPeak:0,activeSeen:false,idleAfterActive:false,latestStatus:'unavailable',latestPeak:0,lastReceivedAt:null};
  const rememberPlayback=event=>{
    const sample=window.__auroraPlaybackAudio;
    if(sample?.source!=='Windows playback'||!['active','idle','unavailable'].includes(sample.status)||typeof sample.peak!=='number'||!Number.isFinite(sample.peak)||sample.peak<0||sample.peak>1||typeof sample.at!=='number'||!Number.isFinite(sample.at))return;
    if(event)startupPlayback.eventCount++;
    startupPlayback.maxPeak=Math.max(startupPlayback.maxPeak,sample.peak);
    if(sample.status==='active'&&sample.peak>0)startupPlayback.activeSeen=true;
    if(sample.status==='idle'&&sample.peak===0&&startupPlayback.activeSeen)startupPlayback.idleAfterActive=true;
    startupPlayback.latestStatus=sample.status;
    startupPlayback.latestPeak=sample.peak;
    startupPlayback.lastReceivedAt=sample.at>0&&sample.at<=8640000000000000?new Date(sample.at).toISOString():null;
  };
  const rememberUsage=event=>{startupUsage=event.detail;};
  const startupGpuTemperature={sampleCount:0,lastSuccess:null,latest:null,samples:[]};
  const rememberGpuTemperature=event=>{
    const reading=event.detail;if(reading?.source!=='nvidia-smi'||!['ok','stale','unavailable'].includes(reading.status))return;
    const measured=Date.parse(reading.updatedAt),validTime=Number.isFinite(measured)&&Date.now()-measured>=-5000;
    const value=typeof reading.temperatureC==='number'&&Number.isFinite(reading.temperatureC)&&reading.temperatureC>=-20&&reading.temperatureC<=130?reading.temperatureC:null;
    if(reading.status==='ok'&&value!==null&&validTime)startupGpuTemperature.lastSuccess=new Date(measured).toISOString();
    const sensor=[...root.querySelectorAll('.ah-sensor')].find(button=>button.querySelector('span')?.textContent.includes('GPU'));
    const sample={status:reading.status,source:'nvidia-smi',name:typeof reading.name==='string'?reading.name.slice(0,128):null,temperatureC:value,measuredAt:validTime?new Date(measured).toISOString():null,ageMs:validTime?Math.max(0,Date.now()-measured):null,receivedAt:new Date().toISOString(),displayed:typeof sensor?.querySelector('strong')?.textContent==='string'?sensor.querySelector('strong').textContent.slice(0,50):null};
    startupGpuTemperature.sampleCount++;startupGpuTemperature.latest=sample;startupGpuTemperature.samples.push(sample);if(startupGpuTemperature.samples.length>6)startupGpuTemperature.samples.shift();
  };
  const rememberFileIndex=event=>{startupFileIndex=event.detail;};
  root.addEventListener('galaxy-atlas:usage-updated',rememberUsage);
  root.addEventListener('galaxy-atlas:gpu-temperature-updated',rememberGpuTemperature);
  root.addEventListener('galaxy-atlas:file-index-updated',rememberFileIndex);
  root.addEventListener('aurora-playback-audio',rememberPlayback);
  rememberPlayback();
  const diagnosticTimer=setTimeout(()=>{
    if(diagnosticClosed)return;
    root.removeEventListener('galaxy-atlas:usage-updated',rememberUsage);
    root.removeEventListener('galaxy-atlas:gpu-temperature-updated',rememberGpuTemperature);
    root.removeEventListener('galaxy-atlas:file-index-updated',rememberFileIndex);
    root.removeEventListener('aurora-playback-audio',rememberPlayback);
    rememberPlayback();
    const windowEndedAt=new Date().toISOString(),renderStateEnd=captureRenderState();
    diagnosticClosed=true;
    void invoke(SeelenCommand.WriteFile,{filename:'system-pulse-startup.json',content:JSON.stringify({startedAt,windowEndedAt,recordedAt:new Date().toISOString(),source:'Seelen native host',usage:startupUsage,gpuTemperature:startupGpuTemperature,fileIndex:startupFileIndex,atomStatus:captureAtomStatus(),playback:startupPlayback,renderState:{start:renderStateStart,end:renderStateEnd}})}).catch(error=>console.warn('System pulse startup diagnostic unavailable',error));
  },35000);
  window.addEventListener('pagehide',()=>{diagnosticClosed=true;clearTimeout(diagnosticTimer);root.removeEventListener('galaxy-atlas:usage-updated',rememberUsage);root.removeEventListener('galaxy-atlas:gpu-temperature-updated',rememberGpuTemperature);root.removeEventListener('galaxy-atlas:file-index-updated',rememberFileIndex);root.removeEventListener('aurora-playback-audio',rememberPlayback);},{once:true});
  const lowerGrid=document.createElement('div');lowerGrid.className='an-lower-grid';
  const weather=root.querySelector('.ah-weather');
  weather.before(lowerGrid);
  lowerGrid.append(weather,root.querySelector('.ah-focus'),root.querySelector('.ah-sensors'));
  const folderList=root.querySelector('.ah-library>.ah-folders');
  folderList.setAttribute('aria-label','Your library, scroll vertically for more folders');
  folderList.tabIndex=0;
  const restoreButton=root.querySelector('.ah-dock-restore');
  if(restoreButton)root.querySelector('.ah-topbar')?.append(restoreButton);
  root.addEventListener('click',event=>{
    const sourceLink=event.target.closest('a[href="https://open-meteo.com/"]');
    if(sourceLink){event.preventDefault();void openTarget('https://open-meteo.com/','Open-Meteo');return;}
    const action=event.target.closest('[data-native-draft],[data-native-explorer],[data-native-hide],[data-native-chat]');
    if(!action)return;
    if(action.hasAttribute('data-native-draft'))void window.__auroraNative.openDraft(root.querySelector('.ah-draft-preview')?.textContent);
    if(action.hasAttribute('data-native-explorer'))void window.__auroraNative.openDesktop();
    if(action.hasAttribute('data-native-chat'))void window.__auroraNative.openApp('ChatGPT');
    if(action.hasAttribute('data-native-hide'))window.__auroraNative.hide();
  });
  const recovery=document.createElement('div');recovery.className='an-recovery';
  recovery.innerHTML='<button type="button" class="cursor-interaction" data-native-explorer>Files</button><button type="button" class="cursor-interaction" data-native-hide>Hide Galaxy Atlas</button>';
  root.querySelector('.ah-statusbar')?.append(recovery);
  const draftButton=document.createElement('button');draftButton.type='button';draftButton.className='ah-dock-button cursor-interaction';draftButton.dataset.action='compose-chat';draftButton.setAttribute('aria-label','Compose ChatGPT draft');draftButton.innerHTML='<i data-lucide="file-pen-line" aria-hidden="true"></i><span>Draft</span>';
  root.querySelector('.ah-dock-button[data-action="chat"]')?.after(draftButton);
  globalThis.lucide?.createIcons({attrs:{width:16,height:16}});
  await widget.ready({show:true});
}

export {invoke,subscribe,SeelenCommand,SeelenEvent,FOLDERS,DESKTOP,KNOWN_ROOTS};
