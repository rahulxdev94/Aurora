import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';
import {emitTo} from '@tauri-apps/api/event';

// Seelen 2.8.10 targets its watchdog ping at this exact webview window.
export function connectWidgetLiveness(win=window){
  if(!win.__TAURI_INTERNALS__)return()=>{};
  let stopped=false,unlisten;
  const cleanup=()=>{stopped=true;unlisten?.();win.removeEventListener('pagehide',cleanup);};
  try{
    const self=getCurrentWebviewWindow();
    void self.listen('internal::liveness-ping',()=>{
      if(!stopped)void emitTo({kind:'WebviewWindow',label:self.label},'internal::liveness-pong',{}).catch(()=>{});
    }).then(off=>{if(stopped)off();else unlisten=off;}).catch(()=>{});
    win.addEventListener('pagehide',cleanup,{once:true});
  }catch{}
  return cleanup;
}
