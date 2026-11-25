import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {build} from 'esbuild';
import {normaliseNotificationPriorityIds} from '../src/aurora-notifications.mjs';
import {normaliseNotificationSiteRules} from '../src/aurora-notification-sites.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const validId=value=>typeof value==='string'&&/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(value);
export async function buildNotificationOverlay({output,widgetId='@aurora/notifications',homeWidgetId='@aurora/home',timezone='Australia/Sydney',clockLabel='Sydney',priorityAppIds=[],prioritySites=[],priorityDuringDnd=false,popupAppIds=null,windowTitle='Aurora Notifications',statusFile='notification-overlay-startup.json',eventNamespace='aurora'}={}){
  if(!validId(widgetId)||!validId(homeWidgetId))throw new Error('Invalid notification overlay widget identity');
  if(typeof windowTitle!=='string'||!windowTitle.trim()||windowTitle.length>80||/[\u0000-\u001f]/.test(windowTitle))throw new Error('Invalid notification window title');
  if(typeof statusFile!=='string'||!/^[-a-z0-9]{1,80}\.json$/i.test(statusFile))throw new Error('Invalid notification status filename');
  if(!/^[-a-z0-9]{1,40}$/.test(eventNamespace))throw new Error('Invalid notification event namespace');
  const priorityIds=normaliseNotificationPriorityIds(priorityAppIds);
  if(!Array.isArray(priorityAppIds)||priorityAppIds.length>64||priorityIds.length!==new Set(priorityAppIds.map(value=>typeof value==='string'?value.trim().toLowerCase():value)).size)throw new Error('Priority apps must be explicit valid notification identities');
  if(!Array.isArray(prioritySites)||prioritySites.length>32||prioritySites.some(rule=>normaliseNotificationSiteRules([rule]).length!==1))throw new Error('Priority sites must be explicit supported browser and HTTPS origin pairs');
  const siteRules=normaliseNotificationSiteRules(prioritySites);
  if(typeof priorityDuringDnd!=='boolean')throw new Error('Priority during Do not disturb must be an explicit boolean');
  if(popupAppIds!==null&&(!Array.isArray(popupAppIds)||popupAppIds.length>64||popupAppIds.some(id=>normaliseNotificationPriorityIds([id]).length!==1)))throw new Error('Popup ownership must use exact sender identities or null');
  const popupIds=popupAppIds===null?null:normaliseNotificationPriorityIds(popupAppIds);
  output=path.resolve(output||path.join(project,'dist','aurora-notifications'));
  await fs.mkdir(output,{recursive:true});
  const escapedTitle=windowTitle.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  await fs.writeFile(path.join(output,'index.html'),`<main id="aurora-home-preview" data-notification-overlay="true" data-motion="reduced" aria-label="${escapedTitle}"></main>\n`);
  const styles=await Promise.all(['aurora-notifications.css','notification-overlay.css','aurora-notification-stars.css'].map(name=>fs.readFile(path.join(project,'src',name),'utf8')));
  await fs.writeFile(path.join(output,'index.css'),styles.join('\n'));
  await build({entryPoints:[path.join(project,'src','notification-overlay.mjs')],outfile:path.join(output,'index.js'),bundle:true,format:'esm',platform:'browser',target:'chrome120',sourcemap:false,legalComments:'eof',define:{__AURORA_NOTIFICATION_OVERLAY_CONFIG__:JSON.stringify({homeWidgetId,priorityAppIds:priorityIds,prioritySites:siteRules,priorityDuringDnd,popupAppIds:popupIds,windowTitle:windowTitle.trim(),statusFile}),__AURORA_BUILD_CONFIG__:JSON.stringify({timezone,clockLabel})},plugins:[{name:'profile-events',setup(build){build.onLoad({filter:/\.mjs$/},async args=>{if(!path.resolve(args.path).startsWith(path.join(project,'src')+path.sep))return;return{contents:(await fs.readFile(args.path,'utf8')).replaceAll('aurora:',eventNamespace+':'),loader:'js'};});}}]});
  const metadata=`id: "${widgetId}"
metadata:
  displayName: ${JSON.stringify(windowTitle.trim())}
  description: Live Windows notification cards with a descending star reveal.
  appTargetVersion: [2, 8, 10]
  tags: [notifications, overlay, productivity]
icon: PiBellRingingDuotone
preset: Overlay
instances: Single
lazy: false
forceHardwareAcceleration: true
html: !include index.html
css: !include index.css
js: !include index.js
settings: []
`;
  await fs.writeFile(path.join(output,'metadata.yml'),metadata);
  const manifest={widget_id:widgetId,files:{}};
  for(const name of ['metadata.yml','index.html','index.css','index.js']){const data=await fs.readFile(path.join(output,name));manifest.files[name]={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};}
  await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};
  const names={'--output':'output','--id':'widgetId','--home-id':'homeWidgetId','--timezone':'timezone','--clock-label':'clockLabel','--priority-config':'priorityConfig','--window-title':'windowTitle','--status-file':'statusFile'};
  for(let i=0;i<args.length;i++){const name=names[args[i]];if(!name||!args[i+1])throw new Error('Expected a supported named option with a value');options[name]=args[++i];}
  if(options.priorityConfig){const policy=JSON.parse(await fs.readFile(options.priorityConfig,'utf8'));if(policy.schema_version!==1||!Array.isArray(policy.appIds))throw new Error('Invalid local priority configuration');options.priorityAppIds=policy.appIds;options.prioritySites=policy.sites??[];options.priorityDuringDnd=policy.priorityDuringDnd??false;options.popupAppIds=policy.popupAppIds??null;delete options.priorityConfig;}
  console.log(JSON.stringify(await buildNotificationOverlay(options),null,2));
}
