import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {companionState,initAuroraCompanion} from '../src/aurora-companion.mjs';
import {initAuroraPresence} from '../src/aurora-presence.mjs';

assert.equal(companionState().state,'idle');
assert.equal(companionState({interacting:true}).state,'awake');
assert.equal(companionState({motion:'off'}).state,'resting');
assert.equal(companionState({hidden:true,presence:{state:'working'}}).state,'resting');
assert.equal(companionState({away:true,presence:{state:'speaking',source:'Voice session'}}).state,'notification');
assert.equal(companionState({presence:{state:'speaking',source:'Windows playback'}}).state,'playback','System output never claims assistant speech');
assert.equal(companionState({presence:{state:'speaking',source:'Codex'}}).state,'idle','Ordinary task updates cannot claim a voice call');
assert.equal(companionState({presence:{state:'listening',source:'Assistant voice'}}).state,'idle','Listening requires an actual voice-session source');
assert.equal(companionState({presence:{state:'listening',source:'Voice session'}}).state,'listening');
assert.equal(companionState({presence:{state:'speaking',source:'Assistant voice'}}).state,'speaking');
assert.equal(companionState({motion:'off',presence:{state:'working',message:'Reading the selected file.'}}).state,'working','Resting the visuals never claims real work stopped');
assert.equal(companionState({presence:{state:'error',message:'File read failed.'}}).state,'error');

class Events{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(event){
    if(!event.target)event.target=this;
    event.preventDefault??=function(){this.defaultPrevented=true;};event.stopPropagation??=function(){this.stopped=true;};
    for(const fn of this.listeners.get(event.type)||[])fn(event);
    if(event.bubbles&&!event.stopped)this.parentElement?.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  fire(type,detail,options={}){const event={type,detail,...options};this.dispatchEvent(event);return event;}
  count(){return [...this.listeners.values()].reduce((sum,value)=>sum+value.size,0);}
}
class Element extends Events{
  constructor(tag,doc){super();this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs=new Map();this.dataset={};this.className='';this.textContent='';this.hidden=false;this.value='';this.replaceCount=0;
    this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;},remove:name=>this.className=this.className.split(' ').filter(item=>item!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};
    this.style={values:new Map(),setProperty:(key,value)=>this.style.values.set(key,value),removeProperty:key=>this.style.values.delete(key)};
  }
  setAttribute(key,value){this.attrs.set(key,String(value));}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.replaceCount++;for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(item=>item!==this);this.parentElement=null;}
  contains(target){return this===target||this.children.some(child=>child.contains(target));}
  matches(selector){return selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector.startsWith('#')?this.id===selector.slice(1):this.tag===selector;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  focus(){this.ownerDocument.activeElement=this;}
}
function fixture(options={}){
  const doc=new Events(),win=new Events(),media=new Events(),timers=new Map(),observers=[];let clock=100000,serial=0;
  doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>new Element(tag,doc);media.matches=false;win.matchMedia=()=>media;
  win.Event=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
  win.CustomEvent=class{constructor(type,{detail}){this.type=type;this.detail=detail;}};
  win.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,at:clock+delay});return serial;};win.clearTimeout=id=>timers.delete(id);
  win.setInterval=()=>{throw new Error('No companion polling loop is allowed');};win.requestAnimationFrame=()=>{throw new Error('The companion reuses the existing renderer');};
  win.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(target,settings){this.target=target;this.settings=settings;}disconnect(){this.disconnected=true;}};
  const root=doc.createElement('main'),desktop=doc.createElement('div'),stage=doc.createElement('section'),core=doc.createElement('button'),motion=doc.createElement('select'),legacy=doc.createElement('aside');
  root.dataset={motion:'full'};root.isConnected=true;desktop.className='ah-desktop';stage.className='ah-core-stage';core.className='ah-companion';motion.className='ah-motion';motion.value='full';legacy.className='aas-bubble';
  root.append(desktop,motion);desktop.append(stage);stage.append(core,legacy);
  const changes=[],opened=[];let normalCoreClicks=0;
  motion.addEventListener('change',()=>{changes.push(motion.value);root.dataset.motion=motion.value;});
  root.addEventListener('click',event=>{if(event.target===core)normalCoreClicks++;});
  win.__auroraOpenPanel=kind=>opened.push(kind);
  const stopPresence=initAuroraPresence({root,now:()=>clock,showConsole:false});
  const states=[],stateListener=event=>states.push(event.detail);root.addEventListener('aurora:companion-state',stateListener);
  const stop=initAuroraCompanion({root,now:()=>clock,...options});
  const query=selector=>root.querySelector(selector);
  const mutate=()=>{for(const observer of observers)if(!observer.disconnected)observer.fn([]);};
  function advance(ms){clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}mutate();}
  return{root,doc,win,media,timers,observers,core,motion,legacy,changes,opened,states,query,stop,stopPresence,mutate,advance,get clock(){return clock;},get normalCoreClicks(){return normalCoreClicks;},finish(){stop();root.removeEventListener('aurora:companion-state',stateListener);stopPresence();}};
}
const f=fixture();
assert.equal(initAuroraCompanion({root:f.root}),f.stop,'Companion mounting is idempotent');
assert.equal(f.timers.size,0,'An idle Sun creates no JavaScript timer, polling or extra render loop');
assert.equal(f.root.dataset.companionState,'idle');assert.ok(f.query('.acp-toggle'));assert.ok(f.query('.acp-menu').hidden);
assert.equal(f.query('.ap-speech').parentElement,f.query('.ap-presence'));assert.equal(f.query('.aas-bubble'),f.legacy,'The existing status bubble is preserved');
const originalSpeech=f.query('.ap-speech'),originalChip=f.query('.ap-state-chip');
f.query('.acp-toggle').fire('click',null,{bubbles:true});assert.equal(f.query('.acp-menu').hidden,false);assert.equal(f.query('.acp-toggle').attrs.get('aria-expanded'),'true');assert.equal(f.doc.activeElement,f.query('.acp-action'),'The controls menu receives keyboard focus');
f.root.fire('keydown',null,{key:'Escape'});assert.equal(f.query('.acp-menu').hidden,true);assert.equal(f.doc.activeElement,f.query('.acp-toggle'));
const context=f.core.fire('contextmenu',null,{bubbles:true});assert.equal(context.defaultPrevented,true);assert.equal(f.query('.acp-menu').hidden,false);assert.equal(f.normalCoreClicks,0);
f.core.fire('click',null,{bubbles:true});assert.equal(f.normalCoreClicks,1,'A normal Sun click keeps its original ChatGPT action');assert.equal(f.query('.ap-speech'),originalSpeech);assert.equal(f.query('.ap-state-chip'),originalChip,'Companion behaviour adds no competing chip or speech bubble');
f.advance(901);

f.root.fire('aurora:activity',{kind:'busy',message:'Reading the selected file.'});assert.equal(f.root.dataset.companionState,'working');
const busyMessage=f.query('.ap-speech-message').textContent;f.core.fire('pointerenter');assert.equal(f.query('.ap-speech-message').textContent,busyMessage,'A greeting does not replace genuine work');assert.equal(f.root.dataset.companionReaction,'warm');
f.advance(12001);assert.equal(f.root.dataset.companionState,'idle');
f.query('.acp-toggle').fire('click');f.query('.acp-actions').children[1].fire('click');
assert.equal(f.motion.value,'off');assert.equal(f.root.dataset.motion,'off');assert.equal(f.changes.at(-1),'off','Rest uses the existing Motion setting event');assert.equal(f.root.dataset.companionState,'resting');
f.media.matches=true;f.media.fire('change');f.query('.acp-actions').children[1].fire('click');assert.equal(f.root.dataset.motion,'reduced','Resume honours the OS reduced-motion preference');
f.query('.acp-actions').children[2].fire('click');assert.equal(f.root.dataset.companionBubbles,'hidden');assert.equal(f.query('.acp-actions').children[2].textContent,'Show status bubble');
f.query('.acp-actions').children[2].fire('click');assert.equal(f.root.dataset.companionBubbles,undefined);
f.query('.acp-actions').children[3].fire('click');assert.deepEqual(f.opened,['notifications']);assert.equal(f.query('.acp-menu').hidden,true,'Notifications opens existing real history and releases the menu');

f.motion.value='full';f.motion.dispatchEvent(new f.win.Event('change',{bubbles:true}));f.mutate();
f.query('.acp-toggle').fire('click');
for(let index=0;index<8;index++)f.root.fire('aurora:activity',{kind:'info',message:'Real desktop update '+index});
assert.equal(f.query('.acp-recent').children.length,4,'The menu keeps at most four ephemeral real updates');
f.win.__auroraPlaybackAudio={status:'active',peak:.7,at:f.clock};f.root.fire('aurora-playback-audio');assert.equal(f.root.dataset.companionState,'playback');
const stableRows=[...f.query('.acp-recent').children],replacements=f.query('.acp-recent').replaceCount;
for(let i=0;i<20;i++)f.root.fire('aurora-playback-audio');
assert.equal(f.query('.acp-recent').replaceCount,replacements,'Repeated playback updates preserve history nodes, selection and scroll');assert.deepEqual(f.query('.acp-recent').children,stableRows);
f.advance(2001);assert.equal(f.root.dataset.companionState,'idle','The companion follows the existing presence expiry');
const call=(state,source='voice-session')=>({state,source,message:state==='listening'?'Listening in the voice session.':'Answering in the linked voice session.',observedAt:f.clock,expiresAt:f.clock+1000});
f.root.fire('aurora:assistant-status',call('listening','Codex'));assert.equal(f.root.dataset.companionState,'idle');
f.root.fire('aurora:assistant-status',call('listening'));assert.equal(f.root.dataset.companionState,'listening');
assert.equal(f.query('.acp-recent').children.filter(row=>row.children[0].textContent==='Listening in the voice session.').length,1,'The existing voice presence and its source event record a single human-labelled update');
assert.equal(f.query('.acp-recent').children[0].children[1].textContent,'Voice session');
f.root.fire('aurora:assistant-status',call('speaking','assistant-voice'));assert.equal(f.root.dataset.companionState,'speaking');f.advance(1001);assert.equal(f.root.dataset.companionState,'idle');

f.query('.acp-toggle').fire('click');if(f.query('.acp-menu').hidden)f.query('.acp-toggle').fire('click');f.core.fire('pointerenter');f.root.dataset.notificationPresence='away';f.mutate();
assert.equal(f.root.dataset.companionState,'notification');assert.equal(f.query('.acp-menu').hidden,true);assert.equal(f.query('.acp-toggle').disabled,true);assert.equal(f.root.dataset.companionReaction,undefined,'Real notification ownership cancels decorative greetings');
assert.equal(f.query('.ap-speech'),originalSpeech);assert.equal(f.query('.ah-companion'),f.core,'The real notification journey never creates a second Home atom');
delete f.root.dataset.notificationPresence;f.mutate();assert.equal(f.root.dataset.companionState,'idle');assert.equal(f.query('.acp-toggle').disabled,false);
f.query('.acp-toggle').fire('click');f.doc.fire('pointerdown',null,{target:f.motion});assert.equal(f.query('.acp-menu').hidden,true,'Outside interaction dismisses only the companion menu');
f.core.fire('pointerenter');f.doc.hidden=true;f.doc.fire('visibilitychange');assert.equal(f.query('.acp-menu').hidden,true);assert.equal(f.root.dataset.companionState,'resting');assert.equal(f.root.dataset.companionReaction,undefined);
f.doc.hidden=false;f.doc.fire('visibilitychange');
for(const value of f.states)assert.deepEqual(Object.keys(value).sort(),['at','away','hidden','motion','state'],'State announcements contain bounded control metadata, not notification text or audio samples');
f.core.fire('pointerenter');f.stop();f.stop();assert.equal(f.query('.acp-toggle'),null);assert.equal(f.query('.acp-menu'),null);assert.equal(f.query('.ap-speech'),originalSpeech);assert.equal(f.root.dataset.companionState,undefined);assert.equal(f.core.count(),0,'Companion core listeners are removed');
f.finish();assert.equal(f.timers.size,0);assert.equal(f.doc.count(),0);assert.equal(f.win.count(),0);assert.equal(f.media.count(),0);assert.ok(f.observers.every(observer=>observer.disconnected));
const unavailable=fixture({openNotifications:()=>{throw new Error('unavailable');}});unavailable.query('.acp-toggle').fire('click');unavailable.query('.acp-actions').children[3].fire('click');assert.equal(unavailable.query('.acp-feedback').textContent,'Notification history is unavailable.');unavailable.finish();
let reject;const late=fixture({openNotifications:()=>new Promise((_resolve,fail)=>{reject=fail;})});late.query('.acp-toggle').fire('click');late.query('.acp-actions').children[3].fire('click');late.finish();reject(new Error('late failure'));await Promise.resolve();assert.equal(late.query('.acp-menu'),null,'A late action failure cannot remount disposed companion controls');
const parsed=await transform(await readFile(new URL('../src/aurora-companion.css',import.meta.url),'utf8'),{loader:'css',target:'chrome120'});assert.equal(parsed.warnings.length,0);
console.log('Sun companion: one existing atom/bubble, provenance-based work/voice/playback, real notification priority, preserved core click, accessible menu, Motion rest/resume, real history routing, stable bounded recent rows, zero idle timers and complete cleanup passed.');
