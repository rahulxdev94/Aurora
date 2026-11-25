import assert from 'node:assert/strict';
import {notificationStarFrame,notificationPointerInside} from '../src/aurora-notification-stars.mjs';
import {notificationOverlayFrame} from '../src/notification-overlay-layout.mjs';
let cases=0;
for(const scale of [1,1.25,1.5,2])for(const origin of [{x:0,y:0},{x:-3840,y:-1080}]){
 const monitor={position:origin,size:{width:3840,height:2160},workArea:{position:origin,size:{width:3840,height:2080}},scaleFactor:scale};
 const dock=notificationOverlayFrame(monitor,{width:480,contentHeight:350});
 const next=notificationStarFrame(monitor,dock);
 assert.equal(next.x,dock.x);assert.equal(next.width,dock.width);assert.equal(next.y+next.height,dock.y+dock.height);
 assert.ok(next.y>=origin.y+18*scale-1);assert.ok(next.height<=dock.height+158*scale+1);assert.ok(next.width<monitor.size.width&&next.height<monitor.size.height);
 const rect={left:12,right:468,top:170,bottom:320};
 assert.equal(notificationPointerInside([next.x+240*scale,next.y+220*scale],next,[rect]),true);
 assert.equal(notificationPointerInside([next.x+240*scale,next.y+50*scale],next,[rect]),false,'Decorative headroom must pass through');
 assert.equal(notificationPointerInside([next.x+5*scale,next.y+220*scale],next,[rect]),false,'Transparent side gutter must pass through');
 assert.equal(notificationPointerInside(null,next,[rect]),false);assert.equal(notificationPointerInside([NaN,0],next,[rect]),false);cases++;
}
const monitor={position:{x:0,y:0},size:{width:640,height:240},workArea:{position:{x:0,y:0},size:{width:640,height:240}},scaleFactor:1};
const dock=notificationOverlayFrame(monitor,{width:480,contentHeight:400}),next=notificationStarFrame(monitor,dock);
assert.equal(next.y+next.height,dock.y+dock.height);assert.ok(next.y>=18);assert.equal(next.width,dock.width);cases++;
console.log(`Notification stars geometry: ${cases} DPI, negative-origin and tiny-screen cases passed; transparent headroom and margins remain noninteractive.`);
