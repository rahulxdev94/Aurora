// Local desk tools. Shortcut IDs resolve only to existing Aurora controls.
const STORAGE_KEY='aurora.deskTools.v1';
const instances=new WeakMap();
const sessionDrafts=new WeakMap();
const DESTINATIONS=Object.freeze([
  {id:'files',label:'Files',find:root=>[...root.querySelectorAll('.ah-navigation button')].find(button=>button.title?.startsWith('Aurora Files')||button.textContent.trim()==='Files')},
  {id:'search',label:'Search',selector:'.ah-search-trigger[data-aurora-search],.ah-search-trigger[data-action="launcher"],[data-aurora-search]'},
  {id:'calendar',label:'Calendar',selector:'.ah-calendar .ac-open'},
  {id:'library',label:'Library',selector:'.ah-library [data-action="library"],.ah-navigation [data-action="library"]'},
  {id:'controls',label:'Quick controls',selector:'.ah-welcome-actions [data-action="quick-controls"]'},
  {id:'notifications',label:'Notifications',selector:'.ah-notification-button[data-action="notifications"]'},
  {id:'appearance',label:'Appearance',selector:'[data-action="appearance"]'},
  {id:'chatgpt',label:'ChatGPT',selector:'.ah-companion[data-action="chat"]'}
]);

export function parseDeskTools(value){
  try{
    const record=typeof value==='string'?JSON.parse(value):value;
    if(record?.schema_version!==1||typeof record.note!=='string'||!Array.isArray(record.pins))return null;
    return {note:record.note,pins:[...new Set(record.pins.filter(id=>DESTINATIONS.some(item=>item.id===id)))]};
  }catch{return null;}
}

export function initDeskTools({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,anchor=root.querySelector('.ah-welcome-actions');
  if(!win||!anchor)return()=>{};
  const make=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const button=make('button','adt-trigger cursor-interaction','Desk tools');
  button.type='button';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.title='Local scratchpad and pinned shortcuts';
  const dialog=make('dialog','adt-dialog');dialog.id='aurora-desk-tools';dialog.setAttribute('aria-labelledby','adt-title');dialog.setAttribute('aria-describedby','adt-description');
  button.setAttribute('aria-controls',dialog.id);
  const header=make('header','adt-header'),heading=make('div','adt-heading'),eyebrow=make('p','adt-eyebrow','YOUR DESK'),title=make('h2','','Desk tools');title.id='adt-title';
  const description=make('p','adt-description','Keep a note and your favourite Aurora shortcuts close.');description.id='adt-description';heading.append(eyebrow,title,description);
  const closeButton=make('button','adt-close cursor-interaction','Close');closeButton.type='button';closeButton.setAttribute('aria-label','Close Desk tools');header.append(heading,closeButton);
  const body=make('div','adt-body'),notes=make('section','adt-notes'),noteHeading=make('label','adt-section-title','Scratchpad');noteHeading.htmlFor='adt-note';
  const note=make('textarea','adt-note');note.id='adt-note';note.placeholder='Leave yourself a thought, a link or a next step.';note.spellcheck=true;note.setAttribute('aria-describedby','adt-local-note adt-save-status');
  const noteInfo=make('p','adt-local-note','Stored in this Aurora desktop on this PC.');noteInfo.id='adt-local-note';
  const saveStatus=make('p','adt-save-status');saveStatus.id='adt-save-status';saveStatus.setAttribute('role','status');saveStatus.setAttribute('aria-live','polite');saveStatus.setAttribute('aria-atomic','true');
  notes.append(noteHeading,note,noteInfo,saveStatus);
  const shortcuts=make('section','adt-shortcuts'),pinHeading=make('h3','adt-section-title','Pinned shortcuts'),pinHelp=make('p','adt-pin-help','Choose working destinations from this desktop.');
  const list=make('ol','adt-pins'),empty=make('p','adt-empty','No shortcuts pinned. Add one below.');
  const addForm=make('form','adt-add'),addLabel=make('label','adt-add-label','Add shortcut');addLabel.htmlFor='adt-destination';
  const select=make('select','adt-destination');select.id='adt-destination';
  const addButton=make('button','adt-pin-button cursor-interaction','Pin');addButton.type='submit';addForm.append(addLabel,select,addButton);
  const pinStatus=make('p','adt-pin-status');pinStatus.setAttribute('role','status');pinStatus.setAttribute('aria-live','polite');
  shortcuts.append(pinHeading,pinHelp,list,empty,addForm,pinStatus);body.append(notes,shortcuts);dialog.append(header,body);anchor.append(button);root.append(dialog);
  let disposed=false,timer=0,dirty=false,store=null,hasSaved=false,storageError=false,opened=false,previousFocus=null;
  let pins=[],fallbackInert=[];
  const resolve=destination=>{
    const target=destination.find?destination.find(root):root.querySelector(destination.selector);
    return target&&target.isConnected&&!dialog.contains(target)&&!target.disabled?target:null;
  };
  const available=()=>DESTINATIONS.filter(destination=>resolve(destination));
  try{
    store=win.localStorage;
    const saved=parseDeskTools(store.getItem(STORAGE_KEY));
    if(saved){hasSaved=true;pins=saved.pins;note.value=saved.note;saveStatus.textContent='Saved on this PC';}
    else saveStatus.textContent='Your note saves as you type';
  }catch{storageError=true;saveStatus.textContent='Saved notes could not be read. New notes stay here while Aurora stays open.';}
  const pendingDraft=sessionDrafts.get(root);
  if(pendingDraft){note.value=pendingDraft.note;pins=[...pendingDraft.pins];dirty=true;hasSaved=true;storageError=true;saveStatus.textContent='Unsaved note restored for this Aurora session. Saving is unavailable.';}
  if(!hasSaved)pins=['files','search','calendar'].filter(id=>available().some(item=>item.id===id));
  const setSaveStatus=(text,failed=false)=>{saveStatus.textContent=text;saveStatus.dataset.state=failed?'error':'ok';};
  if(storageError)saveStatus.dataset.state='error';
  function save(){
    win.clearTimeout(timer);timer=0;
    if(!dirty)return true;
    try{
      if(!store)store=win.localStorage;
      store.setItem(STORAGE_KEY,JSON.stringify({schema_version:1,note:note.value,pins}));
      dirty=false;hasSaved=true;storageError=false;sessionDrafts.delete(root);setSaveStatus('Saved on this PC');return true;
    }catch{
      storageError=true;sessionDrafts.set(root,{note:note.value,pins:[...pins]});setSaveStatus('Saving is unavailable. Your note and shortcuts stay here while Aurora stays open.',true);return false;
    }
  }
  function changed(){dirty=true;win.clearTimeout(timer);setSaveStatus('Saving on this PC');timer=win.setTimeout(save,450);}
  function renderPins(focusId=null,focusAction=null){
    list.replaceChildren();empty.hidden=Boolean(pins.length);
    pins.forEach((id,index)=>{
      const destination=DESTINATIONS.find(item=>item.id===id);if(!destination)return;
      const item=make('li','adt-pin'),launch=make('button','adt-pin-open cursor-interaction',destination.label);launch.type='button';launch.dataset.adtOpen=id;
      if(!resolve(destination)){launch.disabled=true;launch.title='This destination is unavailable in the current desktop';}
      const tools=make('div','adt-pin-tools');
      for(const [action,label,disabled]of [['earlier','Earlier',index===0],['later','Later',index===pins.length-1],['unpin','Unpin',false]]){
        const control=make('button','adt-pin-tool cursor-interaction',label);control.type='button';control.dataset.adtPin=id;control.dataset.adtAction=action;control.disabled=disabled;
        control.setAttribute('aria-label',action==='unpin'?'Unpin '+destination.label:'Move '+destination.label+' '+label.toLowerCase());tools.append(control);
      }
      item.append(launch,tools);list.append(item);
    });
    const remaining=available().filter(item=>!pins.includes(item.id)),selected=select.value;select.replaceChildren();
    for(const destination of remaining){const option=make('option','',destination.label);option.value=destination.id;select.append(option);}
    if(!remaining.length){const option=make('option','','All available shortcuts pinned');option.value='';select.append(option);}
    select.disabled=addButton.disabled=!remaining.length;
    if(remaining.some(item=>item.id===selected))select.value=selected;
    if(focusId){
      const control=[...list.querySelectorAll('button')].find(item=>focusAction?item.dataset.adtPin===focusId&&item.dataset.adtAction===focusAction&&!item.disabled:item.dataset.adtOpen===focusId);
      const ownLaunch=[...list.querySelectorAll('[data-adt-open]')].find(item=>item.dataset.adtOpen===focusId&&!item.disabled);
      (control||ownLaunch||list.querySelector('button:not(:disabled)')||(!select.disabled?select:closeButton)).focus({preventScroll:true});
    }
  }
  function restoreInert(){for(const entry of fallbackInert)entry.element.inert=entry.inert;fallbackInert=[];}
  function close({restore=true}={}){
    if(!opened)return;opened=false;save();button.setAttribute('aria-expanded','false');
    if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open');
    restoreInert();
    if(restore){const target=previousFocus?.isConnected?previousFocus:button;target.focus({preventScroll:true});}
  }
  function open(){
    if(disposed||opened)return;
    if(!hasSaved&&!pins.length)pins=['files','search','calendar'].filter(id=>available().some(item=>item.id===id));
    renderPins();previousFocus=doc.activeElement;opened=true;button.setAttribute('aria-expanded','true');
    try{if(typeof dialog.showModal!=='function')throw new Error('Modal dialog unavailable');dialog.showModal();}
    catch{
      dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      fallbackInert=[...root.children].filter(element=>element!==dialog).map(element=>({element,inert:element.inert}));
      for(const entry of fallbackInert)entry.element.inert=true;
    }
    note.focus({preventScroll:true});
  }
  function keydown(event){
    if(!opened)return;
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Tab'){
      const controls=[...dialog.querySelectorAll('button:not([disabled]),textarea,select:not([disabled]),[tabindex="0"]')].filter(element=>element.getClientRects().length);
      if(!controls.length){event.preventDefault();closeButton.focus();return;}
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
    }
  }
  function focusGuard(event){if(opened&&!dialog.contains(event.target))note.focus({preventScroll:true});}
  function dialogClick(event){
    event.stopPropagation();
    if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();return;}
    const launch=event.target.closest('[data-adt-open]');
    if(launch){
      const destination=DESTINATIONS.find(item=>item.id===launch.dataset.adtOpen),target=destination&&resolve(destination);
      if(!target){pinStatus.textContent='This shortcut is unavailable. Try reopening Desk tools.';renderPins();return;}
      close({restore:false});target.click();return;
    }
    const control=event.target.closest('[data-adt-action]');if(!control)return;
    const id=control.dataset.adtPin,index=pins.indexOf(id),action=control.dataset.adtAction;if(index<0)return;
    const label=DESTINATIONS.find(item=>item.id===id).label;
    if(action==='unpin'){pins.splice(index,1);pinStatus.textContent=label+' unpinned.';changed();renderPins(pins[Math.min(index,pins.length-1)]||null);if(!pins.length)(select.disabled?closeButton:select).focus({preventScroll:true});}
    else{
      const next=index+(action==='earlier'?-1:1);if(next<0||next>=pins.length)return;
      [pins[index],pins[next]]=[pins[next],pins[index]];pinStatus.textContent=label+' moved '+(action==='earlier'?'earlier.':'later.');changed();renderPins(id,action);
    }
  }
  function pin(event){
    event.preventDefault();const destination=available().find(item=>item.id===select.value);if(!destination||pins.includes(destination.id))return;
    pins.push(destination.id);pinStatus.textContent=destination.label+' pinned.';changed();renderPins(destination.id);
  }
  const cancel=event=>{event.preventDefault();close();},dismiss=()=>close(),onClose=()=>{if(opened)close();},beforeLeave=()=>save();
  button.addEventListener('click',open);closeButton.addEventListener('click',dismiss);note.addEventListener('input',changed);dialog.addEventListener('click',dialogClick);dialog.addEventListener('keydown',keydown);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',onClose);addForm.addEventListener('submit',pin);doc.addEventListener('focusin',focusGuard);win.addEventListener('pagehide',beforeLeave);
  function cleanup(){
    if(disposed)return;close();save();disposed=true;win.clearTimeout(timer);restoreInert();
    button.removeEventListener('click',open);closeButton.removeEventListener('click',dismiss);note.removeEventListener('input',changed);dialog.removeEventListener('click',dialogClick);dialog.removeEventListener('keydown',keydown);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',onClose);addForm.removeEventListener('submit',pin);doc.removeEventListener('focusin',focusGuard);win.removeEventListener('pagehide',beforeLeave);button.remove();dialog.remove();instances.delete(root);
  }
  instances.set(root,cleanup);return cleanup;
}
