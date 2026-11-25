// Local aggregate usage only. Never inspect window titles, browser history or page contents.
export const FREQUENT_USAGE_FILE='frequent-usage.json';
export const FREQUENT_USAGE_LIMITS=Object.freeze({entries:64,catalogue:10000,bytes:65536,retentionMs:90*86400000,maxGapMs:90000,maxActiveMs:365*86400000,maxOpens:1000000});
const COVERAGE=Object.freeze({apps:'foreground-while-running',websites:'aurora-launches-only'});
const text=(value,max=512)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value)?value.trim():'';
const safeUmid=value=>Boolean(value&&/^[A-Za-z0-9_.{}!\-]{1,512}$/.test(value));
const identity=value=>text(value,2048).replaceAll('/','\\').toLowerCase();
const hash=value=>{let result=0xcbf29ce484222325n;for(const character of value){result^=BigInt(character.charCodeAt(0));result=BigInt.asUintN(64,result*0x100000001b3n);}return result.toString(16).padStart(16,'0');};
const finiteInteger=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;

/** Retain only a hostname, never paths, query strings, credentials or browser history. */
export function normaliseUsageDomain(value){
  const input=text(value,8192);if(!input)return null;
  try{const url=new URL(input),domain=url.hostname.toLowerCase().replace(/\.$/,'');
    if(url.protocol!=='https:'||url.username||url.password||url.port||domain.length>253||!domain.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return null;
    return domain;
  }catch{return null;}
}

export function validateUsageLaunchTarget(value){
  const target=text(value,2048);if(!target||target!==value)return null;
  if(target.startsWith('shell:AppsFolder\\'))return safeUmid(target.slice(17))?target:null;
  if(/^https:/i.test(target)){
    const domain=normaliseUsageDomain(target);if(!domain)return null;
    const url=new URL(target);return(url.pathname==='/'||url.pathname==='')&&!url.search&&!url.hash?'https://'+domain+'/':null;
  }
  const path=target.replaceAll('/','\\');
  if(!/^[a-z]:\\/i.test(path)||/["<>|?*%]/.test(path)||path.slice(2).includes(':')||path.split('\\').some(part=>part==='.'||part==='..')||!/[.](exe|lnk)$/i.test(path))return null;
  return path;
}

export function buildInstalledUsageRegistry(items){
  const byId=new Map(),byUmid=new Map(),byExe=new Map(),byBasename=new Map();
  if(!Array.isArray(items))return{byId,byUmid,byExe,byBasename};
  for(const item of items.slice(0,FREQUENT_USAGE_LIMITS.catalogue)){
    const label=text(item?.display_name,120),umid=text(item?.umid),exe=validateUsageLaunchTarget(item?.target),path=validateUsageLaunchTarget(item?.path);
    if(!label)continue;
    const target=safeUmid(umid)?'shell:AppsFolder\\'+umid:path||exe;if(!target)continue;
    const key=umid?'umid:'+umid.toLowerCase():'exe:'+identity(exe||path),id='app:'+hash(key);
    const record=byId.get(id)||{id,label,target};byId.set(id,record);
    if(umid)byUmid.set(umid.toLowerCase(),record);
    for(const candidate of [exe,path])if(candidate&&/[.]exe$/i.test(candidate)){
      const key=identity(candidate),basename=key.split('\\').at(-1);
      if(!byExe.has(key))byExe.set(key,record);
      if(!byBasename.has(basename))byBasename.set(basename,record);else if(byBasename.get(basename)?.id!==id)byBasename.set(basename,null);
    }
  }
  return{byId,byUmid,byExe,byBasename};
}

function newState(){return{version:1,enabled:true,updatedAt:0,apps:new Map(),websites:new Map()};}
function prune(state,now){
  for(const name of ['apps','websites']){
    for(const [id,row]of state[name])if(now-row.lastUsedAt>FREQUENT_USAGE_LIMITS.retentionMs)state[name].delete(id);
    const rows=[...state[name].values()].sort((a,b)=>(name==='apps'?b.activeMs-a.activeMs:0)||b.opens-a.opens||b.lastUsedAt-a.lastUsedAt);
    state[name]=new Map(rows.slice(0,FREQUENT_USAGE_LIMITS.entries).map(row=>[row.id,row]));
  }
}
function readState(raw,now){
  const state=newState();if(raw==null||raw==='')return state;
  if(typeof raw!=='string'||raw.length>FREQUENT_USAGE_LIMITS.bytes)throw Error('Invalid usage store');
  const data=JSON.parse(raw);if(data?.version!==1||typeof data.enabled!=='boolean'||!Array.isArray(data.apps)||!Array.isArray(data.websites)||data.apps.length>128||data.websites.length>128)throw Error('Invalid usage store');
  state.enabled=data.enabled;state.updatedAt=finiteInteger(data.updatedAt,0,now+1000)?data.updatedAt:0;
  for(const row of data.apps){
    const label=text(row?.label,120);if(!/^app:[0-9a-f]{16}$/.test(row?.id)||!label||!finiteInteger(row.activeMs,0,FREQUENT_USAGE_LIMITS.maxActiveMs)||!finiteInteger(row.opens,0,FREQUENT_USAGE_LIMITS.maxOpens)||!finiteInteger(row.lastUsedAt,1,now+1000))continue;
    state.apps.set(row.id,{id:row.id,label,activeMs:row.activeMs,opens:row.opens,lastUsedAt:row.lastUsedAt});
  }
  for(const row of data.websites){
    const domain=normaliseUsageDomain('https://'+text(row?.domain,253)+'/');if(!domain||row.id!=='site:'+domain||!finiteInteger(row.opens,1,FREQUENT_USAGE_LIMITS.maxOpens)||!finiteInteger(row.lastUsedAt,1,now+1000))continue;
    state.websites.set(row.id,{id:row.id,domain,opens:row.opens,lastUsedAt:row.lastUsedAt});
  }
  prune(state,now);return state;
}

export function initFrequentUsage({root,invoke,subscribe,SeelenCommand={},SeelenEvent={},refreshMs=60000,now=()=>Date.now(),setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout}={}){
  const interval=Math.max(15000,Math.min(300000,Number(refreshMs)||60000)),win=root?.ownerDocument?.defaultView;
  let state=newState(),registry=buildInstalledUsageRegistry([]),current=null,started=null,loading=true,disposed=false,nativeAvailable=false,storageAvailable=Boolean(SeelenCommand.ReadFile&&SeelenCommand.WriteFile),storageBlocked=false;
  let timer=0,stopFocus=null,generation=0,focusRevision=0,samples=0,polling=null,dirty=false,lastCatalogueAttempt=-Infinity,writeQueue=Promise.resolve(),controls=Promise.resolve();
  const reads=new Set(),websiteDedup=new Map();
  const status=()=>loading?'loading':!state.enabled?'paused':nativeAvailable&&registry.byId.size>0&&storageAvailable&&!storageBlocked?'ready':'unavailable';
  function diagnostic(){if(!root?.dataset)return;root.dataset.usageState=status();root.dataset.usageTracking=String(state.enabled);root.dataset.usageSampleCount=String(Math.min(1000000,samples));root.dataset.usageAppCount=String(state.apps.size);root.dataset.usageWebsiteCount=String(state.websites.size);root.dataset.usageUpdatedAt=state.updatedAt?new Date(state.updatedAt).toISOString():'';}
  function read(command,args){
    if(!command||typeof invoke!=='function')return Promise.reject(Error('Native usage read unavailable'));
    return new Promise((resolve,reject)=>{
      let done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeoutImpl(timeout);reads.delete(cancel);fn(value);};
      const cancel=()=>finish(reject,Error('Usage read cancelled'));
      const timeout=setTimeoutImpl(()=>finish(reject,Error('Usage read timed out')),8000);reads.add(cancel);
      Promise.resolve().then(()=>invoke(command,args)).then(value=>finish(resolve,value),()=>finish(reject,Error('Native usage read failed')));
    });
  }
  const touch=()=>{dirty=true;state.updatedAt=now();prune(state,state.updatedAt);diagnostic();};
  function settle(time=now()){
    if(!state.enabled||!current)return;
    const elapsed=time-current.since;current.since=time;
    if(elapsed<=0||elapsed>FREQUENT_USAGE_LIMITS.maxGapMs)return;
    let row=state.apps.get(current.record.id);
    if(!row){row={id:current.record.id,label:current.record.label,activeMs:0,opens:0,lastUsedAt:time};state.apps.set(row.id,row);}
    row.activeMs=Math.min(FREQUENT_USAGE_LIMITS.maxActiveMs,row.activeMs+elapsed);row.lastUsedAt=time;touch();
  }
  function foreground(raw){
    if(disposed||!state.enabled)return;
    settle();samples++;nativeAvailable=true;
    // Read only process/registration identity. FocusedApp.title and name are intentionally unused.
    const umid=text(raw?.umid),exe=identity(raw?.exe),windowClass=text(raw?.class,100);
    const ignored=!Number.isSafeInteger(raw?.hwnd)||raw.hwnd<=0||/^(progman|workerw|shell_(?:secondary)?traywnd|notifyiconoverflowwindow)$/i.test(windowClass)||/(?:^|\\)(?:seelen[-_]?ui|lockapp|logonui|consent)[.]exe$/i.test(exe);
    const record=ignored?null:(registry.byUmid.get(umid.toLowerCase())||registry.byExe.get(exe)||(!exe.includes('\\')?registry.byBasename.get(exe):null));
    if(!record){current=null;diagnostic();return;}
    if(current?.record.id===record.id){diagnostic();return;}
    current={record,since:now()};
    let row=state.apps.get(record.id);if(!row){row={id:record.id,label:record.label,activeMs:0,opens:0,lastUsedAt:now()};state.apps.set(record.id,row);}
    row.label=record.label;row.opens=Math.min(FREQUENT_USAGE_LIMITS.maxOpens,row.opens+1);row.lastUsedAt=now();touch();
  }
  function serialise(){prune(state,now());return JSON.stringify({version:1,enabled:state.enabled,updatedAt:state.updatedAt,apps:[...state.apps.values()],websites:[...state.websites.values()]});}
  function persist(force=false){
    if((!dirty&&!force)||storageBlocked||!SeelenCommand.WriteFile||typeof invoke!=='function')return Promise.resolve();
    const content=serialise();if(content.length>FREQUENT_USAGE_LIMITS.bytes)return Promise.resolve();dirty=false;
    writeQueue=writeQueue.catch(()=>{}).then(()=>invoke(SeelenCommand.WriteFile,{filename:FREQUENT_USAGE_FILE,content})).then(()=>{storageAvailable=true;diagnostic();},()=>{storageAvailable=false;dirty=true;diagnostic();});return writeQueue;
  }
  function schedule(){clearTimeoutImpl(timer);timer=0;if(!disposed&&state.enabled&&SeelenCommand.GetFocusedApp)timer=setTimeoutImpl(()=>{timer=0;void poll();},interval);}
  async function refreshCatalogue(force=false){
    if(!SeelenCommand.GetStartMenuItems||(!force&&now()-lastCatalogueAttempt<interval))return;
    lastCatalogueAttempt=now();
    try{const raw=await read(SeelenCommand.GetStartMenuItems);if(!disposed)registry=buildInstalledUsageRegistry(raw);}catch{}
  }
  function poll(){
    if(polling)return polling;if(disposed||!state.enabled)return Promise.resolve();
    const session=generation;
    polling=(async()=>{try{if(!registry.byId.size)await refreshCatalogue();if(disposed||!state.enabled||session!==generation)return;const revision=focusRevision,raw=await read(SeelenCommand.GetFocusedApp);if(!disposed&&state.enabled&&session===generation&&revision===focusRevision)foreground(raw);}catch{if(!disposed&&state.enabled&&session===generation){settle();current=null;nativeAvailable=false;diagnostic();}}finally{if(!disposed){await persist();schedule();}polling=null;}})();return polling;
  }
  async function connect(){
    const session=++generation;
    if(!state.enabled||disposed)return;
    if(typeof subscribe==='function'&&SeelenEvent.GlobalFocusChanged){
      try{const stop=await subscribe(SeelenEvent.GlobalFocusChanged,event=>{if(disposed||!state.enabled||session!==generation)return;focusRevision++;foreground(event?.payload??event);});if(disposed||!state.enabled||session!==generation)stop?.();else stopFocus=stop;}catch{}
    }
    if(polling)await polling;
    if(!disposed&&state.enabled&&session===generation)await poll();
  }
  async function start(){
    if(disposed)return;if(started)return started;
    started=(async()=>{
      await Promise.all([
        (async()=>{if(SeelenCommand.ReadFile)try{const raw=await read(SeelenCommand.ReadFile,{filename:FREQUENT_USAGE_FILE});if(!disposed)try{state=readState(raw,now());}catch{storageBlocked=true;storageAvailable=false;}}catch{}})(),
        refreshCatalogue(true)
      ]);
      if(disposed)return;loading=false;diagnostic();if(state.enabled)await connect();
    })();return started;
  }
  function snapshot(){
    prune(state,now());diagnostic();
    const apps=[...state.apps.values()].filter(row=>row.opens||row.activeMs).sort((a,b)=>b.activeMs-a.activeMs||b.opens-a.opens||b.lastUsedAt-a.lastUsedAt).map(row=>({...row,kind:'app',label:registry.byId.get(row.id)?.label||row.label,launchable:registry.byId.has(row.id)}));
    const websites=[...state.websites.values()].sort((a,b)=>b.opens-a.opens||b.lastUsedAt-a.lastUsedAt).map(row=>({...row,kind:'website',label:row.domain,activeMs:0,launchable:true}));
    return{version:1,enabled:state.enabled,updatedAt:state.updatedAt?new Date(state.updatedAt).toISOString():null,status:status(),coverage:{...COVERAGE},apps,websites};
  }
  async function recordWebsiteOpen(value){
    await start();if(disposed||!state.enabled)return false;
    const domain=normaliseUsageDomain(value);if(!domain)return false;
    const time=now();if(time-(websiteDedup.get(domain)??-Infinity)<750)return false;
    websiteDedup.set(domain,time);for(const [key,at]of websiteDedup)if(time-at>5000)websiteDedup.delete(key);
    const id='site:'+domain,row=state.websites.get(id)||{id,domain,opens:0,lastUsedAt:time};row.opens=Math.min(FREQUENT_USAGE_LIMITS.maxOpens,row.opens+1);row.lastUsedAt=time;state.websites.set(id,row);touch();await persist();return true;
  }
  const websiteEvent=event=>{void recordWebsiteOpen(event?.detail?.url);};root?.addEventListener?.('galaxy-atlas:website-opened',websiteEvent);
  function getLaunchTarget(value){const id=typeof value==='string'?value:value?.id;if(typeof id!=='string'||id.length>300)return null;if(state.apps.has(id))return validateUsageLaunchTarget(registry.byId.get(id)?.target);const site=state.websites.get(id);return site?validateUsageLaunchTarget('https://'+site.domain+'/'):null;}
  diagnostic();
  return Object.freeze({
    start,
    async readFrequentUsage(){await start();if(!disposed)settle();return snapshot();},
    setUsageTracking(enabled){if(typeof enabled!=='boolean')return Promise.reject(Error('Tracking state must be boolean'));return controls=controls.catch(()=>{}).then(async()=>{await start();if(disposed)return snapshot();settle();state.enabled=enabled;current=null;generation++;stopFocus?.();stopFocus=null;clearTimeoutImpl(timer);timer=0;touch();if(enabled)await connect();await persist(true);return snapshot();});},
    clearUsage(){return controls=controls.catch(()=>{}).then(async()=>{await start();if(disposed)return snapshot();state.apps.clear();state.websites.clear();websiteDedup.clear();if(current)current.since=now();storageBlocked=false;touch();await persist(true);return snapshot();});},
    recordWebsiteOpen,
    getLaunchTarget,
    async open(value){await start();if(disposed)throw Error('Usage launcher is closed');const target=getLaunchTarget(value);if(!target||!SeelenCommand.OpenFile)throw Error('This item is no longer available to open');await invoke(SeelenCommand.OpenFile,{path:target});if(target.startsWith('https://'))await recordWebsiteOpen(target);return true;},
    async dispose(){if(disposed)return;settle();disposed=true;generation++;clearTimeoutImpl(timer);timer=0;stopFocus?.();stopFocus=null;for(const cancel of reads)cancel();root?.removeEventListener?.('galaxy-atlas:website-opened',websiteEvent);await persist();}
  });
}
