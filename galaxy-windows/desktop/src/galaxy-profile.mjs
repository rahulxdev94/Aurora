import {initStarMap} from './star-map.mjs';
import {initDeskTools} from './desk-tools.mjs';
import {connectDesignSurface} from './design-bridge.mjs';
import {initFrequentUsage} from './frequent-usage.mjs';
import {initAuroraFrequent} from './frequent.mjs';
import {initGlassCards} from './glass-cards.mjs';
import {listen,emit} from '@tauri-apps/api/event';
import {currentMonitor} from '@tauri-apps/api/window';

export function startGalaxy({root, invoke, subscribe, SeelenCommand, SeelenEvent}) {
  root.dataset.desktopDesign='universe';
  const native=root.ownerDocument.defaultView.__auroraNative;
  const stopDesign=connectDesignSurface(root,'@galaxy-atlas/desktop',true);
  const stopTools=initDeskTools({root});
  const glass=initGlassCards({root});
  const usage=initFrequentUsage({root,invoke,subscribe,SeelenCommand,SeelenEvent});
  const frequent=initAuroraFrequent({root,service:usage,openItem:id=>usage.open(id),refreshMs:60000,limit:3});
  void usage.start().then(()=>frequent.refresh(),()=>frequent.refresh());
  const files=root.ownerDocument.createElement('button');
  files.type='button';files.title='Galaxy Atlas Files · Ctrl+E';files.textContent='Files';
  files.addEventListener('click',()=>native.openDesktop());
  root.querySelector('.ah-navigation')?.append(files);
  function key(event){
    if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='e'){
      event.preventDefault();void native.openDesktop();
    }
  }
  root.addEventListener('keydown',key);
  const stopMap=initStarMap({root,standalone:true});
  let closed=false;
  const metadata=listen('galaxy-atlas:notification-presence-request',async ({payload})=>{
    if(closed||payload?.homeWidgetId!=='@galaxy-atlas/desktop'||typeof payload.id!=='string'||payload.id.length>100)return;
    const monitor=await currentMonitor().catch(()=>null);
    if(closed||!monitor)return;
    const star=root.querySelector('.ag-object[data-body="core"]')?.getBoundingClientRect();
    const win=root.ownerDocument.defaultView, vw=Math.max(1,win.innerWidth), vh=Math.max(1,win.innerHeight);
    await emit('galaxy-atlas:notification-presence-source',{id:payload.id,homeWidgetId:payload.homeWidgetId,
      source:star?{x:star.x/vw,y:star.y/vh,width:star.width/vw,height:star.height/vh}:null,
      paletteId:root.dataset.auroraPalette||'violet',accent:getComputedStyle(root).getPropertyValue('--au-accent').trim()||'#bca0ff',
      motion:root.dataset.motion==='full'&&root.dataset.paused!=='true'&&!win.matchMedia('(prefers-reduced-motion: reduce)').matches?'full':'reduced',
      monitor:{position:monitor.position,size:monitor.size,workArea:monitor.workArea,scaleFactor:monitor.scaleFactor},frame:null
    }).catch(()=>{});
  }).catch(()=>null);
  const release=listen('galaxy-atlas:notification-presence-state',({payload})=>{
    if(!closed&&payload?.homeWidgetId==='@galaxy-atlas/desktop'&&payload.away===false&&typeof payload.id==='string'&&payload.id.length<=100)
      void emit('galaxy-atlas:notification-presence-ack',{id:payload.id,homeWidgetId:payload.homeWidgetId,away:false}).catch(()=>{});
  }).catch(()=>null);
  root.dispatchEvent(new CustomEvent('galaxy-atlas:design-changed',{detail:{design:'universe'}}));
  let last='';
  function report(){
    const stage=root.querySelector('.ag-stage'), canvas=stage?.querySelector('canvas');
    const health={profile:'galaxy-atlas',desktop:'universe',planets:root.querySelectorAll('.ag-object').length,
      sky:!!canvas,library:typeof native?.openLibrary==='function',motion:root.dataset.motion,
      dockLink:root.dataset.galaxyDockLink||'inactive',standalone:!root.querySelector('.ag-back,.au-desktop-switch'),
      calendar:!!root.querySelector('.ah-calendar'),widgetGlass:glass.state};
    const value=JSON.stringify(health);
    if(last===value)return;
    last=value;void invoke(SeelenCommand.WriteFile,{filename:'desktop-health.json',content:JSON.stringify({...health,at:new Date().toISOString()})}).catch(()=>{});
  }
  const observer=new MutationObserver(report);
  observer.observe(root,{attributes:true,attributeFilter:['data-galaxy-dock-link','data-motion','data-paused','data-galaxy-widget-glass','data-galaxy-glass-surface','data-galaxy-glass-motion','data-galaxy-glass-cards']});
  report();
  return ()=>{closed=true;for(const sub of [metadata,release])void sub.then(off=>off?.());observer.disconnect();stopMap();glass.dispose();files.remove();root.removeEventListener('keydown',key);frequent.dispose();usage.dispose();stopTools();stopDesign();};
}
