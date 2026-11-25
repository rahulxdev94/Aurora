/* Hardware-only WebGL2 painter. The entry point owns pacing and the 2D fallback. */
import {GRAVITY_WAVE} from './gravity-wave.mjs';
import {armLights} from './arm-lights.mjs';
const TAU = Math.PI * 2, PERIOD = 300, RATE = TAU / PERIOD;
const QUAD = new Float32Array([-.5,-.5,.5,-.5,-.5,.5,-.5,.5,.5,-.5,.5,.5]);
const quadVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
uniform vec2 uResolution,uCentre;
uniform vec4 uAxes;
out vec2 vUv;
void main(){vec2 p=uCentre+aCorner.x*uAxes.xy+aCorner.y*uAxes.zw;gl_Position=vec4(p.x/uResolution.x*2.-1.,1.-p.y/uResolution.y*2.,0.,1.);vUv=aCorner+.5;}`;
const quadFragment = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uAlpha,uLevel;
uniform int uKind;
out vec4 outputColour;
void main(){
 vec4 c;
 if(uKind==0)c=texture(uTexture,vUv);
 else {float r=length((vUv-.5)*2.);if(r>1.)discard;
  if(uKind==1){
   if(r<.19)c=mix(vec4(241.,189.,133.,64.)/255.,vec4(210.,154.,140.,24.)/255.,r/.19);
   else if(r<.55)c=mix(vec4(210.,154.,140.,24.)/255.,vec4(121.,90.,136.,7.)/255.,(r-.19)/.36);
   else c=mix(vec4(121.,90.,136.,7.)/255.,vec4(80.,46.,96.,0.)/255.,(r-.55)/.45);
  }else{
   if(r<.14)c=mix(vec4(1.,244./255.,217./255.,.62+uLevel*.2),vec4(255.,227.,179.,168.)/255.,r/.14);
   else if(r<.4)c=mix(vec4(255.,227.,179.,168.)/255.,vec4(241.,185.,126.,48.)/255.,(r-.14)/.26);
   else c=mix(vec4(241.,185.,126.,48.)/255.,vec4(227.,167.,110.,0.)/255.,(r-.4)/.6);
  }
 }
 float alpha=c.a*uAlpha;outputColour=vec4(c.rgb*alpha,alpha);
}`;
const particleVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aData0;
layout(location=2) in vec4 aData1;
layout(location=3) in vec4 aData2;
layout(location=4) in vec4 aColour;
layout(location=5) in vec4 aData4;
uniform vec2 uResolution,uPointer,uCentre;
uniform vec4 uMain;
uniform float uTime,uDpr;
uniform int uKind;
out vec2 vUv;
out vec4 vColour;
flat out int vShape;
float positiveMod(float x,float y){return mod(mod(x,y)+y,y);}
float starLight(){float wave=.5+sin(uTime*aData1.y+aData1.x)*.5;float normal=aData1.z*(1.-aData1.w+aData1.w*wave);float dip=aData2.x>0.?pow(max(0.,((.5+.5*sin(uTime*aData2.y+aData2.z))-.91)/.09),3.):0.;return normal*(1.-dip*aData2.x);}
void main(){
 vec2 p,size;float alpha;vec3 colour=aColour.rgb;vShape=0;
 if(uKind==0){
  float original=aData0.w,expanded=max(original,1./uDpr);size=vec2(expanded);p=aData0.xy*uResolution+uPointer*aData0.z*vec2(22.,17.)+vec2(original*.5);
  float light=starLight();alpha=(floor(clamp(light,0.,.95)*16.)+.5)/16.;alpha*=min(1.,pow(original*uDpr,2.));
 }else if(uKind==1){
  p=vec2(positiveMod(aData0.x*(uResolution.x+20.)+uTime/300.*(uResolution.x+20.)*aData4.x,uResolution.x+20.)-10.+uPointer.x*aData0.z*55.,positiveMod(aData0.y*(uResolution.y+20.)+uTime/300.*(uResolution.y+20.)*aData4.y,uResolution.y+20.)-10.+uPointer.y*aData0.z*39.);
  size=vec2(3.+aData0.z*7.);alpha=.09+aData0.z*.23;colour=vec3(1.);vShape=1;
 }else if(uKind==2){
  p=vec2(positiveMod(aData0.x*(uResolution.x+80.)+uTime/300.*(uResolution.x+80.),uResolution.x+80.)-40.+uPointer.x*18.,aData0.y*uResolution.y+uPointer.y*13.);
  size=vec2(40.,20.);alpha=.018+aData0.z*.025;colour=vec3(1.);vShape=1;
 }else if(uKind==3){
  float r=(.035+aData0.x*.41)*uMain.x,a=log(aData0.x+.03)*4.15+mod(aData2.w,3.)*6.28318530718/3.+uTime*6.28318530718/300.;
  vec2 local=vec2(cos(a)*r,sin(a)*r*uMain.y/uMain.x);float co=cos(uMain.z),si=sin(uMain.z);p=uCentre+vec2(co*local.x-si*local.y,si*local.x+co*local.y);
  float radius=.35+aData0.z*.6;size=vec2(max(2.*radius,1./uDpr));alpha=aColour.a*min(1.,pow(2.*radius*uDpr,2.));vShape=2;
 }else{
  p=aData0.xy*uResolution+uPointer*aData0.z*vec2(22.,17.);size=vec2(10.);alpha=starLight()*.8;colour=vec3(1.);vShape=1;
 }
 vec2 point=p+aCorner*size;gl_Position=vec4(point.x/uResolution.x*2.-1.,1.-point.y/uResolution.y*2.,0.,1.);vUv=aCorner+.5;vColour=vec4(colour,alpha);
}`;
const particleFragment = `#version 300 es
precision highp float;
in vec2 vUv;in vec4 vColour;flat in int vShape;
uniform sampler2D uFlare;
out vec4 outputColour;
void main(){vec4 c=vColour;if(vShape==1)c*=texture(uFlare,vUv);else if(vShape==2){float r=length((vUv-.5)*2.);c.a*=1.-smoothstep(.82,1.,r);if(r>1.)discard;}outputColour=vec4(c.rgb*c.a,c.a);}`;
const waveFragment=`#version 300 es
precision highp float;
in vec2 vUv;uniform sampler2D uTexture;uniform vec2 uResolution;uniform vec4 uWaves[4];uniform int uWaveCount;out vec4 outputColour;
void main(){vec2 pixels=vec2(textureSize(uTexture,0));vec2 p=vec2(gl_FragCoord.x,pixels.y-gl_FragCoord.y)/pixels*uResolution,shift=vec2(0.);
 for(int i=0;i<4;i++){if(i>=uWaveCount)break;vec2 delta=p-uWaves[i].xy;float d=length(delta),q=(d-uWaves[i].z)/${GRAVITY_WAVE.width.toFixed(1)};if(d>.001&&abs(q)<3.5){float echo=(q+1.55)/.75;shift+=delta/d*(exp(-.5*q*q)-.32*exp(-.5*echo*echo))*uWaves[i].w;}}
 float magnitude=length(shift);if(magnitude>${GRAVITY_WAVE.maxDisplacement.toFixed(1)})shift*=${GRAVITY_WAVE.maxDisplacement.toFixed(1)}/magnitude;
 if(length(shift)<.001){outputColour=texelFetch(uTexture,ivec2(gl_FragCoord.xy),0);return;}
 vec2 uv=clamp((p-shift)/uResolution,vec2(0.),vec2(1.));outputColour=texture(uTexture,vec2(uv.x,1.-uv.y));
}`;

function rgb(value) {
  const hex = String(value || '#ffffff').replace('#','');
  return /^[\da-f]{6}$/i.test(hex) ? [0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255) : [1,1,1];
}
function axes(size, flatten, plane, spin=0) {
  const c=Math.cos(plane),s=Math.sin(plane),cr=Math.cos(spin),sr=Math.sin(spin);
  return [(c*cr-s*flatten*sr)*size,(s*cr+c*flatten*sr)*size,(-c*sr-s*flatten*cr)*size,(-s*sr+c*flatten*cr)*size];
}

export function createSkyGpu({canvas,stars=[],nearStars=[],dust=[],remote=[],colours=[],flare,onLoss=()=>{},onUnavailable=()=>{}}={}) {
  if (!canvas?.getContext) return null;
  let gl;
  try {gl=canvas.getContext('webgl2',{alpha:false,antialias:true,premultipliedAlpha:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:true,preserveDrawingBuffer:false});} catch {onUnavailable('WebGL2 creation failed');return null;}
  if (!gl) {onUnavailable('hardware WebGL2 context unavailable');return null;}
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=debug?String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)||''):'',vendor=debug?String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)||''):'';
  if (!renderer || /swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b|offscreen|angle.*null/i.test(renderer)) {onUnavailable(renderer||'hardware adapter identity unavailable');gl.getExtension('WEBGL_lose_context')?.loseContext();return null;}
  const resources={programs:[],buffers:[],vaos:[],textures:[],framebuffers:[],renderbuffers:[]};
  const waveSamples=Math.min(gl.getParameter(gl.SAMPLES)||0,gl.getParameter(gl.MAX_SAMPLES)||0);
  let armTexture=null;
  let disposed=false,lost=false,frames=0,uploads=0,backdrop=null,main=null,remoteTexture=null,mainSource=null,remoteSource=null,waveFrames=0,waveTarget=null,waveRenderTarget=null,waveColour=null,waveTexture=null,waveWidth=0,waveHeight=0;
  const destroy = () => {
    if(disposed)return;disposed=true;canvas.removeEventListener('webglcontextlost',contextLost);
    for(const resource of resources.textures)gl.deleteTexture(resource);for(const resource of resources.vaos)gl.deleteVertexArray(resource);for(const resource of resources.buffers)gl.deleteBuffer(resource);for(const resource of resources.programs)gl.deleteProgram(resource);
    for(const resource of resources.framebuffers)gl.deleteFramebuffer(resource);
    for(const resource of resources.renderbuffers)gl.deleteRenderbuffer(resource);
  };
  function contextLost(event) {event.preventDefault();if(disposed||lost)return;lost=true;onLoss({reason:'context-lost',renderer,vendor});}
  canvas.addEventListener('webglcontextlost',contextLost);
  function program(vertex,fragment) {
    const shaders=[gl.createShader(gl.VERTEX_SHADER),gl.createShader(gl.FRAGMENT_SHADER)];
    for(let i=0;i<2;i++){gl.shaderSource(shaders[i],i?fragment:vertex);gl.compileShader(shaders[i]);if(!gl.getShaderParameter(shaders[i],gl.COMPILE_STATUS)){const reason=gl.getShaderInfoLog(shaders[i]);for(const shader of shaders)gl.deleteShader(shader);throw new Error(reason||'Sky shader compilation failed');}}
    const value=gl.createProgram();for(const shader of shaders)gl.attachShader(value,shader);gl.linkProgram(value);for(const shader of shaders)gl.deleteShader(shader);if(!gl.getProgramParameter(value,gl.LINK_STATUS)){const reason=gl.getProgramInfoLog(value);gl.deleteProgram(value);throw new Error(reason||'Sky shader link failed');}resources.programs.push(value);return value;
  }
  function texture(source) {
    const value=gl.createTexture();resources.textures.push(value);gl.bindTexture(gl.TEXTURE_2D,value);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);uploads++;return value;
  }
  function replaceTexture(previous,source) {if(previous){gl.deleteTexture(previous);resources.textures=resources.textures.filter(value=>value!==previous);}return source?texture(source):null;}
  try {
    const quadProgram=program(quadVertex,quadFragment),particleProgram=program(particleVertex,particleFragment),waveProgram=program(quadVertex,waveFragment);
    const quadLocations=Object.fromEntries(['uResolution','uCentre','uAxes','uTexture','uAlpha','uLevel','uKind'].map(name=>[name,gl.getUniformLocation(quadProgram,name)]));
    const pointLocations=Object.fromEntries(['uResolution','uPointer','uCentre','uMain','uTime','uDpr','uKind','uFlare'].map(name=>[name,gl.getUniformLocation(particleProgram,name)]));
    const waveLocations=Object.fromEntries(['uResolution','uCentre','uAxes','uTexture','uWaveCount','uWaves[0]'].map(name=>[name,gl.getUniformLocation(waveProgram,name)])),waveData=new Float32Array(16);
    const corners=gl.createBuffer();resources.buffers.push(corners);gl.bindBuffer(gl.ARRAY_BUFFER,corners);gl.bufferData(gl.ARRAY_BUFFER,QUAD,gl.STATIC_DRAW);
    const quadVao=gl.createVertexArray();resources.vaos.push(quadVao);gl.bindVertexArray(quadVao);gl.bindBuffer(gl.ARRAY_BUFFER,corners);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    function batch(rows) {
      const vao=gl.createVertexArray(),buffer=gl.createBuffer();resources.vaos.push(vao);resources.buffers.push(buffer);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,corners);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(rows.flat()),gl.STATIC_DRAW);
      for(let index=0;index<5;index++){gl.enableVertexAttribArray(index+1);gl.vertexAttribPointer(index+1,4,gl.FLOAT,false,80,index*16);gl.vertexAttribDivisor(index+1,1);}return{vao,count:rows.length};
    }
    const row=(star,index,colour,alpha=1,cycles=0,yCycles=0)=>[star.x||0,star.y||0,star.depth??star.z??0,star.size||0,star.phase||0,star.speed||0,star.base||0,star.amplitude||0,star.dipDepth||0,star.dipSpeed||0,star.dipPhase||0,index,...colour,alpha,cycles,yCycles,0,0];
    const starBatch=batch(stars.map((star,index)=>row(star,index,rgb(colours[star.colour]))));
    const flareBatch=batch(stars.flatMap((star,index)=>index%97?[]:[row(star,index,[1,1,1])]));
    const nearBatch=batch(nearStars.map((star,index)=>row(star,index,[1,1,1],1,star.cycles||1,star.yCycles||0)));
    const dustBatch=batch(dust.map((star,index)=>row(star,index,[1,1,1])));
    const diskBatch=batch(stars.slice(0,86).map((star,index)=>row(star,index,index%5?rgb('#d9d0ef'):rgb('#ffe3b3'),index%5?184/255:217/255)));
    const flareTexture=flare?texture(flare):null;
    gl.bindVertexArray(null);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_COLOR);gl.clearColor(2/255,4/255,11/255,1);
    let logicalWidth=1,logicalHeight=1;
    function ensureWaveTarget(width,height){
      if(!waveTarget){waveTarget=gl.createFramebuffer();waveTexture=gl.createTexture();resources.framebuffers.push(waveTarget);resources.textures.push(waveTexture);if(waveSamples){waveRenderTarget=gl.createFramebuffer();waveColour=gl.createRenderbuffer();resources.framebuffers.push(waveRenderTarget);resources.renderbuffers.push(waveColour);}}
      if(waveWidth!==width||waveHeight!==height){gl.bindTexture(gl.TEXTURE_2D,waveTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);if(waveColour){gl.bindRenderbuffer(gl.RENDERBUFFER,waveColour);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,waveSamples,gl.RGBA8,width,height);}waveWidth=width;waveHeight=height;}
      gl.bindFramebuffer(gl.FRAMEBUFFER,waveTarget);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,waveTexture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Sky refraction target unavailable');
      if(waveRenderTarget){gl.bindFramebuffer(gl.FRAMEBUFFER,waveRenderTarget);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,waveColour);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Sky refraction antialias target unavailable');}
    }
    function refract(waves){
      if(waveRenderTarget){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,waveRenderTarget);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,waveTarget);gl.blitFramebuffer(0,0,waveWidth,waveHeight,0,0,waveWidth,waveHeight,gl.COLOR_BUFFER_BIT,gl.NEAREST);}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.BLEND);gl.useProgram(waveProgram);gl.bindVertexArray(quadVao);gl.uniform2f(waveLocations.uResolution,logicalWidth,logicalHeight);gl.uniform2f(waveLocations.uCentre,logicalWidth/2,logicalHeight/2);gl.uniform4f(waveLocations.uAxes,logicalWidth,0,0,logicalHeight);waveData.fill(0);
      const count=Math.min(4,waves.length);for(let i=0;i<count;i++)waveData.set([waves[i].x,waves[i].y,waves[i].radius,waves[i].strength],i*4);gl.uniform4fv(waveLocations['uWaves[0]'],waveData);gl.uniform1i(waveLocations.uWaveCount,count);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,waveTexture);gl.uniform1i(waveLocations.uTexture,0);gl.drawArrays(gl.TRIANGLES,0,6);waveFrames++;
    }
    function quad(tex,cx,cy,transform,alpha=1,kind=0,level=0) {
      gl.useProgram(quadProgram);gl.bindVertexArray(quadVao);gl.uniform2f(quadLocations.uResolution,logicalWidth,logicalHeight);gl.uniform2f(quadLocations.uCentre,cx,cy);gl.uniform4fv(quadLocations.uAxes,transform);gl.uniform1f(quadLocations.uAlpha,alpha);gl.uniform1f(quadLocations.uLevel,level);gl.uniform1i(quadLocations.uKind,kind);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex||flareTexture);gl.uniform1i(quadLocations.uTexture,0);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    function particles(value,kind,{width,height,dpr,time,px,py,cx,cy,w,h,orbit}) {
      if(!value.count)return;gl.useProgram(particleProgram);gl.bindVertexArray(value.vao);gl.uniform2f(pointLocations.uResolution,width,height);gl.uniform2f(pointLocations.uPointer,px,py);gl.uniform2f(pointLocations.uCentre,cx,cy);gl.uniform4f(pointLocations.uMain,w,h,orbit,0);gl.uniform1f(pointLocations.uTime,time);gl.uniform1f(pointLocations.uDpr,dpr);gl.uniform1i(pointLocations.uKind,kind);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,flareTexture);gl.uniform1i(pointLocations.uFlare,0);gl.drawArraysInstanced(gl.TRIANGLES,0,6,value.count);
    }
    return {
      setBackdrop(source) {if(disposed||lost)return;backdrop=replaceTexture(backdrop,source);},
      setArtwork({main:mainArt,remote:remoteArt}={}) {if(disposed||lost)return;if(mainArt!==mainSource){main=replaceTexture(main,mainArt);mainSource=mainArt;}if(remoteArt!==remoteSource){remoteTexture=replaceTexture(remoteTexture,remoteArt);remoteSource=remoteArt;}},
      setArmLight(source){if(!disposed&&!lost)armTexture=replaceTexture(armTexture,source);},
      draw({width,height,dpr=1,time=0,px=0,py=0,orbit=-.14,inclination=.84,geometry,level=0,waves=[],armMotion=true}={}) {
        if(disposed||lost||!geometry||!(width>0)||!(height>0))return false;
        logicalWidth=width;logicalHeight=height;const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;gl.viewport(0,0,pixelWidth,pixelHeight);
        if(waves.length)ensureWaveTarget(pixelWidth,pixelHeight);else gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        const wrappedTime=((time%PERIOD)+PERIOD)%PERIOD,cx=geometry.x+px*24,cy=geometry.y+py*17,w=geometry.width,h=geometry.height*Math.max(.43,Math.min(1.03,inclination+py*.055)),state={width,height,dpr,time:wrappedTime,px,py,cx,cy,w,h,orbit};
        gl.disable(gl.BLEND);gl.clear(gl.COLOR_BUFFER_BIT);if(backdrop)quad(backdrop,width/2,height/2,[width,0,0,height]);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_COLOR);
        if(remoteTexture)for(const item of remote){const size=Math.min(width*item.size,height*.28);quad(remoteTexture,item.x*width+px*5,item.y*height+py*4,axes(size,item.flatten,item.angle,wrappedTime*item.speed),item.alpha);}
        gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);particles(starBatch,0,state);particles(flareBatch,4,state);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_COLOR);
        const radius=w*.48;quad(null,cx,cy,[radius*2,0,0,radius*2],1,1);
        if(main){
          const disk=axes(w,h/w,orbit,wrappedTime*RATE);
          quad(main,cx,cy,disk);
          if(armTexture&&armMotion)for(const light of armLights(wrappedTime,Math.hypot(px,py))){
            const c=Math.cos(light.angle),s=Math.sin(light.angle);
            const patch=[(disk[0]*c+disk[2]*s)*light.width,(disk[1]*c+disk[3]*s)*light.width,
              (disk[2]*c-disk[0]*s)*light.height,(disk[3]*c-disk[1]*s)*light.height];
            quad(armTexture,cx+disk[0]*light.u+disk[2]*light.v,cy+disk[1]*light.u+disk[3]*light.v,patch,Math.min(1,light.alpha));
          }
        }
        particles(diskBatch,3,state);
        const nucleus=Math.max(14,w*.035);quad(null,cx,cy,axes(nucleus*2,.6,orbit),1,2,level);
        particles(nearBatch,1,state);particles(dustBatch,2,state);if(waves.length)refract(waves);gl.bindVertexArray(null);frames++;return true;
      },
      get info(){return{backend:'webgl2',hardwareVerified:true,renderer,vendor,version:String(gl.getParameter(gl.VERSION)),stars:stars.length,nearStars:nearStars.length,dust:dust.length,remoteGalaxies:remote.length,diskStars:Math.min(86,stars.length),textureUploads:uploads,frames,refractionFrames:waveFrames,refractionSamples:waveSamples,refractionOverlay:false,refractionTarget:[waveWidth,waveHeight],contextLost:lost,disposed};},
      dispose:destroy
    };
  } catch(error) {onUnavailable(String(error?.message||error).slice(0,280));destroy();return null;}
}
