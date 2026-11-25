import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {build} from 'esbuild';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildSearch({output,homeWidgetId='@aurora/home',searchWidgetId='@aurora/search',knownRoots={},categories=[],chatgptUrl='https://chatgpt.com/',verificationApps=[],productName='Aurora',windowTitle='Aurora Search',statusFile='search-startup.json',shortcutId='aurora-search',eventNamespace='aurora'}={}){
  if(![homeWidgetId,searchWidgetId].every(value=>typeof value==='string'&&/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(value)))throw new Error('Invalid search profile IDs');
  if(![productName,windowTitle].every(value=>typeof value==='string'&&value.trim()&&value.length<=80&&!/[\u0000-\u001f]/.test(value)))throw new Error('Invalid search branding');
  if(!/^[-a-z0-9]{1,80}\.json$/i.test(statusFile)||!/^[-a-z0-9]{1,80}$/.test(shortcutId)||!/^[-a-z0-9]{1,40}$/.test(eventNamespace))throw new Error('Invalid search profile metadata');
  output??=path.join(project,'dist','aurora-search');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'index.html'),`<main id="aurora-home-preview" data-spotlight-host="popup" data-motion="reduced" aria-label="${windowTitle.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}"></main>\n`);
  const base='html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#F4F3ED;font-family:Segoe UI,system-ui,sans-serif}#aurora-home-preview{height:100vh;overflow:hidden;--ah-accent:#D6B466;--ah-text:#F4F3ED;--ah-muted:#A8ADB6;color-scheme:dark}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:disabled{cursor:default}svg{width:20px;height:20px}';
  await fs.writeFile(path.join(output,'index.css'),base+'\n'+await fs.readFile(path.join(project,'src','aurora-spotlight.css'),'utf8'));
  await build({entryPoints:[path.join(project,'src','aurora-search-popup.mjs')],outfile:path.join(output,'index.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120',sourcemap:false,legalComments:'eof',define:{__AURORA_SEARCH_CONFIG__:JSON.stringify({homeWidgetId,searchWidgetId,knownRoots,categories,chatgptUrl,verificationApps,productName,windowTitle,statusFile})},plugins:[{name:'profile-events',setup(build){build.onLoad({filter:/\.mjs$/},async args=>{if(!path.resolve(args.path).startsWith(path.join(project,'src')+path.sep))return;return{contents:(await fs.readFile(args.path,'utf8')).replaceAll('aurora:',eventNamespace+':'),loader:'js'};});}}]});
  const metadata=`id: "${searchWidgetId}"
metadata:
  displayName: ${JSON.stringify(windowTitle)}
  description: Search apps, indexed files, folders and desktop commands.
  appTargetVersion: [2, 8, 10]
  tags: [search, launcher, productivity]
icon: PiMagnifyingGlassDuotone
preset: Overlay
instances: Single
lazy: true
forceHardwareAcceleration: true
html: !include index.html
css: !include index.css
js: !include index.js
settings: []
shortcuts:
  - id: ${shortcutId}
    label: ${JSON.stringify('Open '+windowTitle)}
    description: Search apps, indexed files and commands from any application.
    command: [widget, trigger, "${searchWidgetId}"]
    defaultKeys: [Ctrl, Alt, Space]
    readonly: false
`;
  await fs.writeFile(path.join(output,'metadata.yml'),metadata);
  const manifest={widget_id:searchWidgetId,files:{}};
  for(const name of ['metadata.yml','index.html','index.css','index.js']){const data=await fs.readFile(path.join(output,name));manifest.files[name]={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};}
  await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2));
  return manifest;
}
