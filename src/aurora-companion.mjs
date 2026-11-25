// A companion behaviour layer for Aurora's existing Sun, presence and notifications.
// No second character, microphone access, generated work or persistent activity log.
import {normaliseAssistantStatus} from './aurora-presence.mjs';

const instances=new WeakMap();
const clean=(value,limit=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit):'';
const displaySource=value=>value==='voice-session'?'Voice session':value==='assistant-voice'?'Assistant voice':value;
const VOICE_SOURCES=new Set(['Voice session','Assistant voice']);
const PROTECTED=new Set(['working','listening','speaking','playback','error','notification']);
const MOTION=new Set(['full','reduced','off']);
let menuSequence=0;

/** Presence has already validated freshness. Keep its playback and voice provenance. */
export function companionState({presence={},motion='full',paused=false,hidden=false,away=false,interacting=false}={}){
  const mode=MOTION.has(motion)?motion:'reduced';
  if(away)return{state:'notification',label:'Delivering a notification',message:'The Sun is carrying a Windows notification.',source:'Windows notifications',motion:mode};
  if(hidden||paused)return{state:'resting',label:'Out of view',message:'Visual activity pauses while the desktop is hidden.',source:'Desktop visibility',motion:mode};
  const message=clean(presence.message),source=clean(presence.source,60)||'Desktop activity';
  if(presence.state==='error')return{state:'error',label:'Needs attention',message:message||'An Aurora action needs attention.',source,motion:mode};
  if(presence.state==='listening'&&source==='Voice session')return{state:'listening',label:'Listening',message,source,motion:mode};
  if(presence.state==='speaking'&&VOICE_SOURCES.has(source))return{state:'speaking',label:'Speaking',message,source,motion:mode};
  if(presence.state==='speaking'&&source==='Windows playback')return{state:'playback',label:'Audio playing',message:'The Sun is responding to your PC audio.',source,motion:mode};
  if(presence.state==='working')return{state:'working',label:'Working',message:message||'A desktop action is in progress.',source,motion:mode};
  if(mode==='off')return{state:'resting',label:'Resting',message:'Motion is off. Live notifications remain available.',source:'Desktop setting',motion:mode};
  return{state:interacting?'awake':'idle',label:interacting?'Awake':'Ready',message:message||'Ready when you are.',source,motion:mode};
}

export function initAuroraCompanion({root,now=()=>Date.now(),openNotifications}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,stage=root.querySelector('.ah-core-stage');
  const core=stage?.querySelector('.ah-companion'),presence=stage?.querySelector('.ap-presence'),chip=presence?.querySelector('.ap-state-chip');
  if(!win||!stage||!core||!presence||!chip)return()=>{};
  const message=presence.querySelector('.ap-speech-message'),source=presence.querySelector('.ap-speech-source');
  const motionControl=root.querySelector('.ah-motion')||root.querySelector('#ah-motion-mode');
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const make=(tag,cls,value)=>{const node=doc.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=value;return node;};
  const button=(cls,label)=>{const node=make('button',cls+' cursor-interaction',label);node.type='button';return node;};
  const toggle=button('acp-toggle','⋯');toggle.setAttribute('aria-label','Sun companion controls');toggle.title='Sun companion controls · Right-click the Sun';toggle.setAttribute('aria-haspopup','dialog');toggle.setAttribute('aria-expanded','false');
  const menu=make('section','acp-menu');menu.id='aurora-companion-menu-'+(++menuSequence);menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Sun companion controls');toggle.setAttribute('aria-controls',menu.id);
  const heading=make('header','acp-heading'),title=make('strong','','Sun companion'),close=button('acp-close','×');close.setAttribute('aria-label','Close Sun companion controls');heading.append(title,close);
  const stateLabel=make('p','acp-state'),status=make('p','acp-status'),provenance=make('p','acp-source');
  const actions=make('div','acp-actions'),greet=button('acp-action','Greet Sun'),rest=button('acp-action','Rest'),bubble=button('acp-action','Hide status bubble'),notifications=button('acp-action','Notifications');
  actions.append(greet,rest,bubble,notifications);
  const feedback=make('p','acp-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  const recentHeading=make('h3','acp-recent-heading','Recent updates'),recent=make('ol','acp-recent');recent.setAttribute('aria-label','Recent Sun companion updates');recent.hidden=true;recentHeading.hidden=true;
  menu.append(heading,stateLabel,status,provenance,actions,feedback,recentHeading,recent);chip.append(toggle);presence.append(menu);root.classList.add('acp-enabled');

  let disposed=false,opened=false,reaction=false,reactionTimer=0,lastGreeting=-Infinity,lastStateKey='',lastPresenceKey='',lastRecentKey='';
  let previousMotion=root.dataset.motion==='reduced'?'reduced':'full',bubblesVisible=true;
  const entries=[],stops=[],observers=[];
  const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const listen=(target,type,fn,options)=>{target?.addEventListener(type,fn,options);stops.push(()=>target?.removeEventListener(type,fn,options));};
  const readPresence=()=>({state:root.dataset.aiState,message:message?.textContent,source:source?.textContent});
  const current=()=>companionState({presence:readPresence(),motion:root.dataset.motion,paused:root.dataset.paused==='true',hidden:Boolean(doc.hidden),away:root.dataset.notificationPresence==='away',interacting:reaction});
  function remember(value,origin,kind='info',at=now()){
    const body=clean(value),from=clean(origin,60)||'Desktop activity';if(!body||disposed)return;
    if(entries[0]?.message===body&&entries[0].source===from)return;
    entries.unshift({message:body,source:from,kind:['busy','error','success'].includes(kind)?kind:'info',at});entries.length=Math.min(entries.length,4);
  }
  function renderRecent(){
    if(!opened)return;const key=JSON.stringify(entries);if(key===lastRecentKey)return;lastRecentKey=key;
    recent.replaceChildren();recent.hidden=recentHeading.hidden=entries.length===0;
    for(const item of entries){const row=make('li','acp-update'),body=make('span','acp-update-message',item.message),meta=make('span','acp-update-source',item.source);row.dataset.kind=item.kind;row.append(body,meta);recent.append(row);}
  }
  function closeMenu(restoreFocus=false){
    opened=false;menu.hidden=true;toggle.setAttribute('aria-expanded','false');delete root.dataset.companionMenu;
    if(restoreFocus&&!disposed&&!doc.hidden&&root.dataset.notificationPresence!=='away')toggle.focus({preventScroll:true});
  }
  function render(){
    if(disposed)return;
    const value=current(),outOfView=doc.hidden||root.dataset.paused==='true'||root.dataset.notificationPresence==='away';
    if(outOfView){closeMenu();win.clearTimeout(reactionTimer);reactionTimer=0;reaction=false;delete root.dataset.companionReaction;}
    if(root.dataset.companionState!==value.state)root.dataset.companionState=value.state;
    setText(stateLabel,value.label);setText(status,value.message);setText(provenance,value.source);
    setText(rest,root.dataset.motion==='off'?'Resume motion':'Rest');rest.disabled=!motionControl;rest.setAttribute('aria-pressed',String(root.dataset.motion==='off'));
    setText(bubble,bubblesVisible?'Hide status bubble':'Show status bubble');bubble.setAttribute('aria-pressed',String(bubblesVisible));
    toggle.disabled=Boolean(outOfView);greet.disabled=Boolean(outOfView);
    const key=[value.state,value.motion,outOfView].join('|');
    if(key!==lastStateKey){lastStateKey=key;if(typeof win.CustomEvent==='function')root.dispatchEvent(new win.CustomEvent('aurora:companion-state',{detail:{state:value.state,motion:value.motion,away:root.dataset.notificationPresence==='away',hidden:Boolean(doc.hidden),at:now()}}));}
    const observed=clean(message?.textContent),from=clean(source?.textContent,60),presenceKey=observed+'|'+from;
    if(presenceKey!==lastPresenceKey){lastPresenceKey=presenceKey;if(PROTECTED.has(value.state)&&value.state!=='notification')remember(observed,from,value.state==='error'?'error':value.state==='working'?'busy':'info');}
    renderRecent();
  }
  function openMenu(){
    if(disposed||doc.hidden||root.dataset.paused==='true'||root.dataset.notificationPresence==='away')return;
    opened=true;menu.hidden=false;toggle.setAttribute('aria-expanded','true');root.dataset.companionMenu='open';feedback.textContent='';render();greet.focus({preventScroll:true});
  }
  function announce(value,kind='info'){
    const body=clean(value);if(!body||disposed||doc.hidden)return;
    setText(feedback,body);
    // A greeting or control acknowledgement cannot replace a real job or call.
    if(PROTECTED.has(current().state))return;
    if(typeof win.CustomEvent==='function')root.dispatchEvent(new win.CustomEvent('aurora:activity',{detail:{kind,message:body}}));
  }
  function react({greeting=false}={}){
    const value=current();if(disposed||doc.hidden||root.dataset.paused==='true'||value.state==='notification')return;
    if(root.dataset.motion!=='off'){
      reaction=true;root.dataset.companionReaction='warm';win.clearTimeout(reactionTimer);
      reactionTimer=win.setTimeout(()=>{reactionTimer=0;reaction=false;delete root.dataset.companionReaction;render();},900);
    }
    if(greeting&&now()-lastGreeting>=10000&&!PROTECTED.has(value.state)){
      lastGreeting=now();announce(root.dataset.motion==='off'?'Ready when you are. Motion is off.':'Ready when you are.');
    }
    render();
  }
  function setMotion(next){
    if(!motionControl||!MOTION.has(next)){setText(feedback,'Motion controls are unavailable.');return false;}
    motionControl.value=next;motionControl.dispatchEvent(new win.Event('change',{bubbles:true}));
    if(root.dataset.motion!==next){setText(feedback,'The motion setting could not be changed.');return false;}
    announce(next==='off'?'Motion is off. Live notifications remain available.':'Motion resumed.');render();return true;
  }
  const stopPointer=event=>event.stopPropagation();
  listen(toggle,'pointerdown',stopPointer);listen(menu,'pointerdown',stopPointer);listen(menu,'click',stopPointer);
  listen(toggle,'click',event=>{event.stopPropagation();if(opened)closeMenu();else openMenu();});
  listen(close,'click',()=>closeMenu(true));
  listen(greet,'click',()=>{lastGreeting=-Infinity;react({greeting:true});});
  listen(rest,'click',()=>{const mode=root.dataset.motion;if(mode!=='off'){previousMotion=mode==='reduced'?'reduced':'full';setMotion('off');}else setMotion(media?.matches?'reduced':previousMotion);});
  listen(bubble,'click',()=>{bubblesVisible=!bubblesVisible;if(bubblesVisible)delete root.dataset.companionBubbles;else root.dataset.companionBubbles='hidden';setText(feedback,bubblesVisible?'Status bubble shown.':'Status bubble hidden. Live notification pop-ups are unchanged.');render();});
  listen(notifications,'click',()=>{
    try{
      const opener=typeof openNotifications==='function'?openNotifications:()=>{if(typeof win.__auroraOpenPanel!=='function')throw new Error('unavailable');return win.__auroraOpenPanel('notifications');};
      const request=opener();remember('Notification history requested.','Desktop control');closeMenu();
      if(request?.catch)request.catch(()=>{if(!disposed){openMenu();setText(feedback,'Notification history is unavailable.');}});
    }catch{setText(feedback,'Notification history is unavailable.');}
  });
  listen(core,'pointerenter',()=>react({greeting:true}));listen(core,'focus',()=>react({greeting:true}));
  // The normal primary click remains owned by Aurora's existing ChatGPT action.
  listen(core,'click',()=>react());
  listen(core,'contextmenu',event=>{event.preventDefault();event.stopPropagation();openMenu();});
  listen(root,'keydown',event=>{if(opened&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);}});
  listen(doc,'pointerdown',event=>{if(opened&&!menu.contains(event.target)&&!toggle.contains(event.target))closeMenu();},{passive:true});
  listen(root,'aurora:activity',event=>{const detail=event.detail;if(detail&&['info','success','error','busy'].includes(detail.kind)){remember(detail.message,'Desktop activity',detail.kind);render();}});
  listen(root,'aurora:assistant-status',event=>{const value=normaliseAssistantStatus(event.detail,now());if(value){remember(value.message,displaySource(value.source),value.state==='error'?'error':value.state==='working'?'busy':'info',value.observedAt);render();}});
  listen(root,'aurora-playback-audio',render);listen(doc,'visibilitychange',render);listen(media,'change',render);listen(win,'pagehide',cleanup);
  if(win.MutationObserver){
    const stateObserver=new win.MutationObserver(render);stateObserver.observe(root,{attributes:true,attributeFilter:['data-ai-state','data-motion','data-paused','data-notification-presence']});observers.push(stateObserver);
    const presenceObserver=new win.MutationObserver(render);for(const node of [message,source])if(node)presenceObserver.observe(node,{childList:true,characterData:true,subtree:true});observers.push(presenceObserver);
  }
  function cleanup(){
    if(disposed)return;disposed=true;win.clearTimeout(reactionTimer);reactionTimer=0;
    for(const stop of stops)stop();for(const observer of observers)observer.disconnect();toggle.remove();menu.remove();root.classList.remove('acp-enabled');
    for(const key of ['companionState','companionReaction','companionMenu','companionBubbles'])delete root.dataset[key];entries.length=0;instances.delete(root);
  }
  instances.set(root,cleanup);render();return cleanup;
}
