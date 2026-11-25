import assert from 'node:assert/strict';
import {initSearchIntegration,SEARCH_COMMANDS,NOTIFICATION_MODE_RESULT_FILE,findSettingsDockTarget,findPowerShellTestNotification,POWERSHELL_TEST_APP_ID} from '../src/aurora-search-integration.mjs';

class Element {
  constructor(tag='div',attrs={}){this.tag=tag;this.attrs={...attrs};this.children=[];this.dataset={};this.listeners=new Map();this.textContent='';this.classList={contains:name=>(this.attrs.class||'').split(' ').includes(name)};this.style={getPropertyValue:()=> '#b9a1ff'};}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  contains(item){return item===this||this.children.some(child=>child.contains(item));}
  matches(selector){
    if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    const attr=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if(attr)return attr[2]===undefined?Object.hasOwn(this.attrs,attr[1]):this.attrs[attr[1]]===attr[2];
    return this.tag===selector;
  }
  closest(selectors){return selectors.split(',').some(selector=>this.matches(selector.trim()))?this:this.parent?.closest(selectors)||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,fn,capture){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);assert.equal(capture,true,'Bridge intercepts before old launcher handlers');}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name,target,extra={}){const event={target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};for(const fn of this.listeners.get(name)||[])fn(event);return event;}
}
const root=new Element('main'),nav=new Element('nav',{class:'ah-navigation'}),navButton=new Element('button',{'data-action':'launcher'}),searchButton=new Element('button',{'data-action':'launcher',class:'ah-search-trigger'}),searchLabel=new Element('span'),hint=new Element('kbd'),other=new Element('button'),input=new Element('input'),plainEditor=new Element('div',{contenteditable:''});
plainEditor.isContentEditable=true;
searchButton.append(searchLabel,hint);nav.append(navButton);root.append(nav,searchButton,other,input,plainEditor);root.dataset={motion:'off',paused:'true'};
const prior=()=>false,win={__auroraHandleSearchCommand:prior};root.ownerDocument={defaultView:win};
const calls=[],statuses=[],commands=[];let closed=0,resolveLaunch,failLaunch=false;
const invoke=(command,args)=>{calls.push({command,args});if(failLaunch)return Promise.reject(Error('offline'));return new Promise(resolve=>{resolveLaunch=resolve;});};
const dispose=initSearchIntegration({root,invoke,SeelenCommand:{TriggerWidget:'trigger'},searchWidgetId:'@rahul/aurora-search',runCommand:id=>commands.push(id),closePanel:()=>closed++,status:message=>statuses.push(message)});
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
assert.equal(searchLabel.textContent,'Search anything');assert.equal(navButton.textContent,'Search');assert.equal(hint.textContent,'Ctrl K');
const click=root.fire('click',searchLabel);assert.equal(click.prevented,true);assert.equal(click.stopped,true);assert.deepEqual(calls[0],{command:'trigger',args:{payload:{id:'@rahul/aurora-search',customArgs:{motion:'off',paused:true,accent:'#b9a1ff'}}}});
root.fire('click',navButton);assert.equal(calls.length,1,'Repeated opening requests are coalesced');resolveLaunch();await drain();
root.fire('click',other);assert.equal(calls.length,1,'Unrelated controls are untouched');
for(const event of [{key:'/'},{key:'k',ctrlKey:true},{key:'K',ctrlKey:true}]){const result=root.fire('keydown',other,event);assert.equal(result.prevented,true);resolveLaunch();await drain();}
const beforeTyping=calls.length;
for(const [target,event] of [[input,{key:'/'}],[plainEditor,{key:'/'}],[other,{key:'k'}],[other,{key:'k',ctrlKey:true,altKey:true}],[other,{key:'k',ctrlKey:true,repeat:true}],[other,{key:'k',ctrlKey:true,isComposing:true}]]){const result=root.fire('keydown',target,event);assert.equal(result.prevented,undefined,'Editing, unrelated keys and repeated/composing keys remain untouched');}
assert.equal(calls.length,beforeTyping);
failLaunch=true;root.fire('keydown',other,{key:'k',ctrlKey:true});await drain();assert.match(statuses.at(-1),/could not open/);failLaunch=false;
let filesOpened=0;win.__auroraOpenFiles=()=>filesOpened++;
for(const command of SEARCH_COMMANDS)if(command!=='notifications-all')assert.equal(win.__auroraHandleSearchCommand(command),true);
assert.equal(closed,1);assert.equal(filesOpened,1,'The Files command opens the built-in explorer');assert.equal(commands.length,SEARCH_COMMANDS.size-3);
for(const command of ['delete-files','shutdown','shell:cmd',null,{},'workspace-unknown'])assert.equal(win.__auroraHandleSearchCommand(command),false);
assert.equal(commands.length,SEARCH_COMMANDS.size-3,'Only allowlisted command identifiers are dispatched');
root.dataset.focusWidgetRemoved='true';assert.equal(win.__auroraHandleSearchCommand('start-focus'),false);assert.equal(commands.length,SEARCH_COMMANDS.size-3,'A removed Focus timer must not restart through a launcher');
assert.equal(await win.__auroraHandleSearchCommand('notifications-all'),false,'Unavailable notification APIs must not report success');
const activeHandler=win.__auroraHandleSearchCommand;dispose();assert.equal(win.__auroraHandleSearchCommand,prior);assert.equal(activeHandler('start-focus'),false);const beforeDispose=calls.length;root.fire('click',searchButton);assert.equal(calls.length,beforeDispose);assert.equal([...root.listeners.values()].reduce((n,list)=>n+list.size,0),0);
function alertHarness(){
  const element=new Element('main'),window_={},requests=[],messages=[];
  element.ownerDocument={defaultView:window_};let mode='All',failure='',setGate=null;
  const cleanup=initSearchIntegration({root:element,SeelenCommand:{TriggerWidget:'trigger',SetNotificationsMode:'set-mode',GetNotificationsMode:'get-mode',WriteFile:'write',StateGetWegItems:'get-dock',GetUserAppWindows:'get-windows',GetNotifications:'get-notifications'},invoke:async(command,args)=>{
    requests.push({command,args});
    if(command==='set-mode'){if(setGate)await setGate;if(failure==='set')throw Error('Write unavailable');return;}
    if(command==='get-mode'){if(failure==='get')throw Error('Private message content must not be persisted');return mode;}
    if(command==='get-dock')return settingsDock;
    if(command==='get-windows')return settingsWindows;
    if(command==='get-notifications')return testNotifications;
    if(command==='write'){if(failure==='write')throw Error('Diagnostic write unavailable');return;}
    throw Error('Unexpected native command');
  },status:message=>messages.push(message),runCommand:()=>{throw Error('Notification settings must not use generic commands');}});
  return{window_,requests,messages,cleanup,setMode:value=>mode=value,setFailure:value=>failure=value,holdSet:promise=>setGate=promise};
}
const settingsUmid='windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel';
const settingsDock={left:[{type:'Plugin'},{type:'AppOrFile',umid:'other-app',displayName:'Settings',path:'private-path'}],center:[{type:'Separator'},{type:'AppOrFile',umid:settingsUmid,displayName:'Private translated label',path:'private-path'}],right:[{type:'AppOrFile',umid:'other-app-2'}]};
const settingsWindows=[{hwnd:999,umid:'other-app',title:'Private title'},{hwnd:3542310,umid:settingsUmid,get title(){throw Error('Titles must not be inspected');},get appName(){throw Error('App labels must not be inspected');}}];
assert.deepEqual(findSettingsDockTarget(settingsDock,settingsWindows),{dockIndex:1,hwnd:3542310},'Index must concatenate left/centre/right and count only AppOrFile');
assert.deepEqual(findSettingsDockTarget(settingsDock,[]),{dockIndex:1,hwnd:null});
assert.equal(findSettingsDockTarget({...settingsDock,center:[]},settingsWindows),null,'A Settings display label alone cannot identify the app');
const legacyPath='C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe';
assert.deepEqual(findSettingsDockTarget({left:[],center:[],right:[{type:'AppOrFile',umid:null,path:legacyPath}]},[{hwnd:42,umid:null,process:{path:legacyPath.toUpperCase()}}]),{dockIndex:0,hwnd:42});
assert.deepEqual(findSettingsDockTarget({left:[],center:[],right:[{type:'AppOrFile',umid:null,path:legacyPath}]},[{hwnd:42,umid:'different-umid',process:{path:legacyPath}}]),{dockIndex:0,hwnd:null},'UMID grouping must not fall through to path matching');
assert.equal(findSettingsDockTarget({left:new Array(4097),center:[],right:[]},[]),null);assert.equal(findSettingsDockTarget(null,[]),null);
const testTime=Date.now(),testNotifications=[{id:999,appUmid:'different-app',date:testTime+5000,get content(){throw Error('Other app content must not be accessed');}},{id:33266,appUmid:POWERSHELL_TEST_APP_ID,date:testTime-1000},{id:33267,appUmid:POWERSHELL_TEST_APP_ID,date:testTime,get content(){throw Error('Test content must not be accessed');},get appName(){throw Error('Test app labels must not be accessed');}}];
assert.deepEqual(findPowerShellTestNotification(testNotifications,testTime+100),{id:33267,date:testTime,ageMs:100},'Only the latest exact registered PowerShell identity may appear in diagnostics');
assert.deepEqual(findPowerShellTestNotification(testNotifications,testTime-100),{id:33267,date:testTime,ageMs:-100},'Future timestamps must remain visible for clock-skew diagnosis');
assert.equal(findPowerShellTestNotification([{id:1,appUmid:'Microsoft.Windows.PowerShell',date:testTime}],testTime),null);
for(const invalid of [{id:-1,date:testTime},{id:0x100000000,date:testTime},{id:1,date:'123'},{id:1,date:NaN}])assert.equal(findPowerShellTestNotification([{...invalid,appUmid:POWERSHELL_TEST_APP_ID}],testTime),null);
assert.equal(findPowerShellTestNotification(new Array(4097),testTime),null);assert.equal(findPowerShellTestNotification(null,testTime),null);
const alerts=alertHarness();assert.equal(alerts.requests.length,0,'Initialisation must preserve Windows notification preferences');
let releaseSet;alerts.holdSet(new Promise(resolve=>releaseSet=resolve));
const enabling=alerts.window_.__auroraHandleSearchCommand('notifications-all'),sameRequest=alerts.window_.__auroraHandleSearchCommand('notifications-all');
assert.equal(enabling,sameRequest,'Repeated explicit enable requests share one native change');assert.equal(alerts.requests.length,1);releaseSet();assert.equal(await enabling,true);
assert.deepEqual(alerts.requests.slice(0,2),[{command:'set-mode',args:{mode:'All'}},{command:'get-mode',args:undefined}]);assert.match(alerts.messages.at(-1),/now allows all/);
const latestReport=()=>{const request=alerts.requests.filter(item=>item.command==='write').at(-1);assert.equal(request.args.filename,NOTIFICATION_MODE_RESULT_FILE);assert.ok(request.args.content.length<512);assert.ok(!request.args.content.includes('private')&&!request.args.content.includes('Private')&&!request.args.content.includes(POWERSHELL_TEST_APP_ID));const data=JSON.parse(request.args.content);assert.deepEqual(Object.keys(data).sort(),data.errorCode?['attemptedAt','errorCode','mode','result','settings','testNotification']:['attemptedAt','mode','result','settings','testNotification']);assert.match(data.attemptedAt,/^\d{4}-\d{2}-\d{2}T/);assert.deepEqual(data.settings,{dockIndex:1,hwnd:3542310});assert.deepEqual(Object.keys(data.testNotification),['id','date','ageMs']);assert.equal(data.testNotification.id,33267);assert.equal(data.testNotification.date,testTime);assert.ok(Number.isSafeInteger(data.testNotification.ageMs));return data;};
assert.equal(latestReport().result,'verified');assert.equal(latestReport().mode,'All');
alerts.holdSet(null);alerts.setMode('PriorityOnly');assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),false);assert.match(alerts.messages.at(-1),/still silencing/);assert.equal(latestReport().result,'mode-not-all');assert.equal(latestReport().mode,'PriorityOnly');assert.equal(latestReport().errorCode,'MODE_NOT_ALL');
alerts.setMode('AlarmsOnly');assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),false);assert.equal(latestReport().mode,'AlarmsOnly');
alerts.setFailure('get');assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),false);assert.match(alerts.messages.at(-1),/could not be confirmed/);assert.equal(latestReport().errorCode,'READBACK_REJECTED');assert.ok(!JSON.stringify(latestReport()).includes('Private message'));
alerts.setFailure('set');const beforeFailure=alerts.requests.length;assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),false);assert.deepEqual(alerts.requests.slice(beforeFailure).map(item=>item.command),['set-mode','get-dock','get-windows','get-notifications','write'],'A failed setter may capture bounded recovery/test diagnostics, without continuing to notification-mode readback');assert.equal(latestReport().errorCode,'SET_REJECTED');
alerts.setFailure('');alerts.setMode('private unexpected content');assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),false);assert.equal(latestReport().errorCode,'UNRECOGNISED_MODE');assert.equal(latestReport().mode,null);
alerts.setMode('All');alerts.setFailure('write');assert.equal(await alerts.window_.__auroraHandleSearchCommand('notifications-all'),true,'A diagnostic write failure must not change a verified native result');alerts.cleanup();
const closing=alertHarness();let finishSet;closing.holdSet(new Promise(resolve=>finishSet=resolve));const closingResult=closing.window_.__auroraHandleSearchCommand('notifications-all');closing.cleanup();finishSet();assert.equal(await closingResult,false);assert.equal(closing.requests.length,1);assert.ok(!closing.messages.some(message=>/now allows all/.test(message)),'A disposed bridge must not publish a late success');
console.log('Search integration: command routing, explicit mode readback, bounded private Settings/test-notification metadata, exact app identity and timestamp filtering, failure classification, no startup override and cleanup passed.');
