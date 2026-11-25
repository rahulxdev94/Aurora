import assert from 'node:assert/strict';
import {notificationOverlayFrame,notificationFlightFrame,notificationFlightGeometry} from '../src/notification-overlay-layout.mjs';
import {captureNotificationAtom,initNotificationPresence} from '../src/aurora-notification-presence.mjs';
const monitor={position:{x:0,y:0},size:{width:1920,height:1080},workArea:{position:{x:0,y:0},size:{width:1920,height:1020}},scaleFactor:1.25};
const frame=notificationOverlayFrame(monitor,{contentHeight:320});
assert.deepEqual(frame,{x:1197,y:597,width:700,height:400,scale:1.25});
assert.ok(frame.x+frame.width<monitor.workArea.size.width);assert.ok(frame.y+frame.height<monitor.workArea.size.height);
const huge=notificationOverlayFrame(monitor,{contentHeight:99999});assert.equal(huge.height,974);
const secondary=notificationOverlayFrame({position:{x:-1920,y:-200},size:{width:1920,height:1080},scaleFactor:1},{contentHeight:170});
assert.ok(secondary.x<0);assert.equal(secondary.x+secondary.width,-18);assert.equal(secondary.y,692);
const tiny=notificationOverlayFrame({position:{x:10,y:20},size:{width:200,height:100},scaleFactor:2},{contentHeight:999});assert.ok(tiny.width>0&&tiny.height>0);assert.ok(tiny.x+tiny.width<=210&&tiny.y+tiny.height<=120);
assert.throws(()=>notificationOverlayFrame({size:{width:100,height:100}}));
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} preserves ${expected} physical pixels`);
const screenPoint=(geometry,point)=>({x:geometry.flight.x+point.x*geometry.flight.scale,y:geometry.flight.y+point.y*geometry.flight.scale});
const defaultFlight=notificationFlightFrame(monitor);assert.ok(defaultFlight.width<1920&&defaultFlight.height<1020);
const geometry=notificationFlightGeometry({monitor,source:{x:.25,y:.2,width:.2,height:.3},dock:frame});
close(screenPoint(geometry,geometry.from).x,672);close(screenPoint(geometry,geometry.from).y,378);
close(screenPoint(geometry,geometry.to).x,frame.x+frame.width-60*1.25);close(screenPoint(geometry,geometry.to).y,frame.y+frame.height-60*1.25);assert.equal(geometry.to.size,96);
const origin=notificationFlightGeometry({monitor:{position:{x:-1920,y:-200},size:{width:1920,height:1080},scaleFactor:1},source:{x:.4,y:.3,width:.2,height:.4},dock:secondary});close(screenPoint(origin,origin.from).x,-960);close(screenPoint(origin,origin.from).y,340);
// Regression for the actual 1920x1080 native fullscreen quiet-mode trigger.
const fullMonitor={position:{x:0,y:0},size:{width:1920,height:1080},workArea:{position:{x:0,y:0},size:{width:1920,height:1080}},scaleFactor:1.25};
const fullDock=notificationOverlayFrame(fullMonitor,{contentHeight:240}),corridor=notificationFlightGeometry({monitor:fullMonitor,source:{x:.3,y:.15,width:.25,height:.4},dock:fullDock});
assert.ok(corridor.flight.width<1920&&corridor.flight.height<1080,'A genuine desktop-to-corner journey must never create a native fullscreen window');assert.ok(corridor.flight.x>0&&corridor.flight.y>0);assert.ok(corridor.flight.width<1920*.8&&corridor.flight.height<1080*.9,'The normal journey uses a tight corridor, rather than an almost-fullscreen surface');
close(screenPoint(corridor,corridor.from).x,816);close(screenPoint(corridor,corridor.from).y,378);close(screenPoint(corridor,corridor.to).x,fullDock.x+fullDock.width-75);close(screenPoint(corridor,corridor.to).y,fullDock.y+fullDock.height-75);
for(const configuration of [{width:1024,height:720,scale:1,x:0,y:0},{width:3840,height:2160,scale:2,x:0,y:0},{width:3440,height:1440,scale:1.25,x:-3440,y:-100}]){
  const display={position:{x:configuration.x,y:configuration.y},size:{width:configuration.width,height:configuration.height},scaleFactor:configuration.scale},dock=notificationOverlayFrame(display,{contentHeight:220}),source={x:.25,y:.2,width:.2,height:.3},journey=notificationFlightGeometry({monitor:display,source,dock});
  assert.ok(journey.flight.x>display.position.x&&journey.flight.y>display.position.y);assert.ok(journey.flight.x+journey.flight.width<display.position.x+display.size.width&&journey.flight.y+journey.flight.height<display.position.y+display.size.height);
  close(screenPoint(journey,journey.from).x,display.position.x+.35*display.size.width);close(screenPoint(journey,journey.from).y,display.position.y+.35*display.size.height);
  close(screenPoint(journey,journey.to).x,dock.x+dock.width-60*configuration.scale);close(screenPoint(journey,journey.to).y,dock.y+dock.height-60*configuration.scale);
}
const oversized=notificationFlightGeometry({monitor:fullMonitor,source:{x:-.5,y:-.5,width:2,height:2},dock:fullDock});assert.ok(oversized.flight.width<1920&&oversized.flight.height<1080,'Oversized source glow is clipped to the safety gutter instead of creating fullscreen bounds');
// A transparent copy uses the real scene geometry and retains nucleus centring.
let copied=null,created=null;
const canvas={width:1600,height:800,getBoundingClientRect:()=>({left:100,top:90,width:800,height:400})};
const hero={clientWidth:800,clientHeight:400};
const root={ownerDocument:{defaultView:{devicePixelRatio:2},createElement:()=>created={width:0,height:0,getContext:()=>({drawImage:(...args)=>{copied=args;}}),toDataURL:()=> 'data:image/png;base64,AAAA'}},querySelector:selector=>selector==='.ah-dyson-canvas'?canvas:selector==='.ah-core-stage'?hero:null};
const capture=captureNotificationAtom(root);assert.equal(capture.png,'data:image/png;base64,AAAA');assert.equal(capture.rect.x+capture.rect.width/2,500);assert.equal(capture.rect.y+capture.rect.height/2,268);assert.ok(created.width*created.height<=1048576);assert.equal(copied[0],canvas);
created=null;assert.equal(captureNotificationAtom({...root,querySelector:()=>null}),null);
let queried=false;const qa={ownerDocument:{},dataset:{browserQa:'true'},querySelector:()=>{queried=true;}};assert.equal(typeof initNotificationPresence({root:qa}),'function');assert.equal(queried,false);
console.log('Notification overlay: nonfullscreen native flight corridor, exact physical source/dock coordinates, DPI/4K/ultrawide/negative origins, oversized-glow safety, bounded capture and native-QA skip passed. Native appearance requires a Windows event.');
