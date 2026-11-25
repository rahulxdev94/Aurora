import {Widget,invoke,subscribe,SeelenCommand,SeelenEvent} from '@seelen-ui/lib';
import {emit} from '@tauri-apps/api/event';
import {cursorPosition,monitorFromPoint,currentMonitor,primaryMonitor,PhysicalPosition,PhysicalSize} from '@tauri-apps/api/window';
import {createIcons,Search,AppWindow,File,FileText,Folder,FolderOpen,Command,Globe,ArrowUpRight,ArrowRight,ArrowLeft,RefreshCw,X,Settings,CalendarDays,Timer,Home,Orbit,Monitor,Mail,Music,Play,Check,ChevronRight,CornerDownLeft} from 'lucide';
import {initSpotlight} from './aurora-spotlight.mjs';
import {createSearchProvider} from './aurora-search-provider.mjs';
import {connectWidgetLiveness} from './widget-liveness.mjs';

connectWidgetLiveness();

const config=__AURORA_SEARCH_CONFIG__;
const activity=value=>emit('aurora:activity',{...value,homeWidgetId:config.homeWidgetId,sourceWidgetId:config.searchWidgetId});
const root=document.getElementById('aurora-home-preview');
globalThis.lucide={createIcons:(options={})=>createIcons({icons:{Search,AppWindow,File,FileText,Folder,FolderOpen,Command,Globe,ArrowUpRight,ArrowRight,ArrowLeft,RefreshCw,X,Settings,CalendarDays,Timer,Home,Orbit,Monitor,Mail,Music,Play,Check,ChevronRight,CornerDownLeft},...options})};
const widget=Widget.self;
let ui,provider,triggerCount=0,opening=false,hideTimer,diagnosticTimer,disposed=false;
let lastAction=null,frame=null;
const stopListeners=[];
function diagnostic(){
  clearTimeout(diagnosticTimer);
  diagnosticTimer=setTimeout(async()=>{
    const result={version:1,build:'aurora-search-v1',at:new Date().toISOString(),ready:widget.isReady,triggerCount,frame,
      viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},
      inputReady:!!root.querySelector('input[type="search"]'),inputFocused:document.activeElement?.matches('input[type="search"]')||false,
      windowFocused:await widget.window.isFocused().catch(()=>false),windowVisible:await widget.window.isVisible().catch(()=>false),
      renderedResults:root.querySelectorAll('[role="option"]').length,providers:provider?.diagnostics({apps:config.verificationApps||[]}),lastAction};
    void invoke(SeelenCommand.WriteFile,{filename:config.statusFile||'search-startup.json',content:JSON.stringify(result)}).catch(()=>{});
  },800);
}
async function fit(){
  const cursor=await cursorPosition().catch(()=>null);
  const monitor=(cursor?await monitorFromPoint(cursor.x,cursor.y).catch(()=>null):null)||await currentMonitor()||await primaryMonitor();
  if(!monitor)throw new Error('No display available');
  const scale=monitor.scaleFactor||1,area=monitor.workArea||monitor;
  const position=area.position||monitor.position,size=area.size||monitor.size;
  const margin=Math.round(20*scale);
  const width=Math.max(1,Math.min(Math.round(820*scale),size.width-margin*2));
  const height=Math.max(1,Math.min(Math.round(660*scale),size.height-margin*2));
  const x=position.x+Math.round((size.width-width)/2);
  const y=position.y+Math.max(margin,Math.round((size.height-height)*.32));
  await widget.window.setSize(new PhysicalSize(width,height));
  await widget.window.setPosition(new PhysicalPosition(x,y));
  frame={width,height,x,y,scale};
}
function applyTheme(args={}){
  if(!args||typeof args!=='object')return;
  if(['full','reduced','off'].includes(args.motion))root.dataset.motion=args.motion;
  if(typeof args.paused==='boolean')root.dataset.paused=String(args.paused);
  if(/^#[0-9a-f]{6}$/i.test(args.accent||''))root.style.setProperty('--ah-accent',args.accent);
}
async function show(args={}){
  if(disposed||opening)return;
  opening=true;clearTimeout(hideTimer);
  try{
    applyTheme(args.customArgs);await fit();
    ui.show(typeof args.customArgs?.query==='string'?args.customArgs.query.slice(0,500):'');
    await widget.show();await widget.window.setFocus();await widget.webview.setFocus();
    root.querySelector('input[type="search"]')?.focus({preventScroll:true});
    triggerCount++;diagnostic();void provider.refresh();
    void activity({message:'Search is ready. Find an app, file or command.',kind:'info'}).catch(()=>{});
  }catch(error){console.warn('Aurora Search could not open',error);}
  finally{opening=false;}
}
try{
  await widget.init({saveAndRestoreLastRect:false,hideOnFocusLoss:false,useThemes:false,closeOnHide:false});
  await widget.window.setTitle(config.windowTitle||'Aurora Search');
  await widget.window.setFocusable(true);
  await widget.window.setResizable(false);
  await widget.window.setAlwaysOnTop(true);
  await widget.window.setSkipTaskbar(true);
  await widget.window.setIgnoreCursorEvents(false);
  root.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full';
  provider=createSearchProvider({invoke,subscribe,SeelenCommand,SeelenEvent,...config,onChange:()=>{ui?.refreshResults();diagnostic();}});
  ui=initSpotlight({root,productName:config.productName||'Aurora',search:(query,filter)=>provider.search(query,filter),refresh:()=>provider.refresh(),
    activate:async(result,options)=>{
      void activity({message:(options?.reveal?'Showing the folder for ':'Opening ')+result.title,kind:'busy'}).catch(()=>{});
      try{const close=await provider.activate(result,options);lastAction={kind:result.kind,outcome:'opened'};diagnostic();void activity({message:(options?.reveal?'Showing the folder for ':'Opened ')+result.title,kind:'success'}).catch(()=>{});return close;}
      catch(error){lastAction={kind:result.kind,outcome:'failed'};diagnostic();void activity({message:'Could not open '+result.title+'. Try again or check its location.',kind:'error'}).catch(()=>{});throw error;}
    },onClose:()=>{widget.hide();diagnostic();}});
  stopListeners.push(await widget.window.onFocusChanged(({payload})=>{
    clearTimeout(hideTimer);
    if(!payload)hideTimer=setTimeout(()=>{if(!opening)ui.hide();},150);
  }));
  widget.onTrigger(args=>{void show(args);});
  await fit();await widget.ready({show:false});diagnostic();
}catch(error){
  console.error('Aurora Search startup failed',error);
  root.textContent=(config.windowTitle||'Aurora Search')+' could not start. Open Seelen settings to reload it.';
  void invoke(SeelenCommand.WriteFile,{filename:config.statusFile||'search-startup.json',content:JSON.stringify({version:1,build:'aurora-search-v1',at:new Date().toISOString(),ready:false,error:'Search startup unavailable'})}).catch(()=>{});
}
window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(hideTimer);clearTimeout(diagnosticTimer);for(const stop of stopListeners)stop();ui?.dispose();provider?.dispose();},{once:true});

import {connectDesignSurface} from './aurora-design-bridge.mjs';
connectDesignSurface(document.getElementById('aurora-home-preview'),__AURORA_SEARCH_CONFIG__.homeWidgetId);
