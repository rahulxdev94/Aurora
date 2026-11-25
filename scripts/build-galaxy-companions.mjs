import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildSearch} from './build-search.mjs';
import {buildNotificationOverlay} from './build-notification-overlay.mjs';
export const GALAXY_IDS=Object.freeze({home:'@galaxy-atlas/desktop',search:'@galaxy-atlas/search',notifications:'@galaxy-atlas/notifications'});
export async function buildGalaxyCompanions({output,privateConfig}={}){
 if(!output||!privateConfig)throw new Error('Explicit output and private configuration paths are required');
 const source=JSON.parse(await fs.readFile(privateConfig,'utf8'));if(source.schema_version!==1||!source.notifications||!source.search)throw new Error('Invalid companion profile');
 const notification=source.notifications,search=source.search,locale=source.locale||{};output=path.resolve(output);
 const result={profile:'Galaxy Atlas',ids:GALAXY_IDS,eventNamespace:'galaxy-atlas:',outputs:{},privateConfigSha256:crypto.createHash('sha256').update(await fs.readFile(privateConfig)).digest('hex'),notificationPolicyPreserved:true,privateValuesPrinted:false};
 result.outputs.notifications=await buildNotificationOverlay({output:path.join(output,'galaxy-notifications'),widgetId:GALAXY_IDS.notifications,homeWidgetId:GALAXY_IDS.home,timezone:locale.timezone||'Australia/Sydney',clockLabel:locale.clockLabel||'Sydney',priorityAppIds:notification.priorityAppIds,prioritySites:notification.prioritySites||[],priorityDuringDnd:notification.priorityDuringDnd,popupAppIds:notification.popupAppIds,windowTitle:'Galaxy Atlas notifications',statusFile:'galaxy-atlas-notifications-startup.json',eventNamespace:'galaxy-atlas'});
 result.outputs.search=await buildSearch({output:path.join(output,'galaxy-search'),homeWidgetId:GALAXY_IDS.home,searchWidgetId:GALAXY_IDS.search,knownRoots:search.knownRoots,categories:search.categories,chatgptUrl:search.chatgptUrl,verificationApps:search.verificationApps||[],productName:'Galaxy Atlas',windowTitle:'Galaxy Atlas Search',statusFile:'galaxy-atlas-search-startup.json',shortcutId:'galaxy-atlas-search',eventNamespace:'galaxy-atlas'});
 const surfaceStyle=await fs.readFile(new URL('../src/galaxy-surface-light.css',import.meta.url),'utf8');
 for(const kind of ['notifications','search']){
   const folder=path.join(output,'galaxy-'+kind),manifest=result.outputs[kind];
   const cssFile=path.join(folder,'index.css');
   await fs.appendFile(cssFile,'\n'+surfaceStyle);
   const data=await fs.readFile(cssFile);
   manifest.files['index.css']={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
   await fs.writeFile(path.join(folder,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 await fs.writeFile(path.join(output,'galaxy-companions-build.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const options={};for(let i=2;i<process.argv.length;i+=2){const key=({'--output':'output','--private-config':'privateConfig'})[process.argv[i]];if(!key||!process.argv[i+1])throw new Error('Expected --output and --private-config');options[key]=process.argv[i+1];}const result=await buildGalaxyCompanions(options);console.log(JSON.stringify({profile:result.profile,ids:result.ids,eventNamespace:result.eventNamespace,outputs:Object.fromEntries(Object.entries(result.outputs).map(([key,value])=>[key,{widget_id:value.widget_id,files:Object.keys(value.files)}])),notificationPolicyPreserved:true,privateValuesPrinted:false},null,2));}
