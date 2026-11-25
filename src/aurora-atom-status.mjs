// A transient view of actual Aurora activity. No chat access, query history or storage.
const instances=new WeakMap();
const KINDS=new Set(['info','success','error','busy']);
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,108):'';
const clamp=(value,min,max)=>Math.min(Math.max(min,value),Math.max(min,max));
const overlap=(a,b)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));

/** Keep the speech bubble inside the atom's stage and prefer space beside controls. */
export function atomStatusPlacement({width,height,core,bubbleWidth=224,bubbleHeight=76,obstacles=[]}){
  const margin=8,w=Math.max(1,Math.min(bubbleWidth,width-margin*2)),h=Math.max(1,Math.min(bubbleHeight,height-margin*2));
  const c=core||{left:width*.4,top:height*.3,width:width*.2,height:height*.35};
  const cx=c.left+c.width/2,cy=c.top+c.height/2;
  const candidates=[
    [c.left+c.width+12,c.top-12],[c.left+c.width+12,cy],
    [c.left-w-12,c.top-12],[c.left-w-12,cy],
    [cx+18,c.top+c.height+10],[cx-w-18,c.top+c.height+10],
    [cx-w/2,c.top-h-12],[cx-w/2,c.top+c.height+12],
    [width-w-margin,height-h-margin],[margin,height-h-margin],
    [width-w-margin,margin],[margin,margin]
  ].map(([left,top],index)=>{
    const rect={left:clamp(left,margin,width-w-margin),top:clamp(top,margin,height-h-margin),width:w,height:h};
    const score=overlap(rect,c)*8+obstacles.reduce((sum,item)=>sum+overlap(rect,item)*3,0)+index;
    return{...rect,score};
  }).sort((a,b)=>a.score-b.score);
  const chosen=candidates[0];
  return{left:Math.round(chosen.left),top:Math.round(chosen.top),width:Math.round(w),maxHeight:Math.round(h),side:chosen.left+w/2<cx?'left':'right'};
}

export function initAtomStatus({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const stage=root.querySelector('.ah-core-stage'),core=stage?.querySelector('.ah-companion');
  if(!stage||!core)return()=>{};
  const doc=root.ownerDocument,win=doc.defaultView;
  const make=(tag,cls,value)=>{const element=doc.createElement(tag);element.className=cls;if(value!==undefined)element.textContent=value;return element;};
  const bubble=make('aside','aas-bubble');bubble.hidden=true;bubble.setAttribute('aria-label','Aurora activity');
  const header=make('div','aas-header'),brand=make('span','aas-brand','Aurora'),dismiss=make('button','aas-dismiss cursor-interaction','×');
  dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss Aurora status');
  header.append(brand,dismiss);
  const message=make('p','aas-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.setAttribute('aria-atomic','true');
  bubble.append(header,message);
  const toggle=make('button','aas-toggle cursor-interaction');toggle.type='button';toggle.setAttribute('aria-label','Aurora status');toggle.title='Aurora status';toggle.setAttribute('aria-expanded','false');
  const dot=make('span','aas-dot');dot.setAttribute('aria-hidden','true');toggle.append(dot);
  stage.append(bubble,toggle);
  let disposed=false,visible=false,current=null,lastMessage={message:'Your space is ready.',kind:'info'},focusPhase='',timeout=0,startup=0,frame=0,weatherMount=null;
  let expiresAt=0,priority=0,dismissed=false,weatherStatus=null,weatherRefresh=null,lastWeather='',wasWeatherBusy=false,hasFileReady=false;
  const fileStates=new Map(),observers=[],cleanups=[];
  const listen=(target,event,fn,options)=>{target?.addEventListener(event,fn,options);cleanups.push(()=>target?.removeEventListener(event,fn,options));};
  const observe=(target,fn,options)=>{if(!target||!win.MutationObserver)return null;const observer=new win.MutationObserver(fn);observer.observe(target,options);observers.push(observer);return observer;};
  const now=()=>Date.now();
  function geometry(){
    frame=0;if(disposed||!root.isConnected)return;
    const bounds=stage.getBoundingClientRect(),centre=core.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    const rect=element=>{const item=element.getBoundingClientRect();return{left:item.left-bounds.left,top:item.top-bounds.top,width:item.width,height:item.height};};
    const coreRect={left:centre.left-bounds.left,top:centre.top-bounds.top,width:centre.width,height:centre.height};
    const obstacles=[...stage.querySelectorAll('.ah-satellite,.ah-core-caption')].filter(element=>element.getClientRects().length).map(rect);
    const measured=bubble.getBoundingClientRect();
    const placement=atomStatusPlacement({width:bounds.width,height:bounds.height,core:coreRect,bubbleWidth:Math.min(224,bounds.width-16),bubbleHeight:Math.max(70,measured.height||76),obstacles});
    bubble.style.setProperty('--aas-left',placement.left+'px');bubble.style.setProperty('--aas-top',placement.top+'px');bubble.style.setProperty('--aas-width',placement.width+'px');bubble.style.setProperty('--aas-max-height',(bounds.height-16)+'px');bubble.dataset.side=placement.side;
    // Place the status control beside the lower left of the core, outside its click target.
    toggle.style.setProperty('--aas-toggle-left',clamp(coreRect.left-30,8,bounds.width-32)+'px');
    toggle.style.setProperty('--aas-toggle-top',clamp(coreRect.top+coreRect.height-17,8,bounds.height-32)+'px');
  }
  function scheduleGeometry(){if(!frame&&!disposed)frame=win.requestAnimationFrame(geometry);}
  function hide(){
    clearTimeout(timeout);timeout=0;visible=false;bubble.hidden=true;toggle.hidden=false;toggle.setAttribute('aria-expanded','false');priority=0;expiresAt=0;
  }
  function render(entry){
    if(disposed)return;current=entry;lastMessage={message:entry.message,kind:entry.kind};
    if(message.textContent!==entry.message)message.textContent=entry.message;
    bubble.dataset.kind=entry.kind;toggle.dataset.kind=entry.kind;bubble.hidden=false;toggle.hidden=true;visible=true;toggle.setAttribute('aria-expanded','true');scheduleGeometry();
  }
  function base(){return focusPhase==='Focusing'?{message:'Your focus timer is running.',kind:'busy'}:{message:'Your space is ready.',kind:'info'};}
  function publish(value,{kind='info',level=2,duration=7000,persistent=false}={}){
    const valueText=text(value);if(disposed||!valueText||doc.hidden)return false;
    if(visible&&(expiresAt===0||expiresAt>now())&&level<priority)return false;
    if(current?.message===valueText&&visible)return false;
    clearTimeout(timeout);priority=level;expiresAt=persistent?0:now()+duration;dismissed=false;
    render({message:valueText,kind:KINDS.has(kind)?kind:'info'});
    if(!persistent)timeout=setTimeout(()=>{timeout=0;hide();if(focusPhase==='Focusing'&&!dismissed){priority=1;render(base());}},duration);
    return true;
  }
  function reveal(){
    if(disposed||doc.hidden)return;dismissed=false;
    const entry=focusPhase==='Focusing'&&(!visible||expiresAt<=now())?base():lastMessage;
    clearTimeout(timeout);render(entry);priority=1;expiresAt=now()+7000;
    timeout=setTimeout(()=>{timeout=0;hide();},7000);
  }
  const stopPointer=event=>event.stopPropagation();
  listen(bubble,'pointerdown',stopPointer);listen(bubble,'click',stopPointer);
  listen(toggle,'pointerdown',stopPointer);
  listen(toggle,'click',event=>{event.stopPropagation();if(visible){dismissed=true;hide();}else reveal();});
  listen(dismiss,'click',event=>{event.stopPropagation();dismissed=true;hide();toggle.focus({preventScroll:true});});
  listen(core,'pointerenter',()=>{if(!dismissed&&!visible)reveal();});
  listen(core,'focus',()=>{if(!dismissed&&!visible)reveal();});
  const focusLabel=root.querySelector('.ah-timer-label');
  function syncFocus(){
    const next=text(focusLabel?.textContent);if(next===focusPhase)return;
    const before=focusPhase;focusPhase=next;
    if(next==='Focusing')publish('Your focus timer is running.',{kind:'busy',level:2,persistent:true});
    else if(next==='Paused')publish('Your focus timer is paused.',{level:2});
    else if(next==='Complete')publish('Focus session complete. Time for a break.',{kind:'success',level:3});
    else if(before&&next==='Ready')publish('Your focus timer is ready.',{level:1});
  }
  observe(focusLabel,syncFocus,{childList:true,characterData:true,subtree:true});syncFocus();
  const toast=root.querySelector('.ah-toast');let lastToast='',lastToastAt=0;
  function syncToast(){
    const value=text(toast?.textContent);if(!value||(value===lastToast&&now()-lastToastAt<4000)||!toast.classList.contains('ah-show'))return;
    lastToast=value;lastToastAt=now();const error=/could not|unavailable|failed|error|not connected|not available/i.test(value);
    publish(value,{kind:error?'error':/^Opened |saved|complete|ready/i.test(value)?'success':'info',level:error?4:3,duration:error?10000:7000});
  }
  observe(toast,syncToast,{attributes:true,attributeFilter:['class'],childList:true,characterData:true,subtree:true});
  listen(root,'aurora:activity',event=>{
    const detail=event.detail;if(!detail||typeof detail.message!=='string')return;
    const kind=KINDS.has(detail.kind)?detail.kind:'info';
    const duration=Number.isFinite(detail.duration)?clamp(detail.duration,2000,15000):7000;
    publish(detail.message,{kind,level:kind==='error'?4:3,duration});
  });
  listen(root,'aurora:file-index-updated',event=>{
    const detail=event.detail;if(!detail||!['ready','waiting','error'].includes(detail.status)||typeof detail.folderType!=='string')return;
    const before=fileStates.get(detail.folderType);fileStates.set(detail.folderType,detail.status);if(before===detail.status)return;
    if(detail.status==='error')publish('A file location is unavailable. Search can use the last received index.',{kind:'error',level:1});
    else if(detail.status==='ready'&&!hasFileReady){hasFileReady=true;publish('Your indexed files are ready to explore.',{kind:'success',level:1});}
    else if(before==='error'&&![...fileStates.values()].includes('error'))publish('File index updates are available again.',{kind:'success',level:1});
  });
  function readWeather(){
    const value=text(weatherStatus?.textContent),busy=Boolean(weatherRefresh?.disabled)&&value!=='Weather disabled';
    if(busy&&!wasWeatherBusy)publish('Refreshing the weather.',{kind:'busy',level:1,duration:12000});
    if(!busy&&(value!==lastWeather||wasWeatherBusy)){
      if(/^Now\b/.test(value))publish('The latest weather is ready.',{kind:'success',level:1});
      else if(/stale|unavailable/i.test(value))publish('Weather could not refresh. Check the weather card for its last update.',{kind:'error',level:1});
    }
    lastWeather=value;
    wasWeatherBusy=busy;
  }
  function mountWeather(){
    if(weatherStatus||disposed)return;
    weatherStatus=root.querySelector('.ah-live-weather-status');if(!weatherStatus)return;
    weatherRefresh=root.querySelector('[data-live-weather-refresh]');
    weatherMount?.disconnect();
    observe(weatherStatus,readWeather,{childList:true,characterData:true,subtree:true});
    observe(weatherRefresh,readWeather,{attributes:true,attributeFilter:['disabled']});readWeather();
  }
  mountWeather();if(!weatherStatus)weatherMount=observe(root.querySelector('.ah-weather'),mountWeather,{childList:true,subtree:true});
  listen(win,'resize',scheduleGeometry);
  listen(doc,'visibilitychange',()=>{if(doc.hidden)hide();else scheduleGeometry();});
  if(win.ResizeObserver){const resize=new win.ResizeObserver(scheduleGeometry);resize.observe(stage);resize.observe(core);observers.push(resize);}
  observe(root,scheduleGeometry,{attributes:true,attributeFilter:['data-workspace']});
  startup=setTimeout(()=>{startup=0;if(!current&&!dismissed)publish(base().message,{kind:base().kind,level:0});},900);
  scheduleGeometry();
  const cleanup=()=>{if(disposed)return;disposed=true;clearTimeout(timeout);clearTimeout(startup);if(frame)win.cancelAnimationFrame(frame);for(const observer of observers)observer.disconnect();for(const stop of cleanups)stop();bubble.remove();toggle.remove();instances.delete(root);};
  instances.set(root,cleanup);return cleanup;
}
