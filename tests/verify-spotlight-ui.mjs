import assert from 'node:assert/strict';
import {initSpotlight} from '../src/aurora-spotlight.mjs';

// A minimal DOM surface keeps these interaction tests independent of Windows.
class Events {
  listeners=new Map();
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  fire(name,event={}){event.preventDefault??=()=>{event.prevented=true;};event.stopPropagation??=()=>{event.stopped=true;};event.stopImmediatePropagation??=()=>{event.stopped=true;};for(const fn of this.listeners.get(name)||[])fn(event);return event;}
  count(){return [...this.listeners.values()].reduce((n,items)=>n+items.size,0);}
}
class Element extends Events {
  constructor(tag,doc){super();this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.dataset={};this.className='';this.textContent='';this.inert=false;this.value='';this.disabled=false;}
  setAttribute(k,v){this.attrs.set(k,String(v));}
  getAttribute(k){return this.attrs.get(k)??null;}
  removeAttribute(k){this.attrs.delete(k);}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children.forEach(node=>node.parent=null);this.children=[];this.append(...nodes);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  get isConnected(){return this===this.ownerDocument.root||Boolean(this.parent?.isConnected);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  matches(selector){
    if(selector.includes(','))return selector.split(',').some(value=>this.matches(value));
    if(selector.endsWith(':last-child'))return this.parent?.children.at(-1)===this&&this.matches(selector.slice(0,-11));
    if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));
    const attribute=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if(attribute){const key=attribute[1];const value=key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]:this.getAttribute(key);return attribute[2]===undefined?value!==null&&value!==undefined:value===attribute[2];}
    return this.tag===selector;
  }
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  focus(){this.ownerDocument.activeElement=this;this.ownerDocument.fire('focusin',{target:this});}
  select(){this.selectedText=true;}
  scrollIntoView(){this.scrolled=true;}
}
const doc=new Events(),win=new Events();doc.defaultView=win;
doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_,tag)=>new Element(tag,doc);
let timerId=0;const timers=new Map();win.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};win.clearTimeout=id=>timers.delete(id);
const tick=async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}for(let i=0;i<12;i++)await Promise.resolve();};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const root=doc.createElement('main');doc.root=root;const prior=doc.createElement('button'),alreadyInert=doc.createElement('section');alreadyInert.inert=true;root.append(prior,alreadyInert);prior.focus();
const pending=[],calls=[],launches=[];let closeCount=0,showCount=0,refreshCount=0,launchResult=true,launchFailure=false,refreshFailure=false;
const search=(query,filter)=>{calls.push({query,filter});return new Promise((resolve,reject)=>pending.push({resolve,reject,query,filter}));};
const api=initSpotlight({root,search,activate:async(entry,options)=>{launches.push({entry,options});if(launchFailure)throw Error('File moved. Refresh search.');return launchResult;},refresh:async()=>{refreshCount++;if(refreshFailure)throw Error('offline');},onClose:()=>closeCount++,onShow:()=>showCount++});
const input=root.querySelector('.asp-input'),layer=root.querySelector('.asp-layer'),results=root.querySelector('.asp-results'),status=root.querySelector('.asp-status');
const key=(name,options={})=>doc.fire('keydown',{key:name,target:input,...options});
const answer=(index,rows,status='Current index')=>pending[index].resolve({results:rows,status});
const rows=[{id:'app:chrome',title:'Chrome',subtitle:'Application',kind:'app'},{id:'file:one',title:'<img onerror="bad">',subtitle:'C:\\Documents\\one.txt',kind:'file'}];

for(const mode of ['', 'true', 'plaintext-only']){
  const editor=doc.createElement('div');editor.setAttribute('contenteditable',mode);editor.isContentEditable=true;root.append(editor);
  const event=doc.fire('keydown',{key:'/',target:editor});assert.equal(event.prevented,undefined,'Slash remains text in editable surfaces');assert.equal(layer.hidden,true);editor.remove();
}
const textbox=doc.createElement('div');textbox.setAttribute('role','textbox');root.append(textbox);assert.equal(doc.fire('keydown',{key:'/',target:textbox}).prevented,undefined);textbox.remove();assert.equal(calls.length,0);
api.show();assert.equal(showCount,1);assert.equal(layer.hidden,false);assert.equal(doc.activeElement,input);assert.equal(prior.inert,true);assert.equal(input.getAttribute('aria-expanded'),'true');assert.equal(calls.length,1);
answer(0,rows);await drain();assert.equal(results.children.length,2);assert.equal(results.children[1].querySelector('strong').textContent,rows[1].title,'Titles are plain text');assert.equal(input.getAttribute('aria-activedescendant'),results.children[0].id);
key('ArrowDown');assert.equal(input.getAttribute('aria-activedescendant'),results.children[1].id);assert.equal(results.children[1].scrolled,true);
api.refreshResults();answer(1,[rows[1],rows[0]]);await drain();assert.equal(input.getAttribute('aria-activedescendant'),results.children[0].id,'Selection survives reordered live data');

input.value='old';input.fire('input');key('Enter');await drain();assert.equal(launches.length,0,'A previous result cannot launch during debounce');await tick();
input.value='new';input.fire('input');await tick();assert.equal(calls.at(-1).query,'new');answer(3,[{id:'new',title:'New result',kind:'file'}]);await drain();answer(2,[{id:'old',title:'Old result',kind:'file'}]);await drain();assert.equal(results.children[0].querySelector('strong').textContent,'New result','Older search cannot replace newer result');
key('Enter',{ctrlKey:true});await drain();assert.equal(launches.at(-1).entry.id,'new');assert.equal(launches.at(-1).options.reveal,true);assert.equal(layer.hidden,true);assert.equal(closeCount,1);assert.equal(doc.activeElement,input,'Launching does not refocus the desktop');assert.equal(prior.inert,false);assert.equal(alreadyInert.inert,true);

prior.focus();api.show('failure');answer(4,rows);await drain();launchFailure=true;key('Enter');await drain();assert.equal(layer.hidden,false);assert.match(status.textContent,/File moved/);launchFailure=false;
const files=root.querySelectorAll('.asp-filter').find(button=>button.dataset.aspFilter==='files');layer.fire('click',{target:files});assert.equal(calls.at(-1).filter,'files');answer(5,[],'No indexed files match.');await drain();assert.equal(root.querySelector('.asp-empty').hidden,false);assert.equal(input.getAttribute('aria-activedescendant'),null);
const closeButton=root.querySelectorAll('.asp-icon-button').find(button=>button.getAttribute('aria-label')==='Close search');closeButton.focus();key('Tab',{shiftKey:true,target:closeButton}); // Previous is Refresh, so native Tab remains valid.
const last=root.querySelectorAll('.asp-filter').at(-1);last.focus();const tab=key('Tab',{target:last});assert.equal(tab.prevented,true);assert.equal(doc.activeElement,root.querySelector('.asp-icon-button'),'Tab wraps within modal');
prior.focus();assert.equal(doc.activeElement,input,'Focus cannot escape the modal');key('Escape');assert.equal(layer.hidden,true);assert.equal(doc.activeElement,prior);assert.equal(closeCount,2);api.hide();assert.equal(closeCount,2,'Close hook runs once per visible session');

api.show();const pendingIndex=pending.length-1;api.hide();answer(pendingIndex,rows);await drain();assert.equal(layer.hidden,true,'A late search cannot reopen a hidden modal');
const button=doc.createElement('button');button.dataset.auroraSearch='';root.append(button);const trigger=root.fire('click',{target:button});assert.equal(trigger.prevented,true);assert.equal(trigger.stopped,true);answer(pending.length-1,rows);await drain();
refreshFailure=true;root.querySelector('.asp-icon-button').fire('click');await drain();assert.equal(refreshCount,1);assert.match(status.textContent,/Refresh unavailable/);refreshFailure=false;
api.dispose();assert.equal(root.querySelector('.asp-layer'),null);assert.equal(doc.count(),0);assert.equal(root.count(),0);assert.equal(timers.size,0);api.dispose();
console.log('Spotlight UI: result races, blocked stale activation, plain-text rendering, keyboard navigation, reveal action, selection preservation, focus trap, focus restore, refresh failure and disposal passed.');
