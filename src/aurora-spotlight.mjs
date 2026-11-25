/* Aurora Spotlight view. Native operations are supplied by the caller. */
const FILTERS = Object.freeze([['all','Everything'],['apps','Apps'],['files','Files'],['folders','Folders'],['commands','Commands'],['web','Web']]);
const ICONS = Object.freeze({
  search:['M21 21l-4.4-4.4','M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0'],
  app:['M4 3h16v18H4z','M4 8h16','M8 5.5h.01M11 5.5h.01'],
  file:['M14 2H5v20h14V7z','M14 2v6h5','M8 13h8M8 17h6'],
  folder:['M2 5h8l2 3h10v12H2z'],
  command:['M7 5l6 7-6 7','M14 19h7'],
  web:['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0','M3 12h18','M12 3c5 5 5 13 0 18-5-5-5-13 0-18'],
  refresh:['M20 7v5h-5','M4 17v-5h5','M19 12a7 7 0 0 0-12-5L4 10M5 12a7 7 0 0 0 12 5l3-3'],
  close:['M6 6l12 12M18 6L6 18'],
  arrow:['M5 12h14M13 6l6 6-6 6']
});
let sequence=0;

/** Build a self-contained search modal, leaving native discovery and opening to providers. */
export function initSpotlight({root,search,activate,refresh,onClose,onShow,productName='Aurora'}={}) {
  if(!root?.ownerDocument||typeof search!=='function'||typeof activate!=='function')throw new TypeError('Spotlight requires a root, search and activate');
  const doc=root.ownerDocument,win=doc.defaultView,uid='aurora-spotlight-'+(++sequence);
  const node=(tag,className='',text)=>{const element=doc.createElement(tag);element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
  function icon(name) {
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    for(const d of ICONS[name]||ICONS.app){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;
  }
  const makeButton=(name,className,iconName)=>{const button=node('button',className);button.type='button';button.setAttribute('aria-label',name);button.title=name;if(iconName)button.append(icon(iconName));return button;};
  const layer=node('div','asp-layer');layer.hidden=true;
  const dialog=node('section','asp-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby',uid+'-title');
  const header=node('header','asp-header'),brand=node('div','asp-brand'),orbit=node('span','asp-orbit');orbit.setAttribute('aria-hidden','true');orbit.append(node('span'));
  const heading=node('h2','asp-title',productName+' Search');heading.id=uid+'-title';brand.append(orbit,heading);
  const shortcutHint=node('span','asp-shortcut','Ctrl + Alt + Space');shortcutHint.title='Open from anywhere · Ctrl + K inside '+productName;brand.append(shortcutHint);
  const tools=node('div','asp-tools'),closeButton=makeButton('Close search','asp-icon-button cursor-interaction','close');
  const refreshButton=refresh?makeButton('Refresh apps and files','asp-icon-button cursor-interaction','refresh'):null;
  if(refreshButton)tools.append(refreshButton);tools.append(closeButton);header.append(brand,tools);
  const field=node('div','asp-field'),input=node('input','asp-input');
  input.type='search';input.placeholder='Apps, files, folders, commands…';input.autocomplete='off';input.spellcheck=false;
  input.setAttribute('aria-label','Search apps, files, folders and commands');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',uid+'-results');input.setAttribute('aria-describedby',uid+'-status');
  const searchMark=node('span','asp-search-mark');searchMark.append(icon('search'));field.append(searchMark,input);
  const filters=node('div','asp-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Search categories');
  const filterButtons=new Map();
  for(const [value,label] of FILTERS){const button=makeButton(label,'asp-filter cursor-interaction');button.textContent=label;button.dataset.aspFilter=value;button.setAttribute('aria-pressed',String(value==='all'));filters.append(button);filterButtons.set(value,button);}
  const results=node('div','asp-results');results.id=uid+'-results';results.setAttribute('role','listbox');results.setAttribute('aria-label','Search results');
  const empty=node('div','asp-empty');empty.hidden=true;const emptyMark=node('span','asp-empty-mark');emptyMark.append(icon('search'));empty.append(emptyMark,node('strong','','Nothing here yet'),node('span','','Try another name or search category.'));
  const body=node('div','asp-body');body.append(results,empty);
  const footer=node('footer','asp-footer'),status=node('p','asp-status','Start typing to find your space.');status.id=uid+'-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const hints=node('div','asp-hints');
  for(const [keys,label] of [['↑ ↓','Navigate'],['Enter','Open'],['Ctrl Enter','Show folder'],['Esc','Close']]){const item=node('span');item.append(node('kbd','',keys),node('span','',label));hints.append(item);}
  footer.append(status,hints);dialog.append(header,field,filters,body,footer);layer.append(dialog);root.append(layer);
  let visible=false,disposed=false,filter='all',entries=[],buttons=[],selected=-1,queryEpoch=0,sessionEpoch=0,searchTimer=0,loading=false,launching=false,returnFocus=null,restoreInert=[],selectionId=null;
  function callHook(callback,label){try{Promise.resolve(callback?.()).catch(error=>console.warn(label,error));}catch(error){console.warn(label,error);}}
  const editable=target=>Boolean(target?.isContentEditable||target?.closest?.('input,textarea,select,[role="textbox"],[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]'));
  function currentQuery(){return input.value.trim();}
  function setStatus(text){status.textContent=String(text||'');}
  function syncSelection({scroll=false}={}){
    buttons.forEach((button,index)=>{const active=index===selected;button.setAttribute('aria-selected',String(active));button.dataset.active=String(active);});
    const active=buttons[selected];
    if(active&&!loading){input.setAttribute('aria-activedescendant',active.id);selectionId=entries[selected]?.id??null;if(scroll)active.scrollIntoView?.({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  }
  function setLoading(value){loading=value;results.setAttribute('aria-busy',String(value));input.setAttribute('aria-busy',String(value));buttons.forEach(button=>button.setAttribute('aria-disabled',String(value||launching)));dialog.dataset.loading=String(value);if(value)input.removeAttribute('aria-activedescendant');}
  function draw(payload){
    const unique=new Set();
    entries=(Array.isArray(payload?.results)?payload.results:[]).filter(item=>item&&typeof item.id==='string'&&!unique.has(item.id)&&unique.add(item.id)&&typeof item.title==='string').slice(0,80);
    results.replaceChildren();buttons=[];
    for(const [index,entry] of entries.entries()){
      const option=node('div','asp-result cursor-interaction');option.id=uid+'-result-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.dataset.aspIndex=String(index);
      const kind=String(entry.kind||'app').replace(/s$/,'');const symbol=node('span','asp-result-symbol');symbol.dataset.kind=kind;symbol.append(icon(kind));
      const words=node('span','asp-result-copy');words.append(node('strong','asp-result-title',entry.title));if(entry.subtitle)words.append(node('span','asp-result-detail',entry.subtitle));
      const meta=node('span','asp-result-meta',kind==='app'?'Open app':kind.charAt(0).toUpperCase()+kind.slice(1));const arrow=node('span','asp-result-arrow');arrow.append(icon('arrow'));option.append(symbol,words,meta,arrow);results.append(option);buttons.push(option);
    }
    const previous=entries.findIndex(entry=>entry.id===selectionId);selected=previous>=0?previous:entries.length?0:-1;
    setLoading(false);syncSelection();empty.hidden=entries.length>0;
    empty.querySelector('strong').textContent=currentQuery()?'No matches found':'Find your next move';
    empty.querySelector('span:last-child').textContent=currentQuery()?'Try another name or search category.':'Search an app, a filename or a '+productName+' command.';
    setStatus(payload?.status||`${entries.length} ${entries.length===1?'result':'results'}`);
  }
  async function executeSearch(epoch){
    if(disposed||!visible||epoch!==queryEpoch)return;
    try{const payload=await search(currentQuery(),filter);if(!disposed&&visible&&epoch===queryEpoch)draw(payload);}
    catch{if(!disposed&&visible&&epoch===queryEpoch){draw({results:[],status:'Search is unavailable. Try Refresh or reopen search.'});empty.querySelector('strong').textContent='Search unavailable';}}
  }
  function queueSearch(delay=90){
    if(disposed||!visible)return;const epoch=++queryEpoch;win.clearTimeout(searchTimer);setLoading(true);setStatus('Searching…');
    if(delay===0)void executeSearch(epoch);else searchTimer=win.setTimeout(()=>{searchTimer=0;void executeSearch(epoch);},delay);
  }
  function releaseBackground(){for(const [element,value] of restoreInert)if(element.isConnected)element.inert=value;restoreInert=[];}
  function hideInternal(restore=true){
    if(!visible)return;visible=false;sessionEpoch++;queryEpoch++;win.clearTimeout(searchTimer);searchTimer=0;launching=false;layer.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');releaseBackground();
    if(restore&&returnFocus?.isConnected&&!returnFocus.inert)returnFocus.focus?.({preventScroll:true});returnFocus=null;
    callHook(onClose,'Aurora search close callback failed');
  }
  function show(query=''){
    if(disposed)return;
    if(!visible){returnFocus=doc.activeElement;restoreInert=Array.from(root.children).filter(element=>element!==layer).map(element=>[element,element.inert]);for(const [element] of restoreInert)element.inert=true;visible=true;sessionEpoch++;layer.hidden=false;callHook(onShow,'Aurora search show callback failed');}
    input.setAttribute('aria-expanded','true');input.value=String(query);filter='all';for(const [name,button] of filterButtons)button.setAttribute('aria-pressed',String(name===filter));
    input.focus({preventScroll:true});input.select?.();queueSearch(0);
  }
  async function launch(index,reveal=false){
    if(disposed||!visible||loading||launching||!entries[index])return;
    const session=sessionEpoch,epoch=queryEpoch,entry=entries[index];launching=true;dialog.dataset.launching='true';buttons.forEach(button=>button.setAttribute('aria-disabled','true'));setStatus(reveal?'Opening containing folder…':'Opening '+entry.title+'…');
    try{const closed=await activate(entry,{reveal});if(disposed||!visible||session!==sessionEpoch||epoch!==queryEpoch)return;if(closed)hideInternal(false);else setStatus('Ready. Choose another result.');}
    catch(error){if(!disposed&&visible&&session===sessionEpoch&&epoch===queryEpoch)setStatus(typeof error?.message==='string'?error.message:'This result could not be opened. Refresh and try again.');}
    finally{if(!disposed&&session===sessionEpoch){launching=false;dialog.dataset.launching='false';buttons.forEach(button=>button.setAttribute('aria-disabled',String(loading)));}}
  }
  function changeFilter(value){if(!filterButtons.has(value)||value===filter)return;filter=value;selectionId=null;for(const [name,button] of filterButtons)button.setAttribute('aria-pressed',String(name===value));input.focus({preventScroll:true});queueSearch(0);}
  function onInput(){queueSearch();}
  function onClick(event){
    const target=event.target;
    if(target===layer){hideInternal();return;}
    const chip=target.closest?.('[data-asp-filter]');if(chip&&filters.contains(chip)){changeFilter(chip.dataset.aspFilter);return;}
    const option=target.closest?.('[data-asp-index]');if(option&&results.contains(option)){selected=Number(option.dataset.aspIndex);syncSelection();void launch(selected,Boolean(event.ctrlKey));}
  }
  function onPointerMove(event){if(loading||launching)return;const option=event.target.closest?.('[data-asp-index]');if(option&&results.contains(option)){selected=Number(option.dataset.aspIndex);syncSelection();}}
  function onTrigger(event){const button=event.target.closest?.('[data-aurora-search]');if(!button||!root.contains(button))return;event.preventDefault();event.stopImmediatePropagation();show();}
  function onKey(event){
    if(disposed||event.isComposing)return;
    const shortcut=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k';
    const slash=event.key==='/'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!editable(event.target);
    if(!visible){if((shortcut||slash)&&root.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();show();}return;}
    if(shortcut){event.preventDefault();event.stopImmediatePropagation();input.focus({preventScroll:true});input.select?.();return;}
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hideInternal();return;}
    if(event.key==='Tab'){
      const focusables=[...(refreshButton?[refreshButton]:[]),closeButton,input,...filterButtons.values()].filter(element=>!element.disabled);
      const at=focusables.indexOf(doc.activeElement);if(at<0||(event.shiftKey&&at===0)||(!event.shiftKey&&at===focusables.length-1)){event.preventDefault();focusables[event.shiftKey?focusables.length-1:0]?.focus();}event.stopPropagation();return;
    }
    if(event.target===input&&['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key)){
      if(['Home','End'].includes(event.key)&&!event.ctrlKey)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Enter'){void launch(selected,Boolean(event.ctrlKey||event.metaKey));return;}
      if(loading||!entries.length)return;
      selected=event.key==='Home'?0:event.key==='End'?entries.length-1:(selected+(event.key==='ArrowDown'?1:-1)+entries.length)%entries.length;syncSelection({scroll:true});
    }
  }
  function onFocus(event){if(visible&&!dialog.contains(event.target))input.focus({preventScroll:true});}
  async function onRefresh(){
    if(!refresh||refreshButton.disabled)return;const session=sessionEpoch,epoch=++queryEpoch;refreshButton.disabled=true;win.clearTimeout(searchTimer);setLoading(true);setStatus('Refreshing apps and files…');
    try{await refresh();if(!disposed&&visible&&session===sessionEpoch)queueSearch(0);}
    catch{if(!disposed&&visible&&session===sessionEpoch&&epoch===queryEpoch){setLoading(false);setStatus('Refresh unavailable. Showing the last search results.');syncSelection();}}
    finally{if(!disposed)refreshButton.disabled=false;}
  }
  const onCloseClick=()=>hideInternal();
  input.addEventListener('input',onInput);layer.addEventListener('click',onClick);results.addEventListener('pointermove',onPointerMove);closeButton.addEventListener('click',onCloseClick);refreshButton?.addEventListener('click',onRefresh);root.addEventListener('click',onTrigger,true);doc.addEventListener('keydown',onKey,true);doc.addEventListener('focusin',onFocus,true);
  return Object.freeze({show,hide:()=>hideInternal(),refreshResults:()=>queueSearch(0),dispose(){if(disposed)return;hideInternal(false);disposed=true;queryEpoch++;win.clearTimeout(searchTimer);input.removeEventListener('input',onInput);layer.removeEventListener('click',onClick);results.removeEventListener('pointermove',onPointerMove);closeButton.removeEventListener('click',onCloseClick);refreshButton?.removeEventListener('click',onRefresh);root.removeEventListener('click',onTrigger,true);doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('focusin',onFocus,true);layer.remove();}});
}
