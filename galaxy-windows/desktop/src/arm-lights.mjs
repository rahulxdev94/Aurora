import {ARM_TRACKS} from './arm-light-art.mjs';

/** Sample the authored paths in UV coordinates on the same projected plane as the galaxy. */
export function armLights(seconds, pointerStrength=0) {
  return ARM_TRACKS.map((points,index)=>{
    const phase=(seconds/(index?15:12)+(index?.58:.15))%1;
    const time=phase*(points.length-1),i=Math.min(points.length-2,Math.floor(time));
    const [x,y]=points[i],[nextX,nextY]=points[i+1],fraction=time-i;
    const fade=Math.min(1,phase/.09,(1-phase)/.09);
    return {u:x+(nextX-x)*fraction-.5,v:y+(nextY-y)*fraction-.5,angle:Math.atan2(nextY-y,nextX-x),
      width:index?.15:.19,height:index?.0625:.0792,alpha:fade*(index?.67:.91)*(1+.12*Math.min(1,pointerStrength))};
  });
}
