import assert from 'node:assert/strict';
import {initInteractiveSurfaces,lightPosition,surfaceMotion} from '../src/aurora-interactive-surfaces.mjs';

assert.deepEqual(lightPosition({left:100,top:50,width:200,height:100},200,100),{x:50,y:50});
assert.deepEqual(lightPosition({left:100,top:50,width:200,height:100},400,-50),{x:100,y:0});
assert.deepEqual(lightPosition({width:0,height:0},10,10),{x:50,y:50});
for(const options of [{motion:'off'},{paused:true},{hidden:true}])assert.equal(surfaceMotion(options),'off');
assert.equal(surfaceMotion({motion:'full',reduced:true}),'reduced');

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
class Element extends Events{
  constructor(kind='span'){
    super();this.kind=kind;this.isConnected=true;this.dataset={};this.children=[];this.classes=new Set();this.attrs=new Map();this.animations=[];
    this.classList={contains:n=>this.classes.has(n),add:n=>this.classes.add(n),remove:n=>this.classes.delete(n)};
    this.style={values:new Map(),setProperty:(name,value)=>this.style.values.set(name,value)};
  }
  setAttribute(name,value){this.attrs.set(name,value);}
  append(child){this.children.push(child);child.parent=this;}
  remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);this.isConnected=false;}
  contains(el){return this===el||this.children.some(child=>child.contains(el));}
  getClientRects(){return this.isConnected?[this.getBoundingClientRect()]:[];}
  getBoundingClientRect(){return{left:100,top:100,width:200,height:100};}
  closest(selector){
    if(selector==='[hidden]')return this.hidden?this:this.parent?.closest(selector)||null;
    if(selector==='button')return this.kind==='button'?this:this.parent?.closest(selector)||null;
    if(selector==='.ah-surface')return this.surface?this:this.parent?.closest(selector)||null;
    if(selector==='.ac-task-row')return this.row?this:this.parent?.closest(selector)||null;
    if(selector.includes('.ah-folder'))return this.target?this:this.parent?.closest(selector)||null;
    return null;
  }
  matches(selector){return selector==='button'?this.kind==='button':selector==='input[type=checkbox][data-ac-check]'&&this.kind==='checkbox';}
  querySelector(){return this.icon||null;}
  querySelectorAll(){return this.inputs||[];}
  animate(keyframes,options){
    const a={keyframes,options,cancelled:false,onfinish:null,oncancel:null,cancel(){if(this.cancelled)return;this.cancelled=true;this.oncancel?.();}};
    this.animations.push(a);return a;
  }
}
const document=new Events(),window=new Events(),media=new Events(),frames=new Map(),observers=[];
let sequence=0,time=1000;
window.matchMedia=()=>media;media.matches=false;window.performance={now:()=>time};
window.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};window.cancelAnimationFrame=id=>frames.delete(id);
window.getComputedStyle=node=>({transform:node.kind==='svg'?'matrix(0,1,-1,0,0,0)':'none',backgroundColor:'rgba(129,192,237,0.03)'});
window.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(node,options){this.options=options;}disconnect(){this.disconnected=true;}};
document.createElement=kind=>new Element(kind);document.defaultView=window;document.hidden=false;
const root=new Element('root');root.ownerDocument=document;root.dataset.motion='full';
const card=new Element('section');card.target=true;card.surface=true;root.append(card);
const folder=new Element('button');folder.target=true;card.append(folder);
const icon=new Element('svg');folder.icon=icon;folder.append(icon);
const flush=()=>{const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();};
const clean=initInteractiveSurfaces({root});assert.equal(initInteractiveSurfaces({root}),clean);
assert.deepEqual(observers[0].options,{attributes:true,attributeFilter:['data-motion','data-paused']});
const event={target:folder,pointerType:'mouse',clientX:150,clientY:125,button:0};
root.fire('pointermove',event);root.fire('pointermove',{...event,clientX:250});
assert.equal(frames.size,1,'Input is coalesced into one frame');flush();
assert.equal(frames.size,0,'No idle render loop is scheduled');
assert.equal(folder.children.filter(x=>x.className==='ais-light').length,1);
assert.equal(card.children.filter(x=>x.className==='ais-light').length,1);
const light=folder.children.find(x=>x.className==='ais-light');
assert.equal(light.style.values.get('--ais-x'),'75.00%');
assert.equal(light.attrs.get('aria-hidden'),'true');
assert.equal(folder.style.values.size,0,'Control geometry and inline styles are untouched');
root.fire('pointerdown',event);
assert.equal(icon.animations.length,1);assert.match(icon.animations[0].keyframes[0].transform,/^matrix\(0,1,-1,0,0,0\)/);
root.fire('focusin',{target:folder});flush();
assert.equal(light.dataset.keyboard,'true');assert.equal(light.style.values.get('--ais-x'),'50.00%');
media.matches=true;media.fire('change');assert.ok(icon.animations.every(x=>x.cancelled));
const before=icon.animations.length;root.fire('pointerdown',event);root.fire('focusin',{target:folder});flush();
assert.equal(icon.animations.length,before,'OS reduced motion prevents icon movement');
assert.equal(folder.children.find(x=>x.className==='ais-light').dataset.keyboard,'true','Keyboard light remains available');
root.dataset.paused='true';observers[0].fn();assert.equal(folder.children.length,1);
root.fire('pointermove',event);assert.equal(frames.size,0,'Paused pointer creates no work');
root.dataset.paused='false';media.matches=false;

// A completed task is replaced by the calendar before the captured visual work runs.
const taskRow=new Element();taskRow.row=true;root.append(taskRow);
const checkbox=new Element('checkbox');checkbox.dataset.acCheck='7';checkbox.checked=true;taskRow.append(checkbox);
root.fire('change',{target:checkbox});assert.equal(frames.size,1);
taskRow.isConnected=false;
const newRow=new Element();newRow.row=true;root.append(newRow);
const newCheckbox=new Element('checkbox');newCheckbox.dataset.acCheck='7';newCheckbox.checked=true;newRow.append(newCheckbox);root.inputs=[newCheckbox];
flush();assert.equal(newRow.animations.length,1,'Completion resolves the new row after render');
newRow.classList.add('ac-done');root.fire('change',{target:newCheckbox});assert.equal(frames.size,0,'Already completed tasks do not replay feedback');
document.hidden=true;document.fire('visibilitychange');assert.ok(newRow.animations[0].cancelled);
root.fire('pointerover',{...event,relatedTarget:null});assert.equal(icon.animations.length,before,'Hidden page starts no animations');
document.hidden=false;time+=1000;root.fire('pointermove',event);
assert.equal(frames.size,1);clean();assert.equal(frames.size,0);
assert.equal(root.count(),0);assert.equal(document.count(),0);assert.equal(window.count(),0);assert.equal(media.count(),0);
assert.ok(observers[0].disconnected);assert.equal(folder.classList.contains('ais-lit'),false);clean();
console.log('Interactive surface lifecycle, motion controls, task feedback and geometry checks passed.');
