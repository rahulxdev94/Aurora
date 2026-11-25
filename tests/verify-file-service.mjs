import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createFileServer} from '../scripts/file-service.mjs';
import {createFileService} from '../src/aurora-file-service.mjs';

const temporaryRoot=path.join(process.cwd(),'.build','file-service-tests');await fs.mkdir(temporaryRoot,{recursive:true});
const workspace=await fs.mkdtemp(path.join(temporaryRoot,'aurora-files-test-'));
const writable=path.join(workspace,'user'),outside=path.join(workspace,'outside');
await fs.mkdir(writable);await fs.mkdir(outside);await fs.mkdir(path.join(writable,'empty'));
await fs.writeFile(path.join(writable,'notes.txt'),'A local preview.');await fs.writeFile(path.join(writable,'.env'),'private');
const svgFixture='<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20" fill="#d6b466"/></svg>';
await fs.writeFile(path.join(writable,'transparent-icon.svg'),svgFixture);
if(process.platform==='win32'){
  const nativeHidden=path.join(writable,'native-hidden.txt');await fs.writeFile(nativeHidden,'Hidden attribute fixture.');
  const result=spawnSync(path.join(process.env.SystemRoot||'C:/Windows','System32','attrib.exe'),['+H',nativeHidden],{windowsHide:true});assert.equal(result.status,0,'Hidden-attribute fixture setup must succeed');
}
await fs.writeFile(path.join(outside,'protected.txt'),'leave unchanged');
const token=randomBytes(32).toString('hex'),service=await createFileServer({token,port:0,roots:[{name:'User',path:writable}],writeRoots:[writable],trashRoot:path.join(workspace,'Trash')});
try{
  const address=await service.listen(),baseUrl='http://127.0.0.1:'+address.port,client=createFileService({baseUrl,token});
  assert.equal((await client.health()).capabilities.recycle,true);
  assert.equal((await client.health()).capabilities.gpuTemperature,false);
  assert.equal((await client.gpuTemperature()).gpu.status,'unavailable','GPU telemetry defaults to disabled');
  const listed=await client.list(writable);assert.ok(listed.entries.some(item=>item.name==='empty'&&item.kind==='folder'));assert.ok(!listed.entries.some(item=>item.name==='.env'));
  if(process.platform==='win32')assert.ok(!listed.entries.some(item=>item.name==='native-hidden.txt'),'Native hidden attributes must be excluded by default');
  assert.ok((await client.list(writable,{hidden:true})).entries.some(item=>item.name==='.env'));
  if(process.platform==='win32')assert.equal((await client.list(writable,{hidden:true})).entries.find(item=>item.name==='native-hidden.txt').hidden,true);
  assert.equal((await client.preview(path.join(writable,'notes.txt'))).text,'A local preview.');
  const boundedContent=path.join(writable,'bounded-content.txt');await fs.writeFile(boundedContent,'x'.repeat(600000));
  const prefix=await client.preview(boundedContent,{textLimit:16384});assert.equal(prefix.text.length,16384);assert.equal(prefix.truncated,true);
  assert.equal((await client.preview(boundedContent,{textLimit:999999999})).text.length,512*1024,'A caller cannot expand the server preview limit');
  assert.equal((await client.preview(boundedContent,{textLimit:-1})).text.length,1024,'Invalid small limits remain bounded');
  const svgPreview=await client.preview(path.join(writable,'transparent-icon.svg'));
  assert.equal(svgPreview.kind,'image');assert.equal(svgPreview.mime,'image/svg+xml');
  assert.equal(Buffer.from(svgPreview.dataUrl.split(',')[1],'base64').toString('utf8'),svgFixture);
  await assert.rejects(client.preview(path.join(writable,'.env')),error=>error.code==='PROTECTED');
  assert.ok((await client.search(writable,'notes')).entries.some(item=>item.name==='notes.txt'));
  assert.equal((await client.search(writable,'env')).entries.length,0);
  await client.operation({kind:'mkdir',path:writable,name:'New folder'});
  await client.operation({kind:'copy',path:path.join(writable,'notes.txt'),destination:path.join(writable,'copy.txt')});
  await assert.rejects(client.operation({kind:'copy',path:path.join(writable,'notes.txt'),destination:path.join(writable,'copy.txt')}),error=>error.code==='EEXIST');
  await client.operation({kind:'rename',path:path.join(writable,'copy.txt'),name:'renamed.txt'});
  assert.equal(await fs.readFile(path.join(writable,'renamed.txt'),'utf8'),'A local preview.');
  await client.operation({kind:'copy',path:path.join(writable,'empty'),destination:path.join(writable,'empty copy')});
  assert.equal((await fs.stat(path.join(writable,'empty copy'))).isDirectory(),true);
  await client.operation({kind:'move',path:path.join(writable,'renamed.txt'),destination:path.join(writable,'moved.txt')});
  await client.operation({kind:'rename',path:path.join(writable,'moved.txt'),name:'renamed.txt'});
  await assert.rejects(client.operation({kind:'rename',path:path.join(writable,'renamed.txt'),name:'notes.txt'}),error=>error.code==='EEXIST');
  await assert.rejects(client.operation({kind:'mkdir',path:outside,name:'Forbidden'}),error=>error.code==='READ_ONLY');
  await assert.rejects(client.operation({kind:'mkdir',path:writable,name:'../outside'}),error=>error.code==='NAME');
  const trashed=await client.operation({kind:'recycle',path:path.join(writable,'renamed.txt')});
  assert.ok((await client.trash()).entries.some(item=>item.id===trashed.id));
  await fs.writeFile(path.join(writable,'renamed.txt'),'new original');
  await assert.rejects(client.operation({kind:'restore',id:trashed.id}),error=>error.code==='EEXIST');
  assert.equal(await fs.readFile(path.join(writable,'renamed.txt'),'utf8'),'new original');
  await fs.unlink(path.join(writable,'renamed.txt'));await client.operation({kind:'restore',id:trashed.id});
  assert.equal(await fs.readFile(path.join(writable,'renamed.txt'),'utf8'),'A local preview.');
  assert.equal((await client.trash()).entries.length,0);
  await client.reportGraphics({renderer:'Test adapter',vendor:'Test',api:'WebGL2',webgpuStatus:'available',webgpuVendor:'Test GPU',webgpuAdapter:'Selected adapter',webgpuError:'\u0000'+ 'x'.repeat(300),resolution:{width:1536,height:864,dpr:1.25}});
  const graphics=(await client.health()).graphics;
  assert.equal(graphics.renderer,'Test adapter');assert.equal(graphics.webgpuStatus,'available');
  assert.equal(graphics.webgpuVendor,'Test GPU');assert.equal(graphics.webgpuAdapter,'Selected adapter');
  assert.equal(graphics.webgpuError.length,200);assert.ok(!graphics.webgpuError.includes('\u0000'),'Diagnostic fields must be bounded and free of control characters');
  assert.equal((await fetch(baseUrl+'/health')).status,401);
  assert.equal((await fetch(baseUrl+'/gpu-temperature',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(baseUrl+'/gpu-temperature',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://untrusted.example'},body:'{}'})).status,403);
  assert.equal((await fetch(baseUrl+'/gpu-temperature',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({query:'other'})})).status,400);
  assert.equal((await fetch(baseUrl+'/health',{headers:{Authorization:'Bearer '+token,Origin:'https://untrusted.example'}})).status,403);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(client.search(writable,'note',{signal:cancelled.signal}));
  try{
    await fs.symlink(outside,path.join(writable,'breakout'),'junction');
    await assert.rejects(client.operation({kind:'mkdir',path:path.join(writable,'breakout'),name:'Forbidden'}),error=>error.code==='READ_ONLY');
  }catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error;}
  assert.equal(await fs.readFile(path.join(outside,'protected.txt'),'utf8'),'leave unchanged');
  console.log('File service: authenticated localhost access, genuine empty-folder browsing, preview/search bounds, private-file exclusions, no-clobber operations, junction boundaries and cancellation passed in temporary folders.');
}finally{
  await service.close();
  const verified=await fs.realpath(workspace);if(!path.basename(verified).startsWith('aurora-files-test-')||path.dirname(verified)!==await fs.realpath(temporaryRoot))throw new Error('Temporary cleanup boundary mismatch');
  await fs.rm(verified,{recursive:true,force:true});
}
