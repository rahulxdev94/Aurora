const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
export const NOTIFICATION_STAR_HEADROOM=158;
/** Native coordinates are physical pixels; element bounds remain CSS pixels. */
export function notificationStarFrame(monitor,dock,headroom=NOTIFICATION_STAR_HEADROOM){
 const area=monitor.workArea||monitor,scale=dock.scale,top=area.position.y+Math.max(1,Math.round(18*scale));
 const extra=Math.max(0,Math.min(Math.round(headroom*scale),dock.y-top));
 return{...dock,y:dock.y-extra,height:dock.height+extra,headroom:extra/scale};
}
export function notificationPointerInside(point,frame,rectangles){
 if(!Array.isArray(point)||!point.every(Number.isFinite)||!frame||!(frame.scale>0))return false;
 const x=(point[0]-frame.x)/frame.scale,y=(point[1]-frame.y)/frame.scale;
 return rectangles.some(rect=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom);
}
export function createNotificationStars({root,onChange=()=>{}}){
 const doc=root.ownerDocument,win=doc.defaultView,waiting=new Map(),active=new Set();let disposed=false,running=false,epoch=0;
 const sky=doc.createElement('div');sky.className='ans-sky';sky.setAttribute('aria-hidden','true');root.append(sky);root.dataset.notificationEntry='stars';
 const motion=()=>root.dataset.motion==='full'&&root.dataset.paused!=='true'&&!win.matchMedia('(prefers-reduced-motion:reduce)').matches;
 function restore(card,state){delete card.dataset.starEntry;card.inert=state.inert;waiting.delete(card);}
 function prepare(){for(const card of root.querySelectorAll('.anot-live-popup'))if(!waiting.has(card)&&!card.dataset.starSeen){const state={inert:card.inert};card.dataset.starSeen='true';card.dataset.starEntry='pending';waiting.set(card,state);}onChange();}
 function finish(){epoch++;for(const animation of active)try{animation.finish();}catch{}active.clear();sky.replaceChildren();for(const [card,state]of waiting)restore(card,state);root.dataset.starPhase='idle';onChange();}
 async function animate(element,frames,options){const animation=element.animate(frames,options);active.add(animation);let timer;try{await Promise.race([animation.finished.catch(()=>{}),new Promise(resolve=>{timer=win.setTimeout(resolve,(options.delay||0)+options.duration+150);})]);}finally{win.clearTimeout(timer);active.delete(animation);animation.cancel();}}
 async function reveal(){
  if(disposed||running)return;prepare();const batch=[...waiting].filter(([card])=>card.isConnected);for(const [card,state]of waiting)if(!card.isConnected)restore(card,state);if(!batch.length)return;
  if(!motion()||root.clientHeight<140||typeof sky.animate!=='function'){finish();return;}
  running=true;const token=++epoch;root.dataset.starPhase='descent';
  try{
   const stack=root.querySelector('.anot-live-stack'),bounds=stack.getBoundingClientRect(),host=root.getBoundingClientRect();
   const x=clamp(bounds.left-host.left+bounds.width*.65,30,root.clientWidth-30),y=Math.max(24,bounds.top-host.top-13),travel=Math.min(NOTIFICATION_STAR_HEADROOM-20,y-10);
   if(travel<38){finish();return;}
   const paths=[[-110,-4,0,680],[-38,-28,80,720],[62,-15,145,660],[122,8,40,760]];
   await Promise.all(paths.map(([spread,altitude,delay,duration],index)=>{const star=doc.createElement('i');star.className='ans-star';star.dataset.star=String(index);sky.append(star);const startX=clamp(x+spread,16,root.clientWidth-16),startY=Math.max(7,y-travel+altitude);return animate(star,[{opacity:0,transform:`translate3d(${startX}px,${startY}px,0) scale(.35) rotate(-18deg)`},{offset:.13,opacity:.9},{offset:.72,opacity:1,transform:`translate3d(${x+spread*.15}px,${y-25}px,0) scale(1) rotate(18deg)`},{opacity:0,transform:`translate3d(${x}px,${y}px,0) scale(.12) rotate(65deg)`}],{duration,delay,easing:'cubic-bezier(.24,.55,.24,1)',fill:'both'});}));
   if(disposed||token!==epoch)return;root.dataset.starPhase='converge';sky.replaceChildren();const flash=doc.createElement('i');flash.className='ans-convergence';flash.style.left=x+'px';flash.style.top=y+'px';sky.append(flash);
   await animate(flash,[{opacity:.9,transform:'translate(-50%,-50%) scale(.25)'},{opacity:0,transform:'translate(-50%,-50%) scale(1.4)'}],{duration:180,easing:'ease-out',fill:'both'});
   if(disposed||token!==epoch)return;root.dataset.starPhase='reveal';
   await Promise.all(batch.map(([card])=>{card.dataset.starEntry='revealing';return animate(card,[{opacity:0,transform:'translateY(-9px) scale(.965)',clipPath:'inset(0 20% 92% 20% round 18px)'},{opacity:1,transform:'translateY(0) scale(1)',clipPath:'inset(0 0 0 0 round 16px)'}],{duration:280,easing:'cubic-bezier(.16,.7,.2,1)',fill:'both'});}));
  }finally{for(const [card,state]of batch)if(waiting.has(card))restore(card,state);sky.replaceChildren();running=false;root.dataset.starPhase='idle';onChange();}
 }
 const observer=new win.MutationObserver(()=>{if(!motion())finish();});observer.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});
 const media=win.matchMedia('(prefers-reduced-motion:reduce)'),changed=()=>{if(media.matches)finish();};media.addEventListener('change',changed);
 const focused=event=>{if(event.target.closest?.('.anot-live-popup[data-star-entry]'))finish();};root.addEventListener('focusin',focused);
 return{prepare,reveal,finish,hasPending:()=>[...waiting.keys()].some(card=>card.isConnected),interactiveRects:()=>[...root.querySelectorAll('.anot-live-popup')].filter(card=>!card.inert&&!card.dataset.starEntry&&card.isConnected).map(card=>card.getBoundingClientRect()),dispose(){disposed=true;finish();observer.disconnect();media.removeEventListener('change',changed);root.removeEventListener('focusin',focused);sky.remove();},get state(){return{running,pending:waiting.size,stars:sky.children.length,phase:root.dataset.starPhase};}};
}
