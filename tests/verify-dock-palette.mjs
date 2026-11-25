import assert from 'node:assert/strict';
import {syncDockPalette,dockPaletteVariables,DOCK_PALETTE_VARIABLES} from '../src/aurora-dock-palette.mjs';
const commands={StateGetSettings:'get',StateWriteSettings:'write'};
const tokens={background:'#101020',surface:'#202030',surfaceRaised:'#303040',text:'#f0f0f0',muted:'#a0a0b0',border:'#404050',accent:'#8050d0',accent2:'#b080f0',accentText:'#ffffff',success:'#20c080',warning:'#e0b050',danger:'#e05060',info:'#50a0e0'};
const palette=(id='violet')=>({id,name:id,mode:id==='porcelain'?'light':'dark',tokens:{...tokens,accent:id==='porcelain'?'#7050c0':tokens.accent}});
const initial=()=>({activeThemes:['@default/theme','@aurora/glass','@rahul/aurora-motion'],byTheme:{'@aurora/glass':{'--aurora-wave-scale':'1.12'},'@rahul/aurora-motion':{'--custom-existing':'kept','--au-unrelated':'kept'}},byWidget:{'@seelen/weg':{enabled:true,pinned:['one','two']}},quietHours:{enabled:true},monitorsV3:{one:{byWidget:{}}}});
function fixture(value=initial()){
  let settings=structuredClone(value);const calls=[];
  const invoke=async(command,args)=>{calls.push({command,args});if(command==='get')return structuredClone(settings);if(command==='write'){settings=structuredClone(args.settings);return null;}throw new Error('Unexpected command');};
  return{invoke,calls,get:()=>structuredClone(settings),set:value=>{settings=structuredClone(value);}};
}
const options=h=>({invoke:h.invoke,SeelenCommand:commands});
const h=fixture();const before=h.get();
assert.equal(h.calls.length,0,'Importing the module performs no native call');
assert.equal((await syncDockPalette({...options(h),palette:palette('gold')})).status,'unchanged');
assert.deepEqual(h.calls.map(x=>x.command),['get'],'Gold with no overrides never requests a native write permission');
h.calls.length=0;
const saved=await syncDockPalette({...options(h),palette:palette()});
assert.equal(saved.status,'saved');assert.equal(saved.themeId,'@rahul/aurora-motion');
const after=h.get();
assert.deepEqual({...after,byTheme:before.byTheme},{...before},'All unrelated top-level settings survive');
assert.deepEqual(after.byTheme['@aurora/glass'],before.byTheme['@aurora/glass']);
assert.equal(after.byTheme[saved.themeId]['--custom-existing'],'kept');
assert.equal(after.byTheme[saved.themeId]['--au-unrelated'],'kept');
assert.deepEqual(after.byTheme[saved.themeId],{...before.byTheme[saved.themeId],...dockPaletteVariables(palette())});
assert.deepEqual(h.calls.map(x=>x.command),['get','write']);
assert.equal((await syncDockPalette({...options(h),palette:palette()})).status,'unchanged');
await syncDockPalette({...options(h),palette:palette('gold')});
assert.deepEqual(h.get(),before,'Gold restores the original theme including every unrelated setting');

const portable=initial();portable.activeThemes[2]='@aurora/motion';portable.byTheme['@aurora/motion']={};
assert.equal((await syncDockPalette({...options(fixture(portable)),palette:palette('arctic')})).themeId,'@aurora/motion');
const both=initial();both.activeThemes.push('@aurora/motion');both.byTheme['@aurora/motion']={};
const dual=fixture(both);await syncDockPalette({...options(dual),palette:palette('evergreen')});
assert.deepEqual(dual.get().byTheme['@rahul/aurora-motion'],both.byTheme['@rahul/aurora-motion'],'Only the last active supported overlay changes');

const missing=initial();missing.activeThemes=[];const missingHost=fixture(missing);
await assert.rejects(syncDockPalette({...options(missingHost),palette:palette()}),/Enable Aurora Motion/);
assert.equal(missingHost.calls.length,1);
for(const bad of [null,{},palette('unknown'),{...palette(),mode:'bad'},{...palette(),tokens:{...tokens,accent:'red;display:none'}},{...palette(),tokens:{...tokens,text:'#fff'}}]){
  const badHost=fixture();await assert.rejects(syncDockPalette({...options(badHost),palette:bad}));assert.equal(badHost.calls.length,0);
}
await assert.rejects(syncDockPalette({invoke:async()=>{throw new Error('Read denied');},SeelenCommand:commands,palette:palette()}),/Read denied/);
await assert.rejects(syncDockPalette({invoke:async command=>{if(command==='get')return initial();throw new Error('Permission declined');},SeelenCommand:commands,palette:palette()}),/Permission declined/);
assert.equal((await syncDockPalette({...options(fixture()),palette:palette()})).status,'saved','A failed save does not poison the queue');

let release;let writes=0;let state=initial();const order=[];
const queueInvoke=async(command,args)=>{
  order.push(command);
  if(command==='get')return structuredClone(state);
  if(++writes===1)await new Promise(resolve=>{release=resolve;});
  state=structuredClone(args.settings);
  if(writes===1)state.someOtherSetting='changed-between-selections';
};
const first=syncDockPalette({invoke:queueInvoke,SeelenCommand:commands,palette:palette('arctic')});
const second=syncDockPalette({invoke:queueInvoke,SeelenCommand:commands,palette:palette('porcelain')});
for(let i=0;i<10&&!release;i++)await Promise.resolve();
assert.equal(typeof release,'function');assert.deepEqual(order,['get','write']);release();
await Promise.all([first,second]);assert.deepEqual(order,['get','write','get','write']);
assert.equal(state.someOtherSetting,'changed-between-selections','Queued selection reads the latest native state');
assert.equal(state.byTheme['@rahul/aurora-motion']['--au-dock-icon-filter'],'drop-shadow(0 2px 3px #00000024)');
assert.equal(new Set(DOCK_PALETTE_VARIABLES).size,DOCK_PALETTE_VARIABLES.length);
assert.equal(Object.keys(dockPaletteVariables(palette())).length,DOCK_PALETTE_VARIABLES.length);
console.log('Dock palette checks passed: scoped fresh writes, queued selections, exact gold restoration and permission failures.');
