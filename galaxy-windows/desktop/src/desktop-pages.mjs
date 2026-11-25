import {mountDesktopAi,chatLink} from './desktop-ai.mjs';
import {mountDesktopMedia} from './desktop-media.mjs';
import {config,CHATGPT_APP} from './config.mjs';
import {validateCompanionLaunchers} from './companion-launchers.mjs';

const ORDER=['media','home','ai'];
const TITLES={media:'Media',home:'Home',ai:'AI'};
const INTERACTIVE='button,a,textarea,input,select,summary,[contenteditable=true],[role=dialog],video,audio';
export function mountDesktopPages({root,invoke,subscribe,SeelenCommand,SeelenEvent}){
  const stage=root?.querySelector('.ag-stage');
  if(!stage)return()=>{};
  const doc=root.ownerDocument,win=doc.defaultView,abort=new win.AbortController();
  const listen=(node,event,fn,options={})=>node.addEventListener(event,fn,{...options,signal:abort.signal});
  const nav=doc.createElement('nav');nav.className='atlas-desktop-tabs';nav.setAttribute('aria-label','Desktop pages');
  const deck=doc.createElement('div');deck.className='atlas-desktop-deck';
  const pages={},buttons={},controllers={};let current='home',gesture=null,wheel=0,lastWheel=0,wheeled=false;
  const companions=validateCompanionLaunchers(config.launchers||{});
  const fixed=new Set([CHATGPT_APP,'https://chatgpt.com/',
    'https://chatgpt.com/dots','codex://dots',companions.scarlettUrl,companions.anchorUrl,
    companions.voiceHotkeyConfigured&&companions.voiceLauncher].filter(Boolean));
  async function launch(target){
    if(typeof target!=='string'||!target||target.length>2048)return false;
    let allowed=fixed.has(target)||!!chatLink(target);
    if(!allowed)try{
      const u=new URL(target);
      allowed=(u.protocol==='spotify:'&&!u.host&&!u.search&&!u.hash&&/^spotify:(?:(?:track|album|artist|playlist):[A-Za-z0-9]{22})?$/.test(target))||
        (u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.youtube.com','music.youtube.com','www.netflix.com','open.spotify.com','www.imdb.com'].includes(u.hostname));
    }catch{}
    if(!allowed)return false;
    try{await invoke(SeelenCommand.OpenFile,{path:target});return true;}catch{return false;}
  }
  for(const id of ORDER){
    const b=doc.createElement('button');b.type='button';b.className='atlas-page-tab cursor-interaction';
    b.textContent=TITLES[id];b.dataset.atlasTab=id;buttons[id]=b;nav.append(b);
    if(id!=='home'){
      const section=doc.createElement('section');section.className='atlas-desktop-page';section.id='atlas-page-'+id;
      section.setAttribute('aria-label',TITLES[id]);section.hidden=true;section.inert=true;
      pages[id]=section;deck.append(section);b.setAttribute('aria-controls',section.id);
    }
    listen(b,'click',()=>show(id));
  }
  const homeNodes=[...stage.children].filter(node=>node.matches('.ag-header,.ag-objects,.ag-core-tools,.ag-help,.ag-status,.ag-detail'));
  const initialInert=homeNodes.map(node=>node.inert);
  stage.append(deck,nav);
  const args={launch,document:doc,window:win,invoke,subscribe,SeelenCommand,SeelenEvent,config};
  function show(id){
    if(!ORDER.includes(id))return;
    const was=current;
    stage.dataset.atlasPage=id;current=id;
    for(const page of ORDER){
      if(page===id)buttons[page].setAttribute('aria-current','page');else buttons[page].removeAttribute('aria-current');
      if(page==='home')continue;
      pages[page].hidden=page!==id;pages[page].inert=page!==id;
    }
    homeNodes.forEach((node,index)=>{node.inert=id!=='home'||initialInert[index];});
    if(was!==id){
      if(was==='home')stage.querySelector('.ag-detail:not([hidden]) .ag-detail-close')?.click();
      controllers[was]?.setActive?.(false);
      if(id!=='home'&&!controllers[id]){
        controllers[id]=(id==='ai'?mountDesktopAi:mountDesktopMedia)({...args,host:pages[id]})||{};
      }
      controllers[id]?.setActive?.(true);
      if(id!=='home'&&root.dataset.motion==='full'&&!win.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const delta=ORDER.indexOf(id)>ORDER.indexOf(was)?1:-1;
        pages[id].animate([{transform:'perspective(1100px) translateX('+delta*36+'px) rotateY('+delta*2+'deg)',opacity:.82},
          {transform:'none',opacity:1}],{duration:250,easing:'cubic-bezier(.2,.72,.18,1)'});
      }
    }
  }
  const step=dir=>show(ORDER[Math.max(0,Math.min(2,ORDER.indexOf(current)+dir))]);
  listen(stage,'keydown',e=>{
    if(e.defaultPrevented||e.target?.closest('input,textarea,select,[contenteditable=true]'))return;
    if(!e.altKey&&!nav.contains(e.target))return;
    if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      e.preventDefault();e.stopPropagation();
      if(e.key==='Home')show('home');else if(e.key==='End')show('ai');else step(e.key==='ArrowLeft'?-1:1);
      buttons[current].focus({preventScroll:true});
    }
  },{capture:true});
  listen(stage,'pointerdown',e=>{
    if(!e.isPrimary||e.button!==0||e.target.closest(INTERACTIVE)&&!nav.contains(e.target))return;
    if(e.pointerType==='mouse'&&!nav.contains(e.target))return;
    gesture={id:e.pointerId,x:e.clientX,y:e.clientY,swiped:false};
    if(!nav.contains(e.target))e.stopPropagation(); // Mouse drag on open sky still controls the orbit.
  },{capture:true});
  listen(win,'pointermove',e=>{
    if(gesture?.id!==e.pointerId)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(Math.abs(dy)>24&&Math.abs(dy)>Math.abs(dx)){gesture=null;return;}
    if(!gesture.swiped&&Math.abs(dx)>64&&Math.abs(dx)>1.35*Math.abs(dy)){
      gesture.swiped=true;e.preventDefault();step(dx>0?-1:1);buttons[current].focus({preventScroll:true});
    }
  },{capture:true,passive:false});
  let blockClick=0;
  listen(win,'pointerup',e=>{if(gesture?.id!==e.pointerId)return;if(gesture.swiped){blockClick=win.performance.now()+350;e.preventDefault();}gesture=null;},{capture:true});
  listen(win,'pointercancel',()=>{gesture=null;});
  listen(stage,'click',e=>{if(e.detail&&win.performance.now()<blockClick){e.preventDefault();e.stopImmediatePropagation();blockClick=0;}},{capture:true});
  listen(stage,'wheel',e=>{
    if(e.ctrlKey||e.target.closest('input,textarea,select,[data-horizontal-scroll]')||Math.abs(e.deltaX)<Math.abs(e.deltaY)*1.3)return;
    if(!e.deltaX)return;
    const now=win.performance.now();
    if(now-lastWheel>230){wheel=0;wheeled=false;}lastWheel=now;wheel+=e.deltaX*(e.deltaMode===1?16:1);
    e.preventDefault();
    if(!wheeled&&Math.abs(wheel)>72){step(wheel>0?1:-1);wheeled=true;}
  },{passive:false});
  show('home');
  return()=>{abort.abort();for(const c of Object.values(controllers)){if(typeof c==='function')c();else c.dispose?.();}
    homeNodes.forEach((node,index)=>{node.inert=initialInert[index];});delete stage.dataset.atlasPage;deck.remove();nav.remove();};
}
