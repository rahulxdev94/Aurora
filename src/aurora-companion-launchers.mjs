// Fixed, build-configured destinations. These buttons never construct commands from user text.
export const EMPTY_COMPANION_LAUNCHERS=Object.freeze({scarlettUrl:'',anchorUrl:'',voiceLauncher:'',voiceHotkeyConfigured:false});

export function validateCompanionLaunchers(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid launcher configuration');
  for(const key of Object.keys(input))if(!Object.hasOwn(EMPTY_COMPANION_LAUNCHERS,key))throw new Error('Unknown launcher configuration field: '+key);
  const config={...EMPTY_COMPANION_LAUNCHERS,...input};
  for(const key of ['scarlettUrl','anchorUrl','voiceLauncher'])if(typeof config[key]!=='string'||config[key]!==config[key].trim()||config[key].length>2048||/[\x00-\x1f\x7f]/.test(config[key]))throw new Error('Invalid launcher target: '+key);
  if(typeof config.voiceHotkeyConfigured!=='boolean')throw new Error('Voice hotkey availability must be boolean');
  if(config.scarlettUrl){
    const url=new URL(config.scarlettUrl);
    const dots=config.scarlettUrl==='codex://dots';
    const chat=url.hostname==='threads'&&/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)&&[...url.searchParams.keys()].every(key=>key==='hostId')&&url.searchParams.getAll('hostId').length<=1;
    if(url.protocol!=='codex:'||(!dots&&!chat)||url.username||url.password||url.port||url.hash)throw new Error('Scarlett must use the supported Dots entry or a copied chat deep link');
  }
  if(config.anchorUrl){const url=new URL(config.anchorUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Anchor must use an HTTPS app URL without credentials or query data');}
  if(config.voiceLauncher){
    const target=config.voiceLauncher.replaceAll('\\','/');
    if(!/^[a-z]:\//i.test(target)||/["<>|?*%]/.test(target)||target.split('/').some(part=>part==='.'||part==='..')||!target.endsWith('/ChatGPT Voice.vbs'))throw new Error('Voice must use the fixed ChatGPT Voice.vbs launcher');
  }
  return Object.freeze(config);
}

export function initCompanionLaunchers({root,launchers={},openTarget,status=()=>{},now=()=>Date.now()}={}){
  if(!root||typeof openTarget!=='function')throw new Error('Companion launchers require a native launch boundary');
  const config=validateCompanionLaunchers(launchers),pending=new Set();
  const targets={scarlett:config.scarlettUrl,voice:config.voiceHotkeyConfigured?config.voiceLauncher:'',anchor:config.anchorUrl};
  const labels={scarlett:'Scarlett',voice:'ChatGPT Voice',anchor:'Anchor'};
  let disposed=false,lastVoiceAt=-Infinity;
  for(const button of root.querySelectorAll('[data-aurora-companion]')){
    const kind=button.dataset.auroraCompanion;
    if(!Object.hasOwn(targets,kind))continue;
    button.setAttribute('aria-label',kind==='anchor'?'Open Anchor reminders':kind==='voice'?'Start ChatGPT Voice using your configured shortcut':'Open Scarlett');
    button.title=kind==='anchor'?'Open Anchor reminders':kind==='voice'?'Start ChatGPT Voice · Ctrl+Alt+Shift+V':'Open Scarlett';
    button.setAttribute('aria-disabled',targets[kind]?'false':'true');
  }
  const click=event=>{
    const button=event.target.closest?.('[data-aurora-companion]');
    if(disposed||!button||!root.contains(button))return;
    event.preventDefault();event.stopImmediatePropagation();
    const kind=button.dataset.auroraCompanion;
    if(!Object.hasOwn(targets,kind))return;
    if(!targets[kind]){status(kind==='voice'?'ChatGPT Voice is not connected to its desktop shortcut yet.':labels[kind]+' is not connected yet.');return;}
    if(pending.has(kind)||(kind==='voice'&&now()-lastVoiceAt<1500))return;
    if(kind==='voice')lastVoiceAt=now();
    pending.add(kind);button.setAttribute('aria-busy','true');
    void Promise.resolve().then(()=>disposed?false:openTarget(targets[kind],labels[kind])).then(result=>{
      if(!disposed&&result!==false)status(kind==='voice'?'Sent the ChatGPT Voice shortcut.':'Opening '+labels[kind]+'.');
    }).catch(()=>{if(!disposed)status(labels[kind]+' could not open. Check its desktop connection.');}).finally(()=>{pending.delete(kind);button.removeAttribute('aria-busy');});
  };
  root.addEventListener('click',click,true);
  return()=>{disposed=true;pending.clear();root.removeEventListener('click',click,true);};
}
