import assert from 'node:assert/strict';
import {normaliseAssistantStatus,derivePresenceState,initAuroraPresence} from '../src/aurora-presence.mjs';

const now=100000;
const status=(state,source='Codex',message='Inspecting the desktop.')=>({state,source,message,observedAt:now-100,expiresAt:now+5000});
assert.equal(derivePresenceState({now}).label,'Ready');
assert.equal(derivePresenceState({now,assistantStatus:status('working')}).state,'working');
assert.equal(derivePresenceState({now,assistantStatus:status('working')}).message,'Inspecting the desktop.');
for(const value of [null,{},status('invented'),status('working',''),{...status('working'),observedAt:now+2000},{...status('working'),expiresAt:now-1},{...status('working'),observedAt:now-60001},{...status('working'),expiresAt:now+120000},{...status('working'),observedAt:'now'}])assert.equal(normaliseAssistantStatus(value,now),null,'Invalid or stale assistant status is rejected');
assert.equal(normaliseAssistantStatus(status('listening'),now),null,'A desktop or Codex activity update cannot claim microphone listening');
assert.equal(normaliseAssistantStatus(status('listening','assistant-voice'),now),null,'Only an active voice session may report listening');
assert.equal(normaliseAssistantStatus(status('listening','voice-session'),now).state,'listening');
assert.equal(normaliseAssistantStatus({...status('listening','voice-session'),observedAt:now-8001},now),null,'Voice activity expires promptly');
assert.equal(normaliseAssistantStatus(status('speaking'),now),null,'An ordinary assistant status cannot pretend to be speech');
assert.equal(normaliseAssistantStatus(status('speaking','assistant-voice'),now).state,'speaking');
const playing={peak:.5,at:now-20,status:'active'};
const heard=derivePresenceState({now,playback:playing,assistantStatus:status('working')});
assert.equal(heard.state,'speaking');assert.equal(heard.label,'Audio playing');assert.equal(heard.source,'Windows playback');assert.equal(heard.energy,.5,'Only the measured peak drives energy');
for(const playback of [{...playing,at:now-2001},{...playing,at:now+2000},{...playing,status:'unavailable'},{...playing,peak:NaN},{...playing,peak:.001}])assert.equal(derivePresenceState({now,playback}).state,'idle','Unavailable, silent, future or stale playback does not imply speech');
const voice=derivePresenceState({now,assistantStatus:status('speaking','voice-session','Answering your question.'),playback:playing});
assert.equal(voice.label,'Speaking');assert.equal(voice.message,'Answering your question.');
const listening=derivePresenceState({now,assistantStatus:status('listening','voice-session','Listening in your voice session.'),playback:playing});
assert.equal(listening.label,'Listening','Attested voice session state takes priority over unrelated system output');
assert.equal(derivePresenceState({now,hidden:true,assistantStatus:status('speaking','voice-session'),playback:playing}).energy,0,'Hidden surfaces stop visual energy');
assert.equal(derivePresenceState({now,hidden:true,assistantStatus:status('working')}).state,'idle');
const activity={message:'Opening calendar.',kind:'busy',observedAt:now-500,expiresAt:now+1200};
assert.equal(derivePresenceState({now,activity}).state,'working');
assert.equal(derivePresenceState({now:now+1201,activity}).state,'idle','A stuck busy event returns to idle');
assert.equal(derivePresenceState({now,activity:{...activity,kind:'error',message:'Calendar is unavailable.'}}).state,'error');
assert.equal(normaliseAssistantStatus(status('working','Codex','<img src=x>\u0000hello'),now).message,'<img src=x> hello','Text remains plain data and control characters are removed');
assert.equal(normaliseAssistantStatus(status('working','Codex','x'.repeat(1000)),now).message.length,240,'External activity is bounded');
assert.equal(derivePresenceState({now,assistantStatus:{...status('working'),expiresAt:now-1},activity}).message,'Opening calendar.','Expired assistant status yields to current desktop activity');

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);return true;}
  fire(type,detail){this.dispatchEvent({type,detail,preventDefault(){},stopPropagation(){}});}
  count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
}
class Element extends Events{
  constructor(tag='div',doc=null){super();this.tag=tag;this.ownerDocument=doc;this.children=[];this.className='';this.dataset={};this.textContent='';this.attrs=new Map();this.value='';this.hidden=false;this.style={values:new Map(),setProperty:(key,value)=>this.style.values.set(key,value),removeProperty:key=>this.style.values.delete(key)};this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;},remove:name=>this.className=this.className.split(' ').filter(item=>item!==name).join(' '),contains:name=>this.className.split(' ').includes(name)};}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  setAttribute(key,value){this.attrs.set(key,String(value));}
  matches(selector){return selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector.startsWith('#')?this.id===selector.slice(1):this.tag===selector;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const result=child.querySelector(selector);if(result)return result;}return null;}
  focus(){this.ownerDocument.activeElement=this;}
}
const doc=new Events(),win=new Events();doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>new Element(tag,doc);
const root=doc.createElement('main'),desktop=doc.createElement('div'),stage=doc.createElement('section'),legacy=doc.createElement('p');
desktop.className='ah-desktop';stage.className='ah-core-stage';legacy.className='aas-message';root.append(desktop);desktop.append(stage);stage.append(legacy);
const timers=new Map(),observers=[];let clock=now,sequence=0;
win.setTimeout=(fn,delay)=>{timers.set(++sequence,{fn,at:clock+delay});return sequence;};win.clearTimeout=id=>timers.delete(id);
win.Event=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
const reduced=new Events();reduced.matches=false;win.matchMedia=()=>reduced;
win.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.disconnected=true;}};
const advance=ms=>{clock+=ms;for(const [id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}};
let opened=0,submittedInput=0;
const openDraft=kind=>{assert.equal(kind,'chat');opened++;const target=doc.createElement('textarea');target.id='ah-draft-input';target.addEventListener('input',()=>submittedInput++);root.append(target);};
const cleanup=initAuroraPresence({root,now:()=>clock,openDraft});
assert.equal(initAuroraPresence({root}),cleanup,'Duplicate mounting returns the existing cleanup');
assert.equal(root.dataset.aiState,'idle');assert.equal(timers.size,0,'An idle desktop creates no repeating timer or frame loop');
assert.ok(root.querySelector('.ap-compose-input'),'A real local draft composer is mounted');
assert.equal(root.querySelector('.ap-voice-label').textContent,'Voice not linked');
assert.equal(root.querySelector('.ap-open-chat').attrs.get('data-native-chat'),'true','Open chat uses the existing delegated native chat action');
root.fire('aurora:assistant-status',status('working'));assert.equal(root.dataset.aiState,'working');assert.equal(root.querySelector('.ap-connection').textContent,'Codex update');
assert.equal(root.querySelector('.ap-feed').children.length,1);
root.fire('aurora:assistant-status',status('working'));assert.equal(root.querySelector('.ap-feed').children.length,1,'Repeated bridge snapshots do not duplicate the feed');
advance(5001);assert.equal(root.dataset.aiState,'idle');assert.equal(timers.size,0,'Expired work clears the state and its deadline timer');
root.fire('aurora:assistant-status',{...status('listening'),observedAt:clock,expiresAt:clock+5000});assert.equal(root.dataset.aiState,'idle','A false listening claim does not change the DOM state');
assert.equal(root.querySelector('.ap-voice-label').textContent,'Voice not linked');
root.fire('aurora:assistant-status',{...status('listening','voice-session'),observedAt:clock,expiresAt:clock+1000});assert.equal(root.querySelector('.ap-voice-label').textContent,'Voice connected','Only a fresh voice-session signal links voice');
advance(1001);assert.equal(root.querySelector('.ap-voice-label').textContent,'Voice not linked','The voice link disappears when the source expires');
win.__auroraPlaybackAudio={peak:.7,at:clock,status:'active'};root.fire('aurora-playback-audio');assert.equal(root.dataset.aiState,'speaking');assert.equal(root.querySelector('.ap-state-label').textContent,'Audio playing');
assert.equal(root.querySelector('.ap-voice-label').textContent,'Voice not linked','System audio does not imply a voice connection');
assert.equal(root.style.values.get('--ap-energy'),'.7'.replace(/^\./,'0.'));
reduced.matches=true;reduced.fire('change');assert.equal(root.dataset.aiMotion,'reduced');assert.equal(root.style.values.get('--ap-energy'),'0','OS reduced motion removes reactive visual energy');
advance(2001);assert.equal(root.dataset.aiState,'idle');assert.equal(timers.size,0,'Playback expiry does not leave an animation loop');
root.querySelector('.ap-compose-input').value='Please help me plan tomorrow.';root.querySelector('.ap-compose').fire('submit');
assert.equal(opened,1);assert.equal(submittedInput,1);assert.equal(root.querySelector('#ah-draft-input').value,'Please help me plan tomorrow.');
assert.match(root.querySelector('.ap-compose-note').textContent,/locally/,'Composer identifies its local review step');
for(let index=0;index<8;index++)root.fire('aurora:activity',{kind:'info',message:'Completed desktop action '+index});
assert.equal(root.querySelector('.ap-feed').children.length,5,'The memory-only feed is bounded');
cleanup();cleanup();assert.equal(root.querySelector('.ap-console'),null);assert.equal(root.querySelector('.ap-presence'),null);assert.equal(timers.size,0);assert.equal(root.count(),0);assert.equal(doc.count(),0);assert.equal(reduced.count(),0);assert.ok(observers.every(observer=>observer.disconnected));assert.equal(root.classList.contains('ap-enabled'),false);assert.equal(root.style.values.has('--ap-energy'),false);
const draftTarget=root.querySelector('#ah-draft-input'),headless=initAuroraPresence({root,now:()=>clock,showConsole:false});
assert.equal(root.querySelector('.ap-console'),null,'Console-free presence never mounts the removed activity widget');assert.equal(root.querySelector('.ap-compose-input'),null);assert.ok(root.querySelector('.ap-presence'),'Core presence remains mounted');assert.equal(root.querySelector('.ah-core-stage'),stage,'The animated core keeps its original element');
root.fire('aurora:activity',{kind:'busy',message:'Reading your selected file.'});assert.equal(root.dataset.aiState,'working');assert.equal(root.querySelector('.ap-speech-message').textContent,'Reading your selected file.','Real activity still reaches the core speech bubble without a console');
assert.equal(root.querySelector('#ah-draft-input'),draftTarget,'Removing the console preserves the separate local file-brief draft');assert.equal(draftTarget.value,'Please help me plan tomorrow.');headless();assert.equal(root.count(),0);assert.equal(timers.size,0);
console.log('Aurora presence: real audio provenance, fresh voice-only listening, safe text, priority, expiry recovery, bounded feed, local draft routing, reduced motion and complete lifecycle cleanup passed.');
