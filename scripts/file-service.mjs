// Local file access for Aurora. No remote binding, shell interpolation or AI upload.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createGpuTelemetry} from './gpu-telemetry.mjs';

export const LIMITS=Object.freeze({body:16384,list:5000,search:20000,searchResults:500,depth:12,text:512*1024,image:8*1024*1024,copyEntries:10000,copyBytes:2*1024*1024*1024});
const ORIGINS=new Set(['tauri://localhost','http://tauri.localhost','https://tauri.localhost','http://127.0.0.1:8769']);
const textExtensions=new Set('txt md json csv tsv yml yaml log ini xml html css js mjs cjs ts tsx jsx py ps1 sh sql rs c cpp h java toml gitignore'.split(' '));
const privateParts=new Set(['appdata','.ssh','.aws','.azure','.gnupg','.kube','.codex','.config','credentials','microsoftcredentials']);
const privateNames=/^(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?|cookies|login data|.*\.(?:pem|pfx|p12|key|kdbx))$/i;
const folded=value=>process.platform==='win32'?value.toLowerCase():value;
const within=(value,root,self=true)=>{const relative=path.relative(folded(root),folded(value));return (!relative&&self)||Boolean(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const sensitive=value=>value.split(/[\\/]+/).some(part=>privateParts.has(part.toLowerCase()))||privateNames.test(path.basename(value));
const hiddenName=name=>name.startsWith('.')||name.startsWith('$')||/^(desktop\.ini|thumbs\.db)$/i.test(name);
const extension=name=>path.extname(name).slice(1).toLowerCase();
const validName=value=>typeof value==='string'&&value.length>0&&value.length<=240&&value===value.trim()&&!/[\x00-\x1f<>:"/\\|?*]/.test(value)&&!/[. ]$/.test(value)&&value!=='.'&&value!=='..'&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
function absolute(value){
  if(typeof value!=='string'||value.length>32760||!path.isAbsolute(value)||/[\x00-\x1f]/.test(value)||/^\\\\|^\/\//.test(value))throw fail('INVALID_PATH','Choose an absolute local folder path.');
  return path.resolve(value);
}
async function exists(value){try{await fs.lstat(value);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function canonical(value){
  const resolved=absolute(value),tail=[];let current=resolved;
  for(;;){try{return path.join(await fs.realpath(current),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;tail.push(path.basename(current));current=parent;}}
}
async function metadata(parent,entry){
  const full=path.join(parent,entry.name),stat=await fs.lstat(full);
  return{name:entry.name,path:full,kind:stat.isSymbolicLink()?'link':stat.isDirectory()?'folder':'file',size:stat.isFile()?stat.size:null,modifiedAt:stat.mtime.toISOString(),extension:extension(entry.name),hidden:hiddenName(entry.name)};
}
function mappedError(error){
  if(error.code&&error.status)return error;
  const messages={ENOENT:'This item no longer exists.',EACCES:'Windows denied access to this item.',EPERM:'Windows denied this file operation.',EEXIST:'An item already exists at the destination. Nothing was replaced.',ENOTEMPTY:'The destination is not empty. Nothing was replaced.',EXDEV:'Move across drives is unavailable. Copy the item instead.',ABORT_ERR:'The request was cancelled.'};
  return fail(error.code||'FILE_ERROR',messages[error.code]||'The file operation could not be completed.',error.code==='ENOENT'?404:409);
}
// These are fixed .NET calls. Paths are JSON on stdin, never part of command text.
const MOVE_SCRIPT="$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$i=[Console]::In.ReadToEnd()|ConvertFrom-Json;if($i.kind -eq 'folder'){[IO.Directory]::Move([string]$i.source,[string]$i.destination)}else{[IO.File]::Move([string]$i.source,[string]$i.destination)}";
const HIDDEN_SCRIPT="$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$i=[Console]::In.ReadToEnd()|ConvertFrom-Json;$hidden=@(foreach($n in $i.names){try{$a=[IO.File]::GetAttributes([IO.Path]::Combine([string]$i.path,[string]$n));if(($a -band [IO.FileAttributes]::Hidden)-ne 0){[string]$n}}catch{}});ConvertTo-Json -InputObject $hidden -Compress";
async function windowsHiddenNames(directory,names){
  if(process.platform!=='win32'||!names.length)return new Set();
  return new Promise(resolve=>{
    const executable=path.join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoProfile','-NonInteractive','-Command',HIDDEN_SCRIPT],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Set());},6000);
    child.stdout.on('data',chunk=>{if(output.length<2*1024*1024)output+=chunk.toString('utf8');else{child.kill();finish(new Set());}});
    child.once('error',()=>finish(new Set()));
    child.once('exit',code=>{try{const parsed=JSON.parse(output.replace(/^\uFEFF/,''));finish(new Set(code===0&&Array.isArray(parsed)?parsed:[]));}catch{finish(new Set());}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({path:directory,names}));
  });
}
async function moveExclusive(source,destination,kind){
  if(folded(path.parse(source).root)!==folded(path.parse(destination).root))throw fail('EXDEV','Move across drives is unavailable. Copy the item instead.',409);
  if(process.platform!=='win32'){
    if(kind==='folder')throw fail('UNSUPPORTED','Atomic folder moves require Windows.',409);
    await fs.link(source,destination);try{await fs.unlink(source);}catch(error){await fs.unlink(destination);throw error;}return;
  }
  await new Promise((resolve,reject)=>{
    const executable=path.join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(executable,['-NoProfile','-NonInteractive','-Command',MOVE_SCRIPT],{windowsHide:true,stdio:['pipe','ignore','pipe']});
    let stderr='';const timer=setTimeout(()=>{child.kill();reject(fail('TIMEOUT','The move did not finish in time. Refresh before trying again.',504));},20000);
    child.stderr.on('data',data=>{if(stderr.length<8192)stderr+=data.toString();});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(fail(/exist|already/i.test(stderr)?'EEXIST':'MOVE_FAILED',/exist|already/i.test(stderr)?'An item already exists at the destination. Nothing was replaced.':'Windows could not move this item. Refresh before trying again.',409));});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({source,destination,kind}));
  });
}

export async function createFileServer(config={}){
  if(typeof config.token!=='string'||config.token.length<32)throw new Error('A private token of at least 32 characters is required');
  const roots=Array.isArray(config.roots)?config.roots:Object.entries(config.roots||{}).map(([name,value])=>({name,path:value}));
  const writeRoots=await Promise.all((config.writeRoots||[]).map(async value=>fs.realpath(absolute(value))));
  let trashRoot=null;
  if(config.trashRoot){await fs.mkdir(absolute(config.trashRoot),{recursive:true});trashRoot=await fs.realpath(absolute(config.trashRoot));}
  const tokenBytes=Buffer.from(config.token),port=config.port??18765;
  const gpuTelemetry=createGpuTelemetry(config.gpuTelemetry);
  let queue=Promise.resolve(),graphics=null;
  const capabilities={list:true,search:true,preview:true,mkdir:true,rename:true,copy:true,move:true,recycle:Boolean(trashRoot),trashLabel:'Aurora Trash',gpuTemperature:gpuTelemetry.enabled};
  const rootRows=await Promise.all(roots.map(async root=>{const value=absolute(root.path);return{name:String(root.name||path.basename(value)||value),path:value,writable:writeRoots.some(boundary=>within(value,boundary))};}));
  async function writable(value,{self=false}={}){
    const real=await canonical(value);
    if(trashRoot&&within(real,trashRoot))throw fail('PROTECTED','Use Aurora Trash to restore items from this location.',403);
    if(!writeRoots.some(root=>within(real,root,self)))throw fail('READ_ONLY','This location is outside Aurora’s writable folders.',403);
    if(sensitive(real))throw fail('PROTECTED','This private application location is protected.',403);
    return real;
  }
  async function readable(value,{content=false}={}){
    const real=await fs.realpath(absolute(value));
    if(trashRoot&&within(real,trashRoot))throw fail('PROTECTED','Use Aurora Trash to restore items from this location.',403);
    if(content&&sensitive(real))throw fail('PROTECTED','Preview and bulk search exclude private application and credential locations.',403);
    return real;
  }
  async function list(input){
    const current=await readable(input.path),stat=await fs.stat(current);if(!stat.isDirectory())throw fail('NOT_DIRECTORY','Choose a folder.');
    const items=await fs.readdir(current,{withFileTypes:true}),sample=items.slice(0,LIMITS.list),nativeHidden=await windowsHiddenNames(current,sample.map(item=>item.name));
    const filtered=sample.filter(item=>input.hidden===true||!hiddenName(item.name)&&!nativeHidden.has(item.name)),entries=[];
    for(const item of filtered){try{const entry=await metadata(current,item);entry.hidden=entry.hidden||nativeHidden.has(item.name);entries.push(entry);}catch{}}
    entries.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
    let canWrite=false;try{await writable(current,{self:true});canWrite=true;}catch{}
    return{path:current,parent:path.dirname(current)===current?null:path.dirname(current),entries,truncated:items.length>LIMITS.list,roots:rootRows,writable:canWrite,capabilities};
  }
  async function search(input,signal){
    const root=await readable(input.root,{content:true}),query=typeof input.query==='string'?input.query.trim().slice(0,256).toLocaleLowerCase():'';
    if(query.length<2)throw fail('QUERY','Enter at least two characters to search.');
    const limit=Math.min(LIMITS.searchResults,Math.max(1,Number(input.limit)||300)),entries=[],todo=[{folder:root,depth:0}];let scanned=0,truncated=false;
    while(todo.length&&scanned<LIMITS.search&&entries.length<limit){
      if(signal?.aborted)throw fail('ABORT_ERR','Search cancelled.');
      const {folder,depth}=todo.pop();let children;try{const real=await fs.realpath(folder),stat=await fs.lstat(folder);if(stat.isSymbolicLink()||!within(real,root)||sensitive(real))continue;children=await fs.readdir(real,{withFileTypes:true});}catch{continue;}
      for(const item of children){
        if(++scanned>LIMITS.search||entries.length>=limit){truncated=true;break;}
        const full=path.join(folder,item.name);if(sensitive(full)||hiddenName(item.name)||['node_modules','.git'].includes(item.name)||item.isSymbolicLink())continue;
        if(item.name.toLocaleLowerCase().includes(query)){try{entries.push(await metadata(folder,item));}catch{}}
        if(item.isDirectory()&&depth<LIMITS.depth)todo.push({folder:full,depth:depth+1});
      }
    }
    return{root,query,entries,scanned,truncated:truncated||todo.length>0};
  }
  async function preview(input){
    const file=await readable(input.path,{content:true}),stat=await fs.stat(file);if(!stat.isFile())return{kind:'unsupported',size:null};
    const ext=extension(file),imageTypes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml',avif:'image/avif'};
    if(imageTypes[ext]){
      if(stat.size>LIMITS.image)return{kind:'unsupported',size:stat.size,reason:'Image exceeds the 8 MB preview limit.'};
      const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(Math.min(stat.size+1,LIMITS.image+1));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>LIMITS.image)return{kind:'unsupported',size:bytesRead,reason:'Image exceeds the 8 MB preview limit.'};return{kind:'image',dataUrl:'data:'+imageTypes[ext]+';base64,'+buffer.subarray(0,bytesRead).toString('base64'),mime:imageTypes[ext],size:bytesRead};}finally{await handle.close();}
    }
    if(!textExtensions.has(ext))return{kind:'unsupported',size:stat.size,reason:'Use Open for this file format.'};
    const textLimit=Number.isInteger(input.textLimit)?Math.min(LIMITS.text,Math.max(1024,input.textLimit)):LIMITS.text;
    const handle=await fs.open(file,'r');try{const buffer=Buffer.alloc(Math.min(stat.size,textLimit));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(buffer.subarray(0,Math.min(4096,bytesRead)).includes(0))return{kind:'unsupported',size:stat.size,reason:'This file contains binary data.'};return{kind:'text',text:buffer.subarray(0,bytesRead).toString('utf8'),size:stat.size,truncated:stat.size>textLimit};}finally{await handle.close();}
  }
  async function copyTree(source,destination,counter){
    const stat=await fs.lstat(source);if(stat.isSymbolicLink())throw fail('LINK','Copying links or junctions is not supported.');
    if(counter.signal?.aborted)throw fail('ABORT_ERR','Copy cancelled before committing the destination.');
    if(++counter.entries>LIMITS.copyEntries)throw fail('LIMIT','This copy exceeds Aurora’s 10,000-item limit.');
    if(sensitive(source))throw fail('PROTECTED','Bulk copies exclude private application and credential locations.',403);
    if(stat.isDirectory()){
      await fs.mkdir(destination);for(const name of await fs.readdir(source))await copyTree(path.join(source,name),path.join(destination,name),counter);
    }else if(stat.isFile()){
      counter.bytes+=stat.size;if(counter.bytes>LIMITS.copyBytes)throw fail('LIMIT','This copy exceeds Aurora’s 2 GB limit.');
      await fs.copyFile(source,destination,constants.COPYFILE_EXCL);
    }else throw fail('UNSUPPORTED','This filesystem item cannot be copied.');
  }
  const validTrashId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  async function trashRecord(id){
    if(!trashRoot||!validTrashId(id))throw fail('TRASH_ITEM','Choose a valid Aurora Trash item.');
    const directory=path.join(trashRoot,id),stat=await fs.lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!within(await fs.realpath(directory),trashRoot,false))throw fail('PROTECTED','This trash record is not valid.',403);
    const metadataPath=path.join(directory,'record.json'),recordStat=await fs.lstat(metadataPath);
    if(recordStat.isSymbolicLink()||!recordStat.isFile()||recordStat.size>8192)throw fail('TRASH_ITEM','This trash record cannot be read.');
    const record=JSON.parse(await fs.readFile(metadataPath,'utf8'));
    if(record.schemaVersion!==1||record.id!==id||!['file','folder'].includes(record.kind)||typeof record.name!=='string'||!Number.isFinite(Date.parse(record.trashedAt)))throw fail('TRASH_ITEM','This trash record cannot be read.');
    await writable(record.originalPath);
    const itemPath=path.join(directory,'item'),itemStat=await fs.lstat(itemPath);
    if(itemStat.isSymbolicLink())throw fail('PROTECTED','Restoring links is unavailable.',403);
    return{record,directory,itemPath,itemStat};
  }
  async function trash(){
    if(!trashRoot)return{entries:[],capabilities};
    const entries=[];
    for(const id of (await fs.readdir(trashRoot)).filter(validTrashId).slice(0,1000)){
      try{const {record,itemStat}=await trashRecord(id);entries.push({...record,size:itemStat.isFile()?itemStat.size:null});}catch{}
    }
    entries.sort((a,b)=>b.trashedAt.localeCompare(a.trashedAt));return{entries,capabilities};
  }
  async function operation(input,signal){
    if(input.kind==='restore'){
      const {record,directory,itemPath}=await trashRecord(input.id),destination=await writable(record.originalPath);
      await writable(path.dirname(destination),{self:true});
      if(await exists(destination))throw fail('EEXIST','An item already exists at the original location. The trash item was kept.',409);
      await moveExclusive(itemPath,destination,record.kind);
      await fs.unlink(path.join(directory,'record.json')).catch(()=>{});await fs.rmdir(directory).catch(()=>{});
      return{kind:'restore',path:destination,id:record.id};
    }
    if(input.kind==='recycle'){
      if(!trashRoot)throw fail('UNSUPPORTED','Aurora Trash is not connected. No item was deleted.',409);
      const source=await writable(input.path),sourceStat=await fs.lstat(absolute(input.path));
      if(sourceStat.isSymbolicLink())throw fail('LINK','Moving links or junctions to trash is unavailable.');
      const id=randomUUID(),directory=path.join(trashRoot,id),kind=sourceStat.isDirectory()?'folder':'file';
      if(folded(path.parse(source).root)!==folded(path.parse(trashRoot).root))throw fail('EXDEV','Aurora Trash is on another drive. The item was kept.',409);
      await fs.mkdir(directory);
      const record={schemaVersion:1,id,name:path.basename(source),originalPath:source,trashedAt:new Date().toISOString(),kind};
      await fs.writeFile(path.join(directory,'record.json'),JSON.stringify(record),{flag:'wx'});
      try{await moveExclusive(source,path.join(directory,'item'),kind);}catch(error){await fs.unlink(path.join(directory,'record.json')).catch(()=>{});await fs.rmdir(directory).catch(()=>{});throw error;}
      return{kind:'recycle',id,name:record.name,originalPath:source,trashedAt:record.trashedAt};
    }
    if(!['mkdir','rename','copy','move'].includes(input.kind))throw fail('OPERATION','Choose a supported file operation.');
    if(input.kind==='mkdir'){
      if(!validName(input.name))throw fail('NAME','Choose a valid new folder name.');
      const parent=await writable(input.path,{self:true}),target=await writable(path.join(parent,input.name));await fs.mkdir(target);return{kind:'mkdir',path:target};
    }
    const lexical=absolute(input.path),source=await readable(lexical);if((await fs.lstat(lexical)).isSymbolicLink())throw fail('LINK','Moving or copying links and junctions is not supported.');
    if(input.kind!=='copy')await writable(source);
    let destination;
    if(input.kind==='rename'){
      if(!validName(input.name))throw fail('NAME','Choose a valid new item name.');destination=path.join(path.dirname(source),input.name);
    }else destination=absolute(input.destination);
    destination=await writable(destination);
    await writable(path.dirname(destination),{self:true});
    if(await exists(destination))throw fail('EEXIST','An item already exists at the destination. Nothing was replaced.',409);
    const stat=await fs.lstat(source),kind=stat.isDirectory()?'folder':'file';
    if(within(destination,source))throw fail('NESTED','An item cannot be placed inside itself.');
    if(input.kind==='rename'||input.kind==='move'){
      await moveExclusive(source,destination,kind);return{kind:input.kind,path:destination,previousPath:source};
    }
    const staging=path.join(path.dirname(destination),'.aurora-copy-'+randomUUID());
    try{
      await copyTree(source,staging,{entries:0,bytes:0,signal});
      if(signal?.aborted)throw fail('ABORT_ERR','Copy cancelled before committing the destination.');
      await writable(destination);await moveExclusive(staging,destination,kind);
      return{kind:'copy',path:destination};
    }finally{
      // Only remove the exact new staging path created in the checked destination.
      if(path.basename(staging).startsWith('.aurora-copy-')&&within(await canonical(staging),await writable(path.dirname(staging),{self:true}),false))await fs.rm(staging,{recursive:true,force:true}).catch(()=>{});
    }
  }
  async function dispatch(route,input={},signal){
    if(route==='/health')return{version:1,capabilities,roots:rootRows,limits:LIMITS,graphics};
    if(route==='/gpu-temperature'){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw fail('GPU_QUERY','GPU temperature accepts no query parameters.');
      return gpuTelemetry.read();
    }
    if(route==='/graphics'){
      const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,200):'';
      graphics={source:'Native Aurora',renderer:clean(input.renderer),vendor:clean(input.vendor),api:clean(input.api),webgpuStatus:clean(input.webgpuStatus),webgpuVendor:clean(input.webgpuVendor),webgpuAdapter:clean(input.webgpuAdapter),webgpuError:clean(input.webgpuError),resolution:typeof input.resolution==='string'?clean(input.resolution):input.resolution&&typeof input.resolution==='object'?{width:Math.min(32768,Math.max(0,Number(input.resolution.width)||0)),height:Math.min(32768,Math.max(0,Number(input.resolution.height)||0)),dpr:Math.min(8,Math.max(0,Number(input.resolution.dpr)||0))}:null,updatedAt:new Date().toISOString()};
      return{accepted:true};
    }
    if(route==='/list')return list(input);
    if(route==='/search')return search(input,signal);
    if(route==='/preview')return preview(input);
    if(route==='/trash')return trash();
    if(route==='/operation'){
      const result=queue.then(()=>{if(signal?.aborted)throw fail('ABORT_ERR','The request was cancelled before the operation started.');return operation(input,signal);});queue=result.catch(()=>{});return result;
    }
    throw fail('NOT_FOUND','Unknown file-service route.',404);
  }
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin,allowed=typeof origin!=='string'||ORIGINS.has(origin);
    const cors=origin&&allowed?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
    const reply=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...cors});res.end(JSON.stringify(value));}};
    if(!allowed){reply(403,{ok:false,error:{code:'ORIGIN',message:'This origin cannot access Aurora files.'}});return;}
    if(req.method==='OPTIONS'){res.writeHead(204,{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});res.end();return;}
    const expectedPort=server.address()?.port||port;
    if(![`127.0.0.1:${expectedPort}`,`localhost:${expectedPort}`].includes(req.headers.host)){reply(403,{ok:false,error:{code:'HOST',message:'Localhost access only.'}});return;}
    const authorization=String(req.headers.authorization||''),supplied=Buffer.from(authorization.replace(/^Bearer /,''));
    if(!authorization.startsWith('Bearer ')||supplied.length!==tokenBytes.length||!timingSafeEqual(supplied,tokenBytes)){reply(401,{ok:false,error:{code:'AUTH',message:'Aurora file access is not connected.'}});return;}
    if(!(req.method==='POST'||req.method==='GET'&&req.url==='/health')){reply(405,{ok:false,error:{code:'METHOD',message:'Use the file-service API.'}});return;}
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),req.url==='/operation'?120000:25000);req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      let body='',bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>LIMITS.body)throw fail('BODY','Request is too large.',413);body+=chunk.toString('utf8');}
      let input={};if(body){try{input=JSON.parse(body);}catch{throw fail('JSON','Request must be valid JSON.');}}
      const data=await dispatch(req.url,input,controller.signal);reply(200,{ok:true,data});
    }catch(error){const mapped=mappedError(error);reply(mapped.status||400,{ok:false,error:{code:mapped.code,message:mapped.message}});}
    finally{clearTimeout(deadline);}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  return{server,dispatch,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address()));}),close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--config');if(at<0||!process.argv[at+1])throw new Error('Use --config with a private local JSON configuration.');
  const config=JSON.parse(await fs.readFile(process.argv[at+1],'utf8'));const service=await createFileServer(config);const address=await service.listen();
  console.log('Aurora file service is listening on 127.0.0.1:'+address.port);
  const shutdown=()=>{void service.close().then(()=>process.exit(0));};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
