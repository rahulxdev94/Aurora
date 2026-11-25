// A view of bounded local usage aggregates. This module never starts a tracker or app.
const instances=new WeakMap();
const STATES=new Set(['loading','ready','paused','unavailable']);
const clean=(value,length=80)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,length):'';
const numeric=value=>Number.isFinite(value)&&value>=0?Math.min(value,Number.MAX_SAFE_INTEGER):0;
let sequence=0;

export function normaliseFrequentUsage(value,{limit=3}={}){
  if(value?.version!==1||typeof value.enabled!=='boolean'||!STATES.has(value.status)||!Array.isArray(value.apps)||!Array.isArray(value.websites))throw new Error('Invalid usage snapshot');
  const maximum=Math.min(6,Math.max(1,Number.isInteger(limit)?limit:3)),seen=new Set();
  const items=(values,kind)=>{
    const result=[];
    for(const item of values.slice(0,100)){
      const id=clean(item?.id,512),label=clean(item?.label),domain=clean(item?.domain,120);
      if(item?.kind!==kind||!id||!label||seen.has(id))continue;
      seen.add(id);result.push(Object.freeze({id,kind,label,domain,activeMs:kind==='app'?numeric(item.activeMs):0,opens:Math.floor(numeric(item.opens)),launchable:item.launchable===true}));
      if(result.length===maximum)break;
    }
    return Object.freeze(result);
  };
  return Object.freeze({enabled:value.enabled,status:value.status,apps:items(value.apps,'app'),websites:items(value.websites,'website')});
}

export function frequentUsageMetric(item){
  if(item.kind==='website')return `${item.opens} ${item.opens===1?'open':'opens'}`;
  const seconds=Math.floor(item.activeMs/1000);
  if(seconds>=3600)return `${Math.floor(seconds/3600)} hr ${Math.floor(seconds%3600/60)} min`;
  if(seconds>=60)return `${Math.floor(seconds/60)} min`;
  if(seconds>0)return `${seconds} sec`;
  return `${item.opens} ${item.opens===1?'visit':'visits'}`;
}

/** Mount next to Weather. Native launch resolution stays with the caller. */
export function initAuroraFrequent({root,service,openItem,nativeStatus,refreshMs=60000,limit=3}={}){
  if(!root?.ownerDocument)return{refresh:async()=>{},dispose:()=>{}};
  if(instances.has(root))return instances.get(root);
  const weather=root.querySelector('.ah-weather'),parent=weather?.parentNode;
  if(!weather||!parent)return{refresh:async()=>{},dispose:()=>{}};
  const doc=root.ownerDocument,win=doc.defaultView,uid=`afq-${++sequence}`;
  const make=(tag,cls,text)=>{const element=doc.createElement(tag);element.className=cls;if(text!==undefined)element.textContent=text;return element;};
  const widget=make('section','ah-frequent ah-surface');widget.setAttribute('aria-label','Frequently used apps and websites');
  const header=make('div','ah-section-head afq-head'),heading=make('h2','','Frequently used');heading.id=uid+'-title';widget.setAttribute('aria-labelledby',heading.id);
  const tools=make('div','afq-tools'),refreshButton=make('button','afq-icon-button cursor-interaction','↻'),optionsButton=make('button','afq-icon-button cursor-interaction','⋯');
  for(const button of [refreshButton,optionsButton])button.type='button';
  refreshButton.dataset.afqAction='refresh';refreshButton.setAttribute('aria-label','Refresh frequently used apps and websites');refreshButton.title='Refresh usage';
  optionsButton.dataset.afqAction='options';optionsButton.setAttribute('aria-label','Local usage options');optionsButton.setAttribute('aria-expanded','false');optionsButton.setAttribute('aria-controls',uid+'-menu');
  tools.append(refreshButton,optionsButton);header.append(heading,tools);
  const groups=make('div','afq-groups'),maps={apps:new Map(),websites:new Map()},views={};
  for(const [key,label,explanation]of [['apps','Apps','Foreground activity on this PC while Aurora is running.'],['websites','Websites','Only websites opened from Aurora are counted.']]){
    const group=make('div','afq-group'),title=make('h3','afq-group-title',label),list=make('ol','afq-list'),empty=make('p','afq-empty','Loading…');
    title.title=explanation;list.setAttribute('aria-label',label==='Apps'?'Most used apps':'Most used websites opened from Aurora');group.append(title,list,empty);groups.append(group);views[key]={list,empty};
  }
  const status=make('p','afq-status','Loading local usage…');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');status.title='App foreground time is measured locally. Website counts include only sites opened from Aurora.';
  const menu=make('div','afq-menu');menu.id=uid+'-menu';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','Local usage options');
  const pauseButton=make('button','afq-menu-button cursor-interaction','Pause local tracking'),clearButton=make('button','afq-menu-button cursor-interaction','Clear local rankings');
  for(const button of [pauseButton,clearButton])button.type='button';pauseButton.dataset.afqAction='tracking';clearButton.dataset.afqAction='confirm-clear';
  const confirmation=make('div','afq-confirm');confirmation.hidden=true;
  const clearText=make('p','','Clear saved usage rankings on this PC?'),confirmActions=make('div','afq-confirm-actions'),cancelButton=make('button','afq-menu-button cursor-interaction','Cancel'),confirmButton=make('button','afq-menu-button afq-clear-button cursor-interaction','Clear rankings');
  cancelButton.type=confirmButton.type='button';cancelButton.dataset.afqAction='cancel-clear';confirmButton.dataset.afqAction='clear';confirmActions.append(cancelButton,confirmButton);confirmation.append(clearText,confirmActions);menu.append(pauseButton,clearButton,confirmation);
  widget.append(header,groups,status,menu);parent.insertBefore(widget,weather.nextSibling);
  const hadClass=root.classList.contains('afq-enabled');root.classList.add('afq-enabled');
  let disposed=false,snapshot=null,connected=false,busy=false,revision=0,read=null,poll=0,feedback='';const opening=new Set(),cleanups=[];
  const listen=(target,type,handler)=>{target.addEventListener(type,handler);cleanups.push(()=>target.removeEventListener(type,handler));};
  const say=value=>{if(status.textContent!==value)status.textContent=value;};
  function hideMenu(focus=false){menu.hidden=true;confirmation.hidden=true;pauseButton.hidden=clearButton.hidden=false;optionsButton.setAttribute('aria-expanded','false');if(focus)optionsButton.focus({preventScroll:true});}
  function rows(key,items){
    const {list,empty}=views[key],records=maps[key],ids=new Set(items.map(item=>item.id));
    for(const [id,record]of records)if(!ids.has(id)){record.entry.remove();records.delete(id);}
    items.forEach((item,index)=>{
      let record=records.get(item.id);
      if(!record){
        const entry=make('li','afq-entry'),button=make('button','afq-item cursor-interaction'),icon=make('span','afq-item-icon'),name=make('span','afq-item-name'),metric=make('span','afq-item-metric');
        button.type='button';button.dataset.afqOpen=item.id;icon.setAttribute('aria-hidden','true');button.append(icon,name,metric);entry.append(button);record={entry,button,icon,name,metric};records.set(item.id,record);
      }
      record.item=item;record.icon.textContent=[...item.label][0]?.toLocaleUpperCase()||'';record.name.textContent=item.label;record.metric.textContent=frequentUsageMetric(item);
      record.button.disabled=busy||opening.has(item.id)||!item.launchable||typeof openItem!=='function';
      record.button.title=item.launchable?item.kind==='website'?`${item.label} · ${item.domain||'Aurora website'} · ${record.metric.textContent}`:`${item.label} · ${record.metric.textContent} foreground activity`:`${item.label} · Opening is unavailable`;
      if(list.children[index]!==record.entry)list.insertBefore(record.entry,list.children[index]||null);
    });
    list.hidden=!items.length;empty.hidden=Boolean(items.length);
    if(!items.length)empty.textContent=!snapshot?connected?'No usage yet.':'Not connected.':snapshot.status==='loading'?'Starting local tracking…':key==='apps'?'No app usage yet.':'No Aurora websites yet.';
  }
  function paint(){
    if(disposed)return;
    widget.dataset.usageState=!connected?'disconnected':snapshot?.status||'loading';widget.setAttribute('aria-busy',String(Boolean(read)||busy));
    refreshButton.disabled=Boolean(read)||busy;pauseButton.disabled=clearButton.disabled=confirmButton.disabled=busy||!connected||!snapshot;
    pauseButton.textContent=snapshot?.enabled?'Pause local tracking':'Resume local tracking';
    rows('apps',snapshot?.apps||[]);rows('websites',snapshot?.websites||[]);
    if(feedback)say(feedback);
    else if(!connected)say(snapshot?'Disconnected · last loaded rankings.':'Local usage is not connected.');
    else if(snapshot?.status==='loading')say('Learning from local use…');
    else if(!snapshot?.enabled||snapshot?.status==='paused')say('Tracking paused · saved rankings.');
    else if(snapshot?.status==='unavailable')say('App tracking unavailable · Aurora sites only.');
    else say('Websites opened from Aurora only.');
  }
  async function refresh(){
    if(disposed||busy)return;if(read)return read.promise;
    const current=++revision,controller=new AbortController(),record={controller,promise:null,cancel:null,timer:0};read=record;feedback='';
    if(!snapshot){for(const view of Object.values(views)){view.empty.textContent='Loading…';view.empty.hidden=false;}say('Loading local usage…');}
    refreshButton.disabled=true;widget.setAttribute('aria-busy','true');
    record.promise=(async()=>{
      try{
        if(typeof service?.readFrequentUsage!=='function')throw new Error('Unavailable');
        const cancelled=new Promise((_,reject)=>{record.cancel=()=>{controller.abort();win.clearTimeout(record.timer);reject(new Error('Cancelled'));};});
        const timeout=new Promise((_,reject)=>{record.timer=win.setTimeout(()=>{controller.abort();reject(new Error('Timeout'));},30000);});
        const value=await Promise.race([service.readFrequentUsage({signal:controller.signal}),timeout,cancelled]);
        if(disposed||current!==revision)return;snapshot=normaliseFrequentUsage(value,{limit});connected=true;
      }catch{if(disposed||current!==revision)return;connected=false;}
      finally{win.clearTimeout(record.timer);record.cancel=null;if(read===record)read=null;if(!disposed&&current===revision)paint();}
    })();
    return record.promise;
  }
  async function change(action){
    if(disposed||busy||!connected||!snapshot)return;
    const current=++revision;read?.cancel?.();read=null;busy=true;feedback=action==='clear'?'Clearing local rankings…':'Updating local tracking…';paint();
    try{
      const method=action==='clear'?service?.clearUsage:service?.setUsageTracking;if(typeof method!=='function')throw new Error('Unavailable');
      const value=await (action==='clear'?method.call(service):method.call(service,!snapshot.enabled));
      if(disposed||current!==revision)return;snapshot=normaliseFrequentUsage(value,{limit});connected=true;feedback=action==='clear'?'Local rankings cleared.':snapshot.enabled?'Local tracking resumed.':'Local tracking paused.';hideMenu();
    }catch{if(disposed||current!==revision)return;feedback='The local usage setting could not be updated.';}
    finally{if(!disposed&&current===revision){busy=false;paint();}}
  }
  async function launch(id){
    const record=[...maps.apps.values(),...maps.websites.values()].find(value=>value.item.id===id),item=record?.item;
    if(disposed||busy||!item?.launchable||opening.has(id)||typeof openItem!=='function')return;
    if(root.dataset.browserQa==='true'){feedback='Opening is disabled in this preview.';paint();return;}
    opening.add(id);feedback=`Opening ${item.label}…`;paint();
    try{if(await openItem(id)===false)throw new Error('Unavailable');if(!disposed){feedback=`Opening ${item.label}.`;nativeStatus?.(feedback);}}
    catch{if(!disposed){feedback=`${item.label} could not be opened.`;nativeStatus?.(feedback);}}
    finally{opening.delete(id);if(!disposed)paint();}
  }
  const click=event=>{
    const target=event.target?.closest?.('[data-afq-action],[data-afq-open]');if(!target||!widget.contains(target))return;event.stopPropagation();
    if(target.disabled)return;
    if(target.dataset.afqOpen!==undefined){void launch(target.dataset.afqOpen);return;}
    const action=target.dataset.afqAction;
    if(action==='refresh')void refresh();
    else if(action==='options'){if(menu.hidden){menu.hidden=false;optionsButton.setAttribute('aria-expanded','true');pauseButton.focus({preventScroll:true});}else hideMenu();}
    else if(action==='tracking')void change('tracking');
    else if(action==='confirm-clear'){pauseButton.hidden=clearButton.hidden=true;confirmation.hidden=false;cancelButton.focus({preventScroll:true});}
    else if(action==='cancel-clear'){confirmation.hidden=true;pauseButton.hidden=clearButton.hidden=false;clearButton.focus({preventScroll:true});}
    else if(action==='clear')void change('clear');
  };
  listen(widget,'click',click);
  listen(widget,'keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();hideMenu(true);}});
  listen(doc,'pointerdown',event=>{if(!menu.hidden&&!widget.contains(event.target))hideMenu();});
  listen(doc,'visibilitychange',()=>{if(!doc.hidden)void refresh();});
  const dispose=()=>{if(disposed)return;disposed=true;revision++;read?.cancel?.();read=null;win.clearInterval(poll);for(const cleanup of cleanups)cleanup();widget.remove();if(!hadClass)root.classList.remove('afq-enabled');instances.delete(root);};
  listen(win,'pagehide',dispose);
  const api=Object.freeze({refresh,dispose});instances.set(root,api);
  const interval=Math.max(60000,Number.isFinite(refreshMs)?refreshMs:60000);poll=win.setInterval(()=>{if(!doc.hidden)void refresh();},interval);
  void refresh();return api;
}
