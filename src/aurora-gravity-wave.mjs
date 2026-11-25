// CSS-pixel radial refraction shared by the GPU, canvas fallback and dock timing.
export const GRAVITY_WAVE=Object.freeze({durationMs:2050,minimumSpeed:.84,crossingMs:1700,width:34,amplitude:4.2,attackMs:80,fadeMs:300,decayMs:2600,maxWaves:4,maxDisplacement:6});
export function gravityWaveSpeed(width,height){return Math.max(GRAVITY_WAVE.minimumSpeed,Math.hypot(width,height)/GRAVITY_WAVE.crossingMs);}
export function gravityWaveEnvelope(age){
 const p=GRAVITY_WAVE;if(!Number.isFinite(age)||age<=0||age>=p.durationMs)return 0;
 const tail=Math.min(1,(p.durationMs-age)/p.fadeMs),fade=tail*tail*(3-2*tail);
 return Math.min(1,age/p.attackMs)*Math.exp(-age/p.decayMs)*fade;
}
export function gravityWaveDisplacement(x,y,waves,out=[0,0]){
 let dx=0,dy=0;
 for(const wave of waves){const vx=x-wave.x,vy=y-wave.y,distance=Math.hypot(vx,vy);if(distance<.001)continue;const q=(distance-wave.radius)/GRAVITY_WAVE.width;if(Math.abs(q)>3.5)continue;const echo=(q+1.55)/.75,amount=(Math.exp(-.5*q*q)-.32*Math.exp(-.5*echo*echo))*wave.strength;dx+=vx/distance*amount;dy+=vy/distance*amount;}
 const size=Math.hypot(dx,dy),scale=size>GRAVITY_WAVE.maxDisplacement?GRAVITY_WAVE.maxDisplacement/size:1;out[0]=dx*scale;out[1]=dy*scale;return out;
}
export function createGravityWavePool(){
 let events=[],accepted=0,coalesced=0,expired=0,last=null;
 return {
  add({x,y,startedAt,speed},now=Date.now()){
   const start=Number.isFinite(startedAt)?Math.min(now,startedAt):now;
   if(![x,y,speed,now].every(Number.isFinite)||speed<=0||now-start>=GRAVITY_WAVE.durationMs)return false;
   if(last&&Math.abs(start-last.startedAt)<40&&Math.hypot(x-last.x,y-last.y)<6){coalesced++;return false;}
   events=events.filter(event=>now-event.startedAt<GRAVITY_WAVE.durationMs);const wave={x,y,startedAt:start,speed};events.push(wave);if(events.length>GRAVITY_WAVE.maxWaves)events.shift();accepted++;last={...wave};return true;
  },
  sample(now=Date.now()){
   const before=events.length;events=events.filter(event=>now-event.startedAt<GRAVITY_WAVE.durationMs);expired+=before-events.length;
   return events.map(event=>({...event,age:Math.max(0,now-event.startedAt),radius:Math.max(0,now-event.startedAt)*event.speed,strength:GRAVITY_WAVE.amplitude*gravityWaveEnvelope(now-event.startedAt)})).filter(wave=>wave.strength>.0001);
  },
  clear(){events=[];last=null;},
  state(now=Date.now()){const waves=this.sample(now);return{active:waves.length,accepted,coalesced,expired,last:last?{...last}:null,waves: waves.map(({x,y,age,radius,speed,strength})=>({x,y,age,radius,speed,strength})),overlay:false,clock:'epoch-ms'};}
 };
}

// The Canvas2D fallback uses the browser's native displacement filter. Only a
// tiny local vector map is encoded; the actual sky remains the source image.
export function createCanvasWaveFilter(canvas,host){
 const doc=canvas.ownerDocument,win=doc.defaultView,ns='http://www.w3.org/2000/svg';
 if(!win?.SVGFEImageElement||!win.CSS?.supports?.('filter','url(#aurora-gravity)'))return null;
 const svg=doc.createElementNS(ns,'svg'),filter=doc.createElementNS(ns,'filter'),image=doc.createElementNS(ns,'feImage'),transfer=doc.createElementNS(ns,'feComponentTransfer'),displacement=doc.createElementNS(ns,'feDisplacementMap');
 const id='aurora-gravity-'+Math.random().toString(36).slice(2);svg.setAttribute('aria-hidden','true');svg.style.cssText='position:absolute;width:0;height:0;pointer-events:none;';filter.id=id;filter.setAttribute('filterUnits','userSpaceOnUse');filter.setAttribute('color-interpolation-filters','sRGB');filter.setAttribute('x','0');filter.setAttribute('y','0');
 image.setAttribute('preserveAspectRatio','none');image.setAttribute('result','vectors');transfer.setAttribute('in','vectors');transfer.setAttribute('result','centred');
 for(const channel of ['R','G']){const fn=doc.createElementNS(ns,'feFunc'+channel);fn.setAttribute('type','linear');fn.setAttribute('slope','1');fn.setAttribute('intercept',String(.5-128/255));transfer.append(fn);}
 displacement.setAttribute('in','SourceGraphic');displacement.setAttribute('in2','centred');displacement.setAttribute('scale',String(GRAVITY_WAVE.maxDisplacement*2));displacement.setAttribute('xChannelSelector','R');displacement.setAttribute('yChannelSelector','G');filter.append(image,transfer,displacement);svg.append(filter);host.append(svg);
 const map=doc.createElement('canvas'),brush=map.getContext('2d',{willReadFrequently:true});let pixels,active=false,lastWidth=0,lastHeight=0,frames=0;const shift=[0,0],previousFilter=canvas.style.filter;
 return {
  draw(waves,width,height){
   if(!waves.length){if(active)canvas.style.filter=previousFilter;active=false;return 0;}
   if(width!==lastWidth||height!==lastHeight){const ratio=Math.min(1/8,Math.sqrt(20000/(width*height)));map.width=Math.max(2,Math.round(width*ratio));map.height=Math.max(2,Math.round(height*ratio));pixels=brush.createImageData(map.width,map.height);lastWidth=width;lastHeight=height;for(const node of [filter,image,transfer,displacement]){node.setAttribute('width',String(width));node.setAttribute('height',String(height));}}
   const data=pixels.data,scale=GRAVITY_WAVE.maxDisplacement*2;
   for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){gravityWaveDisplacement((x+.5)/map.width*width,(y+.5)/map.height*height,waves,shift);const at=(y*map.width+x)*4;data[at]=Math.round(128-shift[0]/scale*255);data[at+1]=Math.round(128-shift[1]/scale*255);data[at+2]=128;data[at+3]=255;}
   brush.putImageData(pixels,0,0);image.setAttribute('href',map.toDataURL('image/png'));canvas.style.filter='url(#'+id+')';active=true;frames++;return map.width*map.height;
  },
  get info(){return{backend:'native-svg-displacement',active,mapPixels:map.width*map.height,frames,overlay:false};},
  dispose(){canvas.style.filter=previousFilter;svg.remove();map.width=map.height=1;}
 };
}

// Draw only a bounded triangle mesh over the currently painted combined sky.
// Source pixels are copied once; there is no readback and no coloured overlay.
export function refractCanvas(context,canvas,snapshot,waves,width,height,dpr){
 if(!waves.length)return 0;
 if(snapshot.width!==canvas.width)snapshot.width=canvas.width;if(snapshot.height!==canvas.height)snapshot.height=canvas.height;
 const copy=snapshot.getContext('2d',{alpha:false});copy.setTransform(1,0,0,1,0,0);copy.globalCompositeOperation='copy';copy.drawImage(canvas,0,0);
 // At most roughly 400 affine draws even at 4K. The fallback's broad mesh
 // trades subpixel fidelity for bounded CPU work while keeping the real image.
 const step=Math.max(42,Math.sqrt(width*height/180)),cols=Math.ceil(width/step),rows=Math.ceil(height/step),points=[];let triangles=0;
 for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){const x=Math.min(width,col*step),y=Math.min(height,row*step),shift=gravityWaveDisplacement(x,y,waves);points.push({x,y,dx:x+shift[0],dy:y+shift[1],moved:Math.abs(shift[0])+Math.abs(shift[1])>.008});}
 function triangle(a,b,c){
  if(!a.moved&&!b.moved&&!c.moved)return;
  const sx=b.x-a.x,sy=b.y-a.y,tx=c.x-a.x,ty=c.y-a.y,det=sx*ty-sy*tx;if(Math.abs(det)<.001)return;
  const ux=b.dx-a.dx,uy=b.dy-a.dy,vx=c.dx-a.dx,vy=c.dy-a.dy;
  const aa=(ux*ty-vx*sy)/det,bb=(uy*ty-vy*sy)/det,cc=(vx*sx-ux*tx)/det,dd=(vy*sx-uy*tx)/det;
  context.save();context.beginPath();context.moveTo(a.dx,a.dy);context.lineTo(b.dx,b.dy);context.lineTo(c.dx,c.dy);context.closePath();context.clip();
  const left=Math.max(0,Math.min(a.x,b.x,c.x)-2/dpr),top=Math.max(0,Math.min(a.y,b.y,c.y)-2/dpr),right=Math.min(width,Math.max(a.x,b.x,c.x)+2/dpr),bottom=Math.min(height,Math.max(a.y,b.y,c.y)+2/dpr);
  context.transform(aa,bb,cc,dd,a.dx-aa*a.x-cc*a.y,a.dy-bb*a.x-dd*a.y);context.drawImage(snapshot,left*dpr,top*dpr,(right-left)*dpr,(bottom-top)*dpr,left,top,right-left,bottom-top);context.restore();triangles++;
 }
 context.save();context.setTransform(dpr,0,0,dpr,0,0);context.globalCompositeOperation='source-over';context.globalAlpha=1;
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){const at=row*(cols+1)+col,a=points[at],b=points[at+1],c=points[at+cols+1],d=points[at+cols+2];triangle(a,b,c);triangle(b,d,c);}
 context.restore();return triangles;
}
