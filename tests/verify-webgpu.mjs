import assert from 'node:assert/strict';
import {initAuroraGraphics,isNvidiaAdapter,AURORA_WGSL} from '../src/aurora-webgpu.mjs';
for(const info of [{vendor:'nvidia'},{vendor:'0x10de'},{vendor:'4318'},{description:'NVIDIA GeForce RTX4050'}])assert.equal(isNvidiaAdapter(info),true);
for(const info of [{vendor:'intel',description:'Intel UHD Graphics'},{vendor:'amd'},{description:'Software renderer'},{}])assert.equal(isNvidiaAdapter(info),false);
assert.ok(AURORA_WGSL.includes('vec4f(colour*alpha,alpha)'),'WebGPU output is premultiplied for transparent compositing');
class Target{
 constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.hidden=false;}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 dispatch(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
 dispatchEvent(event){this.dispatch(event.type,event);}
 append(child){this.children.push(child);child.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
 setAttribute(name,value){this[name]=value;}
}
function fixture({vendor='nvidia',description='NVIDIA GeForce RTX4050',motion='full',available=true,failDevice=false,delayedDevice=false}={}){
 const frames=new Map(),observers=[],canvases=[],stats={draws:0,submissions:0,destroyed:0,uniformDestroyed:0,requested:0,adapterOptions:null,configuration:null,writes:[]};let serial=0,resolveLost,resolveDevice;
 const doc=new Target(),win=new Target(),host=new Target(),statusbar=new Target(),media=new Target(),root=new Target();
 const context={configure:configuration=>stats.configuration=configuration,unconfigure(){stats.unconfigured=true;},getCurrentTexture:()=>({createView:()=>({})})};
 const pipeline={getBindGroupLayout:()=>({})},uniform={destroy(){stats.uniformDestroyed++;}};
 const device={lost:new Promise(resolve=>resolveLost=resolve),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createRenderPipelineAsync:async()=>pipeline,
  pushErrorScope(){},popErrorScope:async()=>null,createBuffer:descriptor=>{stats.bufferSize=descriptor.size;return uniform;},createBindGroup:()=>({}),destroy(){stats.destroyed++;},
  createCommandEncoder:()=>({beginRenderPass:()=>({setPipeline(){},setBindGroup(){},draw(){stats.draws++;},end(){}}),finish:()=>({})}),
  queue:{writeBuffer(_buffer,_offset,values){stats.writes.push([...values]);},submit(){stats.submissions++;},onSubmittedWorkDone:async()=>{}}
 };
 const adapter={info:{vendor,description},isFallbackAdapter:false,requestDevice(){stats.requested++;return failDevice?Promise.reject(new Error('Device not available')):delayedDevice?new Promise(resolve=>resolveDevice=resolve):Promise.resolve(device);}};
 win.navigator=available?{gpu:{requestAdapter:async options=>{stats.adapterOptions=options;return adapter;},getPreferredCanvasFormat:()=> 'bgra8unorm'}}:{};
 win.CustomEvent=class{constructor(type,{detail}){this.type=type;this.detail=detail;}};
 win.devicePixelRatio=2;media.matches=false;win.matchMedia=()=>media;
 win.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};win.cancelAnimationFrame=id=>frames.delete(id);
 const observer=class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
 win.MutationObserver=observer;win.ResizeObserver=observer;win.IntersectionObserver=observer;
 doc.defaultView=win;doc.hidden=false;doc.createElement=tag=>{const node=new Target();if(tag==='canvas'){node.getContext=type=>type==='webgpu'?context:null;canvases.push(node);}return node;};
 root.ownerDocument=doc;root.dataset={motion,aiState:'idle'};
 root.style={getPropertyValue:name=>name==='--au-accent'?'#3FB8EF':name==='--au-accent2'?'#9D85EC':''};
 root.getBoundingClientRect=()=>({left:0,top:0,width:1536,height:864});
 root.querySelector=selector=>selector==='.ah-atmosphere'?host:selector==='.ah-statusbar'?statusbar:selector==='.ah-core-stage'?{getBoundingClientRect:()=>({left:300,top:100,width:450,height:450})}:null;
 root.getAttribute=name=>name==='data-motion'?root.dataset.motion:name==='data-ai-state'?root.dataset.aiState:root.dataset.paused;
 return{root,doc,win,host,statusbar,media,frames,observers,canvases,stats,device,resolveLost:value=>resolveLost(value),resolveDevice:()=>resolveDevice(device)};
}
async function flush(){for(let i=0;i<24;i++)await Promise.resolve();}
const absent=fixture({available:false}),stopAbsent=initAuroraGraphics({root:absent.root});await flush();assert.equal(absent.root.dataset.webgpuStatus,'unavailable');assert.equal(absent.frames.size,0);stopAbsent();
const intel=fixture({vendor:'intel',description:'Intel UHD Graphics'}),stopIntel=initAuroraGraphics({root:intel.root});await flush();
assert.equal(intel.root.dataset.webgpuStatus,'not-nvidia');assert.equal(intel.root.dataset.webgpuVendor,'intel');assert.equal(intel.stats.requested,0,'An unverified adapter must not replace the fallback');stopIntel();
const full=fixture(),ready=[];full.root.addEventListener('aurora:graphics-ready',event=>ready.push(event.detail));
const cleanup=initAuroraGraphics({root:full.root});assert.equal(full.root.dataset.shader,'unavailable','The ordinary fallback is initialised immediately');
await flush();assert.equal(full.root.dataset.shader,'webgpu');assert.equal(full.root.dataset.webgpuStatus,'active');assert.match(full.root.dataset.gpuRenderer,/NVIDIA/);
assert.equal(full.stats.adapterOptions.powerPreference,'high-performance');assert.equal(full.stats.configuration.alphaMode,'premultiplied');assert.ok(full.stats.draws>0);assert.equal(full.frames.size,1);
assert.equal(full.canvases[1].width,3072);assert.equal(full.canvases[1].height,1728);assert.equal(ready.at(-1).backend,'webgpu');assert.equal(initAuroraGraphics({root:full.root}),cleanup);
assert.equal(full.stats.bufferSize,64,'Palette vectors use aligned vec4 uniform fields');
assert.equal(full.stats.writes.at(-1).length,16);
assert.ok(Math.abs(full.stats.writes.at(-1)[8]-.88)<1e-6,'Gold retains the original primary colour');
full.root.dataset.auroraPalette='arctic';full.root.dispatch('aurora:palette-change');
assert.ok(Math.abs(full.stats.writes.at(-1)[8]-63/255)<1e-6);assert.ok(Math.abs(full.stats.writes.at(-1)[12]-157/255)<1e-6,'Both WebGPU colour vectors update together');
full.root.dataset.auroraPalette='gold';full.root.dispatch('aurora:palette-change');assert.ok(Math.abs(full.stats.writes.at(-1)[8]-.88)<1e-6);
const mutation=full.observers[0],frame=[...full.frames.keys()][0];mutation.callback([{attributeName:'data-ai-state',oldValue:'idle'}]);assert.ok(full.frames.has(frame),'Unchanged state updates do not restart rendering');
full.root.dataset.motion='off';mutation.callback([{attributeName:'data-motion',oldValue:'full'}]);assert.equal(full.frames.size,0);assert.equal(full.canvases[1].hidden,true);
full.root.dataset.motion='full';mutation.callback([{attributeName:'data-motion',oldValue:'off'}]);assert.equal(full.frames.size,1);
full.doc.hidden=true;full.doc.dispatch('visibilitychange');assert.equal(full.frames.size,0);full.doc.hidden=false;full.doc.dispatch('visibilitychange');assert.equal(full.frames.size,1);
full.resolveLost({reason:'unknown'});await flush();assert.equal(full.root.dataset.webgpuStatus,'device-lost');assert.equal(full.root.dataset.shader,'unavailable');assert.equal(full.frames.size,0);assert.equal(full.host.children.length,0);cleanup();cleanup();assert.ok(full.observers.every(observer=>observer.disconnected));
const reduced=fixture({motion:'reduced'}),stopReduced=initAuroraGraphics({root:reduced.root});await flush();assert.equal(reduced.frames.size,0);assert.ok(reduced.stats.draws>0);stopReduced();
const off=fixture({motion:'off'}),stopOff=initAuroraGraphics({root:off.root});await flush();assert.equal(off.frames.size,0);assert.equal(off.stats.draws,0);stopOff();
const failure=fixture({failDevice:true}),stopFailure=initAuroraGraphics({root:failure.root});await flush();assert.equal(failure.root.dataset.webgpuStatus,'initialization-failed');assert.equal(failure.root.dataset.webgpuVendor,'nvidia');assert.match(failure.root.dataset.webgpuError,/Device not available/);assert.equal(failure.root.dataset.shader,'unavailable');stopFailure();
const late=fixture({delayedDevice:true}),stopLate=initAuroraGraphics({root:late.root});await flush();stopLate();late.resolveDevice();await flush();assert.equal(late.stats.destroyed,1,'A device arriving after cleanup must be released');assert.equal(late.frames.size,0);assert.equal(late.host.children.length,0);
console.log('NVIDIA WebGPU wrapper: identified-adapter gating, alpha pipeline, real diagnostics, bounded high-DPI, motion/visibility, immediate fallback, device-loss recovery and late cleanup passed. Actual GPU compilation requires native QA.');
