import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {waveformPeak,initPlaybackReactive,MAX_WAVEFORM_SAMPLES,PLAYBACK_STALE_MS,PLAYBACK_DEADLINE_MS,PLAYBACK_RETRY_MS} from '../src/aurora-playback-reactive.mjs';

assert.equal(waveformPeak({samples:[0,-.65,.2]}),.65);
assert.equal(waveformPeak({samples:[-1,0,1]}),1);
assert.equal(waveformPeak({samples:Array(19200).fill(0)}),0);
for(const samples of [undefined,null,[],{},new Float32Array([.5]),[NaN],[Infinity],['.5'],[null],[1.001],[-1.001],Array(MAX_WAVEFORM_SAMPLES+1).fill(0)])assert.throws(()=>waveformPeak({samples}));
const maximum=Array(MAX_WAVEFORM_SAMPLES).fill(.2);const started=performance.now();
for(let i=0;i<20;i++)assert.equal(waveformPeak({samples:maximum}),.2);
console.log('Bounded96k-sample reduction mean: '+((performance.now()-started)/20).toFixed(3)+'ms (synthetic CPU check).');

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  fire(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  count(){return [...this.listeners.values()].reduce((n,values)=>n+values.size,0);}
}
function fixture(options={}){
  const win=new Events(),doc=new Events(),timers=new Map(),events=[],subscriptions=[],calls=[];
  let time=100000,id=0,observer=null,disconnects=0,stops=0;
  win.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;};win.clearTimeout=id=>timers.delete(id);
  win.CustomEvent=class{constructor(type){this.type=type;}};
  win.MutationObserver=class{constructor(fn){observer=fn;}observe(){}disconnect(){disconnects++;}};
  doc.defaultView=win;doc.hidden=options.hidden||false;
  const root={ownerDocument:doc,dataset:{motion:options.motion||'full'},dispatchEvent(event){events.push(event);}};
  const invoke=options.invoke||((command,...args)=>{calls.push({command,args});return Promise.resolve({samples:[1]});});
  const subscribe=options.subscribe||((event,fn)=>{subscriptions.push(fn);assert.equal(event,'waveform');return Promise.resolve(()=>stops++);});
  const stop=initPlaybackReactive({root,invoke,subscribe,SeelenCommand:{GetMediaWaveform:'waveform-get'},SeelenEvent:{MediaWaveform:'waveform'},enabled:options.enabled??true,now:()=>time});
  return{win,doc,root,timers,events,subscriptions,calls,stop,get stops(){return stops;},get disconnects(){return disconnects;},get time(){return time;},change(){observer?.();},send(samples){subscriptions.at(-1)({payload:{samples,frequencies:Array(128).fill(-10)}});},advance(ms){const target=time+ms;let iterations=0;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(++iterations<1000);timers.delete(next[0]);time=next[1].at;next[1].fn();}time=target;}};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const off=fixture({enabled:false});await flush();assert.equal(off.calls.length,0);assert.equal(off.subscriptions.length,0);assert.equal(off.timers.size,0);assert.equal(off.doc.count()+off.win.count(),0);off.stop();
const initiallyHidden=fixture({hidden:true});await flush();assert.equal(initiallyHidden.calls.length,0);assert.equal(initiallyHidden.subscriptions.length,0);initiallyHidden.stop();
const f=fixture();await flush();
assert.deepEqual(f.calls,[{command:'waveform-get',args:[]}]);
assert.equal(f.win.__auroraPlaybackAudio.peak,0,'getter ring must never be rendered');
assert.equal(f.win.__auroraPlaybackAudio.status,'unavailable','support query is not a fresh audio event');
f.send([.2,-.6,0]);assert.equal(f.win.__auroraPlaybackAudio.peak,.6);assert.equal(f.win.__auroraPlaybackAudio.status,'active');
assert.deepEqual(Object.keys(f.win.__auroraPlaybackAudio).sort(),['at','peak','source','status']);assert.equal(f.win.__auroraPlaybackAudio.source,'Windows playback');assert.ok(f.events.every(event=>event.type==='aurora-playback-audio'&&!('detail' in event)));
const count=f.events.length;f.advance(1000);f.send([.6]);assert.equal(f.events.length,count,'unchanged scalar need not request extra frames');
assert.equal(f.win.__auroraPlaybackAudio.at,f.time);
f.advance(PLAYBACK_STALE_MS-1);assert.equal(f.win.__auroraPlaybackAudio.status,'active');
f.advance(1);assert.equal(f.win.__auroraPlaybackAudio.status,'idle');assert.equal(f.win.__auroraPlaybackAudio.peak,0);assert.equal(f.timers.size,0,'stall goes idle without an idle polling loop');
f.send([.0001]);assert.equal(f.win.__auroraPlaybackAudio.status,'idle');
f.send([NaN]);assert.equal(f.win.__auroraPlaybackAudio.status,'unavailable');assert.equal(f.timers.size,0);
f.send([.8]);const oldHandler=f.subscriptions.at(-1);f.root.dataset.motion='off';f.change();assert.equal(f.stops,1);assert.equal(f.timers.size,0);oldHandler({payload:{samples:[1]}});assert.equal(f.win.__auroraPlaybackAudio.peak,0);
f.root.dataset.motion='reduced';f.change();await flush();assert.equal(f.calls.length,2,'reduced mode may receive scalar for glow only');
f.send([.4]);f.doc.hidden=true;f.doc.fire('visibilitychange');assert.equal(f.stops,2);assert.equal(f.win.__auroraPlaybackAudio.peak,0);assert.equal(f.timers.size,0);
f.doc.hidden=false;f.doc.fire('visibilitychange');await flush();assert.equal(f.calls.length,3);
f.root.dataset.paused='true';f.change();assert.equal(f.stops,3);assert.equal(f.timers.size,0);
f.stop();f.stop();assert.equal(f.disconnects,1);assert.equal(f.win.count()+f.doc.count(),0);assert.equal(f.root.dataset.playbackAudioStatus,undefined);

// Model the host's no-new-packets path, which repeats its previous ring even
// though fresh native events keep arriving. An event timestamp alone is unsafe.
const repeated=fixture();await flush();const ring=[0,.7,-.2,.1];repeated.send(ring);const firstRingAt=repeated.time;
for(let i=0;i<19;i++){repeated.advance(100);repeated.send(ring);assert.equal(repeated.win.__auroraPlaybackAudio.status,'active');}
repeated.advance(100);assert.equal(repeated.win.__auroraPlaybackAudio.status,'idle','unchanged ring must expire at2s even before another host event');
for(let i=0;i<30;i++){repeated.advance(100);repeated.send(ring);assert.equal(repeated.win.__auroraPlaybackAudio.status,'idle');assert.equal(repeated.win.__auroraPlaybackAudio.at,firstRingAt,'repeated old ring must not refresh published freshness');}
assert.equal(repeated.timers.size,0,'repeated stale events do not create an idle timer loop');
repeated.send([0,.7,-.2,-.1]);assert.equal(repeated.win.__auroraPlaybackAudio.status,'active','changed waveform with identical peak must recover immediately');
for(let i=0;i<40;i++){repeated.advance(100);repeated.send(i%2?[0,.7,-.2,-.1]:[0,.7,-.2,.1]);assert.equal(repeated.win.__auroraPlaybackAudio.peak,.7,'same peak with changing material stays active');}
for(let i=0;i<30;i++){repeated.advance(100);repeated.send([0,0,0]);assert.equal(repeated.win.__auroraPlaybackAudio.status,'idle');assert.equal(repeated.win.__auroraPlaybackAudio.at,repeated.time,'silence remains a fresh idle reading');}
repeated.send(ring);assert.equal(repeated.win.__auroraPlaybackAudio.status,'active');repeated.stop();assert.equal(repeated.timers.size,0);

let subscriptionResolve,lateStops=0,nativeCalls=0;
const late=fixture({subscribe:()=>new Promise(resolve=>{subscriptionResolve=resolve;}),invoke:()=>{nativeCalls++;return Promise.resolve({samples:[1]});}});
late.stop();subscriptionResolve(()=>lateStops++);await flush();assert.equal(lateStops,1);assert.equal(nativeCalls,0);assert.equal(late.timers.size,0);

let queryResolve;const race=fixture({invoke:()=>new Promise(resolve=>{queryResolve=resolve;})});await flush();race.send([.3]);queryResolve({samples:[1]});await flush();assert.equal(race.win.__auroraPlaybackAudio.peak,.3,'late query cannot overwrite newer event');race.stop();

let toggleResolve,toggleCalls=0;const toggle=fixture({invoke:()=>{toggleCalls++;return new Promise(resolve=>{toggleResolve=resolve;});}});await flush();
for(let i=0;i<4;i++){toggle.doc.hidden=true;toggle.doc.fire('visibilitychange');toggle.doc.hidden=false;toggle.doc.fire('visibilitychange');await flush();toggle.root.dataset.motion='off';toggle.change();toggle.root.dataset.motion='full';toggle.change();await flush();}
assert.equal(toggleCalls,1,'hide/show and motion toggles share an unresolved activation');
toggle.send([.45]);toggleResolve({samples:[1]});await flush();assert.equal(toggle.win.__auroraPlaybackAudio.peak,.45,'shared getter result still cannot replace a live event');toggle.stop();assert.equal(toggle.timers.size,0);

let pendingResolve,pendingCalls=0;const timeout=fixture({invoke:()=>{pendingCalls++;return new Promise(resolve=>{pendingResolve=resolve;});}});await flush();timeout.advance(PLAYBACK_DEADLINE_MS+PLAYBACK_RETRY_MS*2);await flush();assert.equal(pendingCalls,1,'an unresolved native call must not be overlapped by retries');assert.equal(timeout.win.__auroraPlaybackAudio.status,'unavailable');pendingResolve({samples:[1]});await flush();assert.equal(timeout.win.__auroraPlaybackAudio.peak,0);timeout.stop();assert.equal(timeout.timers.size,0);

let attempts=0;const failed=fixture({invoke:()=>{attempts++;return Promise.reject(new Error('unsupported'));}});await flush();assert.equal(attempts,1);failed.advance(PLAYBACK_RETRY_MS-1);await flush();assert.equal(attempts,1);failed.advance(1);await flush();assert.equal(attempts,2);failed.stop();assert.equal(failed.timers.size,0);

let delayedStop,slowCalls=0;const slow=fixture({subscribe:()=>new Promise(resolve=>{delayedStop=resolve;}),invoke:()=>{slowCalls++;return Promise.resolve({samples:[1]});}});slow.advance(PLAYBACK_DEADLINE_MS+1);delayedStop(()=>lateStops++);await flush();assert.equal(slowCalls,0,'expired subscription must not activate capture later');slow.stop();assert.equal(slow.timers.size,0);
console.log('Playback adapter checks passed: bounded samples/fingerprints, repeated old nonzero rings expire, changing equal-peak rings recover/stay active, fresh silent idle, scalar-only publication, getter discarded, event freshness, query races, shared activation, timeouts/non-overlap,30s retry, disabled/hidden/paused/off states and disposal. All native calls were mocks; no audio was read.');
