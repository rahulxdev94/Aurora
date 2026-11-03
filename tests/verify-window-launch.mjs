import assert from 'node:assert/strict';
import {buildLaunchAnimation,launchMotion,isExternalLaunch,initWindowLaunch} from '../src/aurora-window-launch.mjs';

const rect=(left,top,width,height)=>({left,top,width,height});
const geometry={coreRect:rect(200,200,100,100),panelRect:rect(300,100,560,400),rootRect:rect(0,0,1200,800)};
const full=buildLaunchAnimation(geometry);
assert.ok(full.options.duration>=350&&full.options.duration<=480);
assert.match(full.keyframes[0].transform,/translate3d\(-330\.000px,-50\.000px,0\)/);
assert.equal(full.keyframes.at(-1).transform,'none');
assert.equal(full.keyframes.at(-1).filter,'none');
assert.ok(!JSON.stringify(full).includes('NaN'));
assert.equal(buildLaunchAnimation({...geometry,mode:'off'}),null);
const reduced=buildLaunchAnimation({...geometry,mode:'reduced'});
assert.equal(reduced.options.duration,110);assert.ok(reduced.keyframes.every(frame=>!('transform' in frame)));
assert.ok(buildLaunchAnimation({...geometry,baseTransform:'matrix(1,0,0,1,4,5)'}).keyframes.every(frame=>!('transform' in frame)));
assert.ok(buildLaunchAnimation({...geometry,coreRect:null}).keyframes.every(frame=>!('transform' in frame)));
assert.equal(buildLaunchAnimation({...geometry,panelRect:rect(0,0,0,20)}),null);
assert.equal(launchMotion({motion:'full',reduced:true}),'reduced');
assert.equal(launchMotion({motion:'off',reduced:true}),'off');
assert.equal(launchMotion({paused:true}),'off');assert.equal(launchMotion({hidden:true}),'off');
assert.equal(isExternalLaunch({dataset:{app:'Calendar'},hasAttribute:()=>false}),false);
assert.equal(isExternalLaunch({dataset:{app:'YouTube'}}),true);
assert.equal(isExternalLaunch({dataset:{folder:'7'}}),true);
assert.equal(isExternalLaunch({dataset:{folder:'99'}}),false);

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of [...(this.listeners.get(type)||[])])fn(event);}
  listenerCount(){return [...this.listeners.values()].reduce((count,set)=>count+set.size,0);}
}
class FakeAnimation{
  constructor(frames,options){this.frames=frames;this.options=options;this.cancelled=false;this.onfinish=null;this.oncancel=null;}
  cancel(){if(this.cancelled)return;this.cancelled=true;this.oncancel?.();}
  finish(){this.onfinish?.();}
}
class Element extends Events{
  constructor(box=rect(0,0,10,10)){super();this.box=box;this.dataset={};this.attrs=new Map();this.style={};this.children=[];this.animations=[];this.hidden=false;this.isConnected=true;}
  getBoundingClientRect(){return this.box;}
  getAttribute(name){return this.attrs.has(name)?this.attrs.get(name):null;}
  setAttribute(name,value){this.attrs.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())]=String(value);}
  removeAttribute(name){this.attrs.delete(name);if(name.startsWith('data-'))delete this.dataset[name.slice(5).replace(/-([a-z])/g,(_,char)=>char.toUpperCase())];}
  hasAttribute(name){return this.attrs.has(name);}
  append(element){this.children.push(element);element.parent=this;}
  remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);this.isConnected=false;}
  contains(element){return element===this||element?.ownerPanel===this||this.children.includes(element);}
  animate(frames,options){const animation=new FakeAnimation(frames,options);this.animations.push(animation);return animation;}
  getAnimations(){return this.animations.filter(animation=>!animation.cancelled);}
}
const document=new Events(),window=new Events(),media=new Events(),observers=[],frames=new Map();
let frameId=0,clock=1000;media.matches=false;
window.matchMedia=()=>media;window.performance={now:()=>clock};
window.requestAnimationFrame=fn=>{frames.set(++frameId,fn);return frameId;};window.cancelAnimationFrame=id=>frames.delete(id);
window.getComputedStyle=()=>({opacity:'1',transform:'none',filter:'none'});
window.MutationObserver=class{
  constructor(callback){this.callback=callback;this.targets=new Map();this.disconnected=false;observers.push(this);}
  observe(target,options){this.targets.set(target,options);}
  disconnect(){this.disconnected=true;this.targets.clear();}
  fire(target,attributeName){if(!this.disconnected&&this.targets.get(target)?.attributeFilter.includes(attributeName))this.callback([{target,attributeName}]);}
};
document.defaultView=window;document.hidden=false;document.createElement=()=>new Element();
const root=new Element(geometry.rootRect),mainLayer=new Element(),calendarLayer=new Element(),mainPanel=new Element(geometry.panelRect),calendarPanel=new Element(rect(150,80,820,600)),core=new Element(geometry.coreRect);
root.ownerDocument=document;root.offsetWidth=1200;root.offsetHeight=800;root.clientLeft=0;root.clientTop=0;root.scrollLeft=0;root.scrollTop=0;
root.setAttribute('data-motion','full');mainLayer.hidden=calendarLayer.hidden=true;
mainPanel.style={left:'23px',top:'44px',width:'560px',transform:'none'};const originalStyle={...mainPanel.style};
const elements=new Map([['.ah-window-layer',mainLayer],['.ah-window',mainPanel],['.ac-layer',calendarLayer],['.ac-window',calendarPanel],['.ah-core-stage .ah-companion',core]]);
root.querySelector=selector=>elements.get(selector)||null;
const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
const cleanup=initWindowLaunch({root}),observer=observers[0];assert.equal(initWindowLaunch({root}),cleanup);
assert.equal(mainPanel.animations.length,0);assert.equal(root.getAttribute('data-window-launch'),'on');
const show=layer=>{layer.hidden=false;observer.fire(layer,'hidden');flush();};
const hide=layer=>{layer.hidden=true;observer.fire(layer,'hidden');};
show(mainLayer);assert.equal(mainPanel.animations.length,1);assert.deepEqual(mainPanel.style,originalStyle);
mainPanel.box.height=460;observer.fire(mainPanel,'style');observer.fire(mainLayer,'style');flush();assert.equal(mainPanel.animations.length,1);
root.fire('pointerdown',{target:{ownerPanel:mainPanel}});assert.equal(mainPanel.animations[0].cancelled,true);assert.deepEqual(mainPanel.style,originalStyle);
hide(mainLayer);show(mainLayer);assert.equal(mainPanel.animations.length,2);mainPanel.animations[1].finish();assert.equal(mainPanel.animations[1].cancelled,true);
show(calendarLayer);assert.equal(calendarPanel.animations.length,1);window.fire('resize');assert.equal(calendarPanel.animations[0].cancelled,true);flush();assert.equal(calendarPanel.animations.length,1);
root.setAttribute('data-motion','reduced');observer.fire(root,'data-motion');hide(calendarLayer);show(calendarLayer);assert.equal(calendarPanel.animations.at(-1).options.duration,110);
root.setAttribute('data-motion','off');observer.fire(root,'data-motion');hide(mainLayer);show(mainLayer);assert.equal(mainPanel.animations.length,2);
root.setAttribute('data-motion','full');observer.fire(root,'data-motion');
const external=new Element();external.dataset.app='YouTube';external.closest=()=>external;root.append(external);
root.fire('click',{target:external});let pulse=root.children.find(element=>element.className==='ah-launch-pulse');assert.ok(pulse);assert.equal(pulse.getAttribute('aria-hidden'),'true');
pulse.animations[0].finish();assert.ok(!root.children.includes(pulse));root.fire('click',{target:external});assert.ok(!root.children.some(element=>element.className==='ah-launch-pulse'));
clock=1700;root.fire('click',{target:external});pulse=root.children.find(element=>element.className==='ah-launch-pulse');assert.ok(pulse);
document.hidden=true;document.fire('visibilitychange');assert.ok(!root.children.includes(pulse));
document.hidden=false;hide(mainLayer);mainLayer.hidden=false;observer.fire(mainLayer,'hidden');assert.ok(frames.size);window.fire('pagehide');assert.equal(frames.size,0);
assert.equal(observer.disconnected,true);assert.equal(root.getAttribute('data-window-launch'),null);assert.equal(root.listenerCount(),0);assert.equal(document.listenerCount(),0);assert.equal(window.listenerCount(),0);assert.equal(media.listenerCount(),0);cleanup();
assert.deepEqual(mainPanel.style,originalStyle);
console.log('Window launch tests passed: actual core-centre geometry, bounded timing, reduced/off motion, transform preservation, hidden transitions, no resize cascade, interaction cancellation, pulse throttling, idempotence and pagehide cleanup. All DOM/animation objects were local fakes; no browser or host calls.');
