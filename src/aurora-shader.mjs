// An alpha-composited WebGL2 light field. Hardware selection is a browser hint,
// never a claim about which adapter the operating system ultimately selects.
const instances=new WeakMap();
export const SHADER_MAX_PIXELS=8388608;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function shaderBufferSize(width,height,dpr=1,quality=1,maxPixels=SHADER_MAX_PIXELS){
  const w=Number.isFinite(width)?Math.max(1,width):1,h=Number.isFinite(height)?Math.max(1,height):1;
  const requested=clamp(Number.isFinite(dpr)?dpr:1,1,2)*clamp(Number.isFinite(quality)?quality:1,.5,1);
  const scale=Math.min(requested,Math.sqrt(Math.max(1,maxPixels)/(w*h)),8192/w,8192/h);
  return{width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale)),scale};
}
export function shaderMotion({motion='full',reduced=false,paused=false,hidden=false,visible=true,lost=false}={}){
  if(motion==='off'||paused||hidden||!visible||lost)return'off';
  return motion==='reduced'||reduced?'reduced':'full';
}
export function shaderAudioEnergy(playback,now=Date.now()){
  if(playback?.status!=='active'||!Number.isFinite(playback.at)||playback.at>now+1000||now-playback.at>=2000||!Number.isFinite(playback.peak))return 0;
  return clamp(playback.peak,0,1);
}
export function shaderPalette(root){
  const original={primary:[.88,.70,.36],secondary:[.73,.79,.88]};
  if(!root?.dataset?.auroraPalette||root.dataset.auroraPalette==='gold')return original;
  const style=root.ownerDocument?.defaultView?.getComputedStyle?.(root)||root.style;
  const colour=(name,fallback)=>{const raw=style?.getPropertyValue?.(name)?.trim();return /^#[0-9a-f]{6}$/i.test(raw||'')?[1,3,5].map(index=>parseInt(raw.slice(index,index+2),16)/255):fallback;};
  return{primary:colour('--au-accent',original.primary),secondary:colour('--au-accent2',original.secondary)};
}
export const SHADER_VERTEX=`#version 300 es
in vec2 a_position;
void main(){gl_Position=vec4(a_position,0.0,1.0);}`;
export const SHADER_FRAGMENT=`#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_core;
uniform float u_time;
uniform float u_energy;
uniform float u_work;
uniform vec3 u_primary;
uniform vec3 u_secondary;
out vec4 outColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  float aspect=u_resolution.x/u_resolution.y;
  vec2 p=(uv-u_core)*vec2(aspect,1.0);
  float t=u_time*.065;
  vec3 gold=u_primary,silver=u_secondary;
  vec3 light=vec3(0.0);
  float density=0.0;
  for(int i=0;i<5;i++){
    float n=float(i),y=p.y+.075*n-.13;
    y+=sin(p.x*1.35+t+n*.42)*(.045+.008*n);
    y+=sin(p.x*3.2-t*.6+n)*.012;
    float span=exp(-p.x*p.x*.62);
    float fine=exp(-abs(y)*190.0)*span;
    float volume=exp(-y*y*190.0)*span;
    float sheen=.45+.55*pow(max(0.0,sin(p.x*1.1-t+n*.7)),4.0);
    vec3 hue=mix(gold,silver,mod(n,2.0)*.72);
    light+=hue*(fine*.19+volume*.032)*sheen;
    density+=fine*.025+volume*.012;
  }
  float radius=length(p*vec2(1.0,1.07));
  float halo=exp(-pow((radius-.19-u_energy*.012)*30.0,2.0));
  light+=mix(gold,silver,.24)*halo*(.035+u_work*.02+u_energy*.07);
  density+=halo*.026;
  vec2 cell=floor(uv*vec2(66.0,38.0));
  vec2 point=fract(uv*vec2(66.0,38.0))-.5;
  float seed=hash(cell),star=exp(-dot(point,point)*1100.0)*step(.968,seed);
  float pulse=.6+.4*sin(t*1.3+seed*37.0);
  light+=mix(silver,gold,seed)*star*.16*pulse;
  density+=star*.06;
  float edge=smoothstep(.9,.15,length((uv-.5)*vec2(1.15,1.0)));
  float alpha=clamp((density+.018)*edge,0.0,.26);
  vec3 colour=clamp(light/(alpha+.04),0.0,1.0);
  outColor=vec4(colour,alpha);
}`;

export function initAuroraShader({root}={}){
  if(!root?.ownerDocument)return()=>{};
  if(instances.has(root))return instances.get(root);
  const doc=root.ownerDocument,win=doc.defaultView,host=root.querySelector('.ah-atmosphere');
  if(!win||!host)return()=>{};
  const canvas=doc.createElement('canvas');canvas.className='ah-gpu-light-field';canvas.setAttribute('aria-hidden','true');
  const gl=canvas.getContext?.('webgl2',{alpha:true,premultipliedAlpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
  if(!gl){root.dataset.shader='unavailable';return()=>{delete root.dataset.shader;};}
  host.append(canvas);
  const badge=doc.createElement('span');badge.className='ah-gpu-status';badge.textContent='GPU effects';
  root.querySelector('.ah-statusbar')?.append(badge);
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed=false,lost=false,visible=true,frame=0,lastDraw=0,lastFrame=0,phase=0,quality=1,slowFrames=0,program=null,buffer=null,vao=null,uniforms=null;
  let width=1,height=1,coreX=.4,coreY=.55;
  let palette=shaderPalette(root);
  const cleanups=[],observers=[];
  const listen=(target,event,fn,options)=>{target?.addEventListener(event,fn,options);cleanups.push(()=>target?.removeEventListener(event,fn,options));};
  const mode=()=>shaderMotion({motion:root.dataset.motion,reduced:Boolean(media?.matches),paused:root.dataset.paused==='true'||root.dataset.desktopDesign==='universe',hidden:doc.hidden,visible,lost});
  function stop(){if(frame)win.cancelAnimationFrame(frame);frame=0;lastDraw=0;lastFrame=0;slowFrames=0;}
  function clear(){if(!lost&&!disposed){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}}
  function diagnostics(){
    let renderer='WebGL2',vendor='';
    try{const ext=gl.getExtension('WEBGL_debug_renderer_info');if(ext){renderer=String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||renderer);vendor=String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)||'');}}catch{}
    root.dataset.shader='webgl2';root.dataset.gpuRenderer=renderer.slice(0,240);root.dataset.gpuVendor=vendor.slice(0,120);
    badge.textContent=/nvidia/i.test(renderer+' '+vendor)?'NVIDIA GPU effects':'GPU effects';
    badge.title=renderer+' · '+canvas.width+' × '+canvas.height+' render buffer';
  }
  function destroyResources(){
    if(!lost){if(program)gl.deleteProgram(program);if(buffer)gl.deleteBuffer(buffer);if(vao)gl.deleteVertexArray(vao);}
    program=null;buffer=null;vao=null;uniforms=null;
  }
  function buildResources(){
    destroyResources();
    const shaders=[];
    try{
      for(const [type,source]of [[gl.VERTEX_SHADER,SHADER_VERTEX],[gl.FRAGMENT_SHADER,SHADER_FRAGMENT]]){
        const shader=gl.createShader(type);if(!shader)throw new Error('GPU shader allocation failed');
        shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('GPU shader compilation failed');
      }
      program=gl.createProgram();if(!program)throw new Error('GPU program allocation failed');
      for(const shader of shaders)gl.attachShader(program,shader);
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('GPU program linking failed');
      vao=gl.createVertexArray();buffer=gl.createBuffer();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      uniforms=Object.fromEntries(['u_resolution','u_core','u_time','u_energy','u_work','u_primary','u_secondary'].map(name=>[name,gl.getUniformLocation(program,name)]));
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);diagnostics();return true;
    }catch{destroyResources();root.dataset.shader='unavailable';badge.textContent='Standard effects';badge.title='GPU light effects are unavailable. The desktop remains usable.';return false;}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  function resize(){
    if(disposed||lost)return;
    const bounds=root.getBoundingClientRect();width=Math.max(1,bounds.width);height=Math.max(1,bounds.height);
    const core=root.querySelector('.ah-core-stage')?.getBoundingClientRect();
    if(core){coreX=(core.left-bounds.left+core.width/2)/width;coreY=1-(core.top-bounds.top+(core.height-44)/2)/height;}
    const size=shaderBufferSize(width,height,win.devicePixelRatio,quality);
    if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;gl.viewport(0,0,size.width,size.height);}
    root.dataset.shaderResolution=canvas.width+'x'+canvas.height;diagnostics();
  }
  function paint(){
    if(disposed||lost||!program)return;
    const current=mode();if(current==='off'){clear();return;}
    const energy=shaderAudioEnergy(win.__auroraPlaybackAudio);
    gl.useProgram(program);gl.bindVertexArray(vao);
    gl.uniform2f(uniforms.u_resolution,canvas.width,canvas.height);gl.uniform2f(uniforms.u_core,coreX,coreY);
    gl.uniform1f(uniforms.u_time,current==='full'?phase:0);gl.uniform1f(uniforms.u_energy,energy);
    gl.uniform1f(uniforms.u_work,['working','speaking','listening'].includes(root.dataset.aiState)?1:0);
    gl.uniform3f(uniforms.u_primary,...palette.primary);gl.uniform3f(uniforms.u_secondary,...palette.secondary);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function draw(stamp){
    frame=0;if(disposed||mode()!=='full'||!program)return;
    const interval=['working','speaking','listening'].includes(root.dataset.aiState)?1000/45:1000/30;
    const delta=lastFrame?stamp-lastFrame:0;lastFrame=stamp;
    if(delta>interval*1.8&&delta<250)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>=30&&quality>.5){quality=Math.max(.5,quality*.85);slowFrames=0;resize();}
    if(!lastDraw||stamp-lastDraw>=interval-1){phase+=lastDraw?Math.min(.1,(stamp-lastDraw)/1000):0;lastDraw=stamp;paint();}
    frame=win.requestAnimationFrame(draw);
  }
  function sync(){
    if(disposed)return;stop();
    if(lost||!program)return;
    if(mode()==='off'){clear();canvas.hidden=true;return;}
    canvas.hidden=false;resize();paint();if(mode()==='full')frame=win.requestAnimationFrame(draw);
  }
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();lost=true;stop();root.dataset.shader='context-lost';badge.textContent='GPU paused';});
  listen(canvas,'webglcontextrestored',()=>{lost=false;if(buildResources())sync();});
  listen(doc,'visibilitychange',sync);listen(media,'change',sync);listen(win,'resize',sync);
  listen(root,'aurora-playback-audio',()=>{if(mode()==='reduced')paint();});
  listen(root,'aurora:palette-change',()=>{palette=shaderPalette(root);sync();});
  if(win.MutationObserver){const observer=new win.MutationObserver(records=>{if(records.some(record=>record.oldValue!==root.getAttribute(record.attributeName)))sync();});observer.observe(root,{attributes:true,attributeOldValue:true,attributeFilter:['data-motion','data-paused','data-ai-state','data-desktop-design']});observers.push(observer);}
  if(win.ResizeObserver){const observer=new win.ResizeObserver(sync);observer.observe(root);const hero=root.querySelector('.ah-core-stage');if(hero)observer.observe(hero);observers.push(observer);}
  if(win.IntersectionObserver){const observer=new win.IntersectionObserver(entries=>{const next=entries[0]?.isIntersecting!==false;if(next!==visible){visible=next;sync();}});observer.observe(root);observers.push(observer);}
  const cleanup=()=>{
    if(disposed)return;stop();for(const off of cleanups)off();for(const observer of observers)observer.disconnect();destroyResources();disposed=true;
    canvas.remove();badge.remove();delete root.dataset.shader;delete root.dataset.gpuRenderer;delete root.dataset.gpuVendor;delete root.dataset.shaderResolution;instances.delete(root);
    try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
  };
  instances.set(root,cleanup);if(buildResources())sync();return cleanup;
}
