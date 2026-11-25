import {initAuroraShader,shaderBufferSize,shaderMotion,shaderAudioEnergy,shaderPalette} from './aurora-shader.mjs';
const instances=new WeakMap();
const trim=value=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240);
export function isNvidiaAdapter(info={}){
  const vendor=trim(info.vendor).toLowerCase(),description=trim(info.description).toLowerCase();
  return ['0x10de','10de','4318'].includes(vendor)||/\bnvidia\b/.test(vendor+' '+description);
}
export const AURORA_WGSL=`
struct Params { resolution: vec2f, core: vec2f, time: f32, energy: f32, work: f32, pad: f32, primary: vec4f, secondary: vec4f, };
@group(0) @binding(0) var<uniform> u: Params;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
  return vec4f(positions[index],0.0,1.0);
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453123); }
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv=vec2f(position.x/u.resolution.x,1.0-position.y/u.resolution.y);
  let p=(uv-u.core)*vec2f(u.resolution.x/u.resolution.y,1.0);
  let t=u.time*.065;
  let gold=u.primary.xyz; let silver=u.secondary.xyz;
  var light=vec3f(0.0); var density=0.0;
  for(var i=0u;i<5u;i=i+1u){
    let n=f32(i); var y=p.y+.075*n-.13;
    y=y+sin(p.x*1.35+t+n*.42)*(.045+.008*n)+sin(p.x*3.2-t*.6+n)*.012;
    let span=exp(-p.x*p.x*.62);
    let fine=exp(-abs(y)*190.0)*span; let volume=exp(-y*y*190.0)*span;
    let sheen=.45+.55*pow(max(0.0,sin(p.x*1.1-t+n*.7)),4.0);
    let hue=mix(gold,silver,select(0.0,.72,(i%2u)==1u));
    light=light+hue*(fine*.19+volume*.032)*sheen;
    density=density+fine*.025+volume*.012;
  }
  let radius=length(p*vec2f(1.0,1.07));
  let halo=exp(-pow((radius-.19-u.energy*.012)*30.0,2.0));
  light=light+mix(gold,silver,.24)*halo*(.035+u.work*.02+u.energy*.07);
  density=density+halo*.026;
  let cell=floor(uv*vec2f(66.0,38.0)); let point=fract(uv*vec2f(66.0,38.0))-.5;
  let seed=hash(cell); let star=exp(-dot(point,point)*1100.0)*step(.968,seed);
  let pulse=.6+.4*sin(t*1.3+seed*37.0);
  light=light+mix(silver,gold,seed)*star*.16*pulse; density=density+star*.06;
  let edge=1.0-smoothstep(.15,.9,length((uv-.5)*vec2f(1.15,1.0)));
  let alpha=clamp((density+.018)*edge,0.0,.26);
  let colour=clamp(light/(alpha+.04),vec3f(0.0),vec3f(1.0));
  return vec4f(colour*alpha,alpha);
}`;

/** Retain the working WebGL fallback unless an identified NVIDIA WebGPU adapter renders. */
export function initAuroraGraphics({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,host=root.querySelector('.ah-atmosphere');
  if(!win||!host)return()=>{};
  let fallback=initAuroraShader({root}),disposed=false,active=false,device=null,context=null,canvas=null,badge=null,uniform=null,pipeline=null,bindGroup=null;
  let frame=0,lastDraw=0,phase=0,visible=true,quality=1,slowFrames=0,lastFrame=0;
  let palette=shaderPalette(root);
  const cleanups=[],observers=[];let info={};
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const mode=()=>shaderMotion({motion:root.dataset.motion,reduced:Boolean(media?.matches),paused:root.dataset.paused==='true'||root.dataset.desktopDesign==='universe',hidden:doc.hidden,visible});
  const listen=(target,type,fn,options)=>{target?.addEventListener(type,fn,options);cleanups.push(()=>target?.removeEventListener(type,fn,options));};
  const publish=()=>{
    if(disposed)return;
    const detail={backend:root.dataset.shader||'unavailable',renderer:root.dataset.gpuRenderer||'',vendor:root.dataset.gpuVendor||'',resolution:root.dataset.shaderResolution||'',webgpuStatus:root.dataset.webgpuStatus||''};
    if(win.CustomEvent)root.dispatchEvent(new win.CustomEvent('aurora:graphics-ready',{detail}));
  };
  function stop(){if(frame)win.cancelAnimationFrame(frame);frame=0;lastDraw=0;lastFrame=0;slowFrames=0;}
  function diagnostics(){
    if(!active||disposed)return;
    root.dataset.shader='webgpu';root.dataset.gpuVendor=trim(info.vendor)||'NVIDIA';
    root.dataset.gpuRenderer=trim(info.description)||['NVIDIA',trim(info.architecture),trim(info.device)].filter(Boolean).join(' ');
    root.dataset.shaderResolution=canvas.width+'x'+canvas.height;
    badge.textContent='NVIDIA WebGPU';badge.title=root.dataset.gpuRenderer+' · '+root.dataset.shaderResolution+' render buffer';
  }
  function resize(){
    if(!active||!canvas)return;
    const bounds=root.getBoundingClientRect(),size=shaderBufferSize(bounds.width,bounds.height,win.devicePixelRatio,quality);
    if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;}
    diagnostics();
  }
  function paint(draw=true){
    if(!device||!context||!canvas||!pipeline||disposed)return;
    const bounds=root.getBoundingClientRect(),core=root.querySelector('.ah-core-stage')?.getBoundingClientRect();
    const width=Math.max(1,bounds.width),height=Math.max(1,bounds.height);
    const cx=core?(core.left-bounds.left+core.width/2)/width:.4,cy=core?1-(core.top-bounds.top+(core.height-44)/2)/height:.55;
    const motion=mode(),energy=shaderAudioEnergy(win.__auroraPlaybackAudio);
    const values=new Float32Array([canvas.width,canvas.height,cx,cy,motion==='full'?phase:0,energy,['working','speaking','listening'].includes(root.dataset.aiState)?1:0,0,...palette.primary,0,...palette.secondary,0]);
    device.queue.writeBuffer(uniform,0,values);
    const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
    if(draw){pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.draw(3);}
    pass.end();device.queue.submit([encoder.finish()]);
  }
  function fallbackAfterFailure(reason){
    if(disposed)return;
    active=false;stop();
    for(const off of cleanups.splice(0))off();for(const observer of observers.splice(0))observer.disconnect();
    canvas?.remove();badge?.remove();try{context?.unconfigure();}catch{}try{uniform?.destroy();}catch{}
    const oldDevice=device;device=null;context=null;canvas=null;badge=null;uniform=null;pipeline=null;bindGroup=null;
    try{oldDevice?.destroy();}catch{}
    for(const name of ['shader','gpuVendor','gpuRenderer','shaderResolution'])delete root.dataset[name];
    root.dataset.webgpuStatus=reason;
    if(!fallback)fallback=initAuroraShader({root});publish();
  }
  function draw(stamp){
    frame=0;if(disposed||!active||mode()!=='full')return;
    const delta=lastFrame?stamp-lastFrame:0;lastFrame=stamp;
    if(delta>60&&delta<250)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>=30&&quality>.5){quality=Math.max(.5,quality*.85);slowFrames=0;resize();}
    if(!lastDraw||stamp-lastDraw>=32){phase+=lastDraw?Math.min(.1,(stamp-lastDraw)/1000):0;lastDraw=stamp;try{paint();}catch{fallbackAfterFailure('render-failed');return;}}
    frame=win.requestAnimationFrame(draw);
  }
  function sync(){
    if(disposed||!active)return;stop();resize();
    try{if(mode()==='off'){canvas.hidden=true;paint(false);return;}canvas.hidden=false;paint();}catch{fallbackAfterFailure('render-failed');return;}
    if(mode()==='full')frame=win.requestAnimationFrame(draw);
  }
  async function negotiate(){
    const gpu=win.navigator?.gpu;
    if(!gpu?.requestAdapter){root.dataset.webgpuStatus='unavailable';publish();return;}
    root.dataset.webgpuStatus='probing';
    let candidate=null;
    try{
      const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});
      if(disposed)return;
      if(!adapter){root.dataset.webgpuStatus='no-adapter';publish();return;}
      info=adapter.info||(typeof adapter.requestAdapterInfo==='function'?await adapter.requestAdapterInfo():{});
      if(disposed)return;
      root.dataset.webgpuVendor=trim(info.vendor);root.dataset.webgpuAdapter=trim(info.description)||trim(info.architecture)||trim(info.device);
      if(!isNvidiaAdapter(info)){root.dataset.webgpuStatus='not-nvidia';publish();return;}
      if(adapter.isFallbackAdapter||info.isFallbackAdapter){root.dataset.webgpuStatus='fallback-adapter';publish();return;}
      candidate=await adapter.requestDevice();
      if(disposed){candidate.destroy();return;}
      const nextCanvas=doc.createElement('canvas');nextCanvas.className='ah-gpu-light-field';nextCanvas.setAttribute('aria-hidden','true');
      const nextContext=nextCanvas.getContext('webgpu');if(!nextContext)throw new Error('WebGPU canvas is unavailable');
      const bounds=root.getBoundingClientRect(),size=shaderBufferSize(bounds.width,bounds.height,win.devicePixelRatio);
      nextCanvas.width=size.width;nextCanvas.height=size.height;
      const format=gpu.getPreferredCanvasFormat?.()||'bgra8unorm';
      nextContext.configure({device:candidate,format,alphaMode:'premultiplied'});
      candidate.pushErrorScope?.('validation');
      const module=candidate.createShaderModule({label:'Aurora NVIDIA light field',code:AURORA_WGSL});
      if(module.getCompilationInfo){const compilation=await module.getCompilationInfo();const error=compilation.messages.find(message=>message.type==='error');if(error)throw new Error('GPU shader: '+trim(error.message));}
      const descriptor={label:'Aurora NVIDIA alpha lighting',layout:'auto',vertex:{module,entryPoint:'vertexMain'},fragment:{module,entryPoint:'fragmentMain',targets:[{format}]},primitive:{topology:'triangle-list'}};
      const nextPipeline=candidate.createRenderPipelineAsync?await candidate.createRenderPipelineAsync(descriptor):candidate.createRenderPipeline(descriptor);
      const validation=candidate.popErrorScope?await candidate.popErrorScope():null;if(validation)throw new Error('GPU pipeline validation failed');
      if(disposed){candidate.destroy();return;}
      const usage=win.GPUBufferUsage||{UNIFORM:64,COPY_DST:8};
      const nextUniform=candidate.createBuffer({label:'Aurora light parameters',size:64,usage:usage.UNIFORM|usage.COPY_DST});
      const nextGroup=candidate.createBindGroup({layout:nextPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:nextUniform}}]});
      device=candidate;canvas=nextCanvas;context=nextContext;uniform=nextUniform;pipeline=nextPipeline;bindGroup=nextGroup;
      if(mode()!=='off')paint();
      if(candidate.queue.onSubmittedWorkDone)await candidate.queue.onSubmittedWorkDone();
      if(disposed){candidate.destroy();return;}
      fallback?.();fallback=null;
      badge=doc.createElement('span');badge.className='ah-gpu-status';root.querySelector('.ah-statusbar')?.append(badge);host.append(canvas);active=true;
      root.dataset.webgpuStatus='active';delete root.dataset.webgpuError;diagnostics();
      listen(doc,'visibilitychange',sync);listen(media,'change',sync);listen(win,'resize',sync);
      listen(root,'aurora-playback-audio',()=>{if(mode()==='reduced')try{paint();}catch{fallbackAfterFailure('render-failed');}});
      listen(root,'aurora:palette-change',()=>{palette=shaderPalette(root);sync();});
      if(win.MutationObserver){const observer=new win.MutationObserver(records=>{if(records.some(record=>record.oldValue!==root.getAttribute(record.attributeName)))sync();});observer.observe(root,{attributes:true,attributeOldValue:true,attributeFilter:['data-motion','data-paused','data-ai-state','data-desktop-design']});observers.push(observer);}
      if(win.ResizeObserver){const observer=new win.ResizeObserver(sync);observer.observe(root);const hero=root.querySelector('.ah-core-stage');if(hero)observer.observe(hero);observers.push(observer);}
      if(win.IntersectionObserver){const observer=new win.IntersectionObserver(entries=>{const next=entries[0]?.isIntersecting!==false;if(next!==visible){visible=next;sync();}});observer.observe(root);observers.push(observer);}
      const ownedDevice=device;Promise.resolve(device.lost).then(()=>{if(!disposed&&active&&device===ownedDevice)fallbackAfterFailure('device-lost');},()=>{if(!disposed&&active&&device===ownedDevice)fallbackAfterFailure('device-lost');});
      sync();publish();
    }catch(error){
      try{candidate?.destroy();}catch{}
      if(disposed)return;
      if(active){fallbackAfterFailure('initialization-failed');return;}
      device=null;context=null;canvas=null;uniform=null;pipeline=null;bindGroup=null;
      root.dataset.webgpuStatus='initialization-failed';root.dataset.webgpuError=trim(error?.message);publish();
    }
  }
  const cleanup=()=>{
    if(disposed)return;disposed=true;active=false;stop();
    for(const off of cleanups)off();for(const observer of observers)observer.disconnect();
    fallback?.();fallback=null;canvas?.remove();badge?.remove();try{context?.unconfigure();}catch{}try{uniform?.destroy();}catch{}try{device?.destroy();}catch{}
    for(const name of ['shader','gpuVendor','gpuRenderer','shaderResolution','webgpuStatus','webgpuVendor','webgpuAdapter','webgpuError'])delete root.dataset[name];instances.delete(root);
  };
  instances.set(root,cleanup);void negotiate();return cleanup;
}
