// Connect Galaxy Atlas's existing launcher entry points to its native search companion.
export const SEARCH_COMMANDS = new Set(['show-home','files','start-focus','show-calendar','workspace-work','workspace-create','workspace-relax','motion-full','motion-reduced','motion-off','quick-controls','notifications','notifications-all','change-motion']);
export const NOTIFICATION_MODE_RESULT_FILE='notification-mode-result.json';
export const POWERSHELL_TEST_APP_ID='{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

/** Inspect identity and timing only, without accessing any toast content. */
export function findPowerShellTestNotification(notifications,now=Date.now()){
  if(!Array.isArray(notifications)||notifications.length>4096||!Number.isSafeInteger(now))return null;
  let newest=null;
  for(const item of notifications){
    if(item?.appUmid!==POWERSHELL_TEST_APP_ID||!Number.isInteger(item.id)||item.id<0||item.id>0xffffffff||!Number.isSafeInteger(item.date)||item.date<=0)continue;
    if(!newest||item.date>newest.date)newest=item;
  }
  if(!newest||!Number.isSafeInteger(now-newest.date))return null;
  return{id:newest.id,date:newest.date,ageMs:now-newest.date};
}

const SETTINGS_UMID='windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel';
const identifier=value=>typeof value==='string'&&value.length<=8192?value.toLowerCase():'';
const settingsExecutable=value=>/^[a-z]:\\windows\\immersivecontrolpanel\\systemsettings\.exe$/.test(identifier(value).replaceAll('/','\\'));

/** Only return Settings' control identifiers. Match Seelen's CLI ordering/grouping. */
export function findSettingsDockTarget(dock,windows){
  if(!dock||![dock.left,dock.center,dock.right,windows].every(Array.isArray))return null;
  if(dock.left.length+dock.center.length+dock.right.length>4096||windows.length>4096)return null;
  const items=[...dock.left,...dock.center,...dock.right].filter(item=>item?.type==='AppOrFile');
  let fallback=null;
  for(let dockIndex=0;dockIndex<items.length;dockIndex++){
    const item=items[dockIndex],umid=identifier(item.umid),path=identifier(item.path),command=identifier(item.relaunch?.command);
    if(umid!==SETTINGS_UMID&&(umid||(!settingsExecutable(path)&&!settingsExecutable(command))))continue;
    const window=windows.find(candidate=>{
      if(!candidate||!Number.isSafeInteger(candidate.hwnd)||candidate.hwnd<=0)return false;
      // Windows carrying an UMID never use the path fallback in Seelen's CLI.
      if(typeof candidate.umid==='string')return candidate.umid===item.umid;
      const processPath=identifier(candidate.process?.path);
      return processPath!==''&&(processPath===path||processPath===command);
    });
    const target={dockIndex,hwnd:window?.hwnd??null};
    if(window)return target;
    fallback??=target;
  }
  return fallback;
}

export function initSearchIntegration({root,invoke,SeelenCommand,searchWidgetId='@galaxy-atlas/search',runCommand,closePanel,status=()=>{}}){
  if(!root||!SeelenCommand?.TriggerWidget)throw new Error('Galaxy Atlas search bridge unavailable');
  const win=root.ownerDocument.defaultView;
  let disposed=false,opening=false,enablingAlerts=null;
  const controls=[...root.querySelectorAll('[data-action="launcher"]')];
  for(const button of controls){
    button.setAttribute('data-aurora-search','');
    button.setAttribute('aria-label','Galaxy Atlas Search: apps, files and commands');
    button.title='Galaxy Atlas Search · Ctrl+Alt+Space';
    const label=button.querySelector('span');
    if(label)label.textContent=button.classList.contains('ah-search-trigger')?'Search anything':'Search';
    else if(button.closest('.ah-navigation'))button.textContent='Search';
    const hint=button.querySelector('kbd');if(hint)hint.textContent='Ctrl K';
  }
  async function show(){
    if(disposed||opening)return;
    opening=true;
    try{
      await invoke(SeelenCommand.TriggerWidget,{payload:{id:searchWidgetId,customArgs:{
        motion:root.dataset.motion||'reduced',paused:root.dataset.paused==='true',
        accent:root.style.getPropertyValue('--ah-accent')||'#D6B466'
      }}});
    }catch{status('Galaxy Atlas Search could not open. Check that its widget is enabled in Seelen.');}
    finally{opening=false;}
  }
  function enableLiveAlerts(){
    if(disposed)return Promise.resolve(false);
    if(enablingAlerts)return enablingAlerts;
    enablingAlerts=(async()=>{
      const report={attemptedAt:new Date().toISOString(),result:'error',mode:null};
      let stage='set';
      try{
        if(!SeelenCommand.SetNotificationsMode||!SeelenCommand.GetNotificationsMode){
          report.result='unavailable';report.errorCode='API_UNAVAILABLE';
          status('Live alert controls are unavailable in this host. Open Windows notification settings.');
          return false;
        }
        status('Enabling live notification alerts...');
        await invoke(SeelenCommand.SetNotificationsMode,{mode:'All'});
        if(disposed)return false;
        stage='readback';
        const value=await invoke(SeelenCommand.GetNotificationsMode);
        if(disposed)return false;
        report.mode=['All','PriorityOnly','AlarmsOnly'].includes(value)?value:null;
        if(report.mode===null){
          report.errorCode='UNRECOGNISED_MODE';
          status('Live alert status could not be confirmed. Check Windows notification settings.');
          return false;
        }
        if(report.mode!=='All'){
          report.result='mode-not-all';report.errorCode='MODE_NOT_ALL';
          status('Windows is still silencing live alerts. Turn off Do not disturb in notification settings.');
          return false;
        }
        report.result='verified';
        status('Windows now allows all notification alerts.');
        return true;
      }catch{
        report.errorCode=stage==='set'?'SET_REJECTED':'READBACK_REJECTED';
        if(!disposed)status('Live alert status could not be confirmed. Check Windows notification settings.');
        return false;
      }finally{
        if(!disposed&&SeelenCommand.WriteFile){
          if(SeelenCommand.StateGetWegItems&&SeelenCommand.GetUserAppWindows){
            try{
              const [dock,windows]=await Promise.all([invoke(SeelenCommand.StateGetWegItems),invoke(SeelenCommand.GetUserAppWindows)]);
              const settings=findSettingsDockTarget(dock,windows);
              if(settings)report.settings=settings;
            }catch{}
          }
          if(!disposed&&SeelenCommand.GetNotifications){
            try{report.testNotification=findPowerShellTestNotification(await invoke(SeelenCommand.GetNotifications));}catch{}
          }
          // Fixed-size operational metadata only. Never persist errors or notification content.
          if(!disposed)try{await invoke(SeelenCommand.WriteFile,{filename:NOTIFICATION_MODE_RESULT_FILE,content:JSON.stringify(report)});}catch{}
        }
        enablingAlerts=null;
      }
    })();
    return enablingAlerts;
  }
  const click=event=>{
    const target=event.target.closest?.('[data-aurora-search],[data-action="launcher"]');
    if(!target||!root.contains(target))return;
    event.preventDefault();event.stopImmediatePropagation();void show();
  };
  const key=event=>{
    if(event.repeat||event.isComposing)return;
    const editable=event.target.isContentEditable||event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
    if((event.ctrlKey&&!event.altKey&&!event.metaKey&&event.key.toLowerCase()==='k')||
      (event.key==='/'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!editable)){
      event.preventDefault();event.stopImmediatePropagation();void show();
    }
  };
  const previous=win.__auroraHandleSearchCommand;
  win.__auroraHandleSearchCommand=id=>{
    if(disposed||!SEARCH_COMMANDS.has(id))return false;
    if(id==='notifications-all')return enableLiveAlerts();
    if(id==='start-focus'&&root.dataset.focusWidgetRemoved==='true'){status('The Focus timer has been removed from Galaxy Atlas.');return false;}
    if(id==='show-home')closePanel?.();else if(id==='files')void win.__auroraOpenFiles?.();else runCommand?.(id);
    return true;
  };
  root.addEventListener('click',click,true);
  root.addEventListener('keydown',key,true);
  return()=>{disposed=true;root.removeEventListener('click',click,true);root.removeEventListener('keydown',key,true);win.__auroraHandleSearchCommand=previous;};
}
