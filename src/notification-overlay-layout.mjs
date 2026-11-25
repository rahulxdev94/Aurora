// Tauri monitor coordinates and sizes are physical pixels.
export function notificationOverlayFrame(monitor,{contentHeight=1,width=560,margin=18}={}){
  const area=monitor?.workArea||monitor,position=area?.position||monitor?.position,size=area?.size||monitor?.size;
  if(!position||!size||!['x','y'].every(key=>Number.isFinite(position[key]))||!['width','height'].every(key=>Number.isFinite(size[key])&&size[key]>0))throw new Error('Notification display area is unavailable');
  const scale=Number.isFinite(monitor.scaleFactor)&&monitor.scaleFactor>0?monitor.scaleFactor:1;
  const inset=Math.max(0,Math.min(Math.round(margin*scale),Math.floor((Math.min(size.width,size.height)-1)/2)));
  const pixelWidth=Math.max(1,Math.min(Math.round(width*scale),size.width-inset*2));
  const pixelHeight=Math.max(1,Math.min(Math.ceil(Math.max(1,contentHeight)*scale),size.height-inset*2));
  return{x:Math.round(position.x+size.width-pixelWidth-inset),y:Math.round(position.y+size.height-pixelHeight-inset),width:pixelWidth,height:pixelHeight,scale};
}
function notificationMonitorFrame(monitor){
  const area=monitor?.workArea||monitor,position=area?.position||monitor?.position,size=area?.size||monitor?.size;
  // Reuse validation and scale handling without applying the dock's insets.
  const checked=notificationOverlayFrame(monitor,{contentHeight:1,margin:0});
  return{x:Math.round(position.x),y:Math.round(position.y),width:Math.round(size.width),height:Math.round(size.height),scale:checked.scale};
}
export function notificationFlightFrame(monitor,options={}){return notificationFlightGeometry({monitor,...options}).flight;}
export function notificationFlightGeometry({monitor,source,dock,atomSize=96,inset=12,glowPadding=24}={}){
  const area=notificationMonitorFrame(monitor),bounds=monitor.position&&monitor.size?monitor:{position:{x:area.x,y:area.y},size:{width:area.width,height:area.height}};
  if(area.width<3||area.height<3)throw new Error('Notification flight display area is too small');
  dock??=notificationOverlayFrame(monitor,{contentHeight:120});
  const finite=value=>Number.isFinite(value),valid=source&&['x','y','width','height'].every(key=>finite(source[key]))&&source.width>0&&source.height>0;
  const rectangle=valid?source:{x:.37,y:.22,width:.26,height:.38};
  const centreX=bounds.position.x+(rectangle.x+rectangle.width/2)*bounds.size.width;
  const centreY=bounds.position.y+(rectangle.y+rectangle.height/2)*bounds.size.height;
  const size=Math.max(atomSize,Math.min(Math.max(rectangle.width*bounds.size.width,rectangle.height*bounds.size.height)/area.scale,Math.max(area.width,area.height)/area.scale));
  const targetX=dock.x+dock.width-(inset+atomSize/2)*area.scale,targetY=dock.y+dock.height-(inset+atomSize/2)*area.scale;
  const sourceRadius=size*area.scale/2,targetRadius=atomSize*area.scale/2,padding=Math.max(0,Number.isFinite(glowPadding)?glowPadding:24)*area.scale;
  // Keep the native surface around the actual flight, rather than covering the
  // monitor and triggering Windows' automatic fullscreen quiet rule. A small
  // safety gutter also prevents extreme source bounds becoming fullscreen.
  const gutter=Math.max(1,Math.min(Math.ceil(8*area.scale),Math.floor((Math.min(area.width,area.height)-1)/2)));
  const safe={left:area.x+gutter,top:area.y+gutter,right:area.x+area.width-gutter,bottom:area.y+area.height-gutter};
  const left=Math.max(safe.left,Math.min(Math.floor(Math.min(centreX-sourceRadius,targetX-targetRadius)-padding),safe.right-1));
  const top=Math.max(safe.top,Math.min(Math.floor(Math.min(centreY-sourceRadius,targetY-targetRadius)-padding),safe.bottom-1));
  const right=Math.max(left+1,Math.min(safe.right,Math.ceil(Math.max(centreX+sourceRadius,targetX+targetRadius)+padding)));
  const bottom=Math.max(top+1,Math.min(safe.bottom,Math.ceil(Math.max(centreY+sourceRadius,targetY+targetRadius)+padding)));
  const flight={x:left,y:top,width:right-left,height:bottom-top,scale:area.scale};
  return{flight,from:{x:(centreX-flight.x)/flight.scale,y:(centreY-flight.y)/flight.scale,size},to:{x:(targetX-flight.x)/flight.scale,y:(targetY-flight.y)/flight.scale,size:atomSize}};
}
