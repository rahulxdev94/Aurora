import assert from 'node:assert/strict';
import {notificationSunlightSample,notificationAtomLight} from '../src/aurora-notification-presence.mjs';

const now=Date.now(),geometry={position:{x:-1920,y:100},nativeSize:{width:1920,height:1080},viewport:{width:1536,height:864},rootRect:{left:16,top:8,width:1504,height:840}};
// The carrier is halfway across the physical window. Convert through DPI and
// the desktop's actual inset, rather than treating screen pixels as CSS pixels.
const sample=notificationSunlightSample({x:-960,y:640,radius:50,intensity:.9,visible:true,at:now},geometry,now);
assert.equal(sample.x,.5);assert.ok(Math.abs(sample.y-(432-8)/840)<1e-12);assert.equal(sample.radius,40);assert.equal(sample.intensity,.9);assert.equal(sample.source,'notification');
assert.equal(notificationSunlightSample({x:0,y:0,radius:50,intensity:1,visible:true,at:now-2001},geometry,now),null);
assert.equal(notificationSunlightSample({x:0,y:0,radius:50,intensity:1,visible:true,at:now+1001},geometry,now),null);
assert.equal(notificationSunlightSample({x:NaN,y:640,radius:50,intensity:1,visible:true,at:now},geometry,now),null);
assert.equal(notificationSunlightSample({x:99999,y:640,radius:50,intensity:1,visible:true,at:now},geometry,now),null);
assert.equal(notificationSunlightSample({x:-960,y:640,radius:50,intensity:2,visible:true,at:now},geometry,now),null);
const hidden=notificationSunlightSample({x:-960,y:640,radius:50,intensity:.9,visible:false,at:now},geometry,now);assert.equal(hidden.visible,false);
assert.equal(notificationSunlightSample({x:-960,y:640,radius:50,intensity:1,visible:true,at:now},{...geometry,nativeSize:{width:0,height:1080}},now),null);

// PNG padding and a parallax offset must not shift the real light back to the
// image's geometric centre while the overlay carries it.
const atom=notificationAtomLight({x:.5,y:.5,radius:30,intensity:.8},{x:610,y:280,width:400,height:400},{left:20,top:30,width:1600,height:900});
assert.equal(atom.x,.525);assert.equal(atom.y,.5);assert.equal(atom.radiusRatio,.075);assert.equal(atom.intensity,.8);
assert.deepEqual(notificationAtomLight(null,null,null),{x:.5,y:.5,radiusRatio:.075,intensity:1});
console.log('Notification sunlight: negative monitor origins, DPI and root insets, actual PNG nucleus offsets, radius scaling, freshness, malformed geometry and hidden-source transfer passed.');
