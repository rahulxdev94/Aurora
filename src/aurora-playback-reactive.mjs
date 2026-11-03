// Seelen's default multimedia output, including every app routed to it.
// The host sends in-memory PCM. This adapter immediately reduces it to one
// scalar, never retaining, recording, logging, uploading or redistributing it.
// Native waveform capture has no stop API: removing our listener does not stop
// capture already started inside Seelen. No microphone endpoint is requested.
export const PLAYBACK_STALE_MS=2000;
export const PLAYBACK_DEADLINE_MS=6000;
export const PLAYBACK_RETRY_MS=30000;
export const MAX_WAVEFORM_SAMPLES=96000;

function reduceWaveform(value){
  const samples=value?.samples;
  if(!Array.isArray(samples)||samples.length<1||samples.length>MAX_WAVEFORM_SAMPLES)throw new Error('Playback waveform unavailable');
  let peak=0,hashA=2166136261,hashB=0x9e3779b9;
  for(let i=0;i<samples.length;i++){
    const sample=samples[i];
    if(typeof sample!=='number'||!Number.isFinite(sample)||sample < -1||sample > 1)throw new Error('Invalid playback sample');
    peak=Math.max(peak,Math.abs(sample));
    // Two order-sensitive scalar fingerprints, with sub-nanolevel quantisation.
    // No PCM samples or sample arrays survive this synchronous reduction.
    const value=(sample*2147483647)|0;
    hashA=Math.imul(hashA^value,16777619)>>>0;
    hashB=Math.imul(hashB^value,0x85ebca6b);
    hashB=((hashB<<13)|(hashB>>>19))>>>0;
  }
  return{peak,hashA,hashB,length:samples.length};
}
export function waveformPeak(value){return reduceWaveform(value).peak;}

export function initPlaybackReactive({root,invoke,subscribe,SeelenCommand,SeelenEvent,enabled=true,now=()=>Date.now()}={}){
  if(enabled!==true||!root?.ownerDocument)return()=>{};
  const doc=root.ownerDocument,win=doc.defaultView;
  if(!win)return()=>{};
  let disposed=false,session=null,retryTimer=0,pendingActivation=null;
  const available=()=>!disposed&&!doc.hidden&&root.dataset.motion!=='off'&&root.dataset.paused!=='true';
  const current=token=>session===token&&!token.cancelled&&available();
  const unlisten=fn=>{if(typeof fn==='function')try{fn();}catch{}};
  function publish(peak,at,status){
    const previous=win.__auroraPlaybackAudio;
    win.__auroraPlaybackAudio={peak,at,status,source:'Windows playback'};
    root.dataset.playbackAudioStatus=status;
    if(previous?.peak!==peak||previous?.status!==status)root.dispatchEvent(new win.CustomEvent('aurora-playback-audio'));
  }
  function clearSession(){
    win.clearTimeout(retryTimer);retryTimer=0;
    if(!session)return;
    const token=session;session=null;token.cancelled=true;
    for(const key of ['subscriptionTimer','queryTimer','staleTimer'])win.clearTimeout(token[key]);
    unlisten(token.unsubscribe);token.unsubscribe=null;
  }
  function scheduleRetry(token){
    if(!current(token)||retryTimer)return;
    retryTimer=win.setTimeout(()=>{
      retryTimer=0;if(!current(token))return;
      // Tauri invocations cannot be cancelled. Never pile up unresolved calls.
      if(token.subscriptionPending||token.queryPending){scheduleRetry(token);return;}
      begin();
    },PLAYBACK_RETRY_MS);
  }
  function watchFreshness(token,delay=PLAYBACK_STALE_MS){
    if(token.staleTimer||!current(token))return;
    token.staleTimer=win.setTimeout(()=>{
      token.staleTimer=0;if(!current(token)||token.lastAt===null)return;
      const freshAt=token.level>0?Math.min(token.lastAt,token.changedAt):token.lastAt;
      const age=now()-freshAt;
      if(!Number.isFinite(age)||age<0||age>=PLAYBACK_STALE_MS){publish(0,freshAt,'idle');return;}
      watchFreshness(token,Math.max(1,PLAYBACK_STALE_MS-age));
    },delay);
  }
  function receive(token,event){
    if(!current(token)||token.subscriptionExpired||!token.activationRequested)return;
    let scalar;
    try{scalar=reduceWaveform(event?.payload);}catch{
      win.clearTimeout(token.staleTimer);token.staleTimer=0;token.lastAt=null;
      publish(0,0,'unavailable');return;
    }
    const at=now();if(!Number.isFinite(at)){publish(0,0,'unavailable');return;}
    const peak=scalar.peak<.001?0:scalar.peak;
    const changed=scalar.hashA!==token.hashA||scalar.hashB!==token.hashB||scalar.length!==token.sampleCount;
    if(changed||peak===0){token.changedAt=at;token.hashA=scalar.hashA;token.hashB=scalar.hashB;token.sampleCount=scalar.length;}
    token.seen=true;token.level=peak;
    win.clearTimeout(retryTimer);retryTimer=0;
    // Seelen can re-emit an old ring when no new packets arrive. Its API has no
    // producer clock, so an unchanged nonzero ring is conservatively expired.
    // A genuinely identical repeated tone can also become idle after two seconds.
    if(peak>0&&(at-token.changedAt>=PLAYBACK_STALE_MS||at<token.changedAt)){
      win.clearTimeout(token.staleTimer);token.staleTimer=0;
      publish(0,token.changedAt,'idle');return;
    }
    token.lastAt=at;
    // Receipt time is all the API supplies. It is not a producer timestamp.
    // The renderer performs attack/release smoothing and circular scaling.
    publish(peak,at,peak>0?'active':'idle');watchFreshness(token);
  }
  function activate(token){
    if(!current(token))return;
    token.activationRequested=true;token.queryPending=true;
    token.queryTimer=win.setTimeout(()=>{
      token.queryExpired=true;
      if(current(token)&&!token.seen){publish(0,0,'unavailable');scheduleRetry(token);}
    },PLAYBACK_DEADLINE_MS);
    // Share an uncancellable in-flight activation across visibility/motion
    // sessions. Rapid toggles must not create additional native requests.
    let activation=pendingActivation;
    if(!activation){
      try{activation=Promise.resolve(invoke(SeelenCommand?.GetMediaWaveform||'get_media_waveform')).then(()=>undefined);}
      catch{activation=Promise.reject(new Error('Playback unavailable'));}
      pendingActivation=activation;
      const clear=()=>{if(pendingActivation===activation)pendingActivation=null;};
      activation.then(clear,clear);
    }
    activation.then(()=>{
      // The getter may return an old ring. Discard it; only events drive motion.
      token.queryPending=false;win.clearTimeout(token.queryTimer);
      if(current(token)&&token.queryExpired&&!token.seen)scheduleRetry(token);
    },()=>{
      token.queryPending=false;win.clearTimeout(token.queryTimer);
      if(current(token)&&!token.seen){publish(0,0,'unavailable');scheduleRetry(token);}
    });
  }
  function begin(){
    clearSession();if(!available())return;
    if(typeof invoke!=='function'||typeof subscribe!=='function'){publish(0,0,'unavailable');return;}
    const token={cancelled:false,subscriptionPending:true,subscriptionExpired:false,queryPending:false,queryExpired:false,activationRequested:false,seen:false,lastAt:null,changedAt:null,hashA:null,hashB:null,sampleCount:0,level:0,unsubscribe:null,subscriptionTimer:0,queryTimer:0,staleTimer:0};
    session=token;
    token.subscriptionTimer=win.setTimeout(()=>{
      token.subscriptionExpired=true;
      if(current(token)){publish(0,0,'unavailable');scheduleRetry(token);}
    },PLAYBACK_DEADLINE_MS);
    let subscription;
    try{subscription=subscribe(SeelenEvent?.MediaWaveform||'media::waveform',event=>receive(token,event));}
    catch{subscription=Promise.reject(new Error('Playback unavailable'));}
    Promise.resolve(subscription).then(stop=>{
      token.subscriptionPending=false;win.clearTimeout(token.subscriptionTimer);
      if(!current(token)||token.subscriptionExpired){unlisten(stop);if(current(token))scheduleRetry(token);return;}
      if(typeof stop!=='function'){publish(0,0,'unavailable');scheduleRetry(token);return;}
      token.unsubscribe=stop;activate(token);
    },()=>{
      token.subscriptionPending=false;win.clearTimeout(token.subscriptionTimer);
      if(current(token)){publish(0,0,'unavailable');scheduleRetry(token);}
    });
  }
  function changed(){clearSession();publish(0,0,'unavailable');if(available())begin();}
  const observer=new win.MutationObserver(changed);
  observer.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});
  doc.addEventListener('visibilitychange',changed);
  function dispose(){
    if(disposed)return;clearSession();publish(0,0,'unavailable');disposed=true;
    observer.disconnect();doc.removeEventListener('visibilitychange',changed);win.removeEventListener('pagehide',dispose);
    delete root.dataset.playbackAudioStatus;
  }
  win.addEventListener('pagehide',dispose,{once:true});publish(0,0,'unavailable');begin();return dispose;
}
