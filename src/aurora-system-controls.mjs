/* Seelen 2.8.10 native status and popup entry points. No native settings are written here. */
const instances=new WeakMap();
export const STATUS_MAX_AGE=150000;
const REFRESH_MS=60000;
export const SYSTEM_ACTIONS=Object.freeze({
  profile:{label:'Your profile',detail:'Account and folders',widget:'@seelen/user-menu',icon:'user'},
  keyboard:{label:'Keyboard',detail:'Language and layout',widget:'@seelen/keyboard-selector',icon:'keyboard'},
  bluetooth:{label:'Bluetooth',detail:'Devices and connection',widget:'@seelen/bluetooth-popup',icon:'bluetooth'},
  network:{label:'Network',detail:'Wi-Fi and connection',widget:'@seelen/network-popup',icon:'network'},
  media:{label:'Sound and media',detail:'Volume, devices and playback',widget:'@seelen/media-popup',icon:'sound'},
  battery:{label:'Battery and power',detail:'Battery and sleep settings',path:'ms-settings:powersleep',icon:'battery'},
  tray:{label:'Background apps',detail:'System tray and app menus',widget:'@seelen/system-tray',icon:'tray'},
  notifications:{label:'Windows notifications',detail:'Notifications and Do not disturb',widget:'@seelen/notifications',icon:'bell'},
  quick:{label:'Device controls',detail:'Brightness and quick settings',widget:'@seelen/quick-settings',icon:'sliders'},
  power:{label:'Power menu',detail:'Lock, sleep and power options',widget:'@seelen/power-menu',icon:'power'},
  settings:{label:'Seelen settings',detail:'Desktop and shell preferences',widget:'@seelen/settings',icon:'settings'}
});
const paths={
  user:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  keyboard:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h1m3 0h1m3 0h2M7 14h10"/>',
  bluetooth:'<path d="m8 7 8 10-4 4V3l4 4-8 10"/>',
  network:'<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".7"/>',
  sound:'<path d="M4 9h4l5-4v14l-5-4H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  battery:'<rect x="2" y="6" width="17" height="12" rx="2"/><path d="M22 10v4M6 9v6m4-6v6m4-6v6"/>',
  tray:'<path d="M3 6h18v14H3ZM3 14h6l1 3h4l1-3h6"/>',
  bell:'<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 4h4"/>',
  sliders:'<path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h11m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  power:'<path d="M12 2v10m-6-7a9 9 0 1 0 12 0"/>',
  settings:'<path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 2h6l1-2 3-1v-4l2-2-2-1V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>'
};
const STYLE=`
#aurora-home-preview .asc-status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) 29px;gap:4px;margin-top:7px;min-width:0}
#aurora-home-preview .asc-chip{min-width:0;display:flex;gap:4px;align-items:center;justify-content:center;padding:4px 3px;border:1px solid #9edfff16;border-radius:7px;background:#8abddd09;color:#bcd9e8;font-family:inherit;font-size:10px;line-height:1.3;cursor:pointer;white-space:nowrap}
#aurora-home-preview .asc-chip:hover{background:#8abddd20;border-color:#9edfff48;color:#e1f4ff}
#aurora-home-preview .asc-chip[data-state=unavailable]{color:#8fa4bb}
#aurora-home-preview .asc-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;color:var(--ah-accent)}
#aurora-home-preview .asc-icon svg{width:100%;height:100%;overflow:visible}
#aurora-home-preview .asc-system-panel{padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid #98c7e329}
#aurora-home-preview .asc-system-panel h3{margin:0 0 5px}
#aurora-home-preview .asc-system-summary{font-size:11px;color:#adc3d7;margin:0 0 12px;overflow-wrap:anywhere;line-height:1.5}
#aurora-home-preview .asc-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
#aurora-home-preview .asc-action{display:flex;gap:10px;text-align:left;align-items:center;min-width:0;padding:12px 10px;border:1px solid #90bad626;border-radius:9px;background:#78a8c70b;color:#d4e6f1;cursor:pointer}
#aurora-home-preview .asc-action:hover{border-color:#9ddcff55;background:#84bdd51b}
#aurora-home-preview .asc-action .asc-icon{width:19px;height:19px}
#aurora-home-preview .asc-action-label{font-size:12px;line-height:1.3;display:block}
#aurora-home-preview .asc-action-detail{font-size:10px;line-height:1.4;color:#a4bdd2;margin-top:3px;display:block}
#aurora-home-preview .asc-action:disabled{opacity:.6;cursor:progress}
#aurora-home-preview .asc-panel-status{font-size:11px;line-height:1.5;margin:12px 0 0;color:#9fb8cd}
@media(max-width:800px){#aurora-home-preview .asc-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function readPower(raw){
  if(!raw||typeof raw!=='object')return null;
  if(raw.batteryFlag===128)return{label:raw.acLineStatus===1?'Plugged in':'Power',description:'No battery reported'};
  const percentage=raw.batteryLifePercent;
  if(!finite(percentage)||percentage<0||percentage>100)return null;
  return{label:Math.round(percentage)+'%',description:Math.round(percentage)+'% battery'+(raw.acLineStatus===1?', plugged in':'')};
}
export function readConnection(raw){return typeof raw==='boolean'?{label:raw?'Online':'Offline',description:raw?'Internet connected':'No internet connection'}:null;}
export function readAudio(raw){
  if(!Array.isArray(raw)||!Array.isArray(raw[1]))return null;
  const output=raw[1].find(item=>item?.isDefaultMultimedia===true);
  if(!output||typeof output.muted!=='boolean'||!finite(output.volume)||output.volume<0||output.volume>1)return null;
  const percent=Math.round(output.volume*100);
  return{label:output.muted?'Muted':percent+'%',description:output.muted?'Default sound output muted':'Default sound output '+percent+'%'};
}
export function readFocus(raw){
  if(!raw||typeof raw.name!=='string'||typeof raw.title!=='string')return null;
  const name=raw.name.trim().slice(0,80),title=raw.title.trim().slice(0,180);
  return name||title?{label:name,description:[name,title&&title!==name?title:''].filter(Boolean).join(' · ')}:null;
}
export function nativeActionArgs(action,commands={}){
  const item=SYSTEM_ACTIONS[action];if(!item)return null;
  if(item.widget&&commands.TriggerWidget)return{command:commands.TriggerWidget,args:{payload:{id:item.widget}}};
  if(item.path&&commands.OpenFile)return{command:commands.OpenFile,args:{path:item.path}};
  return null;
}

export async function initSystemControls({root,invoke,subscribe,SeelenCommand={},SeelenEvent={},nativeStatus,openPanel}={}){
  if(!root?.ownerDocument||typeof invoke!=='function')return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,clock=root.querySelector('.ah-clock');
  if(!clock||!win?.MutationObserver)return()=>{};
  const make=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const icon=name=>{const element=make('span','asc-icon');element.setAttribute('aria-hidden','true');element.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.sliders)+'</svg>';return element;};
  const style=make('style');style.textContent=STYLE;root.append(style);
  const chips=make('div','asc-status');chips.setAttribute('aria-label','System status and controls');
  const chipMap={};
  for(const [key,label,action,shape] of [['power','Power','battery','battery'],['network','Network','network','network'],['audio','Sound','media','sound'],['controls','','controls','sliders']]){
    const button=make('button','asc-chip cursor-interaction');button.type='button';button.dataset.ascAction=action;button.title=key==='controls'?'Open system controls':label+' status unavailable';button.setAttribute('aria-label',button.title);button.append(icon(shape));
    const value=make('span','asc-chip-value',label);button.append(value);chips.append(button);chipMap[key]={button,value,fallback:label};
  }
  clock.append(chips);
  const panel=root.querySelector('.ah-window'),content=root.querySelector('.ah-window-content');
  let disposed=false,refreshing=false,poll=0,sequence=0;
  const unsubs=[],timers=new Map(),pendingButtons=new Set();
  const readings=new Map();
  const sources=[
    {key:'power',command:SeelenCommand.GetPowerStatus,event:SeelenEvent.PowerStatus,read:readPower},
    {key:'network',command:SeelenCommand.GetNetworkInternetConnection,event:SeelenEvent.NetworkInternetConnection,read:readConnection},
    {key:'audio',command:SeelenCommand.GetMediaDevices,event:SeelenEvent.MediaDevices,read:readAudio},
    {key:'focus',command:SeelenCommand.GetFocusedApp,event:SeelenEvent.GlobalFocusChanged,read:readFocus}
  ];
  const fresh=key=>{const item=readings.get(key),age=item?Date.now()-item.at:Infinity;return item?.value&&age>=0&&age<=STATUS_MAX_AGE?item.value:null;};
  function renderStatus(){
    if(disposed)return;
    for(const key of ['power','network','audio']){
      const item=fresh(key),chip=chipMap[key];chip.value.textContent=item?.label||chip.fallback;chip.button.dataset.state=item?'current':'unavailable';
      chip.button.title=item?.description||chip.fallback+' status unavailable';chip.button.setAttribute('aria-label',chip.button.title+'. Open '+SYSTEM_ACTIONS[chip.button.dataset.ascAction].label.toLowerCase());
    }
    const section=content?.querySelector('.asc-system-panel');if(!section)return;
    const focus=fresh('focus');section.querySelector('.asc-system-summary').textContent=focus?'Current window: '+focus.description:'Window information unavailable';
    section.querySelector('.asc-panel-status').textContent=['power','network','audio'].map(key=>fresh(key)?.description||chipMap[key].fallback+' status unavailable').join(' · ');
  }
  function mountPanel(){
    if(disposed||!panel||!content||panel.dataset.panel!=='quick-controls'||content.querySelector('.asc-system-panel'))return;
    const section=make('section','asc-system-panel');section.setAttribute('aria-label','Windows and device controls');
    section.append(make('h3','','System controls'),make('p','asc-system-summary'));
    const grid=make('div','asc-actions');
    for(const [action,item] of Object.entries(SYSTEM_ACTIONS)){
      const button=make('button','asc-action cursor-interaction');button.type='button';button.dataset.ascAction=action;
      button.append(icon(item.icon));const label=make('span');label.append(make('span','asc-action-label',item.label),make('span','asc-action-detail',item.detail));button.append(label);grid.append(button);
    }
    section.append(grid,make('p','asc-panel-status'));content.prepend(section);renderStatus();
  }
  function apply(source,raw){readings.set(source.key,{value:source.read(raw),at:Date.now(),version:++sequence});renderStatus();}
  function deadline(promise,ms=6000){
    return new Promise((resolve,reject)=>{
      const timer=win.setTimeout(()=>{timers.delete(timer);reject(new Error('Native status unavailable'));},ms);timers.set(timer,reject);
      Promise.resolve(promise).then(value=>{win.clearTimeout(timer);timers.delete(timer);resolve(value);},error=>{win.clearTimeout(timer);timers.delete(timer);reject(error);});
    });
  }
  async function refresh(){
    renderStatus();if(disposed||refreshing||doc.hidden)return;refreshing=true;
    await Promise.all(sources.map(async source=>{
      const version=readings.get(source.key)?.version||0;
      try{
        if(!source.command)throw new Error('Command unavailable');
        const raw=await deadline(invoke(source.command));
        if(!disposed&&(readings.get(source.key)?.version||0)===version)apply(source,raw);
      }catch{if(!disposed&&(readings.get(source.key)?.version||0)===version)apply(source,null);}
    }));
    refreshing=false;
  }
  const onClick=event=>{
    const button=event.target?.closest?.('[data-asc-action]');if(!button||!root.contains(button)||disposed)return;
    const action=button.dataset.ascAction;
    if(action==='controls'){if(typeof openPanel==='function')openPanel('quick-controls');mountPanel();return;}
    const request=nativeActionArgs(action,SeelenCommand);
    if(!request){nativeStatus?.('This system control is unavailable.');return;}
    if(pendingButtons.has(button))return;pendingButtons.add(button);button.disabled=true;
    void deadline(Promise.resolve().then(()=>invoke(request.command,request.args))).catch(()=>{if(!disposed)nativeStatus?.(SYSTEM_ACTIONS[action].label+' could not open.');}).finally(()=>{pendingButtons.delete(button);if(!disposed)button.disabled=false;});
  };
  const observer=new win.MutationObserver(mountPanel);
  if(panel)observer.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  if(content)observer.observe(content,{childList:true});
  const visible=()=>{renderStatus();if(!doc.hidden)void refresh();};
  root.addEventListener('click',onClick);doc.addEventListener('visibilitychange',visible);
  for(const source of sources){
    if(!source.event||typeof subscribe!=='function')continue;
    void Promise.resolve().then(()=>subscribe(source.event,event=>{if(!disposed)apply(source,event?.payload);})).then(unsubscribe=>{if(typeof unsubscribe==='function'){if(disposed)unsubscribe();else unsubs.push(unsubscribe);}}).catch(()=>{});
  }
  renderStatus();mountPanel();void refresh();poll=win.setInterval(()=>void refresh(),REFRESH_MS);
  function cleanup(){
    if(disposed)return;disposed=true;observer.disconnect();win.clearInterval(poll);for(const [timer,reject] of timers){win.clearTimeout(timer);reject(new Error('System controls disposed'));}timers.clear();
    for(const unsubscribe of unsubs){try{unsubscribe();}catch{}}
    root.removeEventListener('click',onClick);doc.removeEventListener('visibilitychange',visible);win.removeEventListener('pagehide',cleanup);
    for(const button of pendingButtons)button.disabled=false;pendingButtons.clear();
    chips.remove();content?.querySelector('.asc-system-panel')?.remove();style.remove();
    instances.delete(root);
  }
  win.addEventListener('pagehide',cleanup,{once:true});instances.set(root,cleanup);return cleanup;
}
