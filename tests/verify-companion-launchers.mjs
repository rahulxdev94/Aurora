import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateCompanionLaunchers,initCompanionLaunchers,EMPTY_COMPANION_LAUNCHERS} from '../src/aurora-companion-launchers.mjs';

const targets={scarlettUrl:'codex://dots',anchorUrl:'https://anchor.example.test',voiceLauncher:'C:/Aurora/ChatGPT Voice.vbs',voiceHotkeyConfigured:true};
assert.deepEqual(validateCompanionLaunchers(),EMPTY_COMPANION_LAUNCHERS);
assert.deepEqual(validateCompanionLaunchers(targets),targets);
for(const bad of [null,[],{unknown:'x'},{scarlettUrl:'javascript:alert(1)'},{scarlettUrl:'codex://dots/invented-id'},{scarlettUrl:'codex://dots?prompt=send'},{anchorUrl:'http://anchor.example.test'},{anchorUrl:'https://name:secret@anchor.example.test'},{anchorUrl:'https://anchor.example.test?token=private'},{voiceLauncher:'relative/ChatGPT Voice.vbs'},{voiceLauncher:'C:/Aurora/../ChatGPT Voice.vbs'},{voiceLauncher:'C:/Aurora/other.vbs'},{voiceHotkeyConfigured:'true'}])assert.throws(()=>validateCompanionLaunchers(bad));

class Button{
  constructor(kind){this.dataset={auroraCompanion:kind};this.attributes={};}
  closest(selector){return selector==='[data-aurora-companion]'?this:null;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
}
class Root{
  constructor(){this.buttons=['scarlett','voice','anchor'].map(kind=>new Button(kind));this.handlers=new Set();}
  querySelectorAll(){return this.buttons;}
  contains(button){return this.buttons.includes(button);}
  addEventListener(name,fn,capture){assert.equal(name,'click');assert.equal(capture,true);this.handlers.add(fn);}
  removeEventListener(name,fn,capture){assert.equal(capture,true);this.handlers.delete(fn);}
  click(kind){const event={target:this.buttons.find(button=>button.dataset.auroraCompanion===kind),preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of this.handlers)fn(event);return event;}
}
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const root=new Root(),calls=[],statuses=[];let clock=10000,releaseVoice,fail=false;
const dispose=initCompanionLaunchers({root,launchers:targets,now:()=>clock,status:message=>statuses.push(message),openTarget:(target,label)=>{calls.push({target,label});if(fail)throw Error('Private target must not appear in status');if(label==='ChatGPT Voice')return new Promise(resolve=>releaseVoice=resolve);}});
assert.equal(calls.length,0,'Initialisation never opens an app or starts a call');
assert.equal(root.buttons[2].title,'Open Anchor reminders');
const event=root.click('scarlett');assert.equal(event.prevented,true);assert.equal(event.stopped,true);await drain();
root.click('anchor');await drain();assert.deepEqual(calls.slice(0,2),[{target:targets.scarlettUrl,label:'Scarlett'},{target:targets.anchorUrl,label:'Anchor'}]);
root.click('voice');root.click('voice');await drain();assert.equal(calls.length,3,'Double clicking must not toggle a voice call twice');releaseVoice();await drain();root.click('voice');await drain();assert.equal(calls.length,3,'A completed launch still has a short double-click guard');
clock+=1501;root.click('voice');await drain();assert.equal(calls.length,4);releaseVoice();await drain();assert.match(statuses.at(-1),/^Sent the ChatGPT Voice shortcut/);
fail=true;root.click('anchor');await drain();assert.match(statuses.at(-1),/could not open/);assert.ok(!statuses.at(-1).includes('Private'));
dispose();root.click('scarlett');await drain();assert.equal(calls.length,5);assert.equal(root.handlers.size,0);
const unconfigured=new Root();let unintended=0;const stop=initCompanionLaunchers({root:unconfigured,openTarget:()=>unintended++});for(const kind of ['scarlett','voice','anchor'])unconfigured.click(kind);await drain();assert.equal(unintended,0);stop();
const qa=new Root(),blocked=[];const stopQa=initCompanionLaunchers({root:qa,launchers:targets,openTarget:(_target,label)=>{blocked.push(label);return false;}});for(const kind of ['scarlett','voice','anchor'])qa.click(kind);await drain();assert.deepEqual(blocked,['Scarlett','ChatGPT Voice','Anchor']);stopQa();
const fragment=await fs.readFile(new URL('../src/fragments/aurora-home-prototype.html',import.meta.url),'utf8');
for(const [kind,label,icon]of [['scarlett','Scarlett','bot'],['voice','ChatGPT Voice','audio-lines'],['anchor','Anchor','anchor']])assert.match(fragment,new RegExp('data-aurora-companion="'+kind+'"[^>]*><i data-lucide="'+icon+'"[^>]*></i>'+label));
console.log('Companion launchers: configured native targets, real labels/icons, no automatic calls, Voice double-click protection, QA blocking, failure privacy and cleanup passed. No real apps, hotkeys or calls executed.');
