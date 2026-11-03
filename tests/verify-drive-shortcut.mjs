import assert from 'node:assert/strict';
import {initFileBrowser,localDiskShortcut,FOLDER_TYPES} from '../src/aurora-file-browser.mjs';

assert.deepEqual(localDiskShortcut({LocalDisk:'C:\\'}),{label:'Local disk (C:)',path:'C:\\',detail:'Open in File Explorer'});
for(const path of [undefined,'C:','C:/Windows','C:/../Windows','D:/','\\\\server\\share','C:/&start.exe'])assert.equal(localDiskShortcut({LocalDisk:path}),null);
assert.ok(!FOLDER_TYPES.includes('LocalDisk'),'Drive is not added to the indexed source types');

class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes=new Map();this.listeners=new Map();this.className='';this.textContent='';this.disabled=false;}
  get isConnected(){return this.connected||Boolean(this.parent?.isConnected);}
  get lastElementChild(){return this.children.at(-1);}
  append(...items){for(const item of items){item.remove();item.parent=this;this.children.push(item);}}
  replaceChildren(...items){for(const child of this.children)child.parent=null;this.children=[];this.append(...items);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(){}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  contains(item){return this===item||this.children.some(child=>child.contains(item));}
  matches(selector){
    const parts=selector.trim().split(/\s+/);if(parts.length>1){const last=parts.pop();if(!this.matches(last))return false;let ancestor=this.parent;while(ancestor){if(ancestor.matches(parts.join(' ')))return true;ancestor=ancestor.parent;}return false;}
    const match=selector.match(/^([a-z]+)?(?:\.([a-z-]+))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/);if(!match)return false;
    if(match[1]&&match[1]!==this.tag)return false;if(match[2]&&!this.className.split(' ').includes(match[2]))return false;
    if(match[3]){const attribute=match[3],value=attribute.startsWith('data-')?this.dataset[attribute.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this[attribute]??this.getAttribute(attribute);if(match[4]!==undefined?value!==match[4]:value===undefined||value===null)return false;}
    return true;
  }
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){}
}
const root=new Element(),panel=new Element(),content=new Element(),name=new Element(),library=new Element(),list=new Element();
root.connected=true;panel.className='ah-window';content.className='ah-window-content';name.className='ah-window-name';library.className='ah-library';list.className='ah-folders';root.append(panel,library);panel.append(name,content);library.append(list);
for(const title of ['Projects','Archives']){const category=new Element('button');category.className='ah-folder';category.textContent=title;list.append(category);}
const categories=[...list.children],observers=[];
const win={CustomEvent:class{},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
const doc={defaultView:win,createElement:tag=>new Element(tag)};root.ownerDocument=doc;
const calls=[];let failOpen=false,holdOpen=false,releaseOpen,unsubscribed=0;
const invoke=async(command,args)=>{calls.push({command,args});if(command==='open'){if(failOpen)throw new Error('denied');if(holdOpen)return new Promise(resolve=>{releaseOpen=resolve;});return;}return [];};
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const api=initFileBrowser({root,invoke,subscribe:async()=>()=>{unsubscribed++;},SeelenCommand:{OpenFile:'open',GetUserFolderContent:'index'},SeelenEvent:{UserFolderChanged:'changed'},openPanel:()=>{panel.dataset.panel='files';},desktopPath:'C:/Users/Example/Desktop',categories:['Projects','Archives'],knownRoots:{LocalDisk:'C:\\',Documents:'C:/Users/Example/Documents'}});
await drain();assert.equal(list.children.length,3);assert.deepEqual(list.children.slice(0,2),categories,'Existing category nodes and order stay unchanged');
const drive=list.children[2];assert.match(drive.getAttribute('aria-label'),/Local disk \(C:\).*Open in File Explorer/);assert.match(drive.title,/not part of Aurora/);
root.fire('click',{target:drive.lastElementChild});await drain();assert.deepEqual(calls.at(-1),{command:'open',args:{path:'C:\\'}});assert.equal(drive.disabled,false);
assert.equal(api.openRoot('LocalDisk'),false,'No misleading empty drive index');
panel.dataset.panel='library';const modalFolders=new Element();modalFolders.className='ah-folders';
const modalCategories=[new Element('button'),new Element('button')];modalFolders.append(...modalCategories);content.replaceChildren(modalFolders);
observers[0].fn();observers[0].fn();assert.equal(modalFolders.children.length,3,'Library modal gets one drive shortcut');assert.deepEqual(modalFolders.children.slice(0,2),modalCategories,'Modal category nodes stay intact');
const modalDrive=modalFolders.querySelector('[data-afb-drive="local"]');root.fire('click',{target:modalDrive});await drain();assert.deepEqual(calls.at(-1),{command:'open',args:{path:'C:\\'}},'Library modal has the same exact native route');
assert.equal(api.openRoot('Desktop'),true);await drain();
const sidebar=content.querySelector('.afb-sidebar');assert.equal(sidebar.querySelectorAll('[data-afb-category]').length,2);const sidebarDrive=sidebar.querySelector('[data-afb-drive="local"]');assert.ok(sidebarDrive);
const indexCalls=calls.filter(call=>call.command==='index').length;root.fire('click',{target:sidebarDrive});await drain();assert.deepEqual(calls.at(-1),{command:'open',args:{path:'C:\\'}});assert.equal(calls.filter(call=>call.command==='index').length,indexCalls,'Opening drive does not start a new index query');
failOpen=true;root.fire('click',{target:sidebarDrive});await drain();assert.match(sidebarDrive.querySelector('.afb-drive-detail').textContent,/Could not open/);assert.equal(sidebarDrive.disabled,false);failOpen=false;
holdOpen=true;root.fire('click',{target:drive});root.fire('click',{target:drive});await drain();assert.equal(drive.disabled,true);const before=calls.length;api.dispose();releaseOpen();await drain();root.fire('click',{target:sidebarDrive});assert.equal(calls.length,before);assert.deepEqual(list.children,categories);assert.equal(unsubscribed,1);assert.ok(observers.every(observer=>observer.disconnected));
assert.ok(calls.every(call=>call.command==='open'?call.args.path==='C:\\':call.command==='index'&&call.args.folderType==='Desktop'),'Only explicit drive opens and the existing Desktop index are invoked');
console.log('Drive shortcut: exact C:\\ route across desktop Library, Library modal and file-browser sidebar; explicit Explorer label, preserved categories, no drive scan, error feedback, duplicate-click guard and disposal passed. All native calls mocked.');
