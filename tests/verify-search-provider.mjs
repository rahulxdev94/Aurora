import assert from 'node:assert/strict';
import {createSearchProvider,parseSearchQuery,searchScore,SEARCH_LIMIT} from '../src/aurora-search-provider.mjs';

assert.deepEqual(parseSearchQuery(' apps:  Chrome '),{query:'Chrome',kind:'apps',normalised:'chrome'});
assert.equal(parseSearchQuery('> start focus','files').kind,'commands');
assert.equal(parseSearchQuery('folder: invoices').kind,'folders');
assert.equal(parseSearchQuery('web: Café').normalised,'cafe');
assert.equal(parseSearchQuery('a'.repeat(500)).query.length,256);
assert.ok(searchScore('cafe',{title:'Café notes',subtitle:''})>0);
assert.ok(searchScore('vsc',{title:'Visual Studio Code',subtitle:''})>0);
assert.ok(searchScore('chrme',{title:'Google Chrome',subtitle:''})>0);
assert.equal(searchScore('xyz',{title:'Google Chrome',subtitle:''}),-1);
assert.ok(searchScore('chrome',{title:'Chrome',subtitle:''})>searchScore('chrome',{title:'Google Chrome',subtitle:''}));

const commands={GetStartMenuItems:'apps',GetUserFolderContent:'files',OpenFile:'open',SelectFileOnExplorer:'reveal',TriggerWidget:'trigger'};
const events={StartMenuItemsChanged:'apps-changed',UserFolderChanged:'files-changed'};
const roots={Desktop:'C:\\Users\\Example\\Desktop',Documents:'C:\\Users\\Example\\Documents',Downloads:'C:\\Users\\Example\\Downloads',LocalDisk:'C:\\'};
const chrome={display_name:'Google Chrome',path:'C:\\ProgramData\\Start Menu\\Chrome.lnk',umid:'Chrome',target:'C:\\Bad target.exe'};
const galaxyBuds={path:'',umid:'SAMSUNGELECTRONICSCO.LTD.GalaxyBuds_3c1yjt4zspk6g!App',display_name:'Galaxy Buds',target:null};
let appData=[chrome,{display_name:'Visual Studio Code',path:'C:\\Users\\Example\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Code.lnk',umid:null},{display_name:'Café Player',path:'C:\\Apps\\Cafe.lnk',umid:null},galaxyBuds,
  {display_name:'Store App',path:'',umid:'Microsoft.Test_123!App'},
  {display_name:'Untrusted URI',path:'https://example.com/',umid:null},
  {display_name:'Invalid traversal',path:'C:\\Apps\\..\\bad.lnk',umid:null},
  {display_name:'Invalid identity',path:'',umid:'anything & calc.exe'},chrome];
let folderData={Desktop:['C:\\Users\\Example\\Desktop\\Projects\\Plan.md','C:\\Users\\Example\\Desktop\\Projects\\Budget.xlsx','C:\\Users\\Example\\Desktop\\invalid:stream',
  'C:\\Users\\Example\\Desktop\\..\\outside.txt','C:\\Elsewhere\\not-desktop.txt'],
  Documents:['C:\\Users\\Example\\Documents\\Café notes.txt'],Downloads:['C:\\Users\\Example\\Downloads\\music.mp3'],
  Recent:['C:\\Users\\Example\\Desktop\\Projects\\Plan.md','D:\\Research\\Notes.md']};
const handlers=new Map(),calls=[];
let changes=0,stopped=0,holdApps=null,holdFiles=null,failApps=false;
const invoke=(command,args)=>{
  calls.push({command,args});
  if(command==='apps'){if(holdApps)return holdApps.promise;if(failApps)return Promise.reject(new Error('app unavailable'));return Promise.resolve(appData);}
  if(command==='files'){if(holdFiles?.type===args.folderType)return holdFiles.promise;return Promise.resolve(folderData[args.folderType]??[]);}
  return Promise.resolve();
};
const subscribe=async(event,fn)=>{assert.ok(!handlers.has(event),'Each feed is subscribed only once');handlers.set(event,fn);return()=>{handlers.delete(event);stopped++;};};
const deferred=()=>{let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const provider=createSearchProvider({invoke,subscribe,SeelenCommand:commands,SeelenEvent:events,knownRoots:roots,categories:['Projects','Money and Home','../Invalid'],homeWidgetId:'@test/home',chatgptUrl:'codex://new',onChange:()=>changes++});
await provider.refresh();
assert.equal(handlers.size,2);
assert.equal(provider.diagnostics().counts.apps,5,'Both Start Menu shortcut sources and packaged apps are included; invalid routes and duplicates are excluded');
assert.equal(provider.diagnostics().counts.files,5,'Duplicate Recent paths and invalid/out-of-root paths excluded');
assert.equal(provider.diagnostics().sources.Desktop.status,'ready');
assert.ok(changes>0,'Native updates notify the search view');
assert.ok(!JSON.stringify(provider.diagnostics()).includes('Plan.md'),'Diagnostics do not include filenames');
assert.ok(!JSON.stringify(provider.diagnostics()).includes('Chrome'),'Diagnostics do not include application names');
assert.ok(!Object.hasOwn(provider.diagnostics(),'appChecks'),'App verification is opt-in');
assert.deepEqual(provider.diagnostics({apps:['Galaxy Buds','galaxy buds','Not Installed']}).appChecks,[
  {label:'galaxy buds',exactMatches:1,hasInstalledLaunch:true},
  {label:'Not Installed',exactMatches:0,hasInstalledLaunch:false}
]);
const verifiedReport=JSON.stringify(provider.diagnostics({apps:['Galaxy Buds']}));
assert.ok(!verifiedReport.includes(galaxyBuds.umid)&&!verifiedReport.includes('Chrome')&&!verifiedReport.includes('C:\\'),'Explicit app checks do not reveal launch targets or unrelated apps');
assert.ok(!calls.some(call=>['open','trigger','reveal'].includes(call.command)),'Indexing has no launch side effects');

let response=await provider.search('Galaxy Buds');
assert.equal(response.results[0].title,'Galaxy Buds','Installed packaged app ranks before external search actions');
assert.equal(response.results[0].kind,'apps');
assert.equal(response.results[0].subtitle,'Installed app','Installed packaged apps are not presented as Store downloads');
await provider.activate(response.results[0]);
assert.deepEqual(calls.at(-1),{command:'open',args:{path:'shell:AppsFolder\\'+galaxyBuds.umid}},'Galaxy Buds opens the installed app by AUMID');
response=await provider.search('apps: Visual Studio Code');
assert.equal(response.results[0].subtitle,'Installed app');
await provider.activate(response.results[0]);
assert.equal(calls.at(-1).args.path,'C:\\Users\\Example\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Code.lnk','Per-user Start Menu app opens its installed shortcut');
response=await provider.search('apps: chrme');
assert.equal(response.results[0].title,'Google Chrome');
assert.ok(response.results.every(row=>row.kind==='apps'));
assert.match(response.status,/not the whole drive/);
await provider.activate({...response.results[0],target:'cmd.exe',path:'C:\\evil.exe'});
assert.deepEqual(calls.at(-1),{command:'open',args:{path:'shell:AppsFolder\\Chrome'}},'Launch uses the current verified app record, never mutated UI input or shortcut target');
await provider.activate(response.results[0],{reveal:true});
assert.deepEqual(calls.at(-1),{command:'reveal',args:{path:chrome.path}});

response=await provider.search('files: Plan');
assert.equal(response.results.length,2,'Indexed result and explicit Windows Search fallback');
await provider.activate(response.results[0]);
assert.deepEqual(calls.at(-1),{command:'open',args:{path:'C:\\Users\\Example\\Desktop\\Projects\\Plan.md'}});
await provider.activate(response.results[0],{reveal:true});
assert.equal(calls.at(-1).command,'reveal');
const windowsResult=response.results.at(-1);
await provider.activate(windowsResult);
assert.deepEqual(calls.at(-1),{command:'open',args:{path:'search-ms:query=Plan'}});
response=await provider.search('folders: Projects');
assert.equal(response.results.length,1,'Known category and inferred folder merge');
await provider.activate(response.results[0]);
assert.equal(calls.at(-1).args.path,'C:\\Users\\Example\\Desktop\\Projects');
response=await provider.search('> start focus');
assert.equal(response.results[0].title,'Start focus');
await provider.activate(response.results[0]);
assert.deepEqual(calls.at(-1),{command:'trigger',args:{payload:{id:'@test/home',customArgs:{auroraCommand:'start-focus'}}}});
await assert.rejects(()=>provider.activate(response.results[0],{reveal:true}),/containing folder/);
response=await provider.search('sound settings','commands');
assert.equal(response.results[0].title,'Sound settings');
await provider.activate(response.results[0]);
assert.equal(calls.at(-1).args.path,'ms-settings:sound');
await assert.rejects(()=>provider.activate({id:'settings:delete-system',target:'cmd.exe'}),/no longer available/);

const beforeWeb=calls.length;
const webQuery='$(calc.exe) & "cats"';
response=await provider.search('web: '+webQuery);
assert.equal(calls.length,beforeWeb,'Typing a query never opens a URL or runs a command');
assert.equal(response.results.length,1);
await provider.activate(response.results[0]);
assert.equal(calls.at(-1).args.path,'https://www.google.com/search?q='+encodeURIComponent(webQuery));
assert.equal(calls.at(-1).command,'open');
const beforeWindows=calls.length;
response=await provider.search('files: '+webQuery);
assert.equal(calls.length,beforeWindows,'Windows Search is launched only on activation');
await provider.activate(response.results.at(-1));
assert.equal(calls.at(-1).args.path,'search-ms:query='+encodeURIComponent(webQuery));

// A live event must win over an earlier, still-pending getter, including failure.
holdApps=deferred();
const refresh1=provider.refresh(),refresh2=provider.refresh();
await drain();
const appReads=calls.filter(call=>call.command==='apps').length;
handlers.get('apps-changed')({payload:[{display_name:'Fresh App',path:'C:\\Apps\\Fresh.lnk',umid:null}]});
holdApps.resolve([chrome]);holdApps=null;
await Promise.all([refresh1,refresh2]);
assert.equal(calls.filter(call=>call.command==='apps').length,appReads,'Concurrent refreshes share one native read');
response=await provider.search('apps: Fresh');assert.equal(response.results[0].title,'Fresh App');
assert.equal((await provider.search('apps: Chrome')).results.length,0,'Older getter cannot overwrite the newer event');
holdApps=deferred();const refresh3=provider.refresh();await drain();
handlers.get('apps-changed')({payload:[{display_name:'Latest App',path:'C:\\Apps\\Latest.lnk',umid:null}]});
holdApps.reject(new Error('late failure'));holdApps=null;await refresh3;
assert.equal(provider.diagnostics().sources.apps.status,'ready','Late read failure cannot mark a newer event stale');

holdFiles={...deferred(),type:'Documents'};const refresh4=provider.refresh();await drain();
handlers.get('files-changed')({payload:{ofFolder:'Documents',content:['C:\\Users\\Example\\Documents\\Newest.txt']}});
holdFiles.resolve(['C:\\Users\\Example\\Documents\\Older.txt']);holdFiles=null;await refresh4;
assert.equal((await provider.search('files: Newest')).results.filter(row=>row.id.startsWith('file:')).length,1);
assert.equal((await provider.search('files: Older')).results.filter(row=>row.id.startsWith('file:')).length,0);
response=await provider.search('files: Newest');const oldResult=response.results[0];
handlers.get('files-changed')({payload:{ofFolder:'Documents',content:[]}});
await assert.rejects(()=>provider.activate(oldResult),/no longer available/,'Removed file is no longer launchable from an old result');
assert.equal(provider.diagnostics().sources.Documents.status,'ready','An empty event is a completed, empty index');
folderData.Documents=[];await provider.refresh();
assert.equal(provider.diagnostics().sources.Documents.status,'ready');
const countBefore=provider.diagnostics().counts.files;
handlers.get('files-changed')({payload:{ofFolder:'Unknown',content:['C:\\not-indexed.txt']}});
assert.equal(provider.diagnostics().counts.files,countBefore);

failApps=true;await provider.refresh();
response=await provider.search('');assert.match(response.status,/Some sources unavailable/);
assert.equal(provider.diagnostics().sources.apps.status,'error');
failApps=false;
appData=Array.from({length:120},(_,i)=>({display_name:'Example application '+i,path:`C:\\Apps\\Example${i}.lnk`,umid:null}));
await provider.refresh();response=await provider.search('example');
assert.equal(response.results.length,SEARCH_LIMIT,'Results are bounded including web action');
assert.equal(response.results.at(-1).kind,'web');
assert.equal((await provider.search('example','apps')).results.length,SEARCH_LIMIT);
assert.ok((await provider.search('')).results.some(row=>row.title==='Downloads'),'Empty search offers useful locations');

provider.dispose();provider.dispose();await drain();
assert.equal(stopped,2);assert.equal(handlers.size,0);
assert.equal(provider.diagnostics().disposed,true);
assert.deepEqual((await provider.search('Chrome')).results,[]);
await assert.rejects(()=>provider.activate({id:'command:start-focus'}),/closed/);

// Missing capabilities give an honest failure state while fixed shortcuts work.
const missing=createSearchProvider({invoke:async()=>{throw new Error('unexpected');},subscribe:async()=>()=>{},SeelenCommand:{OpenFile:'open'},knownRoots:roots});
await missing.refresh();assert.match((await missing.search('files: missing')).status,/unavailable/);missing.dispose();

// A subscription that finishes after its deadline must be released rather than
// leaking a second listener when Refresh retries the connection.
const originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
const timers=new Map();let nextTimer=1000;
globalThis.setTimeout=(fn,ms)=>{if(ms===8000){timers.set(++nextTimer,fn);return nextTimer;}return originalSetTimeout(fn,ms);};
globalThis.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else originalClearTimeout(id);};
try{
  const delayed=deferred();let appSubscriptions=0,folderSubscriptions=0,lateStops=0,activeStops=0;
  const slow=createSearchProvider({invoke,SeelenCommand:commands,SeelenEvent:events,knownRoots:roots,
    subscribe:async event=>{if(event==='apps-changed'&&++appSubscriptions===1)return delayed.promise;if(event==='files-changed')folderSubscriptions++;return()=>activeStops++;}});
  await drain();assert.equal(timers.size,1,'Only the pending subscription keeps a deadline timer');
  for(const fn of [...timers.values()])fn();
  await drain();
  assert.equal(slow.diagnostics().sources.apps.live,false);
  delayed.resolve(()=>lateStops++);await drain();assert.equal(lateStops,1,'Late subscription is disposed');
  await slow.refresh();assert.equal(slow.diagnostics().sources.apps.live,true,'A failed subscription retries on refresh');
  assert.equal(folderSubscriptions,1,'The successful feed is not subscribed twice');
  slow.dispose();assert.equal(activeStops,2);assert.equal(timers.size,0);

  const never=deferred();let releasedAfterDispose=0;
  const closing=createSearchProvider({invoke,SeelenCommand:commands,SeelenEvent:events,knownRoots:roots,subscribe:async()=>never.promise});
  await drain();assert.equal(timers.size,2);
  closing.dispose();await drain();assert.equal(timers.size,0,'Disposal releases pending deadline timers');
  never.resolve(()=>releasedAfterDispose++);await drain();assert.equal(releasedAfterDispose,2,'Subscriptions resolving after disposal are released');
}finally{globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;}
console.log('Search provider: ranking, filters, bounded results, safe native launch/reveal, commands, local query privacy, index races, incomplete/error states, deduplication and cleanup passed. No Windows calls were made.');
