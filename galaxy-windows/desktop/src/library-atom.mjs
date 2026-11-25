/** Decorative 3D Library atom. Owns only children inserted into the supplied model. */
const instances=new WeakMap();
const TAU=Math.PI*2;
const ORBITS=Object.freeze([
  {incline:1.13,roll:-.29,period:5.3,phase:.62,colour:[155,211,255]},
  {incline:.93,roll:1.04,period:7.7,phase:2.93,colour:[197,183,255]},
  {incline:1.43,roll:2.18,period:9.9,phase:4.58,colour:[159,238,245]},
]);
export function createLibraryAtom(model){
  if(!model?.ownerDocument)return()=>{};
  instances.get(model)?.();
  const doc=model.ownerDocument,win=doc.defaultView;
  const root=model.closest('#aurora-home-preview')||doc.documentElement;
  const canvas=doc.createElement('canvas');canvas.className='ag-library-atom-canvas';canvas.setAttribute('aria-hidden','true');canvas.setAttribute('role','presentation');
  const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return()=>{};
  model.classList.add('ag-library-atom');model.append(canvas);
  const media=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let width=0,height=0,dpr=1,radius=0,nucleusRadius=0,frame=0,frames=0,lastPaint=-Infinity,started=0,elapsed=0,running=false,destroyed=false,lastElectrons=[];
  const currentMotion=()=>root.dataset.motion||'full';
  const isVisible=()=>!doc.hidden&&root.dataset.paused!=='true'&&model.getClientRects().length>0;
  const canAnimate=()=>isVisible()&&currentMotion()==='full'&&!media?.matches;
  function project(orbit,theta){
    const cx=Math.cos(theta)*radius,cy=Math.sin(theta)*radius;
    const y=cy*Math.cos(orbit.incline),z=cy*Math.sin(orbit.incline);
    const x=cx*Math.cos(orbit.roll)-y*Math.sin(orbit.roll),tiltedY=cx*Math.sin(orbit.roll)+y*Math.cos(orbit.roll);
    const scale=1/(1-z/(radius*4.8));
    return{x:width*.5+x*scale,y:height*.5+tiltedY*scale,z,scale};
  }
  function strokeSegment(orbit,from,to,opacity,lineWidth){
    const a=project(orbit,from),b=project(orbit,to),rgb=orbit.colour.join(',');
    ctx.strokeStyle='rgba('+rgb+','+opacity+')';ctx.lineWidth=lineWidth;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
  }
  function drawPaths(front){
    const segments=128;
    for(const orbit of ORBITS){for(let step=0;step<segments;step++){
      const a=step/segments*TAU,b=(step+1)/segments*TAU,point=project(orbit,(a+b)*.5);
      if((point.z>=0)!==front)continue;
      strokeSegment(orbit,a,b,front?.31+Math.max(0,point.z/radius)*.18:.13,.64);
    }}
  }
  function drawElectron(point,orbit,front,theta){
    const rgb=orbit.colour.join(',');
    // The trailing arc lies in the same inclined plane as its electron.
    const trail=.52,steps=18;
    for(let index=0;index<steps;index++){
      const a=theta-trail+trail*index/steps,b=theta-trail+trail*(index+1)/steps,mid=project(orbit,(a+b)*.5);
      if((mid.z>=0)!==front)continue;
      strokeSegment(orbit,a,b,(front?.09:.035)+(index/steps)*(front?.48:.16),.95*mid.scale);
    }
    if((point.z>=0)!==front)return;
    const electronRadius=1.55*point.scale*(front?1:.86),haloRadius=electronRadius*4.7;
    const glow=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,haloRadius);
    glow.addColorStop(0,'rgba(245,253,255,'+(front?.91:.49)+')');glow.addColorStop(.2,'rgba('+rgb+','+(front?.69:.32)+')');glow.addColorStop(1,'rgba('+rgb+',0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(point.x,point.y,haloRadius,0,TAU);ctx.fill();
    ctx.fillStyle=front?'#f4fdff':'#9eb9d4';ctx.beginPath();ctx.arc(point.x,point.y,electronRadius,0,TAU);ctx.fill();
  }
  function drawNucleus(){
    const x=width*.5,y=height*.5,r=nucleusRadius;
    const aura=ctx.createRadialGradient(x,y,r*.35,x,y,r*4.8);
    aura.addColorStop(0,'rgba(216,237,255,.42)');aura.addColorStop(.25,'rgba(126,179,255,.22)');aura.addColorStop(1,'rgba(91,133,255,0)');ctx.fillStyle=aura;ctx.beginPath();ctx.arc(x,y,r*4.8,0,TAU);ctx.fill();
    // Opaque sphere occludes the rear paths and rear electrons. Its centre never moves.
    const core=ctx.createRadialGradient(x-r*.3,y-r*.35,r*.08,x,y,r);
    core.addColorStop(0,'#ffffff');core.addColorStop(.32,'#e6f4ff');core.addColorStop(.67,'#accbfa');core.addColorStop(.91,'#6179b6');core.addColorStop(1,'#435177');ctx.fillStyle=core;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
    ctx.strokeStyle='rgba(226,242,255,.78)';ctx.lineWidth=.5;ctx.beginPath();ctx.arc(x,y,r*.98,-2.8,-.6);ctx.stroke();
  }
  function renderAt(seconds=0){
    if(destroyed||width<1||height<1)return;
    const time=Number.isFinite(seconds)?Math.max(0,seconds):0;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    lastElectrons=ORBITS.map(orbit=>{const theta=orbit.phase+time*TAU/orbit.period;return{orbit,theta,...project(orbit,theta)};});
    drawPaths(false);for(const point of [...lastElectrons].sort((a,b)=>a.z-b.z))drawElectron(point,point.orbit,false,point.theta);
    drawNucleus();drawPaths(true);for(const point of [...lastElectrons].sort((a,b)=>a.z-b.z))drawElectron(point,point.orbit,true,point.theta);
    elapsed=time;frames++;
  }
  function resize(){
    if(destroyed)return;const box=model.getBoundingClientRect();
    // CSS layout dimensions keep hover/focus transforms from resizing the canvas.
    width=model.clientWidth||box.width;height=model.clientHeight||box.height;dpr=Math.min(2,Math.max(1,win.devicePixelRatio||1));
    canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
    radius=Math.min(width*.405,height*.405);nucleusRadius=Math.min(width,height)*.076;
    renderAt(canAnimate()?elapsed:0);reconcile();
  }
  function tick(now){frame=0;if(!canAnimate()){reconcile();return;}if(!started)started=now-elapsed*1000;if(now-lastPaint>=1000/30-1){renderAt((now-started)/1000);lastPaint=now;}frame=win.requestAnimationFrame(tick);}
  function reconcile(){
    if(destroyed)return;const next=canAnimate();
    if(next&&!running){running=true;started=0;lastPaint=-Infinity;frame=win.requestAnimationFrame(tick);}
    if(!next){if(frame)win.cancelAnimationFrame(frame);frame=0;started=0;running=false;if(isVisible())renderAt(0);}
  }
  const observer=new win.MutationObserver(reconcile);observer.observe(root,{attributes:true,subtree:true,attributeFilter:['data-motion','data-paused','data-workspace','hidden','class']});
  const resizeObserver=typeof win.ResizeObserver==='function'?new win.ResizeObserver(resize):null;resizeObserver?.observe(model);
  doc.addEventListener('visibilitychange',reconcile);media?.addEventListener('change',reconcile);win.addEventListener('resize',resize);
  const hook={renderAt,get state(){return{running,frames,motion:currentMotion(),width,height,dpr,elapsed,nucleus:{x:width*.5,y:height*.5,radius:nucleusRadius},orbits:ORBITS.map(({incline,roll,period})=>({incline,roll,period})),electrons:lastElectrons.map(({x,y,z,scale})=>({x,y,z,scale}))};}};
  Object.defineProperty(model,'__auroraLibraryAtom',{configurable:true,value:hook});
  function cleanup(){if(destroyed)return;destroyed=true;if(frame)win.cancelAnimationFrame(frame);observer.disconnect();resizeObserver?.disconnect();doc.removeEventListener('visibilitychange',reconcile);media?.removeEventListener('change',reconcile);win.removeEventListener('resize',resize);canvas.remove();model.classList.remove('ag-library-atom');if(model.__auroraLibraryAtom===hook)delete model.__auroraLibraryAtom;instances.delete(model);}
  instances.set(model,cleanup);resize();return cleanup;
}
