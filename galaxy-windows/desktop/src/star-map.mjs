import {installWorldIndicators} from './celestial-readings.mjs';
import {initDeepSky} from './deep-sky.mjs';
import {initWorldClock} from './world-clock.mjs';
import {parseDeskTools} from './desk-tools.mjs';
import {createComet} from './comet.mjs';
import {createLibraryAtom} from './library-atom.mjs';
import {connectGalaxyInput} from './galaxy-input.mjs';
import {mountCalendarFace} from './calendar-face.mjs';

const instances = new WeakMap();
const BODIES = Object.freeze([
  {id:'time', name:'Time', reading:'Current local time', source:'.ah-clock'},
  {id:'calendar', name:'Calendar', reading:'Dates and local tasks', source:'.ah-calendar'},
  {id:'library', name:'Library', reading:'Your collections', source:'.ah-library'},
  {id:'weather', name:'Weather', reading:'Checking the forecast', source:'.ah-weather'},
  {id:'system', name:'System', reading:'Hardware readings', source:'.ah-sensors'},
  {id:'frequent', name:'Frequently used', reading:'Local app activity', source:'.ah-frequent'},
  {id:'tools', name:'Desk tools', reading:'Notes and pinned shortcuts'},
  {id:'search', name:'Search', reading:'Apps, files and commands'},
  {id:'core', name:'Galaxy Atlas', reading:'Open ChatGPT'}
]);
const tidy = (value, limit=140) => String(value || '').replace(/\s+/g,' ').trim().slice(0,limit);
const read = (parent, selector) => tidy(parent?.querySelector(selector)?.textContent);
const put = (element, value) => {if (element && element.textContent !== value) element.textContent = value;};

/** A spatial desktop. Native widgets keep their identity, state and event owners. */
export function initStarMap({root, onSwitch=()=>{}, standalone=false} = {}) {
  if (!root?.ownerDocument?.defaultView) return () => {};
  if (instances.has(root)) return instances.get(root);
  const doc=root.ownerDocument, win=doc.defaultView;
  const make=(tag, cls, text) => {const element=doc.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=text;return element;};
  const section=make('section','ag-map');section.id='au-starmap';section.setAttribute('aria-label','Galaxy Atlas desktop');
  const stage=make('div','ag-stage');stage.tabIndex=0;stage.setAttribute('aria-label','Galaxy star map. Hover or focus a world to preview its widget. Click, press Enter or tap to bring it closer. Drag empty space to turn the galaxy. Use the arrow keys to rotate and Home to reset.');stage.dataset.focusPhase='idle';
  const header=make('header','ag-header'), title=make('h1','ag-title','Galaxy Atlas');
  header.append(title);
  const objects=make('nav','ag-objects');objects.setAttribute('aria-label','Desktop worlds');
  const controls=new Map();
  for (const body of BODIES) {
    const button=make('button','ag-object cursor-interaction');button.type='button';button.dataset.body=body.id;
    button.setAttribute('aria-label',body.name+': '+body.reading);
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','ag-detail');
    const model=make('span','ag-model');model.setAttribute('aria-hidden','true');
    if(body.id==='time') {model.append(make('i','ag-clock-hour'),make('i','ag-clock-minute'));}
    const caption=make('span','ag-caption'), name=make('strong','ag-name',body.name), reading=make('small','ag-reading',body.reading);
    caption.append(name,reading);button.append(model,caption);objects.append(button);controls.set(body.id,{body,button,name,reading});
  }
  const coreTools=make('button','ag-core-tools cursor-interaction','Orbit controls');coreTools.type='button';
  coreTools.setAttribute('aria-label','Galaxy Atlas launchers and desktop controls');coreTools.setAttribute('aria-haspopup','dialog');coreTools.setAttribute('aria-expanded','false');coreTools.setAttribute('aria-controls','ag-detail');
  const help=make('p','ag-help','Hover over a planet to preview it. Click Library to open File Explorer. Drag empty space to rotate.');
  const status=make('p','ag-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const detail=make('section','ag-detail');detail.id='ag-detail';detail.hidden=true;detail.tabIndex=-1;
  detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','false');detail.setAttribute('aria-labelledby','ag-detail-title');
  const detailHeader=make('header','ag-detail-header'), detailTitle=make('h2','ag-detail-title');detailTitle.id='ag-detail-title';
  const detailClose=make('button','ag-detail-close cursor-interaction','Close');detailClose.type='button';detailClose.setAttribute('aria-label','Close world details');
  const content=make('div','ag-detail-content');detailHeader.append(detailTitle,detailClose);detail.append(detailHeader,content);
  stage.append(header,objects,coreTools,help,status,detail);section.append(stage);root.append(section);
  const hadClass=root.classList.contains('au-starmap-active');root.classList.add('au-starmap-active');
  const decorationStops=[createComet(controls.get('frequent').button.querySelector('.ag-model')),createLibraryAtom(controls.get('library').button.querySelector('.ag-model'))];
  const stopCalendarFace=mountCalendarFace(controls.get('calendar'));
  const initialFocus=doc.activeElement;
  const previousLegacy=[...root.querySelectorAll(':scope > .ah-topbar,:scope > .ah-desktop,:scope > .ah-bottom,:scope > .ah-atmosphere,:scope > .ah-pointer')].map(element=>({element,inert:element.inert,ariaHidden:element.getAttribute('aria-hidden'),display:element.style.getPropertyValue('display'),displayPriority:element.style.getPropertyPriority('display')}));
  const focusCameFromLegacy=previousLegacy.some(entry=>entry.element.contains(initialFocus));
  for(const entry of previousLegacy){entry.element.inert=true;entry.element.setAttribute('aria-hidden','true');entry.element.style.setProperty('display','none','important');}
  const disposeClock=initWorldClock({root});
  const indicators=installWorldIndicators({root,controls,stage});
  let disposeSky=()=>{}, disposed=false, frame=0, selected=null, opener=null, nativeFeedback=false;
  let hoverIntent=null, pointerOver=null, flightVersion=0, skyFocus=null;
  const flightAnimations=[], suppressedBodies=new Set(), reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const moved=[], listeners=[], detailListeners=[];
  const listen=(target,name,fn,options)=>{target?.addEventListener(name,fn,options);listeners.push(()=>target?.removeEventListener(name,fn,options));};
  const listenDetail=(target,name,fn)=>{target.addEventListener(name,fn);detailListeners.push(()=>target.removeEventListener(name,fn));};
  const source=selector=>root.querySelector(selector);
  const say=value=>{nativeFeedback=false;put(status,value);};

  function cancelHover() {if(hoverIntent)win.clearTimeout(hoverIntent.timer);hoverIntent=null;}
  function restoreSkyScale() {
    if(!skyFocus)return;
    for(const [property,value]of [['transform',skyFocus.transform],['transform-origin',skyFocus.origin]]){if(value)skyFocus.node.style.setProperty(property,value);else skyFocus.node.style.removeProperty(property);}
    skyFocus=null;
  }
  function cancelFlight() {
    flightVersion++;
    for(const animation of flightAnimations.splice(0))animation.cancel();
    for(const {button}of controls.values())delete button.dataset.focused;
    detail.style.removeProperty('visibility');detail.style.removeProperty('transform-origin');detail.inert=false;detail.removeAttribute('aria-hidden');
    restoreSkyScale();stage.dataset.focusPhase=detail.hidden?'idle':'preview';delete stage.dataset.focusBody;
  }
  const cinematic=()=>root.dataset.motion==='full'&&root.dataset.paused!=='true'&&!doc.hidden&&!reduced?.matches;
  const trackAnimation=animation=>{flightAnimations.push(animation);void animation.finished.catch(()=>{});return animation;};
  function setWidgetOrigin(button) {
    const bounds=stage.getBoundingClientRect(), object=button.getBoundingClientRect(), hud=detail.getBoundingClientRect();
    const cx=Math.max(bounds.left+10,Math.min(bounds.right-10,object.left+object.width/2));
    const cy=Math.max(bounds.top+10,Math.min(bounds.bottom-10,object.top+object.height/2));
    detail.style.setProperty('--ag-origin-x',cx-hud.left+'px');detail.style.setProperty('--ag-origin-y',cy-hud.top+'px');
    return {x:cx-hud.left-hud.width/2,y:cy-hud.top-hud.height/2};
  }
  function finishFocus(version,{moveFocus=true}={}) {
    if(disposed||version!==flightVersion||detail.hidden||!selected)return;
    for(const animation of flightAnimations.splice(0))animation.cancel();
    detail.style.removeProperty('visibility');detail.style.removeProperty('transform-origin');detail.inert=false;detail.removeAttribute('aria-hidden');
    controls.get(selected).button.dataset.focused='true';stage.dataset.focusPhase='focused';stage.dataset.focusBody=selected;
    if(selected==='core'&&cinematic()&&skyFocus)skyFocus.node.style.setProperty('transform','scale(1.08)');else restoreSkyScale();
    if(moveFocus&&!doc.hidden&&!anotherDialogVisible())detailClose.focus({preventScroll:true});
  }

  function restoreSources() {
    for(const entry of moved.splice(0).reverse()) {
      if(entry.node.matches('.au-theme-selector'))entry.node.open=false;
      if(entry.marker.parentNode)entry.marker.parentNode.replaceChild(entry.node,entry.marker);
      else if(entry.parent)entry.parent.insertBefore(entry.node,entry.next?.parentNode===entry.parent?entry.next:null);
    }
  }
  function moveSource(node,parent=content) {
    if(!node||node===section||section.contains(node))return false;
    const marker=doc.createComment('Galaxy Atlas native widget position');
    const originalParent=node.parentNode, next=node.nextSibling;
    if(!originalParent)return false;
    originalParent.insertBefore(marker,node);moved.push({node,marker,parent:originalParent,next});parent.append(node);return true;
  }
  function closeDetail({restoreFocus=true,suppressReopen=true}={}) {
    if(detail.hidden&&!moved.length)return;
    const previous=opener;
    if(suppressReopen&&selected)suppressedBodies.add(selected);
    cancelHover();cancelFlight();
    for(const stop of detailListeners.splice(0))stop();
    restoreSources();content.replaceChildren();detail.hidden=true;
    for(const {button} of controls.values()){button.classList.remove('is-selected');if(button.hasAttribute('aria-expanded'))button.setAttribute('aria-expanded','false');}
    coreTools.setAttribute('aria-expanded','false');selected=null;opener=null;stage.dataset.focusPhase='idle';delete stage.dataset.focusBody;delete detail.dataset.body;
    if(restoreFocus&&previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});
  }
  function invokeSource(selector, label, {close=true}={}) {
    const target=source(selector);
    if(!target||target.disabled||target.getAttribute('aria-disabled')==='true'){say(label+' is unavailable in this desktop.');return false;}
    if(close&&!detail.hidden){const returnTarget=opener;closeDetail({restoreFocus:false});if(returnTarget?.isConnected)returnTarget.focus({preventScroll:true});}
    target.click();return true;
  }
  function addAction(parent,label,selector) {
    const button=make('button','ag-action cursor-interaction',label);button.type='button';
    const target=source(selector);button.disabled=!target||target.disabled||target.getAttribute('aria-disabled')==='true';
    if(button.disabled)button.title=label+' is unavailable in the current desktop';
    listenDetail(button,'click',event=>{event.stopPropagation();invokeSource(selector,label);});parent.append(button);return button;
  }
  function renderCoreControls() {
    const actions=make('div','ag-actions');actions.setAttribute('aria-label','Galaxy Atlas launchers');
    for(const [label,selector] of [
      ['Open ChatGPT','.ah-companion[data-action="chat"]'],
      ['Scarlett','[data-aurora-companion="scarlett"]'],
      ['ChatGPT Voice','[data-aurora-companion="voice"]'],
      ['Anchor','[data-aurora-companion="anchor"]'],
      ['Desk tools','.adt-trigger'],
      ['Search','.ah-search-trigger[data-aurora-search],.ah-search-trigger'],
      ['Notifications','.ah-notification-button'],
      ['Quick controls','.ah-welcome-actions [data-action="quick-controls"]'],
      ['Hide Galaxy Atlas','[data-native-hide]']
    ])addAction(actions,label,selector);
    content.append(actions);
    const modeGroup=make('div','ag-workspaces');modeGroup.setAttribute('role','group');modeGroup.setAttribute('aria-label','Workspace');
    for(const mode of ['work','create','relax']) {
      const button=make('button','ag-action ag-workspace cursor-interaction',mode[0].toUpperCase()+mode.slice(1));button.type='button';button.dataset.agWorkspace=mode;
      button.setAttribute('aria-pressed',String(root.dataset.workspace===mode));
      listenDetail(button,'click',event=>{event.stopPropagation();invokeSource('.ah-workspace-switch [data-workspace="'+mode+'"]',mode+' workspace',{close:false});queueReadings();});modeGroup.append(button);
    }
    const row=make('label','ag-control-row','Motion'), motion=make('select','ag-motion');motion.setAttribute('aria-label','Galaxy Atlas motion');
    for(const [value,label]of [['full','Full'],['reduced','Reduced'],['off','Off']]){const option=make('option','',label);option.value=value;motion.append(option);}
    motion.value=root.dataset.motion||'reduced';
    listenDetail(motion,'change',event=>{event.stopPropagation();const target=source('.ah-motion');if(!target){say('Motion controls are unavailable.');return;}target.value=motion.value;target.dispatchEvent(new win.Event('change',{bubbles:true}));queueReadings();});row.append(motion);content.append(modeGroup,row);
    const themes=make('div','ag-theme-controls');content.append(themes);
    moveSource(source('.au-theme-selector'),themes);
  }
  function renderToolsPreview() {
    const nativeDialog=source('.adt-dialog'), textarea=nativeDialog?.querySelector('#adt-note');
    content.append(make('h3','ag-preview-heading','Scratchpad'));
    const note=make('p','ag-note-preview');content.append(note);
    let stored=null;try{stored=parseDeskTools(win.localStorage.getItem('galaxy-atlas.deskTools.v1'));}catch{}
    const value=textarea?textarea.value:stored?.note||'';put(note,value?value.slice(0,600)+(value.length>600?'…':''):'No note yet.');
    const actions=make('div','ag-actions');addAction(actions,'Open Desk tools','.adt-trigger');content.append(actions);
    const pinNodes=[...nativeDialog?.querySelectorAll('[data-adt-open]')||[]];
    const pins=pinNodes.length?pinNodes.map(node=>node.dataset.adtOpen):stored?.pins||[];
    const destinations={
      files:['Files','.ah-navigation button[title^="Galaxy Atlas Files"]'],search:['Search','.ah-search-trigger'],calendar:['Calendar','.ah-calendar .ac-open'],
      library:['Library','.ah-library [data-action="library"]'],controls:['Quick controls','.ah-welcome-actions [data-action="quick-controls"]'],
      notifications:['Notifications','.ah-notification-button'],appearance:['Appearance','[data-action="appearance"]'],chatgpt:['ChatGPT','.ah-companion[data-action="chat"]']
    };
    if(pins.length){content.append(make('h3','ag-preview-heading','Pinned shortcuts'));const pinned=make('div','ag-actions');for(const id of pins){const destination=destinations[id];if(destination)addAction(pinned,destination[0],destination[1]);}content.append(pinned);}
    else content.append(make('p','ag-preview-intro','Open Desk tools to manage your pinned shortcuts.'));
  }
  function renderSearchPreview() {
    content.append(make('p','ag-preview-intro','Search your installed apps, files and Galaxy Atlas commands.'));
    const actions=make('div','ag-actions');addAction(actions,'Open Search','.ah-search-trigger[data-aurora-search],.ah-search-trigger');content.append(actions);
  }
  function publishFocus(button) {
    const bounds=stage.getBoundingClientRect(), object=button.getBoundingClientRect();
    if(bounds.width&&bounds.height)root.dispatchEvent(new win.CustomEvent('galaxy-atlas:scene-focus',{detail:{x:(object.x+object.width/2-bounds.x)/bounds.width,y:(object.y+object.height/2-bounds.y)/bounds.height}}));
  }
  function positionDetail() {
    if(detail.hidden||!opener)return;
    const bounds=stage.getBoundingClientRect(), object=opener.getBoundingClientRect();
    detail.dataset.side=object.x+object.width/2>bounds.x+bounds.width*.57?'left':'right';
  }
  function openDetail(id, from=controls.get(id)?.button, {focus=false,passive=false}={}) {
    if(anotherDialogVisible())return false;
    if(selected===id&&!detail.hidden){if(focus)detailClose.focus({preventScroll:true});return true;}
    say('');
    closeDetail({restoreFocus:false,suppressReopen:false});
    const control=controls.get(id);if(!control)return;
    selected=id;opener=from;put(detailTitle,id==='core'?'Galaxy Atlas controls':control.name.textContent);
    if(id==='core')renderCoreControls();
    else if(id==='tools')renderToolsPreview();
    else if(id==='search')renderSearchPreview();
    else if(!moveSource(source(control.body.source))){content.append(make('p','ag-unavailable','This desktop connection is unavailable.'));}
    detail.hidden=false;detail.dataset.body=id;control.button.classList.add('is-selected');stage.dataset.focusPhase='preview';stage.dataset.focusBody=id;
    if(control.button.hasAttribute('aria-expanded'))control.button.setAttribute('aria-expanded','true');
    if(from===coreTools)coreTools.setAttribute('aria-expanded','true');
    positionDetail();if(focus)detailClose.focus({preventScroll:true});if(!passive)publishFocus(from||control.button);return true;
  }
  async function selectBody(id, from=controls.get(id)?.button, {animate=true}={}) {
    cancelHover();suppressedBodies.delete(id);
    const button=controls.get(id)?.button;if(!button||anotherDialogVisible())return;
    if(id==='library' && win.__auroraNative?.openLibrary){
      void win.__auroraNative.openLibrary();
      return;
    }
    if(selected===id&&!detail.hidden&&stage.dataset.focusPhase==='focused'){detailClose.focus({preventScroll:true});return;}
    if(!openDetail(id,from,{passive:true}))return;
    cancelFlight();const version=flightVersion;
    button.dataset.focused='true';stage.dataset.focusBody=id;publishFocus(button);
    if(!animate||!cinematic()||typeof button.animate!=='function'||typeof detail.animate!=='function'){setWidgetOrigin(button);finishFocus(version);return;}
    stage.dataset.focusPhase='approach';detail.inert=true;detail.setAttribute('aria-hidden','true');detail.style.setProperty('visibility','hidden');
    const approach=trackAnimation(button.animate([{transform:'translate(-50%,-50%) scale(1)'},{transform:'translate(-50%,-50%) scale(1.24)'}],{duration:340,easing:'cubic-bezier(.18,.75,.2,1)',fill:'both'}));
    if(id==='core'){
      const sky=stage.querySelector('.ag-sky');
      if(sky){skyFocus={node:sky,transform:sky.style.getPropertyValue('transform'),origin:sky.style.getPropertyValue('transform-origin')};const object=button.getBoundingClientRect(),bounds=stage.getBoundingClientRect();sky.style.setProperty('transform-origin',(object.left+object.width/2-bounds.left)+'px '+(object.top+object.height/2-bounds.top)+'px');trackAnimation(sky.animate([{transform:'scale(1)'},{transform:'scale(1.08)'}],{duration:340,easing:'cubic-bezier(.18,.75,.2,1)',fill:'both'}));}
    }
    await approach.finished.catch(()=>{});
    if(disposed||version!==flightVersion||stage.dataset.focusPhase!=='approach')return;
    const origin=setWidgetOrigin(button);stage.dataset.focusPhase='reveal';detail.style.removeProperty('visibility');detail.style.setProperty('transform-origin','50% 50%');
    const reveal=trackAnimation(detail.animate([
      {opacity:0,transform:'translate('+origin.x+'px,'+origin.y+'px) scale(.08)',filter:'blur(7px)'},
      {opacity:.8,transform:'translate('+origin.x*.13+'px,'+origin.y*.13+'px) scale(.82)',filter:'blur(1px)',offset:.68},
      {opacity:1,transform:'translate(0px,0px) scale(1)',filter:'blur(0px)'}
    ],{duration:420,easing:'cubic-bezier(.18,.72,.2,1)',fill:'both'}));
    await reveal.finished.catch(()=>{});
    if(version===flightVersion&&stage.dataset.focusPhase==='reveal')finishFocus(version);
  }
  function setReading(id,name,reading,description=reading) {
    const control=controls.get(id);if(!control)return;
    put(control.name,name);put(control.reading,reading);
    const label=name+': '+description;
    if(control.button.getAttribute('aria-label')!==label)control.button.setAttribute('aria-label',label);
  }
  function updateReadings() {
    frame=0;if(disposed||doc.hidden)return;
    const selectedSource=controls.get(selected)?.body.source;
    if(!detail.hidden&&selectedSource&&!moved.length){const widget=source(selectedSource);if(widget){content.replaceChildren();moveSource(widget);}}
    const notePreview=selected==='tools'&&content.querySelector('.ag-note-preview'), nativeNote=source('.adt-dialog #adt-note');
    if(notePreview&&nativeNote){const value=nativeNote.value;put(notePreview,value?value.slice(0,600)+(value.length>600?'…':''):'No note yet.');}
    const clock=source('.ah-clock'), zoned=clock?.__auroraWorldClock;
    const time=tidy(zoned?zoned.time+' '+zoned.period:read(clock,'.ah-time')+' '+read(clock,'.ah-period'));
    setReading('time',zoned?.label?zoned.label+' time':'Time',time||'Unavailable',zoned?time+', '+zoned.fullDate:time||'Current time is unavailable');
    let hours=zoned?.hours, minutes=zoned?.minutes;
    if(!Number.isFinite(hours)||!Number.isFinite(minutes)) {
      const match=read(clock,'.ah-time').match(/(\d{1,2}):(\d{2})/);
      if(match){hours=Number(match[1]);minutes=Number(match[2]);const period=read(clock,'.ah-period').toUpperCase();if(period==='AM'||period==='PM')hours=hours%12+(period==='PM'?12:0);}
    }
    if(Number.isFinite(hours)&&Number.isFinite(minutes)) {
      const style=controls.get('time').button.style;
      for(const [key,value]of [['--ag-minute-angle',minutes*6+'deg'],['--ag-hour-angle',(hours%12*30+minutes*.5)+'deg']])if(style.getPropertyValue(key)!==value)style.setProperty(key,value);
    }
    const library=source('.ah-library'), collections=library?.querySelectorAll('.ah-folder').length||0;
    setReading('library','Library',collections?collections+' collections':'Your collections');
    const {cpu,weather}=indicators.update();
    const where=weather.city?' · '+weather.city:'';
    setReading('weather','Weather',weather.state==='current'?[weather.temperature,weather.label].filter(Boolean).join(' · '):weather.label,weather.label+where);
    setReading('system','System',cpu===null?'CPU unavailable':'CPU '+Math.round(cpu)+'%',cpu===null?'CPU reading unavailable':'CPU '+Math.round(cpu)+'%, binary orbit follows processor use');
    const frequent=source('.ah-frequent'), names=[...frequent?.querySelectorAll('.afq-item-name')||[]].map(node=>tidy(node.textContent));
    setReading('frequent','Frequently used',names.length?names[0]+(names.length>1?' +'+(names.length-1):''):'No local ranking',read(frequent,'.afq-status')||'Local app and Galaxy Atlas website activity');
    for(const button of content.querySelectorAll('[data-ag-workspace]'))button.setAttribute('aria-pressed',String(button.dataset.agWorkspace===root.dataset.workspace));
    const motion=content.querySelector('.ag-motion');if(motion&&motion.value!==root.dataset.motion)motion.value=root.dataset.motion||'reduced';
    const toast=source('.ah-toast.ah-show');if(toast&&tidy(toast.textContent)){put(status,tidy(toast.textContent));nativeFeedback=true;}else if(nativeFeedback){put(status,'');nativeFeedback=false;}
  }
  function queueReadings() {if(!disposed&&!frame&&!doc.hidden)frame=win.requestAnimationFrame(updateReadings);}
  function anotherDialogVisible() {
    return [...root.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(node=>node!==detail&&node.getClientRects().length>0);
  }
  function editingDetail() {
    const active=doc.activeElement;
    return detail.contains(active)&&active.matches('textarea,[contenteditable="true"],input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="password"],input[type="tel"],input[type="number"]');
  }
  function beginHover(id,button,event,kind='pointer') {
    if(disposed||doc.hidden||suppressedBodies.has(id)||anotherDialogVisible()||editingDetail()||selected===id&&!detail.hidden)return;
    if(kind==='pointer'&&(event.pointerType==='touch'||event.buttons))return;
    cancelHover();
    const intent={id,button,kind,x:event.clientX||0,y:event.clientY||0,timer:0};hoverIntent=intent;
    intent.timer=win.setTimeout(()=>{
      if(hoverIntent!==intent)return;hoverIntent=null;
      if(disposed||doc.hidden||anotherDialogVisible()||editingDetail()||suppressedBodies.has(id))return;
      if(kind==='focus'?doc.activeElement!==button:pointerOver!==id)return;
      openDetail(id,button,{passive:true});
    },280);
  }
  for(const [id,{button}]of controls){
    listen(button,'pointerenter',event=>{pointerOver=id;suppressedBodies.delete(id);beginHover(id,button,event);});
    listen(button,'pointermove',event=>{if(event.pointerType==='touch'||event.buttons)return;if(!hoverIntent){beginHover(id,button,event);return;}if(hoverIntent.kind==='pointer'&&hoverIntent.id===id&&Math.hypot(event.clientX-hoverIntent.x,event.clientY-hoverIntent.y)>6)beginHover(id,button,event);});
    listen(button,'pointerleave',()=>{if(pointerOver===id)pointerOver=null;suppressedBodies.delete(id);if(hoverIntent?.id===id&&hoverIntent.kind==='pointer')cancelHover();});
    listen(button,'focus',event=>beginHover(id,button,event,'focus'));
    listen(button,'blur',()=>{suppressedBodies.delete(id);if(hoverIntent?.id===id&&hoverIntent.kind==='focus')cancelHover();});
    listen(button,'keydown',event=>{
      if(!['Enter',' ','Spacebar'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
      event.preventDefault();event.stopPropagation();
      if(!event.repeat)selectBody(id,button);
    });
    listen(button,'keyup',event=>{if(['Enter',' ','Spacebar'].includes(event.key))event.preventDefault();});
  }
  listen(objects,'click',event=>{const button=event.target.closest('.ag-object');if(!button||!objects.contains(button))return;event.stopPropagation();selectBody(button.dataset.body);});
  listen(root,'click',event=>{
    if(!win.__auroraNative?.openLibrary||!event.target.closest?.('[data-action="library"]'))return;
    event.preventDefault();event.stopImmediatePropagation();void win.__auroraNative.openLibrary();
  },true);
  listen(coreTools,'click',event=>{event.stopPropagation();selectBody('core',coreTools,{animate:false});});

  listen(detailClose,'click',event=>{event.stopPropagation();closeDetail();});
  listen(doc,'keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!detail.hidden&&!anotherDialogVisible()){event.preventDefault();closeDetail();}});
  listen(stage,'pointerdown',event=>{if(!detail.hidden&&!event.target.closest('.ag-detail,.ag-object,.ag-core-tools,button,a,input,select,textarea'))closeDetail({restoreFocus:false});});
  listen(win,'resize',()=>{positionDetail();if(['approach','reveal'].includes(stage.dataset.focusPhase)){setWidgetOrigin(controls.get(selected).button);finishFocus(flightVersion,{moveFocus:false});}queueReadings();});
  const motionChanged=()=>{cancelHover();if(!cinematic()){if(['approach','reveal'].includes(stage.dataset.focusPhase))finishFocus(flightVersion,{moveFocus:false});else restoreSkyScale();}queueReadings();};
  listen(doc,'visibilitychange',motionChanged);listen(reduced,'change',motionChanged);
  for(const name of ['galaxy-atlas:clock-change','galaxy-atlas:calendar-render','galaxy-atlas:outlook-updated','galaxy-atlas:usage-updated','galaxy-atlas:activity'])listen(root,name,queueReadings);
  const observer=new win.MutationObserver(queueReadings);
  observer.observe(root,{childList:true,characterData:true,subtree:true});
  const stateObserver=new win.MutationObserver(motionChanged);
  stateObserver.observe(root,{attributes:true,attributeFilter:['data-motion','data-workspace','data-paused']});
  updateReadings();
  try{disposeSky=initDeepSky({root,stage});}catch(error){say('Galaxy graphics are unavailable. Your desktop worlds still work.');console.warn('Galaxy Atlas graphics unavailable',error);}
  const disconnectInput=connectGalaxyInput(root);
  function cleanup() {
    if(disposed)return;disposed=true;
    disconnectInput();
    const returnFromMap=section.contains(doc.activeElement);
    cancelHover();cancelFlight();
    win.cancelAnimationFrame(frame);observer.disconnect();stateObserver.disconnect();
    for(const stop of listeners)stop();
    closeDetail({restoreFocus:false});
    for(const stop of decorationStops)stop();
    stopCalendarFace();
    indicators.dispose();disposeSky();disposeClock();
    for(const entry of previousLegacy){entry.element.inert=entry.inert;if(entry.ariaHidden===null)entry.element.removeAttribute('aria-hidden');else entry.element.setAttribute('aria-hidden',entry.ariaHidden);if(entry.display)entry.element.style.setProperty('display',entry.display,entry.displayPriority);else entry.element.style.removeProperty('display');}
    section.remove();if(!hadClass)root.classList.remove('au-starmap-active');instances.delete(root);
    if(returnFromMap)win.requestAnimationFrame(()=>{const active=doc.activeElement;if(!root.isConnected||root.classList.contains('au-starmap-active'))return;if(active===doc.body||!active?.getClientRects().length||active.closest('[inert]'))(root.querySelector('.au-desktop-switch')||root.querySelector('.ah-brand'))?.focus({preventScroll:true});});
  }
  instances.set(root,cleanup);if(focusCameFromLegacy)stage.focus({preventScroll:true});return cleanup;
}
