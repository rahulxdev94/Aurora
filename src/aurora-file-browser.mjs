/* Aurora file index browser. Read-only navigation and explicit OpenFile calls.
   No shell command, filesystem mutation, credential access or new native window. */
export const FOLDER_TYPES=Object.freeze(['Desktop','Downloads','Documents','Music','Pictures','Videos','Recent']);
const MAX_VISIBLE=300;
export function localDiskShortcut(knownRoots={}){
  return normalisePath(knownRoots.LocalDisk)==='C:/'?{label:'Local disk (C:)',path:'C:\\',detail:'Open in File Explorer'}:null;
}

export function normalisePath(value){
  if(typeof value!=='string'||!value||value!==value.trim()||/[\x00-\x1f]/.test(value))return null;
  let path=value.replaceAll('\\','/');
  if(/^\/\/\?\/UNC\//i.test(path))path='//'+path.slice(8);
  else if(/^\/\/\?\/[a-z]:\//i.test(path))path=path.slice(4);
  let prefix,rest;
  const drive=path.match(/^([a-z]):\//i);
  if(drive){prefix=drive[1].toUpperCase()+':/';rest=path.slice(3);}
  else{
    const unc=path.match(/^\/\/([^/]+)\/([^/]+)(?:\/|$)/);
    if(!unc||/[<>:"|?*]/.test(unc[1]+unc[2])||[unc[1],unc[2]].some(part=>part==='.'||part==='..'||/[. ]$/.test(part)))return null;
    prefix='//'+unc[1]+'/'+unc[2];rest=path.slice(unc[0].length);
  }
  const parts=rest.split('/').filter(Boolean);
  if(parts.some(part=>part==='.'||part==='..'||/[<>:"|?*]/.test(part)||/[. ]$/.test(part)))return null;
  return prefix+(parts.length?(prefix.endsWith('/')?'':'/')+parts.join('/'):'');
}
const key=path=>normalisePath(path)?.toLowerCase()||null;
export function isPathWithin(path,boundary,includeSelf=true){
  const value=key(path),base=key(boundary);if(!value||!base)return false;
  if(value===base)return includeSelf;
  return value.startsWith(base.endsWith('/')?base:base+'/');
}
export function parentPath(value){
  const path=normalisePath(value);if(!path)return null;
  if(/^[A-Z]:\/$/.test(path)||/^\/\/[^/]+\/[^/]+$/.test(path))return null;
  const at=path.lastIndexOf('/');return at===2?path.slice(0,3):path.slice(0,at);
}
const basename=value=>value.slice(value.lastIndexOf('/')+1)||value;
const windowsPath=value=>value.replaceAll('/','\\');

export function parseFolderEvent(event){
  const payload=event?.payload??event;
  return payload&&FOLDER_TYPES.includes(payload.ofFolder)&&Array.isArray(payload.content)?payload:null;
}
export function initialIndexState(){return{files:new Map(),status:'waiting',eventVersion:0,receivedEvent:false,updatedAt:null,error:false};}
export function nextIndexState(previous,content,source,boundary=null){
  if(!Array.isArray(content))throw new TypeError('File index must be an array');
  const files=new Map();
  for(const original of content){
    const path=normalisePath(original);
    if(!path||(boundary&&!isPathWithin(path,boundary,false)))continue;
    files.set(key(path),{path,original});
  }
  const event=source==='event';
  if(!event&&files.size===0)return{...previous,status:previous.receivedEvent?'ready':'waiting',error:false};
  return{files,status:'ready',eventVersion:previous.eventVersion+(event?1:0),receivedEvent:previous.receivedEvent||event,updatedAt:Date.now(),error:false};
}
export function failedIndexState(previous){return{...previous,status:'error',error:true};}

export function indexedChildren(files,currentPath,{query='',flat=false}={}){
  const base=normalisePath(currentPath),needle=query.trim().toLocaleLowerCase(),entries=new Map();
  for(const file of files.values()){
    if(!flat&&(!base||!isPathWithin(file.path,base,false)))continue;
    const relative=flat?file.path:file.path.slice(base.length+(base.endsWith('/')?0:1));
    if(needle){if(relative.toLocaleLowerCase().includes(needle))entries.set('f:'+key(file.path),{...file,kind:'file',name:basename(file.path),detail:relative});continue;}
    const slash=relative.indexOf('/');
    if(flat||slash<0){entries.set('f:'+key(file.path),{...file,kind:'file',name:basename(file.path),detail:flat?file.path:''});}
    else{
      const name=relative.slice(0,slash),path=base+(base.endsWith('/')?'':'/')+name;
      entries.set('d:'+key(path),{kind:'folder',name,path,detail:'Indexed folder'});
    }
  }
  return[...entries.values()].sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
}

export function initFileBrowser({root,invoke,subscribe,SeelenCommand,SeelenEvent,openPanel,desktopPath,categories=[],knownRoots={}}={}){
  if(!root||typeof invoke!=='function'||typeof subscribe!=='function'||typeof openPanel!=='function')throw new Error('File browser requires the existing panel and Seelen bridge');
  if(!SeelenCommand?.GetUserFolderContent||!SeelenCommand?.OpenFile||!SeelenEvent?.UserFolderChanged)throw new Error('Seelen file index capability is unavailable');
  const panel=root.querySelector('.ah-window'),content=panel?.querySelector('.ah-window-content');
  if(!panel||!content)throw new Error('Existing Aurora panel is missing');
  const doc=root.ownerDocument,win=doc.defaultView;
  const localDisk=localDiskShortcut(knownRoots);
  const roots=Object.fromEntries(FOLDER_TYPES.filter(type=>type!=='Recent').map(type=>[type,normalisePath(type==='Desktop'?desktopPath:knownRoots[type])]));
  if(!roots.Desktop)throw new Error('A valid Desktop root is required');
  const categoryRows=categories.map((category,index)=>{
    const name=typeof category==='string'?category:category?.name;
    if(typeof name!=='string'||!name||/[\\/]/.test(name))return null;
    const path=normalisePath(roots.Desktop+'/'+name);
    return path&&isPathWithin(path,roots.Desktop,false)?{index,name,path,icon:typeof category==='object'?category.icon:null}:null;
  }).filter(Boolean);
  const states=new Map(FOLDER_TYPES.map(type=>[type,initialIndexState()]));
  const pending=new Map();let disposed=false,unlisten=null,subscriptionReady=false,subscriptionPromise=null;
  let current={type:'Desktop',path:roots.Desktop},history=[],query='',view=null,rows=new Map(),searchTimer=null,focusFrame=0;
  const icon=name=>{const element=doc.createElement('i');element.dataset.lucide=name;element.setAttribute('aria-hidden','true');return element;};
  const node=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
  const button=(label,iconName,action)=>{const element=node('button','afb-button cursor-interaction');element.type='button';element.setAttribute('aria-label',label);if(iconName)element.append(icon(iconName));element.append(node('span','',label));if(action)element.dataset.afbAction=action;return element;};
  const icons=()=>win.lucide?.createIcons({attrs:{width:16,height:16}});
  const emit=type=>{const state=states.get(type);root.dispatchEvent(new win.CustomEvent('aurora:file-index-updated',{detail:{folderType:type,count:state.files.size,status:state.status}}));};
  const notify=text=>{if(view?.isConnected)view.querySelector('.afb-feedback').textContent=text;};
  function driveButton(inLibrary=false){
    const item=node('button',inLibrary?'ah-folder afb-drive-shortcut cursor-interaction':'afb-button afb-drive-shortcut cursor-interaction');
    item.type='button';item.dataset.afbDrive='local';
    item.setAttribute('aria-label',localDisk.label+' · '+localDisk.detail);
    item.title='Open C:\\ in File Explorer. Drive contents are not part of Aurora’s folder index.';
    const symbol=node('span','afb-drive-symbol');symbol.setAttribute('aria-hidden','true');
    const label=node('span',inLibrary?'ah-folder-label afb-drive-label':'afb-drive-label',localDisk.label);
    label.append(node('small','afb-drive-detail',localDisk.detail));item.append(symbol,label);return item;
  }
  const libraryList=root.querySelector('.ah-library .ah-folders');
  const libraryDrive=localDisk&&libraryList?driveButton(true):null;
  let modalDrive=null;
  if(libraryDrive)libraryList.append(libraryDrive);
  function syncLibraryDrive(){
    if(disposed||!localDisk||panel.dataset.panel!=='library')return;
    const list=content.querySelector('.ah-folders');
    if(!list||list.querySelector('[data-afb-drive="local"]'))return;
    modalDrive?.remove();modalDrive=driveButton(true);list.append(modalDrive);
  }
  async function onDriveClick(event){
    const target=event.target.closest('button[data-afb-drive="local"]');
    if(disposed||!localDisk||!target||!root.contains(target)||target.disabled)return;
    target.disabled=true;
    const detail=target.querySelector('.afb-drive-detail');if(detail)detail.textContent='Opening File Explorer…';
    try{await invoke(SeelenCommand.OpenFile,{path:localDisk.path});if(!disposed){if(detail)detail.textContent='Opened in File Explorer';notify('Opened Local disk (C:) in File Explorer.');}}
    catch{if(!disposed){if(detail)detail.textContent='Could not open. Try again.';notify('Local disk (C:) could not be opened in File Explorer.');}}
    finally{if(!disposed)target.disabled=false;}
  }
  root.addEventListener('click',onDriveClick);
  const validFolder=path=>{
    if(!path||current.type==='Recent'||!isPathWithin(path,roots[current.type]))return false;
    if(key(path)===key(roots[current.type]))return true;
    if(current.type==='Desktop'&&categoryRows.some(category=>key(category.path)===key(path)))return true;
    return[...states.get(current.type).files.values()].some(file=>isPathWithin(file.path,path,false));
  };
  function receive(event){
    const payload=parseFolderEvent(event);if(!payload||disposed)return;
    const boundary=payload.ofFolder==='Recent'?null:roots[payload.ofFolder];
    if(payload.ofFolder!=='Recent'&&!boundary)return;
    states.set(payload.ofFolder,nextIndexState(states.get(payload.ofFolder),payload.content,'event',boundary));
    emit(payload.ofFolder);if(current.type===payload.ofFolder)render();
  }
  async function connect(){
    if(subscriptionReady)return true;if(subscriptionPromise)return subscriptionPromise;
    subscriptionPromise=Promise.resolve().then(()=>subscribe(SeelenEvent.UserFolderChanged,receive)).then(stop=>{
      if(typeof stop!=='function')throw new Error('File index subscription did not return an unsubscribe function');
      if(disposed){stop();return false;}unlisten=stop;subscriptionReady=true;return true;
    }).catch(()=>{if(!disposed){states.set(current.type,failedIndexState(states.get(current.type)));emit(current.type);render();}return false;}).finally(()=>{subscriptionPromise=null;});
    return subscriptionPromise;
  }
  async function refresh(type){
    if(disposed||!FOLDER_TYPES.includes(type)||pending.has(type))return;
    if(type!=='Recent'&&!roots[type])return;
    const operation=(async()=>{
      if(!await connect()||disposed)return;
      const version=states.get(type).eventVersion;
      try{
        const paths=await invoke(SeelenCommand.GetUserFolderContent,{folderType:type});
        if(disposed||states.get(type).eventVersion!==version)return;
        states.set(type,nextIndexState(states.get(type),paths,'query',type==='Recent'?null:roots[type]));
      }catch{if(!disposed&&states.get(type).eventVersion===version)states.set(type,failedIndexState(states.get(type)));}
      if(!disposed){emit(type);if(current.type===type)render();}
    })();pending.set(type,operation);try{await operation;}finally{pending.delete(type);}
  }
  function fileType(name){
    const match=name.match(/\.([^.]+)$/),extension=match?match[1].toUpperCase():'';
    let symbol='file-pen-line';
    if(/^(PNG|JPE?G|GIF|WEBP|HEIC|BMP|SVG|ICO)$/.test(extension))symbol='images';
    else if(/^(MP4|MKV|MOV|AVI|WEBM)$/.test(extension))symbol='clapperboard';
    else if(/^(MP3|WAV|FLAC|AAC|M4A|OGG)$/.test(extension))symbol='circle-dot';
    else if(/^(ZIP|7Z|RAR|TAR|GZ)$/.test(extension))symbol='archive';
    else if(/^(PDF|DOCX?|XLSX?|PPTX?|TXT|MD|RTF)$/.test(extension))symbol='notebook-pen';
    else if(/^(EXE|LNK|MSI|URL)$/.test(extension))symbol='app-window';
    return{extension,symbol};
  }
  function setTitle(){
    if(panel.dataset.panel!=='files')return;
    const label=current.path?basename(current.path):current.type+' index';
    const name=panel.querySelector('.ah-window-name');if(name)name.textContent='Files · '+label;
    panel.setAttribute('aria-label','Aurora files · '+label);
  }
  function mount(){
    view=node('section','afb-shell');view.setAttribute('aria-label','Aurora indexed file browser');
    const sidebar=node('nav','afb-sidebar');sidebar.setAttribute('aria-label','File locations');
    sidebar.append(node('div','afb-nav-heading','YOUR CATEGORIES'));
    for(const category of categoryRows){const item=button(category.name,'folder-open');item.dataset.afbCategory=String(category.index);sidebar.append(item);}
    if(localDisk){sidebar.append(node('div','afb-nav-heading','DRIVES'),driveButton());}
    sidebar.append(node('div','afb-nav-heading','INDEX SOURCES'));
    const rootIcons={Desktop:'house',Downloads:'download',Documents:'notebook-pen',Music:'circle-dot',Pictures:'images',Videos:'clapperboard',Recent:'timer'};
    for(const type of FOLDER_TYPES){const item=button(type,rootIcons[type]);item.dataset.afbRoot=type;item.disabled=type!=='Recent'&&!roots[type];sidebar.append(item);}
    const main=node('div','afb-main'),toolbar=node('div','afb-toolbar');
    toolbar.append(button('Back','arrow-left','back'),button('Up','arrow-left','up'));
    const search=node('label','afb-search');search.append(icon('search'));
    const input=node('input');input.type='search';input.placeholder='Search indexed files';input.setAttribute('aria-label','Search indexed files in this location');input.autocomplete='off';search.append(input);toolbar.append(search,button('Refresh index','rotate-ccw','refresh'));
    const crumbs=node('nav','afb-crumbs');crumbs.setAttribute('aria-label','Folder path');
    const status=node('p','afb-status');status.setAttribute('role','status');
    const list=node('div','afb-list');list.setAttribute('aria-label','Indexed folders and files');
    const footer=node('footer','afb-footer'),details=node('details','afb-details');
    details.append(node('summary','','Indexed files · Some files may be omitted'),node('p','','Seelen supplies a filtered file index, up to five folders deep. Empty directories and excluded or not-yet-indexed files may not appear. File sizes and modified dates are not supplied. Recent is an indexed source, not a verified date order.'));
    footer.append(details,button('Open folder in File Explorer','arrow-up-right','explorer'));
    const feedback=node('p','afb-feedback');feedback.setAttribute('role','status');
    main.append(toolbar,crumbs,status,list,feedback,footer);view.append(sidebar,main);content.replaceChildren(view);
    view.addEventListener('click',onClick);
    input.addEventListener('input',()=>{query=input.value;clearTimeout(searchTimer);searchTimer=setTimeout(render,90);});
    render();
  }
  function render(){
    if(disposed||!view?.isConnected||panel.dataset.panel!=='files')return;
    setTitle();const state=states.get(current.type);
    view.querySelectorAll('[data-afb-category]').forEach(item=>item.setAttribute('aria-current',String(current.type==='Desktop'&&key(categoryRows.find(category=>category.index===Number(item.dataset.afbCategory))?.path)===key(current.path))));
    view.querySelectorAll('[data-afb-root]').forEach(item=>item.setAttribute('aria-current',String(item.dataset.afbRoot===current.type&&(!current.path||key(current.path)===key(roots[current.type])))));
    view.querySelector('[data-afb-action="back"]').disabled=!history.length;
    const parent=current.path?parentPath(current.path):null;
    view.querySelector('[data-afb-action="up"]').disabled=!parent||!isPathWithin(parent,roots[current.type]);
    view.querySelector('[data-afb-action="explorer"]').disabled=!validFolder(current.path);
    const crumbs=view.querySelector('.afb-crumbs');crumbs.replaceChildren();
    const first=button(current.type,null);first.dataset.afbCrumb=roots[current.type]||'';crumbs.append(first);
    if(current.path&&roots[current.type]&&isPathWithin(current.path,roots[current.type],false)){
      let path=roots[current.type];for(const part of current.path.slice(path.length+(path.endsWith('/')?0:1)).split('/')){path+=(path.endsWith('/')?'':'/')+part;crumbs.append(icon('chevron-right'));const item=button(part,null);item.dataset.afbCrumb=path;crumbs.append(item);}
    }
    let entries=indexedChildren(state.files,current.path,{query,flat:current.type==='Recent'});
    if(!query&&current.type==='Desktop'&&key(current.path)===key(roots.Desktop)){
      const known=new Set(entries.map(entry=>key(entry.path)));for(const category of categoryRows)if(!known.has(key(category.path)))entries.push({...category,kind:'folder',detail:'Desktop category'});
      entries.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
    }
    const status=view.querySelector('.afb-status');
    const suffix=entries.length>MAX_VISIBLE?` · Showing ${MAX_VISIBLE} of ${entries.length}; narrow your search`:'';
    status.textContent=(state.status==='error'?'Index unavailable. '+(state.files.size?'Showing the last received index.':'Try Refresh index or use File Explorer.'):state.status==='waiting'?'Waiting for Seelen’s file index'+(state.files.size?' · Showing the last received index.':'.'):`${entries.length} indexed ${entries.length===1?'item':'items'}${suffix}`);
    const list=view.querySelector('.afb-list');list.replaceChildren();rows=new Map();
    for(const [index,entry] of entries.slice(0,MAX_VISIBLE).entries()){
      const info=entry.kind==='folder'?{symbol:'folder-open',extension:'Folder'}:fileType(entry.name);
      const item=button('',info.symbol);item.className='afb-entry cursor-interaction';item.dataset.afbRow=String(index);item.dataset.kind=entry.kind;
      item.lastElementChild.remove();item.setAttribute('aria-label',(entry.kind==='folder'?'Browse ':'Open ')+entry.name);
      const text=node('span','afb-entry-text');text.append(node('strong','',entry.name),node('small','',entry.detail||info.extension||'File'));item.append(text);
      rows.set(String(index),entry);list.append(item);
    }
    if(!entries.length){const message=query?'No indexed files match this search.':state.status==='waiting'?'The index is still warming up.':state.status==='error'?'The index could not be read.':'No indexed files are shown here. This does not mean the folder is empty.';list.append(node('p','afb-empty',message));}
    icons();
  }
  function navigate(type,path,{remember=true}={}){
    if(!FOLDER_TYPES.includes(type)||(type!=='Recent'&&!roots[type]))return false;
    const next=type==='Recent'?null:normalisePath(path||roots[type]);if(type!=='Recent'&&!isPathWithin(next,roots[type]))return false;
    if(remember&&(type!==current.type||key(next)!==key(current.path)))history.push({...current});
    current={type,path:next};query='';if(view?.isConnected)view.querySelector('input[type="search"]').value='';render();void refresh(type);return true;
  }
  async function openIndexed(entry){
    const record=states.get(current.type).files.get(key(entry.path));
    if(!record){notify('This file is no longer in the current index. Refresh and try again.');return;}
    try{await invoke(SeelenCommand.OpenFile,{path:record.original});notify('Opened '+entry.name+'.');}
    catch{notify('This file could not be opened. It may have moved or need to download from OneDrive.');}
  }
  async function openExplorer(){
    if(!validFolder(current.path)){notify('This location is not available as a verified folder path.');return;}
    try{await invoke(SeelenCommand.OpenFile,{path:windowsPath(current.path)});notify('Opened this folder in File Explorer.');}
    catch{notify('File Explorer could not open this folder.');}
  }
  function onClick(event){
    const target=event.target.closest('button');if(!target||!view.contains(target))return;
    if(target.dataset.afbCategory!==undefined){const category=categoryRows.find(item=>item.index===Number(target.dataset.afbCategory));if(category)navigate('Desktop',category.path);return;}
    if(target.dataset.afbRoot){navigate(target.dataset.afbRoot);return;}
    if(target.dataset.afbCrumb!==undefined){if(current.type==='Recent')navigate('Recent');else if(validFolder(target.dataset.afbCrumb))navigate(current.type,target.dataset.afbCrumb);return;}
    if(target.dataset.afbRow!==undefined){const entry=rows.get(target.dataset.afbRow);if(!entry)return;if(entry.kind==='folder'&&validFolder(entry.path))navigate(current.type,entry.path);else if(entry.kind==='file')void openIndexed(entry);return;}
    switch(target.dataset.afbAction){
      case'back':{const previous=history.pop();if(previous)navigate(previous.type,previous.path,{remember:false});break;}
      case'up':{const parent=parentPath(current.path);if(parent&&isPathWithin(parent,roots[current.type]))navigate(current.type,parent);break;}
      case'refresh':void refresh(current.type);notify('Requested the current Seelen index.');break;
      case'explorer':void openExplorer();break;
    }
  }
  function show(type,path){
    if(disposed||!FOLDER_TYPES.includes(type)||(type!=='Recent'&&!roots[type]))return false;
    openPanel();panel.dataset.panel='files';history=[];current={type,path:type==='Recent'?null:normalisePath(path||roots[type])};query='';mount();
    if(focusFrame)win.cancelAnimationFrame(focusFrame);focusFrame=win.requestAnimationFrame(()=>{focusFrame=0;if(view?.isConnected&&panel.dataset.panel==='files')view.querySelector('input[type="search"]').focus({preventScroll:true});});
    void refresh(type);return true;
  }
  const panelObserver=new win.MutationObserver(()=>{syncLibraryDrive();if(panel.dataset.panel==='files'&&view?.isConnected)setTitle();});
  panelObserver.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  syncLibraryDrive();
  void connect().then(connected=>{if(connected&&!disposed)void refresh('Desktop');});
  return{
    openFolder(index){const category=categoryRows.find(item=>item.index===index);return category?show('Desktop',category.path):false;},
    openRoot(type){return show(type,roots[type]);},
    dispose(){disposed=true;clearTimeout(searchTimer);if(focusFrame)win.cancelAnimationFrame(focusFrame);panelObserver.disconnect();root.removeEventListener('click',onDriveClick);libraryDrive?.remove();modalDrive?.remove();if(unlisten)unlisten();if(view)view.removeEventListener('click',onClick);}
  };
}
