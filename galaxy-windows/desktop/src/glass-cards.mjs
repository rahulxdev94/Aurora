const instances=new WeakMap(),selector='.ag-detail,.adt-dialog,.ah-window';
export function initGlassCards({root}={}){
 if(!root?.ownerDocument?.defaultView)return{dispose(){},get state(){return{mounted:false};}};
 if(instances.has(root))return instances.get(root);
 const doc=root.ownerDocument,win=doc.defaultView,abort=new win.AbortController(),marked=new Map();
 const media={transparency:win.matchMedia('(prefers-reduced-transparency:reduce)'),contrast:win.matchMedia('(prefers-contrast:more)'),forced:win.matchMedia('(forced-colors:active)'),motion:win.matchMedia('(prefers-reduced-motion:reduce)')};
 const previous=new Map(['data-galaxy-widget-glass','data-galaxy-glass-surface','data-galaxy-glass-motion','data-galaxy-glass-cards'].map(key=>[key,root.getAttribute(key)]));
 let active=null,timer=0,disposed=false;
 function clear(){if(timer)win.clearTimeout(timer);timer=0;if(active)active.card.removeAttribute('data-galaxy-glass-pressed');active=null;}
 function policy(){
  if(disposed)return;const surface=media.forced.matches?'contrast':media.transparency.matches||media.contrast.matches?'solid':'glass';
  root.dataset.galaxyWidgetGlass='v1';root.dataset.galaxyGlassSurface=surface;root.dataset.galaxyGlassMotion=media.motion.matches||root.dataset.motion!=='full'||root.dataset.paused==='true'?'static':'responsive';
  if(surface!=='glass')clear();
 }
 function mark(node){if(!(node instanceof win.Element))return;const cards=[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)];let changed=false;for(const card of cards)if(!marked.has(card)){marked.set(card,card.getAttribute('data-galaxy-glass-card'));card.setAttribute('data-galaxy-glass-card','v1');changed=true;}if(changed)root.dataset.galaxyGlassCards=String(marked.size);}
 function press(card,id){clear();if(root.dataset.galaxyGlassSurface!=='glass'||!card?.isConnected||card.hidden||card.closest('[hidden],[inert]'))return;active={card,id};card.dataset.galaxyGlassPressed='true';timer=win.setTimeout(clear,520);}
 function pointerDown(event){if(event.isPrimary===false||event.button!==0){clear();return;}const card=event.target.closest?.(selector);if(card&&root.contains(card))press(card,event.pointerId);}
 function pointerUp(event){if(active?.id===event.pointerId)clear();}
 function keyDown(event){if(event.repeat||!['Enter',' ','Spacebar'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;const control=event.target.closest?.('button,a[href],input[type=button],input[type=checkbox],input[type=radio],[role=button]'),card=control?.closest(selector);if(card&&root.contains(card)&&!control.disabled&&control.getAttribute('aria-disabled')!=='true')press(card,'key:'+event.key);}
 function keyUp(event){if(active?.id==='key:'+event.key)clear();}
 const listen=(node,type,fn)=>node.addEventListener(type,fn,{capture:true,passive:true,signal:abort.signal});
 listen(doc,'pointerdown',pointerDown);listen(doc,'pointerup',pointerUp);listen(doc,'pointercancel',clear);listen(doc,'lostpointercapture',clear);listen(doc,'keydown',keyDown);listen(doc,'keyup',keyUp);listen(win,'blur',clear);listen(doc,'visibilitychange',()=>{if(doc.hidden)clear();});
 const observer=new win.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)mark(node);if(active&&!active.card.isConnected)clear();});observer.observe(root,{childList:true,subtree:true});
 const policyObserver=new win.MutationObserver(policy);policyObserver.observe(root,{attributes:true,attributeFilter:['data-motion','data-paused']});
 for(const query of Object.values(media))query.addEventListener('change',policy);
 mark(root);policy();
 const controller={get state(){const style=win.getComputedStyle(root),card=root.querySelector('.ag-detail[data-galaxy-glass-card]')||root.querySelector('[data-galaxy-glass-card]');return{mounted:!disposed,version:'v1',surface:root.dataset.galaxyGlassSurface,normalAlpha:Number.parseFloat(style.getPropertyValue('--galaxy-glass-alpha')),pressAlpha:Number.parseFloat(style.getPropertyValue('--galaxy-glass-press-alpha')),fill:style.getPropertyValue('--galaxy-glass-fill').trim(),sample:card?win.getComputedStyle(card,'::before').backgroundColor:null,sampleKind:card?.classList.contains('ag-detail')?'ag-detail':'dialog',motion:root.dataset.galaxyGlassMotion,pressed:Boolean(active)};},dispose(){if(disposed)return;disposed=true;clear();abort.abort();observer.disconnect();policyObserver.disconnect();for(const query of Object.values(media))query.removeEventListener('change',policy);for(const [card,value]of marked){if(value===null)card.removeAttribute('data-galaxy-glass-card');else card.setAttribute('data-galaxy-glass-card',value);}for(const [key,value]of previous){if(value===null)root.removeAttribute(key);else root.setAttribute(key,value);}instances.delete(root);}};
 listen(win,'pagehide',()=>controller.dispose());instances.set(root,controller);return controller;
}
