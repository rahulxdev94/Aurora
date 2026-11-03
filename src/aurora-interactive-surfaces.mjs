/* Input-driven decoration only. This module never launches, moves or focuses a control. */
const instances=new WeakMap();
const TARGET='.ah-folder,.afb-entry,.ah-app-tile,.ah-surface';
const STYLE=`
#aurora-home-preview .ais-lit{position:relative}
#aurora-home-preview .ais-light{position:absolute;inset:0;border-radius:inherit;pointer-events:none!important;user-select:none;z-index:1;background:radial-gradient(220px circle at var(--ais-x,50%) var(--ais-y,50%),#97e7ff26,transparent 75%);box-shadow:inset 0 0 0 1px #b2e4ff2e;contain:strict}
#aurora-home-preview .ah-folder>.ais-light,#aurora-home-preview .afb-entry>.ais-light,#aurora-home-preview .ah-app-tile>.ais-light{background:radial-gradient(145px circle at var(--ais-x,50%) var(--ais-y,50%),#a4eaff34,transparent 80%)}
#aurora-home-preview .ais-light[data-keyboard=true]{background:linear-gradient(125deg,#9ae8ff16,#bd9cff10);box-shadow:inset 0 0 0 1px #a9e7ff38}
@media(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference){
  #aurora-home-preview[data-motion="full"]:not([data-paused="true"]) .ah-surface[data-tilt]{transform:perspective(1000px) translateY(0) rotateX(clamp(-3.25deg,calc(var(--tilt-x,0deg)*1.3),3.25deg)) rotateY(clamp(-3.25deg,calc(var(--tilt-y,0deg)*1.3),3.25deg));transition:transform .32s cubic-bezier(.2,.75,.25,1),border-color .22s}
  #aurora-home-preview[data-motion="full"]:not([data-paused="true"]) .ah-surface[data-tilt]:hover{transform:perspective(1000px) translateY(-3px) rotateX(clamp(-3.25deg,calc(var(--tilt-x,0deg)*1.3),3.25deg)) rotateY(clamp(-3.25deg,calc(var(--tilt-y,0deg)*1.3),3.25deg));border-color:#a5d3ff6b;box-shadow:inset 0 1px 0 #d5f0ff12,0 14px 24px #03091e42}
}
#aurora-home-preview[data-paused="true"] .ah-surface[data-tilt]{transform:none!important}
`;

export function surfaceMotion({motion='full',reduced=false,paused=false,hidden=false}={}){
  if(motion==='off'||paused||hidden)return'off';
  return motion==='reduced'||reduced?'reduced':'full';
}
export function lightPosition(rect,x,y){
  if(!rect||!Number.isFinite(rect.width)||!Number.isFinite(rect.height)||rect.width<=0||rect.height<=0||!Number.isFinite(x)||!Number.isFinite(y))return{x:50,y:50};
  const clamp=value=>Math.max(0,Math.min(100,value));
  return{x:clamp((x-rect.left)/rect.width*100),y:clamp((y-rect.top)/rect.height*100)};
}

export function initInteractiveSurfaces({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView;
  if(!win?.requestAnimationFrame||!win.MutationObserver)return()=>{};
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const style=doc.createElement('style');style.textContent=STYLE;root.append(style);
  const active=new Map(),animations=new Set(),iconAnimations=new WeakMap(),lastHover=new WeakMap();
  let disposed=false,frame=0,pending=null,taskFrame=0;
  const pendingTasks=new Set();
  const mode=()=>surfaceMotion({motion:root.dataset.motion,reduced:Boolean(media?.matches),paused:root.dataset.paused==='true',hidden:doc.hidden});
  const targetFor=node=>{const el=node?.closest?.(TARGET);return el&&root.contains(el)?el:null;};
  const visible=node=>Boolean(node?.isConnected&&node.getClientRects().length&&!node.closest('[hidden]'));
  const iconFor=node=>node?.querySelector('.ah-folder-symbol,:scope > svg,.ah-section-head h2 > svg');
  function cancelAnimation(animation){
    if(!animation)return;
    animation.onfinish=null;animation.oncancel=null;animations.delete(animation);animation.cancel();
  }
  function animate(node,keyframes,options){
    if(mode()!=='full'||typeof node?.animate!=='function'||!visible(node))return null;
    while(animations.size>=6)cancelAnimation(animations.values().next().value);
    try{
      const animation=node.animate(keyframes,{...options,fill:'none'});animations.add(animation);
      animation.onfinish=()=>cancelAnimation(animation);animation.oncancel=()=>animations.delete(animation);
      return animation;
    }catch{return null;}
  }
  function iconFeedback(target,pressed=false){
    if(mode()!=='full')return;
    const icon=iconFor(target);if(!icon)return;
    const now=win.performance.now();if(!pressed&&now-(lastHover.get(icon)??-Infinity)<280)return;
    lastHover.set(icon,now);cancelAnimation(iconAnimations.get(icon));
    const base=win.getComputedStyle(icon).transform;
    const prefix=base&&base!=='none'?base+' ':'';
    const keyframes=pressed
      ?[{transform:prefix+'scale(.87)'},{transform:prefix+'scale(1)'}]
      :[{transform:prefix+'translateY(0) scale(1)'},{transform:prefix+'translateY(-3px) scale(1.10)',offset:.42},{transform:prefix+'translateY(0) scale(1)'}];
    const animation=animate(icon,keyframes,{duration:pressed?150:280,easing:'cubic-bezier(.2,.7,.25,1)'});
    if(animation)iconAnimations.set(icon,animation);
  }
  function removeLight(element){const record=active.get(element);if(!record)return;record.light.remove();if(!record.hadClass)element.classList.remove('ais-lit');active.delete(element);}
  function clearLights(){for(const element of [...active.keys()])removeLight(element);}
  function showLight(element,x,y,keyboard=false){
    if(!visible(element))return;
    let record=active.get(element);
    if(!record){const light=doc.createElement('span');light.className='ais-light';light.setAttribute('aria-hidden','true');record={light,hadClass:element.classList.contains('ais-lit')};element.classList.add('ais-lit');element.append(light);active.set(element,record);}
    const point=keyboard||mode()!=='full'?{x:50,y:50}:lightPosition(element.getBoundingClientRect(),x,y);
    record.light.style.setProperty('--ais-x',point.x.toFixed(2)+'%');record.light.style.setProperty('--ais-y',point.y.toFixed(2)+'%');
    record.light.dataset.keyboard=String(keyboard);
  }
  function paint(){
    frame=0;const input=pending;pending=null;
    if(disposed||mode()==='off'||!input||!visible(input.target)){clearLights();return;}
    const targets=[input.target],surface=input.target.closest('.ah-surface');
    if(surface&&surface!==input.target)targets.push(surface);
    for(const old of [...active.keys()])if(!targets.includes(old))removeLight(old);
    for(const target of targets)showLight(target,input.x,input.y,input.keyboard);
  }
  function queue(target,x=0,y=0,keyboard=false){pending={target,x,y,keyboard};if(!frame)frame=win.requestAnimationFrame(paint);}
  const move=event=>{if(event.pointerType==='touch'||mode()==='off')return;queue(targetFor(event.target),event.clientX,event.clientY);};
  const over=event=>{if(event.pointerType==='touch')return;const target=targetFor(event.target);if(target&&target!==targetFor(event.relatedTarget))iconFeedback(target);};
  const leave=()=>{pending=null;if(frame){win.cancelAnimationFrame(frame);frame=0;}clearLights();};
  const focus=event=>{const target=targetFor(event.target);queue(target,0,0,true);if(target)iconFeedback(target);};
  const blur=event=>{if(!root.contains(event.relatedTarget))leave();};
  const press=event=>{if(event.button!==undefined&&event.button!==0)return;const target=event.target?.closest?.('button');if(target&&root.contains(target))iconFeedback(target,true);};
  const key=event=>{if(event.repeat||!['Enter',' '].includes(event.key)||!event.target.matches?.('button'))return;press(event);};
  function taskChange(event){
    const checkbox=event.target;
    if(mode()!=='full'||!checkbox?.matches?.('input[type=checkbox][data-ac-check]')||!checkbox.checked||checkbox.closest('.ac-task-row')?.classList.contains('ac-done'))return;
    // Capture before the calendar's own change handler replaces its task rows.
    pendingTasks.add(checkbox.dataset.acCheck);
    if(taskFrame)return;
    taskFrame=win.requestAnimationFrame(()=>{
      taskFrame=0;const ids=new Set(pendingTasks);pendingTasks.clear();
      if(disposed||mode()!=='full')return;
      for(const input of root.querySelectorAll('input[type=checkbox][data-ac-check]')){
        if(!input.checked||!ids.has(input.dataset.acCheck))continue;
        const row=input.closest('.ac-task-row');if(!visible(row))continue;
        const background=win.getComputedStyle(row).backgroundColor;
        animate(row,[{backgroundColor:'#73e6cb30',boxShadow:'inset 2px 0 #9ff9df'},{backgroundColor:background,boxShadow:'inset 0 0 transparent'}],{duration:500,easing:'ease-out'});
      }
    });
  }
  function settle(){
    leave();if(taskFrame){win.cancelAnimationFrame(taskFrame);taskFrame=0;}pendingTasks.clear();
    for(const animation of [...animations])cancelAnimation(animation);
  }
  const observer=new win.MutationObserver(settle);observer.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});
  const listeners=[['pointermove',move],['pointerover',over],['pointerleave',leave],['pointerdown',press],['focusin',focus],['focusout',blur],['keydown',key],['change',taskChange,true],['scroll',leave,true]];
  for(const [name,handler,capture=false] of listeners)root.addEventListener(name,handler,capture);
  doc.addEventListener('visibilitychange',settle);win.addEventListener('resize',settle);media?.addEventListener?.('change',settle);
  function cleanup(){
    if(disposed)return;disposed=true;settle();observer.disconnect();
    for(const [name,handler,capture=false] of listeners)root.removeEventListener(name,handler,capture);
    doc.removeEventListener('visibilitychange',settle);win.removeEventListener('resize',settle);win.removeEventListener('pagehide',cleanup);media?.removeEventListener?.('change',settle);
    style.remove();instances.delete(root);
  }
  win.addEventListener('pagehide',cleanup,{once:true});instances.set(root,cleanup);return cleanup;
}
