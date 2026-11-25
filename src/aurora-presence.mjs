// Ephemeral presence for real desktop activity and explicitly linked assistant updates.
// This module never opens a microphone, sends a draft, fetches a chat or stores a feed.
const instances=new WeakMap();
const STATES=new Set(['idle','working','speaking','listening','error']);
const KINDS=new Set(['info','success','error','busy']);
const VOICE_SOURCES=new Set(['voice-session','assistant-voice']);
const clean=(value,limit=240)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';
const sourceLabel=value=>value==='voice-session'?'Voice session':value==='assistant-voice'?'Assistant voice':value;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const fresh=(value,now,maxAge)=>Boolean(value&&finite(value.observedAt)&&finite(value.expiresAt)&&value.observedAt<=now+1000&&value.observedAt>=now-maxAge&&value.expiresAt>now&&value.expiresAt>value.observedAt);

/** Validate a producer's short-lived status. Source labels are provenance, not permissions. */
export function normaliseAssistantStatus(value,now=Date.now()){
  if(!value||!STATES.has(value.state)||!finite(now))return null;
  const source=clean(value.source,60),message=clean(value.message);
  if(!source||!message)return null;
  const voice=value.state==='listening'||value.state==='speaking';
  if(value.state==='listening'&&source!=='voice-session')return null;
  if(value.state==='speaking'&&!VOICE_SOURCES.has(source))return null;
  const maxAge=voice?8000:60000;
  if(!fresh(value,now,maxAge)||value.expiresAt-value.observedAt>maxAge)return null;
  return{state:value.state,message,source,observedAt:value.observedAt,expiresAt:value.expiresAt};
}

/** A playback peak is only evidence of Windows output, not who is speaking. */
export function derivePresenceState({now=Date.now(),assistantStatus=null,playback=null,activity=null,hidden=false}={}){
  const fallback={state:'idle',label:'Ready',message:'Your next move starts here.',source:'Desktop activity',energy:0,linked:false,expiresAt:0};
  if(hidden||!finite(now))return fallback;
  const status=normaliseAssistantStatus(assistantStatus,now);
  const audio=playback?.status==='active'&&finite(playback.at)&&playback.at<=now+1000&&now-playback.at<2000&&finite(playback.peak)&&playback.peak>.015;
  const energy=audio?Math.min(1,Math.max(0,playback.peak)):0;
  if(status&&['listening','speaking','error'].includes(status.state))return{...status,label:{listening:'Listening',speaking:'Speaking',error:'Needs attention'}[status.state],energy,linked:true};
  if(audio)return{state:'speaking',label:'Audio playing',message:'The core is moving with your PC audio.',source:'Windows playback',energy,linked:Boolean(status),expiresAt:playback.at+2000};
  if(status)return{...status,label:status.state==='working'?'Working':'Updated',energy:0,linked:true};
  if(fresh(activity,now,15000)&&KINDS.has(activity.kind)&&clean(activity.message))return{state:activity.kind==='busy'?'working':activity.kind==='error'?'error':'idle',label:activity.kind==='busy'?'Working':activity.kind==='error'?'Needs attention':'Updated',message:clean(activity.message),source:clean(activity.source,60)||'Desktop activity',energy:0,linked:false,expiresAt:activity.expiresAt};
  return fallback;
}

export function initAuroraPresence({root,now=()=>Date.now(),openDraft,showConsole=true}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,stage=root.querySelector('.ah-core-stage'),desktop=root.querySelector('.ah-desktop');
  if(!win||!stage||!desktop)return()=>{};
  const make=(tag,cls,value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=value;return node;};
  const presence=make('div','ap-presence');
  const chip=make('div','ap-state-chip'),dot=make('span','ap-state-dot'),label=make('span','ap-state-label','Ready');
  dot.setAttribute('aria-hidden','true');chip.append(dot,label);
  const waveform=make('div','ap-waveform');waveform.setAttribute('aria-hidden','true');
  for(let index=0;index<5;index++){const bar=make('i','');bar.style.setProperty('--ap-bar',String(index));waveform.append(bar);}
  const speech=make('aside','ap-speech');speech.setAttribute('aria-label','Aurora presence');
  const brand=make('span','ap-speech-brand','AURORA'),message=make('p','ap-speech-message'),source=make('span','ap-speech-source');
  message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.setAttribute('aria-atomic','true');
  speech.append(brand,message,source);presence.append(chip,waveform,speech);stage.append(presence);

  let panel,connection,voiceLabel,feed,empty,form,input,note;
  if(showConsole){
  panel=make('section','ap-console ah-surface');panel.setAttribute('aria-label','Aurora assistant activity');
  const head=make('header','ap-console-head'),heading=make('h2','','With Aurora');connection=make('span','ap-connection','Desktop activity');
  head.append(heading,connection);
  const capabilities=make('div','ap-capabilities'),openChat=make('button','ap-open-chat cursor-interaction','Open chat');voiceLabel=make('span','ap-voice-label','Voice not linked');
  openChat.type='button';openChat.setAttribute('data-native-chat','true');openChat.title='Open the Aurora chat in Codex. Start voice there.';
  capabilities.append(voiceLabel,openChat);
  feed=make('ol','ap-feed');feed.setAttribute('aria-label','Recent Aurora activity');
  empty=make('p','ap-empty','Your desktop activity and linked assistant updates appear here.');
  form=make('form','ap-compose');input=make('textarea','ap-compose-input');
  input.placeholder='A question, an idea, your next move…';input.maxLength=4000;input.rows=2;input.setAttribute('aria-label','Draft for Aurora');
  const submit=make('button','ap-compose-submit cursor-interaction','Open draft');submit.type='submit';
  note=make('p','ap-compose-note','Drafts stay local until you choose to send.');
  form.append(input,submit);panel.append(head,capabilities,empty,feed,form,note);desktop.append(panel);
  }
  root.classList.add('ap-enabled');
  let disposed=false,assistantStatus=null,activity=null,expiryTimer=0,connectionAvailable=false;
  const entries=[],cleanups=[],observers=[];
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const listen=(target,type,callback)=>{target?.addEventListener(type,callback);cleanups.push(()=>target?.removeEventListener(type,callback));};
  function remember(value,origin,kind='info',at=now()){
    if(!feed)return;
    const entryMessage=clean(value),entrySource=clean(origin,60)||'Desktop activity';if(!entryMessage||disposed)return;
    const previous=entries[0];if(previous?.message===entryMessage&&previous.source===entrySource)return;
    entries.unshift({message:entryMessage,source:entrySource,kind,observedAt:at});entries.length=Math.min(entries.length,5);
    feed.replaceChildren();
    for(const entry of entries){
      const row=make('li','ap-entry');row.dataset.kind=entry.kind;
      const body=make('p','ap-entry-message',entry.message),meta=make('span','ap-entry-source',sourceLabel(entry.source));
      row.append(body,meta);feed.append(row);
    }
    empty.hidden=entries.length>0;
  }
  function render(){
    win.clearTimeout(expiryTimer);expiryTimer=0;if(disposed)return;
    const time=now(),hidden=doc.hidden||root.dataset.paused==='true';
    const state=derivePresenceState({now:time,assistantStatus,playback:win.__auroraPlaybackAudio,activity,hidden});
    const motion=root.dataset.motion==='off'?'off':root.dataset.motion==='reduced'||media?.matches?'reduced':'full';
    root.dataset.presenceIdle=String(state.label==='Ready'&&!state.linked&&!state.expiresAt);root.dataset.aiState=state.state;root.dataset.aiMotion=motion;
    root.style.setProperty('--ap-energy',motion==='full'&&!hidden?String(state.energy):'0');
    setText(label,state.label);setText(message,state.message);setText(source,sourceLabel(state.source));
    const freshStatus=connectionAvailable?normaliseAssistantStatus(assistantStatus,time):null;
    setText(connection,freshStatus?(freshStatus.source==='Codex'?'Codex update':VOICE_SOURCES.has(freshStatus.source)?'Voice session':'Assistant update'):'Desktop activity');
    setText(voiceLabel,freshStatus&&VOICE_SOURCES.has(freshStatus.source)?'Voice connected':'Voice not linked');
    if(hidden)return;
    const deadlines=[state.expiresAt,assistantStatus?.expiresAt,activity?.expiresAt].filter(value=>finite(value)&&value>time);
    if(deadlines.length)expiryTimer=win.setTimeout(render,Math.max(1,Math.min(...deadlines)-time+1));
  }
  function desktopUpdate(value,kind='info'){
    const valueText=clean(value);if(!valueText||disposed||doc.hidden)return;
    const observedAt=now();activity={message:valueText,kind,source:'Desktop activity',observedAt,expiresAt:observedAt+(kind==='busy'?12000:8000)};
    remember(valueText,activity.source,kind,observedAt);render();
  }
  listen(root,'aurora:activity',event=>{const detail=event.detail;if(detail&&KINDS.has(detail.kind))desktopUpdate(detail.message,detail.kind);});
  listen(root,'aurora:assistant-status',event=>{
    const candidate=normaliseAssistantStatus(event.detail,now());if(!candidate)return;
    assistantStatus=candidate;connectionAvailable=true;
    remember(candidate.message,candidate.source,candidate.state==='error'?'error':candidate.state==='working'?'busy':'info',candidate.observedAt);render();
  });
  listen(root,'aurora:assistant-connection',event=>{if(typeof event.detail?.connected!=='boolean')return;connectionAvailable=event.detail.connected;if(!connectionAvailable)assistantStatus=null;render();});
  listen(root,'aurora-playback-audio',render);
  listen(doc,'visibilitychange',render);
  listen(media,'change',render);
  if(win.MutationObserver){
    const motionObserver=new win.MutationObserver(render);motionObserver.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});observers.push(motionObserver);
    // Reuse the original status observer's genuine focus, weather and toast messages.
    // Its UI is hidden by .ap-enabled; no synthetic progress or chat is generated here.
    const statusMessage=root.querySelector('.aas-message');
    if(statusMessage){
      const statusObserver=new win.MutationObserver(()=>{
        const text=clean(statusMessage.textContent),container=statusMessage.parentElement;
        if(text&&text!=='Your space is ready.')desktopUpdate(text,container?.dataset.kind==='busy'?'busy':container?.dataset.kind==='error'?'error':container?.dataset.kind==='success'?'success':'info');
      });
      statusObserver.observe(statusMessage,{childList:true,characterData:true,subtree:true});observers.push(statusObserver);
    }
  }
  listen(form,'submit',event=>{
    event.preventDefault();event.stopPropagation();
    const value=String(input.value||'').trim().slice(0,4000);if(!value){input.focus();return;}
    try{
      const opener=openDraft||win.__auroraOpenPanel;
      if(typeof opener!=='function'){setText(note,'Draft space is unavailable. Your text is still here.');return;}
      opener('chat');
      const target=root.querySelector('#ah-draft-input');
      if(!target){setText(note,'Draft space is unavailable. Your text is still here.');return;}
      target.value=value;target.dispatchEvent(new win.Event('input',{bubbles:true}));target.focus({preventScroll:true});
      setText(note,'Draft opened locally. Review it before sending.');
      desktopUpdate('Your draft is ready to review. Nothing has been sent.','success');
    }catch{setText(note,'Draft space could not open. Your text is still here.');}
  });
  const cleanup=()=>{
    if(disposed)return;disposed=true;win.clearTimeout(expiryTimer);expiryTimer=0;
    for(const stop of cleanups)stop();for(const observer of observers)observer.disconnect();
    presence.remove();panel?.remove();root.classList.remove('ap-enabled');delete root.dataset.aiState;delete root.dataset.aiMotion;root.style.removeProperty('--ap-energy');
    entries.length=0;assistantStatus=null;activity=null;instances.delete(root);
  };
  instances.set(root,cleanup);render();return cleanup;
}
