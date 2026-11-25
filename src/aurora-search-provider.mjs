import {FOLDER_TYPES,normalisePath,parentPath,isPathWithin} from './aurora-file-browser.mjs';

// These indexes are supplied by Seelen. No directory traversal or command-line
// execution takes place here. Queries remain local until a web result is opened.
export const SEARCH_LIMIT=40;
export const READ_TIMEOUT_MS=8000;
const MAX_SOURCE_FILES=50000,MAX_APPS=20000,MAX_QUERY=256,REFRESH_AGE=60000;
const fold=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
const windowsPath=value=>value.replaceAll('/','\\');
const basename=value=>value.slice(value.lastIndexOf('/')+1)||value;
const pathKey=value=>normalisePath(value)?.toLocaleLowerCase()||null;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const cleanLabel=value=>typeof value==='string'&&value.trim()&&!/[\x00-\x1f]/.test(value)?value.trim().slice(0,250):null;

export const AURORA_SEARCH_COMMANDS=Object.freeze([
  ['show-home','Aurora Home','Return to your desktop','house','home desktop aurora'],
  ['start-focus','Start focus','Begin your Focus Orbit timer','timer','focus timer work'],
  ['show-calendar','Show calendar','Open your dates and calendar','calendar-days','calendar dates month today'],
  ['workspace-work','Work workspace','Library and focus first','briefcase-business','work workspace mode'],
  ['workspace-create','Create workspace','Space for ideas','sparkles','create workspace creative mode'],
  ['workspace-relax','Relax workspace','A quieter orbit','moon-star','relax workspace calm mode'],
  ['motion-full','Motion: Full','Animate your Aurora scene','orbit','full motion animation on'],
  ['motion-reduced','Motion: Reduced','Reduce movement','circle-dot','reduced motion animation'],
  ['motion-off','Motion: Off','Switch off scene movement','circle-pause','off motion animation disable'],
  ['quick-controls','Quick controls','Sound, light and system controls','sliders-horizontal','quick controls sound brightness light'],
  ['notifications','Windows notifications','Open your notification centre','bell','notifications activity messages'],
  ['change-motion','Appearance and motion','Choose how Aurora feels','sliders-horizontal','appearance theme motion settings']
]);
const SETTINGS=Object.freeze([
  ['display','Display settings','ms-settings:display','display monitor resolution brightness'],
  ['sound','Sound settings','ms-settings:sound','sound volume audio speaker microphone'],
  ['bluetooth','Bluetooth settings','ms-settings:bluetooth','bluetooth devices headphones earbuds'],
  ['wifi','Wi-Fi settings','ms-settings:network-wifi','wifi wi-fi network internet'],
  ['apps','Installed apps settings','ms-settings:appsfeatures','installed apps uninstall applications'],
  ['storage','Storage settings','ms-settings:storagesense','storage disk space drive'],
  ['notifications','Notification settings','ms-settings:notifications','notifications settings do not disturb'],
  ['power','Power and battery settings','ms-settings:powersleep','power battery sleep energy']
]);

export function parseSearchQuery(value,filter='all'){
  let query=String(value??'').replace(/[\x00-\x1f]/g,' ').slice(0,MAX_QUERY).trim();
  let kind=['all','apps','files','folders','commands','web'].includes(filter)?filter:'all';
  const prefix=query.match(/^(apps?|files?|folders?|commands?|web)\s*:\s*/i);
  if(prefix){const name=prefix[1].toLowerCase();kind=name==='web'?'web':name.endsWith('s')?name:name+'s';query=query.slice(prefix[0].length).trim();}
  else if(query.startsWith('>')){kind='commands';query=query.slice(1).trim();}
  return{query,kind,normalised:fold(query)};
}

function subsequenceScore(needle,haystack){
  if(needle.length<3||needle.length>haystack.length)return 0;
  let from=0,first=-1,last=-1;
  for(const character of needle){const at=haystack.indexOf(character,from);if(at<0)return 0;if(first<0)first=at;last=at;from=at+1;}
  const spread=last-first+1;
  return spread<=needle.length*2+2?Math.max(1,26-(spread-needle.length)*2-first):0;
}

export function searchScore(query,row){
  const needle=fold(query).trim();if(!needle)return row.suggested??0;
  const title=row.searchTitle??fold(row.title),detail=row.searchDetail??fold(row.subtitle+' '+(row.keywords||''));
  if(title===needle)return 1000;
  let score=title.startsWith(needle)?350:0;
  const tokens=needle.split(/\s+/).filter(Boolean),words=title.split(/[^\p{L}\p{N}]+/u).filter(Boolean),initials=words.map(word=>word[0]).join('');
  for(const token of tokens){
    if(title===token){score+=200;continue;}
    if(words.some(word=>word===token)){score+=110;continue;}
    if(words.some(word=>word.startsWith(token))){score+=85;continue;}
    if(title.includes(token)){score+=60;continue;}
    if(token.length>1&&initials.startsWith(token)){score+=70;continue;}
    if(detail.includes(token)){score+=20;continue;}
    const fuzzy=subsequenceScore(token,title);if(fuzzy){score+=fuzzy;continue;}
    return -1;
  }
  return score;
}

function prepare(row){return{...row,searchTitle:fold(row.title),searchDetail:fold(row.subtitle+' '+(row.keywords||''))};}
function dto(row){return{id:row.id,title:row.title,subtitle:row.subtitle,kind:row.kind,icon:row.icon};}

export function createSearchProvider({invoke,subscribe,SeelenCommand={},SeelenEvent={},knownRoots={},categories=[],homeWidgetId='@aurora/home',chatgptUrl='https://chatgpt.com/',onChange=()=>{},productName='Aurora'}={}){
  if(typeof invoke!=='function'||typeof subscribe!=='function')throw new TypeError('Aurora search needs its native bridge.');
  const roots=Object.fromEntries(Object.entries(knownRoots).map(([name,path])=>[name,normalisePath(path)]).filter(([,path])=>path));
  const folderTypes=FOLDER_TYPES.filter(type=>type==='Recent'||roots[type]);
  const states=new Map(['apps',...folderTypes].map(name=>[name,{rows:[],status:'waiting',version:0,updatedAt:null,truncated:false,live:false}]));
  let disposed=false,connecting=null,connected=false,refreshing=null,lastRefreshAt=0,dirty=true,notificationQueued=false;
  let catalogue=new Map(),latestResults=new Map();
  const unlisten=[],pending=new Map(),cancelReads=new Set();
  const notify=()=>{
    dirty=true;
    if(notificationQueued||disposed)return;
    notificationQueued=true;
    queueMicrotask(()=>{notificationQueued=false;if(!disposed)try{onChange();}catch{}});
  };
  const boundedRead=(operation,onLateValue)=>new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);cancelReads.delete(cancel);fn(value);};
    const cancel=()=>finish(reject,new Error('Search read cancelled.'));
    const timer=setTimeout(()=>finish(reject,new Error('Search index read timed out.')),READ_TIMEOUT_MS);
    cancelReads.add(cancel);
    Promise.resolve().then(operation).then(value=>{if(settled){try{onLateValue?.(value);}catch{};return;}finish(resolve,value);},error=>finish(reject,error));
  });
  function receiveApps(items,source='event'){
    if(!Array.isArray(items))throw new TypeError('Invalid application catalogue.');
    const result=new Map();
    for(const item of items.slice(0,MAX_APPS)){
      const title=cleanLabel(item?.display_name);if(!title)continue;
      const path=normalisePath(item.path);
      // This is the same AppsFolder route used by Seelen's own app launcher.
      const umid=typeof item.umid==='string'&&/^[\w.{}!\-]{1,512}$/.test(item.umid)?item.umid:null;
      if(!path&&!umid)continue;
      const target=umid?'shell:AppsFolder\\'+umid:windowsPath(path);
      const id='app:'+fold(umid||path);
      if(result.has(id))continue;
      const suggested=/^(google chrome|microsoft edge|outlook|spotify|codex|chatgpt|visual studio code|file explorer)$/i.test(title)?95:30;
      result.set(id,prepare({id,title,subtitle:'Installed app',kind:'apps',icon:'app-window',target,path,suggested}));
    }
    apply('apps',[...result.values()],source,items.length>MAX_APPS);
  }
  function receiveFiles(type,items,source='event'){
    if(!states.has(type)||!Array.isArray(items))throw new TypeError('Invalid file index.');
    const result=new Map(),boundary=roots[type];
    for(const original of items.slice(0,MAX_SOURCE_FILES)){
      const path=normalisePath(original);
      if(!path||(type!=='Recent'&&!isPathWithin(path,boundary,false)))continue;
      result.set(pathKey(path),{path,target:windowsPath(path)});
    }
    apply(type,[...result.values()],source,items.length>MAX_SOURCE_FILES);
  }
  function apply(name,rows,source,truncated){
    if(disposed)return;
    const state=states.get(name),event=source==='event';
    // An empty getter means Seelen may still be initialising. An empty event is
    // authoritative; never erase a previously populated index on a lazy getter.
    if(!event&&rows.length===0){state.status=state.updatedAt?'ready':'waiting';state.truncated=state.truncated||truncated;notify();return;}
    state.rows=rows;state.status='ready';state.updatedAt=Date.now();state.truncated=truncated;
    if(event)state.version++;
    notify();
  }
  function fail(name,version){const state=states.get(name);if(disposed||!state||state.version!==version)return;state.status='error';notify();}
  async function connect(){
    if(connected||disposed)return;if(connecting)return connecting;
    connecting=(async()=>{
      const subscriptions=[
        [SeelenEvent.StartMenuItemsChanged,['apps'],payload=>receiveApps(payload?.payload??payload)],
        [SeelenEvent.UserFolderChanged,folderTypes,payload=>{const value=payload?.payload??payload;if(value&&folderTypes.includes(value.ofFolder))receiveFiles(value.ofFolder,value.content);}]
      ];
      await Promise.all(subscriptions.map(async([event,names,handler])=>{
        if(!event||names.every(name=>states.get(name).live))return;
        try{
          const stop=await boundedRead(()=>subscribe(event,value=>{if(disposed)return;try{handler(value);}catch{for(const name of names)fail(name,states.get(name).version);}}),lateStop=>{if(typeof lateStop==='function')lateStop();});
          if(disposed){if(typeof stop==='function')stop();return;}
          if(typeof stop==='function')unlisten.push(stop);
          for(const name of names)states.get(name).live=true;
        }catch{for(const name of names)states.get(name).live=false;}
      }));
      connected=subscriptions.every(([event,names])=>!event||names.every(name=>states.get(name).live));
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  function read(name){
    if(pending.has(name))return pending.get(name);
    const state=states.get(name),version=state.version;
    const command=name==='apps'?SeelenCommand.GetStartMenuItems:SeelenCommand.GetUserFolderContent;
    if(!command){fail(name,version);return Promise.resolve();}
    const work=boundedRead(()=>invoke(command,name==='apps'?undefined:{folderType:name})).then(value=>{
      if(disposed||state.version!==version)return;
      if(name==='apps')receiveApps(value,'query');else receiveFiles(name,value,'query');
    }).catch(()=>fail(name,version)).finally(()=>pending.delete(name));
    pending.set(name,work);return work;
  }
  async function refresh(){
    if(disposed)return;if(refreshing)return refreshing;
    refreshing=(async()=>{await connect();if(disposed)return;lastRefreshAt=Date.now();await Promise.all([...states.keys()].map(read));})().finally(()=>{refreshing=null;});
    return refreshing;
  }
  function compile(){
    if(!dirty)return;dirty=false;
    const rows=new Map();
    const add=row=>{if(!rows.has(row.id))rows.set(row.id,prepare(row));};
    for(const row of states.get('apps').rows)add(row);
    const addFolder=(path,title,subtitle,suggested=0)=>add({id:'folder:'+pathKey(path),title:title||basename(path),subtitle,kind:'folders',icon:'folder-open',path,target:windowsPath(path),suggested});
    for(const [name,path] of Object.entries(roots))addFolder(path,name==='LocalDisk'?'Local disk (C:)':name,'Folder · '+windowsPath(path),name==='Downloads'?100:65);
    for(const category of categories){
      const label=cleanLabel(typeof category==='string'?category:category?.name);
      if(!label||/[\\/]/.test(label)||!roots.Desktop)continue;
      const path=normalisePath(roots.Desktop+'/'+label);
      if(path&&isPathWithin(path,roots.Desktop,false))addFolder(path,label,productName+' collection · '+windowsPath(path),80);
    }
    for(const type of folderTypes)for(const file of states.get(type).rows){
      const title=basename(file.path),id='file:'+pathKey(file.path);
      add({id,title,subtitle:windowsPath(file.path),kind:'files',icon:'file',path:file.path,target:file.target,suggested:0});
      let folder=parentPath(file.path),depth=0;
      while(folder&&depth++<12){
        if(type!=='Recent'&&!isPathWithin(folder,roots[type]))break;
        addFolder(folder,null,'Indexed folder · '+windowsPath(folder));
        if(type!=='Recent'&&pathKey(folder)===pathKey(roots[type]))break;
        folder=parentPath(folder);
      }
    }
    for(const [id,title,subtitle,icon,keywords] of AURORA_SEARCH_COMMANDS)add({id:'command:'+id,title:title.replaceAll('Aurora',productName),subtitle:subtitle.replaceAll('Aurora',productName),kind:'commands',icon,keywords:keywords+' '+productName.toLowerCase(),command:id,suggested:id==='start-focus'?75:id==='show-home'?70:20});
    for(const [id,title,target,keywords] of SETTINGS)add({id:'settings:'+id,title,subtitle:'Windows settings',kind:'commands',icon:'settings',keywords,target,suggested:10});
    try{const url=new URL(chatgptUrl);if(['https:','codex:'].includes(url.protocol)&&!url.username&&!url.password)add({id:'command:chatgpt',title:'Open ChatGPT',subtitle:'Your configured ChatGPT destination',kind:'commands',icon:'sparkles',target:chatgptUrl,keywords:'assistant chat ai',suggested:90});}catch{}
    catalogue=rows;
  }
  function statusText(){
    compile();const counts={apps:0,files:0};for(const row of catalogue.values())if(own(counts,row.kind))counts[row.kind]++;
    const waiting=[...states.values()].some(s=>s.status==='waiting'),errors=[...states.values()].some(s=>s.status==='error'),limited=[...states.values()].some(s=>s.truncated);
    let text=`${counts.apps} apps · ${counts.files} indexed files`;
    if(errors)text+=' · Some sources unavailable; showing the last received index';
    else if(waiting)text+=' · Waiting for remaining indexes';
    else if([...states.values()].some(s=>!s.live))text+=' · Live updates unavailable; use Refresh';
    if(limited)text+=' · Index limit reached';
    return text+'. Files cover your indexed user folders and Recent, not the whole drive.';
  }
  async function search(value,filter='all'){
    if(disposed)return{results:[],status:'Search is closed.'};
    if(!lastRefreshAt||Date.now()-lastRefreshAt>REFRESH_AGE)void refresh();
    const {query,kind}=parseSearchQuery(value,filter);compile();
    const matches=[];
    if(kind!=='web')for(const row of catalogue.values()){
      if(kind!=='all'&&row.kind!==kind)continue;
      const score=searchScore(query,row);
      if(score<0||(!query&&kind==='all'&&score===0))continue;
      matches.push({row,score});
    }
    matches.sort((a,b)=>b.score-a.score||a.row.title.localeCompare(b.row.title,undefined,{numeric:true,sensitivity:'base'}));
    const offerWeb=Boolean(query&&(kind==='all'||kind==='web'));
    const offerWindows=Boolean(query&&(kind==='all'||kind==='files'));
    const results=matches.slice(0,SEARCH_LIMIT-Number(offerWeb)-Number(offerWindows)).map(({row})=>dto(row));
    latestResults=new Map(results.map(row=>[row.id,catalogue.get(row.id)]));
    if(offerWindows){
      // Documented Windows Search protocol. Only the query value is variable;
      // encoding prevents it from becoming additional protocol parameters.
      // https://learn.microsoft.com/en-us/windows/win32/search/getting-started-with-parameter-value-arguments
      const windows=prepare({id:'windows-search:'+query,title:'Search Windows for “'+query+'”',subtitle:'Open File Explorer to search the Windows index',kind:'files',icon:'search',target:'search-ms:query='+encodeURIComponent(query),ephemeral:true});
      results.push(dto(windows));latestResults.set(windows.id,windows);
    }
    if(offerWeb){
      const web=prepare({id:'web:'+query,title:'Search the web for “'+query+'”',subtitle:'Open Google in your browser',kind:'web',icon:'globe',target:'https://www.google.com/search?q='+encodeURIComponent(query),ephemeral:true});
      results.push(dto(web));latestResults.set(web.id,web);
    }
    return{results,status:statusText()};
  }
  async function activate(result,{reveal=false}={}){
    if(disposed)throw new Error('Search is closed.');
    compile();
    const id=typeof result?.id==='string'?result.id:null;
    const issued=id&&latestResults.get(id),row=issued&&(issued.ephemeral?issued:catalogue.get(id));
    if(!row)throw new Error('This result is no longer available. Search again.');
    if(reveal){
      if(!row.path)throw new Error('This result does not have a containing folder.');
      if(row.kind==='folders')await invoke(SeelenCommand.OpenFile,{path:row.target});
      else if(SeelenCommand.SelectFileOnExplorer)await invoke(SeelenCommand.SelectFileOnExplorer,{path:windowsPath(row.path)});
      else {const parent=parentPath(row.path);if(!parent)throw new Error('The containing folder is unavailable.');await invoke(SeelenCommand.OpenFile,{path:windowsPath(parent)});}
    }else if(row.command){
      if(!SeelenCommand.TriggerWidget)throw new Error('Aurora commands are unavailable.');
      await invoke(SeelenCommand.TriggerWidget,{payload:{id:homeWidgetId,customArgs:{auroraCommand:row.command}}});
    }else{
      if(!SeelenCommand.OpenFile)throw new Error('Opening results is unavailable.');
      await invoke(SeelenCommand.OpenFile,{path:row.target});
    }
    return true;
  }
  function diagnostics({apps=[]}={}){
    compile();const counts={apps:0,files:0,folders:0,commands:0};for(const row of catalogue.values())if(own(counts,row.kind))counts[row.kind]++;
    const report={counts,sources:Object.fromEntries([...states].map(([name,state])=>[name,{status:state.status,count:state.rows.length,updatedAt:state.updatedAt,truncated:state.truncated,live:state.live}])),pending:pending.size,disposed};
    // Only explicitly requested app labels are included. Do not expose the
    // catalogue, launch targets, file paths or search history in diagnostics.
    const labels=Array.isArray(apps)?[...new Map(apps.slice(0,10).map(cleanLabel).filter(Boolean).map(label=>[fold(label),label])).values()]:[];
    if(labels.length)report.appChecks=labels.map(label=>{
      const matches=[...catalogue.values()].filter(row=>row.kind==='apps'&&fold(row.title)===fold(label));
      return{label,exactMatches:matches.length,hasInstalledLaunch:Boolean(SeelenCommand.OpenFile&&matches.some(row=>row.target))};
    });
    return report;
  }
  function dispose(){if(disposed)return;disposed=true;for(const cancel of cancelReads)cancel();for(const stop of unlisten.splice(0))try{stop();}catch{};catalogue.clear();latestResults.clear();for(const state of states.values())state.rows=[];}
  void refresh();
  return{search,activate,refresh,dispose,diagnostics};
}
