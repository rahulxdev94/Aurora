/* Animates Aurora's own DOM panels only. Native Windows opening effects are unchanged. */
const activeRoots=new WeakMap();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const goodRect=rect=>rect&&['left','top','width','height'].every(key=>Number.isFinite(rect[key]))&&rect.width>0&&rect.height>0;
const centre=rect=>({x:rect.left+rect.width/2,y:rect.top+rect.height/2});

export function launchMotion({motion='full',reduced=false,paused=false,hidden=false}={}){
  if(motion==='off'||paused||hidden)return'off';
  return motion==='reduced'||reduced?'reduced':'full';
}

export function buildLaunchAnimation({coreRect,panelRect,rootRect,mode='full',scaleX=1,scaleY=1,opacity=1,baseTransform='none',baseFilter='none'}={}){
  if(mode==='off'||!goodRect(panelRect))return null;
  const alpha=Number.isFinite(opacity)?clamp(opacity,0,1):1;
  // Preserve any independently supplied panel transform rather than replacing it.
  if(mode==='reduced'||!goodRect(coreRect)||!goodRect(rootRect)||(baseTransform&&baseTransform!=='none')){
    return{keyframes:[{opacity:alpha*.65},{opacity:alpha}],options:{duration:mode==='reduced'?110:140,easing:'ease-out',fill:'both'}};
  }
  const source=centre(coreRect),target=centre(panelRect);
  const sx=Number.isFinite(scaleX)&&scaleX>0?scaleX:1,sy=Number.isFinite(scaleY)&&scaleY>0?scaleY:1;
  const dx=(source.x-target.x)/sx,dy=(source.y-target.y)/sy;
  const initialScale=clamp(Math.min(coreRect.width/panelRect.width,coreRect.height/panelRect.height)*.75,.12,.25);
  const tiltX=clamp(-dy/(rootRect.height/sy)*7,-3.5,3.5),tiltY=clamp(dx/(rootRect.width/sx)*8,-5,5);
  const duration=Math.round(380+Math.min(80,Math.hypot(dx*sx,dy*sy)/Math.hypot(rootRect.width,rootRect.height)*110));
  const filter=baseFilter&&baseFilter!=='none'?baseFilter+' ':'';
  const transform=(x,y,scale,rx,ry)=>`translate3d(${x.toFixed(3)}px,${y.toFixed(3)}px,0) perspective(1000px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
  return{
    keyframes:[
      {offset:0,transform:transform(dx,dy,initialScale,tiltX,tiltY),opacity:alpha*.12,filter:filter+'blur(2.5px)'},
      {offset:.76,transform:transform(dx*.018,dy*.018,.98,tiltX*.06,tiltY*.06),opacity:alpha,filter:filter+'blur(0px)'},
      {offset:1,transform:'none',opacity:alpha,filter:baseFilter||'none'}
    ],
    options:{duration,easing:'cubic-bezier(.2,.78,.2,1)',fill:'both'}
  };
}

export function isExternalLaunch(control){
  if(!control)return false;
  if(control.dataset?.folder!==undefined)return /^\d+$/.test(control.dataset.folder)&&Number(control.dataset.folder)<8;
  if(['YouTube','Netflix','Gmail','Outlook','Downloads','ChatGPT','Projects'].includes(control.dataset?.app))return true;
  if(control.dataset?.action==='chat'||control.dataset?.command==='open-projects')return true;
  return ['data-native-chat','data-native-draft','data-native-explorer'].some(name=>control.hasAttribute?.(name));
}

export function initWindowLaunch({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(activeRoots.has(root))return activeRoots.get(root);
  const doc=root.ownerDocument,win=doc.defaultView;
  if(!win?.MutationObserver||!win.requestAnimationFrame)return()=>{};
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const oldFlag=root.getAttribute('data-window-launch');
  const records=[['.ah-window-layer','.ah-window'],['.ac-layer','.ac-window']].flatMap(([layerSelector,panelSelector])=>{
    const layer=root.querySelector(layerSelector),panel=root.querySelector(panelSelector);
    return layer&&panel?[{layer,panel,hidden:layer.hidden,frame:0,animation:null}]:[];
  });
  let disposed=false,pulse=null,lastPulse=-Infinity;
  root.setAttribute('data-window-launch','on');
  const mode=()=>launchMotion({motion:root.dataset.motion,reduced:Boolean(media?.matches),paused:root.dataset.paused==='true',hidden:doc.hidden});
  const core=()=>root.querySelector('.ah-core-stage .ah-companion');

  function stopRecord(record){
    if(record.frame){win.cancelAnimationFrame(record.frame);record.frame=0;}
    if(record.animation){const animation=record.animation;record.animation=null;animation.onfinish=null;animation.oncancel=null;animation.cancel();}
  }
  function stopPulse(){
    if(!pulse)return;
    const current=pulse;pulse=null;
    if(current.animation){current.animation.onfinish=null;current.animation.oncancel=null;current.animation.cancel();}
    current.element.remove();
  }
  const settleAll=()=>{records.forEach(stopRecord);stopPulse();};
  function open(record){
    stopRecord(record);
    if(disposed||mode()==='off'||typeof record.panel.animate!=='function')return;
    // The existing window-positioning observer queues its own RAF first. Measuring
    // here uses the final snapped/clamped geometry without changing left/top/size.
    record.frame=win.requestAnimationFrame(()=>{
      record.frame=0;
      if(disposed||record.layer.hidden||mode()==='off')return;
      // Defensive fallback if the native CSS override has not loaded yet.
      for(const animation of record.panel.getAnimations?.()||[])if(animation.animationName==='ah-window-in')animation.cancel();
      const rootRect=root.getBoundingClientRect(),panelRect=record.panel.getBoundingClientRect(),coreRect=core()?.getBoundingClientRect();
      const computed=win.getComputedStyle(record.panel);
      const spec=buildLaunchAnimation({coreRect,panelRect,rootRect,mode:mode(),scaleX:rootRect.width/(root.offsetWidth||rootRect.width),scaleY:rootRect.height/(root.offsetHeight||rootRect.height),opacity:Number.parseFloat(computed.opacity),baseTransform:computed.transform,baseFilter:computed.filter});
      if(!spec)return;
      try{
        const animation=record.panel.animate(spec.keyframes,spec.options);record.animation=animation;
        const finish=()=>{if(record.animation!==animation)return;record.animation=null;animation.onfinish=null;animation.oncancel=null;animation.cancel();};
        animation.onfinish=finish;animation.oncancel=()=>{if(record.animation===animation)record.animation=null;};
      }catch{record.animation=null;}
    });
  }
  const observer=new win.MutationObserver(mutations=>{
    if(disposed)return;
    for(const mutation of mutations){
      if(mutation.target===root){if(mode()!=='full')settleAll();continue;}
      const record=records.find(item=>item.layer===mutation.target);
      if(!record||record.hidden===record.layer.hidden)continue;
      record.hidden=record.layer.hidden;
      if(record.hidden)stopRecord(record);else open(record);
    }
  });
  records.forEach(record=>observer.observe(record.layer,{attributes:true,attributeFilter:['hidden']}));
  observer.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});

  function launchPulse(){
    if(disposed||mode()!=='full'||pulse)return;
    const now=win.performance?.now?.()??Date.now();if(now-lastPulse<600)return;
    const button=core(),rect=button?.getBoundingClientRect(),rootRect=root.getBoundingClientRect();
    if(!goodRect(rect)||!goodRect(rootRect))return;
    const element=doc.createElement('span');if(typeof element.animate!=='function')return;
    element.className='ah-launch-pulse';element.setAttribute('aria-hidden','true');
    const sx=rootRect.width/(root.offsetWidth||rootRect.width),sy=rootRect.height/(root.offsetHeight||rootRect.height);
    const width=rect.width/sx*.65,height=rect.height/sy*.65,point=centre(rect);
    element.style.left=((point.x-rootRect.left)/sx-root.clientLeft+root.scrollLeft-width/2)+'px';
    element.style.top=((point.y-rootRect.top)/sy-root.clientTop+root.scrollTop-height/2)+'px';
    element.style.width=width+'px';element.style.height=height+'px';
    root.append(element);lastPulse=now;
    try{
      const animation=element.animate([{transform:'scale(.92)',opacity:.18},{transform:'scale(1.28)',opacity:0}],{duration:360,easing:'ease-out',fill:'both'});
      pulse={element,animation};animation.onfinish=stopPulse;animation.oncancel=()=>{if(pulse?.animation===animation){pulse=null;element.remove();}};
    }catch{element.remove();}
  }
  const onClick=event=>{const control=event.target?.closest?.('button');if(control&&root.contains(control)&&isExternalLaunch(control))launchPulse();};
  const onInteraction=event=>{for(const record of records)if(record.panel.contains(event.target))stopRecord(record);};
  const onVisibility=()=>{if(doc.hidden)settleAll();};
  const onMotionChange=()=>{if(mode()!=='full')settleAll();};
  root.addEventListener('click',onClick,true);
  root.addEventListener('pointerdown',onInteraction,true);
  root.addEventListener('keydown',onInteraction,true);
  doc.addEventListener('visibilitychange',onVisibility);
  win.addEventListener('resize',settleAll);
  media?.addEventListener?.('change',onMotionChange);

  function cleanup(){
    if(disposed)return;disposed=true;
    observer.disconnect();settleAll();
    root.removeEventListener('click',onClick,true);root.removeEventListener('pointerdown',onInteraction,true);root.removeEventListener('keydown',onInteraction,true);
    doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('resize',settleAll);win.removeEventListener('pagehide',cleanup);
    media?.removeEventListener?.('change',onMotionChange);
    if(root.getAttribute('data-window-launch')==='on'){if(oldFlag===null)root.removeAttribute('data-window-launch');else root.setAttribute('data-window-launch',oldFlag);}
    activeRoots.delete(root);
  }
  win.addEventListener('pagehide',cleanup,{once:true});activeRoots.set(root,cleanup);
  return cleanup;
}
