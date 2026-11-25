import {createFileService} from './aurora-file-service.mjs';
import {initAuroraExplorer} from './aurora-explorer.mjs';
import {initAuroraGraphics} from './aurora-webgpu.mjs';
import {initNotificationPresence} from './aurora-notification-presence.mjs';
import {initAuroraSunlight} from './aurora-sunlight.mjs';
import {initFrequentUsage} from './aurora-frequent-usage.mjs';
import {initAuroraFrequent} from './aurora-frequent.mjs';

export function initAuroraWorkspace({root,serviceOptions={},openPanel,categories=[],desktopPath,knownRoots={},openFile,attachFileBrowser,invoke,subscribe,SeelenCommand={},SeelenEvent={}}={}){
  const doc=root.ownerDocument,win=doc.defaultView;
  let service;
  try{service=createFileService(serviceOptions);}catch{
    const unavailable=async()=>{throw new Error('Aurora file access is not configured on this installation.');};
    service={health:unavailable,list:unavailable,search:unavailable,preview:unavailable,operation:unavailable,trash:unavailable,reportGraphics:unavailable};
  }
  const files=initAuroraExplorer({root,service,openPanel,categories,desktopPath,knownRoots,openFile,
    openDraft:value=>{
      win.__auroraOpenPanel?.('chat');
      const input=root.querySelector('#ah-draft-input');
      if(input){input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));input.focus({preventScroll:true});}
    }
  });
  attachFileBrowser?.(files);
  const previousOpenFiles=win.__auroraOpenFiles;
  const openFiles=()=>files.openLocation(desktopPath);
  win.__auroraOpenFiles=openFiles;
  const nav=root.querySelector('.ah-navigation'),button=doc.createElement('button');
  button.type='button';button.className='cursor-interaction';button.textContent='Files';button.title='Aurora Files · Ctrl+E';
  button.addEventListener('click',()=>files.openLocation(desktopPath));nav?.append(button);
  const key=event=>{if(event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='e'){event.preventDefault();void files.openLocation(desktopPath);}};
  root.addEventListener('keydown',key);
  const disposeShader=initAuroraGraphics({root});
  const disposeNotificationPresence=initNotificationPresence({root});
  const usage=initFrequentUsage({root,invoke,subscribe,SeelenCommand,SeelenEvent,refreshMs:60000});
  const frequent=initAuroraFrequent({root,service:usage,openItem:id=>usage.open(id),refreshMs:60000,limit:3});
  const disposeSunlight=initAuroraSunlight({root});
  void usage.start().then(()=>frequent.refresh(),()=>frequent.refresh());
  let disposed=false,reportTimer=0,reportAttempts=0;
  let reportGraphics=()=>{};
  if(root.dataset.browserQa!=='true'){
    const report=()=>{
      if(disposed)return;
      if(++reportAttempts>10)return;
      if(root.dataset.shader){
        void service.reportGraphics({api:root.dataset.shader,renderer:root.dataset.gpuRenderer,vendor:root.dataset.gpuVendor,resolution:root.dataset.shaderResolution,webgpuStatus:root.dataset.webgpuStatus,webgpuVendor:root.dataset.webgpuVendor,webgpuAdapter:root.dataset.webgpuAdapter,webgpuError:root.dataset.webgpuError}).catch(()=>{if(!disposed)reportTimer=win.setTimeout(report,1200);});
      }else reportTimer=win.setTimeout(report,1200);
    };
    reportGraphics=()=>{win.clearTimeout(reportTimer);reportAttempts=0;reportTimer=win.setTimeout(report,100);};
    root.addEventListener('aurora:graphics-ready',reportGraphics);
    reportTimer=win.setTimeout(report,500);
  }
  const cleanup=()=>{if(disposed)return;disposed=true;win.clearTimeout(reportTimer);root.removeEventListener('aurora:graphics-ready',reportGraphics);root.removeEventListener('keydown',key);button.remove();if(win.__auroraOpenFiles===openFiles)win.__auroraOpenFiles=previousOpenFiles;frequent.dispose();usage.dispose();files.dispose();disposeSunlight();disposeNotificationPresence();disposeShader();};
  return cleanup;
}
