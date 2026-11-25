import assert from 'node:assert/strict';
import {shaderBufferSize,shaderMotion,shaderAudioEnergy,shaderPalette,initAuroraShader,SHADER_FRAGMENT,SHADER_MAX_PIXELS} from '../src/aurora-shader.mjs';

assert.deepEqual(shaderBufferSize(1536,864,2),{width:3072,height:1728,scale:2});
const huge=shaderBufferSize(7680,4320,3);assert.ok(huge.width*huge.height<=SHADER_MAX_PIXELS);assert.ok(huge.width<=8192&&huge.height<=8192);
assert.equal(shaderBufferSize(3840,2160,2).width,3861,'4K drawing remains close to physical resolution within the pixel budget');
for(const flags of [{motion:'off'},{paused:true},{hidden:true},{visible:false},{lost:true}])assert.equal(shaderMotion(flags),'off');
assert.equal(shaderMotion({motion:'full',reduced:true}),'reduced');
assert.equal(shaderMotion({motion:'full'}),'full');
assert.equal(shaderAudioEnergy({status:'active',peak:.43,at:1000},1500),.43);
assert.equal(shaderAudioEnergy({status:'active',peak:.43,at:1000},3000),0);
assert.equal(shaderAudioEnergy({status:'active',peak:1,at:5000},1000),0);
assert.equal(shaderAudioEnergy({status:'unavailable',peak:1,at:1000},1000),0);
assert.ok(SHADER_FRAGMENT.includes('outColor=vec4(colour,alpha)'),'Lighting preserves alpha instead of painting an opaque wallpaper');

class Target{
  constructor(){this.listeners=new Map();this.children=[];this.dataset={};this.hidden=false;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatch(type,event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
  append(child){this.children.push(child);child.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  setAttribute(name,value){this[name]=value;}
}
function fixture({motion='full',gpu=true}={}){
  const frames=new Map(),observers=[],canvases=[],stats={draws:0,clears:0,deleted:0,contextRequests:[],colours:[],styleReads:0};let serial=0;
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,DEPTH_TEST:8,BLEND:9,COLOR_BUFFER_BIT:10,TRIANGLES:11,
    createShader:()=>({}),createProgram:()=>({}),createVertexArray:()=>({}),createBuffer:()=>({}),getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,getUniformLocation:(_p,name)=>name,
    getExtension:name=>name==='WEBGL_debug_renderer_info'?{UNMASKED_RENDERER_WEBGL:101,UNMASKED_VENDOR_WEBGL:102}:null,getParameter:name=>name===101?'ANGLE NVIDIA GeForce RTX 4050':'NVIDIA',
    drawArrays(){stats.draws++;},clear(){stats.clears++;},deleteProgram(){stats.deleted++;},deleteBuffer(){stats.deleted++;},deleteVertexArray(){stats.deleted++;}
  };
  for(const name of ['shaderSource','compileShader','attachShader','linkProgram','bindVertexArray','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','disable','deleteShader','viewport','clearColor','useProgram','uniform2f','uniform1f'])gl[name]=()=>{};
  gl.uniform3f=(name,...value)=>stats.colours.push({name,value});
  const doc=new Target(),win=new Target(),host=new Target(),statusbar=new Target(),media=new Target(),root=new Target();
  media.matches=false;win.matchMedia=()=>media;win.devicePixelRatio=2;
  win.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};win.cancelAnimationFrame=id=>frames.delete(id);
  const observerClass=class{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  win.MutationObserver=observerClass;win.ResizeObserver=observerClass;win.IntersectionObserver=observerClass;
  doc.defaultView=win;doc.hidden=false;
  doc.createElement=tag=>{const element=new Target();if(tag==='canvas'){element.getContext=(type,attributes)=>{stats.contextRequests.push({type,attributes});return gpu?gl:null;};canvases.push(element);}return element;};
  root.ownerDocument=doc;root.dataset={motion,aiState:'idle'};
  root.style={getPropertyValue:name=>name==='--au-accent'?'#3FB8EF':name==='--au-accent2'?'#9D85EC':''};win.getComputedStyle=()=>{stats.styleReads++;return root.style;};
  root.getBoundingClientRect=()=>({left:0,top:0,width:1536,height:864});
  root.querySelector=selector=>selector==='.ah-atmosphere'?host:selector==='.ah-statusbar'?statusbar:selector==='.ah-core-stage'?{getBoundingClientRect:()=>({left:300,top:100,width:450,height:450})}:null;
  root.getAttribute=name=>name==='data-motion'?root.dataset.motion:name==='data-ai-state'?root.dataset.aiState:root.dataset.paused;
  return{root,doc,win,host,statusbar,media,frames,observers,canvases,stats};
}
const off=fixture({motion:'off'}),stopOff=initAuroraShader({root:off.root});
assert.equal(off.frames.size,0,'Off mode schedules no animation loop');assert.equal(off.canvases[0].hidden,true);
assert.equal(off.stats.contextRequests[0].attributes.powerPreference,'high-performance');assert.equal(off.stats.contextRequests[0].attributes.alpha,true);
stopOff();stopOff();assert.ok(off.observers.every(observer=>observer.disconnected));
const reduced=fixture({motion:'reduced'}),stopReduced=initAuroraShader({root:reduced.root});
assert.equal(reduced.frames.size,0,'Reduced mode paints without a continuous frame loop');assert.equal(reduced.stats.draws,1);stopReduced();
const full=fixture(),cleanup=initAuroraShader({root:full.root});
assert.equal(full.frames.size,1);assert.equal(initAuroraShader({root:full.root}),cleanup,'Initialisation is idempotent');
assert.match(full.root.dataset.gpuRenderer,/NVIDIA/);
assert.deepEqual(shaderPalette(full.root),{primary:[.88,.70,.36],secondary:[.73,.79,.88]},'Gold keeps the original exact shader colours');
full.root.dataset.auroraPalette='arctic';full.root.dispatch('aurora:palette-change');
assert.deepEqual(full.stats.colours.at(-2),{name:'u_primary',value:[63/255,184/255,239/255]});
assert.equal(full.stats.styleReads,1,'Palette colours are read once on change');
const readCount=full.stats.styleReads;full.root.dispatch('aurora-playback-audio');assert.equal(full.stats.styleReads,readCount,'Audio frames do not read computed colours');
full.root.dataset.auroraPalette='gold';full.root.dispatch('aurora:palette-change');assert.deepEqual(full.stats.colours.at(-2).value,[.88,.70,.36]);
const mutation=full.observers[0],scheduled=[...full.frames.keys()][0];
mutation.callback([{attributeName:'data-ai-state',oldValue:'idle'}]);assert.ok(full.frames.has(scheduled),'Repeated identical state attributes do not restart GPU animation');
full.root.dataset.motion='off';mutation.callback([{attributeName:'data-motion',oldValue:'full'}]);assert.equal(full.frames.size,0);
full.root.dataset.motion='full';mutation.callback([{attributeName:'data-motion',oldValue:'off'}]);assert.equal(full.frames.size,1);
full.doc.hidden=true;full.doc.dispatch('visibilitychange');assert.equal(full.frames.size,0);assert.equal(full.canvases[0].hidden,true);
full.doc.hidden=false;full.doc.dispatch('visibilitychange');assert.equal(full.frames.size,1);
let prevented=false;full.canvases[0].dispatch('webglcontextlost',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(full.frames.size,0);assert.equal(full.root.dataset.shader,'context-lost');
full.canvases[0].dispatch('webglcontextrestored');assert.equal(full.frames.size,1);assert.equal(full.root.dataset.shader,'webgl2');
cleanup();cleanup();assert.equal(full.frames.size,0);assert.equal(full.host.children.length,0);assert.equal(full.statusbar.children.length,0);assert.ok(full.stats.deleted>=3);assert.ok(full.observers.every(observer=>observer.disconnected));
const missing=fixture({gpu:false}),stopMissing=initAuroraShader({root:missing.root});assert.equal(missing.root.dataset.shader,'unavailable');assert.equal(missing.frames.size,0);stopMissing();
console.log('GPU lighting: high-DPI bounds, actual audio freshness, transparent output, high-performance context hint, motion gates, non-restarting state updates, context recovery and cleanup passed. Driver rendering needs browser/native QA.');
