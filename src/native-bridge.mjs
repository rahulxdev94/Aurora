import { Widget, invoke, subscribe, SeelenCommand, SeelenEvent } from '@seelen-ui/lib';
import { currentMonitor, primaryMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

import {config} from './config.mjs';
const FOLDERS=['Work','Personal','Finance','Projects','Media','Documents','Apps','Archives'];
const DESKTOP=config.roots.Desktop;
const KNOWN_ROOTS=Object.freeze(config.roots);
const URLS=Object.freeze({YouTube:'https://www.youtube.com/',Netflix:'https://www.netflix.com/',Gmail:'https://mail.google.com/',Outlook:'https://outlook.live.com/mail/',ChatGPT:config.chatgptUrl});
const STATE_KEY='aurora-home.preferences.v1';
const TASKS_KEY='aurora-home.tasks.v1';
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

async function openTarget(path,label){
  try {await invoke(SeelenCommand.OpenFile,{path});nativeStatus(`Opened ${label}.`);}
  catch(error){console.warn('Aurora launch failed',error);nativeStatus(`${label} could not be opened. Check the Seelen permission prompt.`);}
}

export async function initialiseNative(){
  widget=Widget.self;
  await widget.init({saveAndRestoreLastRect:false,hideOnFocusLoss:false,useThemes:false,normalizeDevicePixelRatio:false});
  await widget.window.setFocusable(true);
  await widget.window.setResizable(false);
  await widget.window.setTitle('Aurora Home');
  async function fitWorkArea(){
    const monitor=await currentMonitor()||await primaryMonitor();
    if(!monitor)throw new Error('No monitor available for Aurora Home');
    const position=monitor.position;
    const size=monitor.size;
    await widget.window.setPosition(new PhysicalPosition(position.x,position.y));
    await widget.window.setSize(new PhysicalSize(size.width,size.height));
  }
  await fitWorkArea();
  widget.window.onScaleChanged(()=>{void fitWorkArea().catch(console.warn);});
  widget.onTrigger(async()=>{await widget.show();await widget.focus();});
  const saved=readJSON(STATE_KEY,{privateContent:{}});
  window.openai={
    widgetState:saved,
    async setWidgetState(value){
      const next={...value,privateContent:{...(this.widgetState?.privateContent||{}),...(value.privateContent||{})}};
      localStorage.setItem(STATE_KEY,JSON.stringify(next));this.widgetState=next;
    }
  };
  window.__auroraNative=Object.freeze({
    handlesApp:name=>Object.prototype.hasOwnProperty.call(URLS,name)||name==='Projects'||name==='Downloads',
    openApp:name=>name==='Downloads'?openTarget(KNOWN_ROOTS.Downloads,'Downloads'):name==='Projects'?(fileBrowser?fileBrowser.openFolder(3):openTarget(`${DESKTOP}\\Projects`,'Projects')):Object.prototype.hasOwnProperty.call(URLS,name)?openTarget(URLS[name],name):Promise.resolve(),
    openFolder:index=>Number.isInteger(index)&&index>=0&&index<FOLDERS.length?(fileBrowser?fileBrowser.openFolder(index):openTarget(`${DESKTOP}\\${FOLDERS[index]}`,FOLDERS[index])):Promise.resolve(),
    loadTasks:()=>{const items=readJSON(TASKS_KEY,[]);return Array.isArray(items)?items.filter(item=>Number.isInteger(item.id)&&typeof item.title==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.date)&&typeof item.time==='string').slice(0,1000):[];},
    saveTasks:items=>{try{localStorage.setItem(TASKS_KEY,JSON.stringify(items.slice(0,1000)));}catch{nativeStatus('Tasks could not be saved locally.');}},
    openDraft:()=>openTarget(config.chatgptUrl,'ChatGPT; copy your draft from Aurora'),
    openDesktop:()=>openTarget(DESKTOP,'Desktop in File Explorer'),
    hide:()=>widget.hide()
  });
  return widget;
}

export async function finishNative(){
  const root=document.getElementById('aurora-home-preview');
  root.dataset.nativeDesktop='true';
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
  recovery.innerHTML='<button type="button" class="cursor-interaction" data-native-explorer>File Explorer</button><button type="button" class="cursor-interaction" data-native-hide>Hide Aurora</button>';
  root.querySelector('.ah-statusbar')?.append(recovery);
  const draftButton=document.createElement('button');draftButton.type='button';draftButton.className='ah-dock-button cursor-interaction';draftButton.dataset.action='compose-chat';draftButton.setAttribute('aria-label','Compose ChatGPT draft');draftButton.innerHTML='<i data-lucide="file-pen-line" aria-hidden="true"></i><span>Draft</span>';
  root.querySelector('.ah-dock-button[data-action="chat"]')?.after(draftButton);
  globalThis.lucide?.createIcons({attrs:{width:16,height:16}});
  await widget.ready({show:true});
}

export {invoke,subscribe,SeelenCommand,SeelenEvent,FOLDERS,DESKTOP,KNOWN_ROOTS};
