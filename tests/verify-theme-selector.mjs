import assert from 'node:assert/strict';
import {createPaletteController} from '../src/aurora-theme-selector.mjs';
import {PALETTE_STORAGE,parsePalettePreference,serialisePalettePreference} from '../src/aurora-palettes.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(options={}){
  let file=options.file??null;const stored=new Map(options.stored?[[PALETTE_STORAGE,options.stored]]:[]);
  const applied=[],writes=[],docks=[],published=[],states=[];
  const controller=createPaletteController({
    apply:id=>applied.push(id),
    read:options.read||(async()=>file),
    write:async content=>{writes.push(parsePalettePreference(content));await options.write?.(content);file=content;},
    syncDock:async palette=>{docks.push(palette.id);await options.syncDock?.(palette);},
    storage:{getItem:key=>{if(options.storageReadError)throw new Error('Storage unavailable');return stored.get(key)??null;},setItem:(key,value)=>{if(options.storageWriteError)throw new Error('Storage unavailable');stored.set(key,value);}},
    publish:async id=>{published.push(id);await options.publish?.(id);},
    onState:state=>states.push(state),
  });
  return{controller,applied,writes,docks,published,states,stored,get file(){return file;}};
}

for(const file of [null,'','not-json','{}','{"schema_version":1,"palette_id":"unknown"}','{"schema_version":2,"palette_id":"violet"}']){
  const h=fixture({file});await h.controller.ready;
  assert.equal(h.controller.id,'gold');assert.equal(h.controller.state.persisted,false);assert.deepEqual(h.writes,[]);assert.deepEqual(h.docks,[],'First/default gold startup never writes global dock settings');
  assert.equal(await h.controller.select('invalid'),false);assert.deepEqual(h.writes,[]);h.controller.dispose();
}
const restored=fixture({file:serialisePalettePreference('arctic'),stored:serialisePalettePreference('violet')});
assert.equal(restored.controller.id,'violet','A valid local fallback paints before the file read');await restored.controller.ready;
assert.equal(restored.controller.id,'arctic');assert.equal(restored.controller.state.persisted,true);assert.equal(parsePalettePreference(restored.stored.get(PALETTE_STORAGE)),'arctic');assert.deepEqual(restored.writes,[],'Restoring a valid saved preference does not rewrite it');assert.deepEqual(restored.docks,['arctic'],'A prior explicit preference repairs its dock colours on restart');restored.controller.dispose();

const missing=fixture({stored:serialisePalettePreference('evergreen'),read:async()=>{throw new Error('Missing record');}});await missing.controller.ready;
assert.equal(missing.controller.id,'evergreen');assert.equal(missing.controller.state.restored,true);assert.equal(missing.controller.state.persisted,false);assert.deepEqual(missing.docks,['evergreen'],'A valid previous local fallback also restores the coordinated dock');missing.controller.dispose();

const lateRead=deferred(),intervening=fixture({read:()=>lateRead.promise});
await intervening.controller.select('porcelain');lateRead.resolve(serialisePalettePreference('violet'));await intervening.controller.ready;
assert.equal(intervening.controller.id,'porcelain','A slow startup read cannot replace an explicit newer selection');assert.equal(parsePalettePreference(intervening.file),'porcelain');intervening.controller.dispose();

const holdFirstWrite=deferred(),holdSecondWrite=deferred();let writeIndex=0;
const rapid=fixture({write:()=>++writeIndex===1?holdFirstWrite.promise:writeIndex===2?holdSecondWrite.promise:undefined});await rapid.controller.ready;
const first=rapid.controller.select('arctic');await drain();const second=rapid.controller.select('violet'),third=rapid.controller.select('arctic');
assert.equal(rapid.controller.id,'arctic');assert.equal(parsePalettePreference(rapid.stored.get(PALETTE_STORAGE)),'arctic','Rapid choices update local fallback immediately');
assert.deepEqual(rapid.writes,['arctic'],'Only one preference operation runs at once');
const beforeStaleReport=rapid.states.length;holdFirstWrite.resolve();await first;await drain();
assert.ok(rapid.states.slice(beforeStaleReport).every(state=>!state.persisted),'The first A completion cannot report a later A choice saved during an A-B-A sequence');
holdSecondWrite.resolve();await Promise.all([second,third]);
assert.deepEqual(rapid.writes,['arctic','violet','arctic']);assert.deepEqual(rapid.docks,['arctic','violet','arctic']);assert.equal(parsePalettePreference(rapid.file),'arctic');assert.equal(rapid.controller.state.persisted,true);assert.equal(rapid.controller.state.dock,'synced');
const restarted=fixture({file:rapid.file});await restarted.controller.ready;assert.equal(restarted.controller.id,'arctic','The last completed rapid selection survives controller restart');restarted.controller.dispose();rapid.controller.dispose();

const pendingSave=deferred(),pending=fixture({file:serialisePalettePreference('gold'),write:()=>pendingSave.promise});await pending.controller.ready;
const saving=pending.controller.select('violet');assert.equal(pending.states.at(-1).paletteId,'violet');assert.equal(pending.states.at(-1).persisted,false,'The new selection is reported as pending before its write completes');pendingSave.resolve();await saving;pending.controller.dispose();

const noStorage=fixture({storageReadError:true,storageWriteError:true});await noStorage.controller.ready;assert.equal(await noStorage.controller.select('evergreen'),true);
assert.equal(parsePalettePreference(noStorage.file),'evergreen');assert.equal(noStorage.controller.state.persisted,true,'The native file can retain the preference when localStorage is unavailable');noStorage.controller.dispose();
const fileFailure=fixture({write:async()=>{throw new Error('Write denied');}});await fileFailure.controller.ready;
assert.equal(await fileFailure.controller.select('porcelain'),false);assert.equal(fileFailure.controller.id,'porcelain');assert.equal(fileFailure.controller.state.persisted,false);assert.match(fileFailure.controller.state.error,/file could not be saved/);assert.equal(parsePalettePreference(fileFailure.stored.get(PALETTE_STORAGE)),'porcelain');fileFailure.controller.dispose();
const dockFailure=fixture({syncDock:async()=>{throw new Error('Dock denied');},publish:async()=>{throw new Error('Bridge unavailable');}});await dockFailure.controller.ready;
assert.equal(await dockFailure.controller.select('violet'),true);assert.equal(dockFailure.controller.state.persisted,true);assert.equal(dockFailure.controller.state.dock,'unavailable');assert.match(dockFailure.controller.state.error,/Dock colours/);dockFailure.controller.dispose();

const readAfterDispose=deferred(),disposedRead=fixture({read:()=>readAfterDispose.promise});disposedRead.controller.dispose();readAfterDispose.resolve(serialisePalettePreference('violet'));await disposedRead.controller.ready;
assert.deepEqual(disposedRead.applied,['gold']);assert.deepEqual(disposedRead.published,[]);assert.equal(await disposedRead.controller.select('arctic'),false);await disposedRead.controller.publish();assert.deepEqual(disposedRead.published,[],'A late transport callback cannot publish a disposed controller\'s stale palette');
const inflight=deferred(),disposedQueue=fixture({write:()=>inflight.promise});await disposedQueue.controller.ready;
const writing=disposedQueue.controller.select('arctic');await drain();const waiting=disposedQueue.controller.select('violet');disposedQueue.controller.dispose();const reportCount=disposedQueue.states.length;
inflight.resolve();await Promise.all([writing,waiting]);assert.deepEqual(disposedQueue.writes,['arctic'],'Disposal skips work that had not started');assert.deepEqual(disposedQueue.docks,[],'An old controller cannot start a dock update after disposal');assert.equal(disposedQueue.states.length,reportCount,'Disposed async completion cannot update the control');

console.log('Theme controller: validated restore/fallback, first-gold no-write, explicit selection versus slow reads, serial rapid A-B-A writes, pending/save truthfulness, restart durability, storage/file/dock/bridge errors, and disposed async cleanup passed. Local fixtures only.');
