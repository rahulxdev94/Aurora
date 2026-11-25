import {PALETTES,PALETTE_EVENTS,PALETTE_FILE,PALETTE_STORAGE,getPalette,parsePalettePreference,serialisePalettePreference,applyPalette} from './palettes.mjs';
import {syncDockPalette} from './dock-palette.mjs';

// One Home writer, a durable local record and a small request/state bridge for
// the separate notification surface. Native operations are serialised so the
// last choice wins even when users switch quickly.
export function createPaletteController({apply,read,write,storage,publish=async()=>{},syncDock=async()=>{},onState=()=>{}}){
  let current='gold',revision=0,queue=Promise.resolve(),disposed=false,restoredId=null;
  const state={paletteId:'gold',restored:false,persisted:false,dock:'unchanged',error:null};
  const report=()=>{if(!disposed)onState({...state});};
  const set=(id)=>{current=id;state.paletteId=id;apply(id);report();};
  try{const saved=parsePalettePreference(storage?.getItem(PALETTE_STORAGE));if(saved){restoredId=saved;set(saved);}}catch{}
  if(state.paletteId==='gold')apply('gold');
  const ready=(async()=>{
    const before=revision;
    try{const id=parsePalettePreference(await read());if(!disposed&&before===revision&&id){restoredId=id;set(id);state.persisted=true;try{storage?.setItem(PALETTE_STORAGE,serialisePalettePreference(id));}catch{}}}catch{}
    if(disposed)return;state.restored=true;report();await publish(current).catch(()=>{});

  })();
  const select=(id)=>{
    if(disposed||!getPalette(id))return Promise.resolve(false);
    const selectedRevision=++revision;state.error=null;state.persisted=false;state.dock='pending';set(id);
    const content=serialisePalettePreference(id);
    try{storage?.setItem(PALETTE_STORAGE,content);}catch{state.error='Theme could not be saved in local storage.';}
    void publish(id).catch(()=>{});
    queue=queue.catch(()=>{}).then(async()=>{
      if(disposed)return false;
      let saved=false,dock='unavailable',error=null;
      try{await write(content);saved=true;}catch{error='Theme is visible, but its local file could not be saved.';}
      if(disposed)return false;
      try{await syncDock(getPalette(id));dock='synced';}catch{error=(error?error+' ':'')+'Dock colours could not be updated.';}
      if(revision===selectedRevision&&!disposed){state.persisted=saved;state.dock=dock;state.error=error;report();}
      return saved;
    });
    return queue;
  };
  return{ready,select,get id(){return current;},get state(){return{...state};},publish:()=>disposed?Promise.resolve():publish(current),dispose(){disposed=true;}};
}

export function initThemeSelector({root,invoke,SeelenCommand,homeWidgetId='@galaxy-atlas/desktop',status=()=>{},transport=null}={}){
  if(!root?.ownerDocument)return()=>{};
  const doc=root.ownerDocument,win=doc.defaultView;
  const control=doc.createElement('details');control.className='au-theme-selector';
  control.innerHTML='<summary aria-label="Choose Galaxy Atlas colour theme"><span class="au-theme-dot" aria-hidden="true"></span><span class="au-theme-caption">Theme</span><span class="au-theme-current">Solar Gold</span><span aria-hidden="true">⌄</span></summary><div class="au-theme-menu"><fieldset><legend>Colour theme</legend>'+PALETTES.map(p=>'<label class="au-theme-option"><input type="radio" name="aurora-colour-theme" value="'+p.id+'"><span class="au-theme-swatches" aria-hidden="true" style="--swatch-base:'+p.tokens.background+';--swatch-accent:'+p.tokens.accent+';--swatch-secondary:'+p.tokens.accent2+'"></span><span>'+p.name+'<small>'+(p.mode==='light'?'Light':'Dark')+'</small></span></label>').join('')+'</fieldset><p class="au-theme-save" role="status" aria-live="polite">Saved on this PC</p></div>';
  const anchor=root.querySelector('.ah-topbar');if(!anchor)return()=>{};
  anchor.append(control);
  let bridge=transport,disposed=false,unlisten=null,diagnosticTimer=0;
  const report=state=>{
    const selected=getPalette(state.paletteId);control.querySelector('.au-theme-current').textContent=selected.name;
    for(const radio of control.querySelectorAll('input[name="aurora-colour-theme"]'))radio.checked=radio.value===selected.id;
    control.querySelector('summary').setAttribute('aria-label','Galaxy Atlas colour theme: '+selected.name);
    control.querySelector('.au-theme-save').textContent=state.error||(state.dock==='pending'?'Saving theme and matching the dock':state.persisted?'Saved on this PC':state.restored?'Choose a theme for every Galaxy Atlas surface':'Loading local theme');
    root.dataset.paletteSaved=String(state.persisted);root.dataset.paletteDock=state.dock;
    win.clearTimeout(diagnosticTimer);diagnosticTimer=win.setTimeout(()=>{if(!disposed&&invoke&&SeelenCommand?.WriteFile)void invoke(SeelenCommand.WriteFile,{filename:'palette-startup.json',content:JSON.stringify({schema_version:1,at:new Date().toISOString(),...state,selector:!!control.isConnected,desktopDesign:root.dataset.desktopDesign,worldIndicators:root.querySelector(".ag-stage")?.__auroraWorldIndicators?.state,sceneReady:!!root.querySelector(".au-prism-core,.ag-sky"),scene:root.querySelector(".ag-stage")?.__auroraDeepSky?.state,deskToolsReady:!!root.querySelector(".adt-trigger"),worldClockReady:!!root.querySelector(".awc-select")})}).catch(()=>{});},250);
  };
  let local;try{local=win.localStorage;}catch{}
  const controller=createPaletteController({apply:id=>applyPalette(root,id),storage:local,
    read:()=>invoke?invoke(SeelenCommand.ReadFile,{filename:PALETTE_FILE}):Promise.reject(),
    write:content=>invoke?invoke(SeelenCommand.WriteFile,{filename:PALETTE_FILE,content}):Promise.resolve(),
    publish:async paletteId=>{if(bridge)await bridge.emit(PALETTE_EVENTS.state,{homeWidgetId,paletteId});},
    syncDock:palette=>invoke?syncDockPalette({invoke,SeelenCommand,palette,design:root.dataset.desktopDesign}):Promise.resolve(),onState:report});
  const change=event=>{const radio=event.target.closest('input[name="aurora-colour-theme"]');if(!radio)return;void controller.select(radio.value).then(()=>{if(controller.state.error)status(controller.state.error);});};
  const key=event=>{if(event.key==='Escape'&&control.open){event.stopPropagation();control.open=false;control.querySelector('summary').focus();}};
  const outside=event=>{if(!control.contains(event.target))control.open=false;};
  control.addEventListener('change',change);control.addEventListener('keydown',key);doc.addEventListener('pointerdown',outside);
  // Native events contain only a validated palette ID and the matching Home ID.
  void(async()=>{
    if(!bridge&&win.__TAURI_INTERNALS__)bridge=await import('@tauri-apps/api/event');
    if(!bridge||disposed)return;
    unlisten=await bridge.listen(PALETTE_EVENTS.request,event=>{if(!disposed&&event.payload?.homeWidgetId===homeWidgetId)void controller.ready.then(()=>controller.publish()).catch(()=>{});});
    if(disposed){unlisten();return;}
    await controller.ready;if(!disposed)await controller.publish();
  })().catch(()=>{});
  // Exposed only to Galaxy Atlas's local diagnostics, never as a remote command API.
  root.__auroraPaletteController=controller;
  let sceneTimer;
  const sceneReady=()=>{report(controller.state);clearTimeout(sceneTimer);sceneTimer=setTimeout(()=>report(controller.state),11000);};
  root.addEventListener?.('galaxy-atlas:sky-ready',sceneReady);
  return()=>{clearTimeout(sceneTimer);root.removeEventListener?.('galaxy-atlas:sky-ready',sceneReady);disposed=true;controller.dispose();unlisten?.();win.clearTimeout(diagnosticTimer);control.removeEventListener('change',change);control.removeEventListener('keydown',key);doc.removeEventListener('pointerdown',outside);control.remove();delete root.__auroraPaletteController;};
}
