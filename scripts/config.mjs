import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadConfig(project,env=process.env){
  const defaults=JSON.parse(await fs.readFile(path.join(project,'config.example.json'),'utf8'));
  let local={};
  try{local=JSON.parse(await fs.readFile(path.join(project,'config.local.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  for(const key of Object.keys(local))if(!Object.hasOwn(defaults,key))throw new Error('Unknown local configuration field: '+key);
  for(const group of ['weather','calendar','audio'])for(const key of Object.keys(local[group]||{}))if(!Object.hasOwn(defaults[group],key))throw new Error('Unknown '+group+' configuration field: '+key);
  const config={...defaults,...local,weather:{...defaults.weather,...local.weather},calendar:{...defaults.calendar,...local.calendar},audio:{...defaults.audio,...local.audio}};
  new Intl.DateTimeFormat('en-AU',{timeZone:config.timezone});
  for(const key of ['clockLabel','chatgptUrl'])if(typeof config[key]!=='string'||!config[key].trim())throw new Error('Invalid '+key);
  const chat=new URL(config.chatgptUrl);
  if(!['https:','codex:'].includes(chat.protocol)||chat.username||chat.password)throw new Error('ChatGPT target must be an HTTPS or Codex URL without credentials');
  if(typeof config.weather.enabled!=='boolean'||typeof config.calendar.enabled!=='boolean'||typeof config.audio.enabled!=='boolean')throw new Error('Integration enabled fields must be boolean');
  if(typeof config.weather.city!=='string'||!Number.isFinite(config.weather.latitude)||Math.abs(config.weather.latitude)>90||!Number.isFinite(config.weather.longitude)||Math.abs(config.weather.longitude)>180)throw new Error('Invalid weather location');
  const profile=env.USERPROFILE||(process.platform==='win32'?null:'C:\\Users\\Public');
  if(!profile)throw new Error('USERPROFILE is required to build local Windows folder paths');
  const roots={LocalDisk:'C:\\'};
  for(const name of ['Desktop','Documents','Pictures','Music','Videos','Downloads'])roots[name]=path.win32.join(profile,name);
  for(const [name,value] of Object.entries(local.roots||{})){
    if(!Object.hasOwn(roots,name)||typeof value!=='string')throw new Error('Unknown or invalid folder root');
    const expanded=value.replaceAll('%USERPROFILE%',profile);
    if(!path.win32.isAbsolute(expanded)||expanded.includes('\0'))throw new Error('Folder roots must be absolute Windows paths');
    roots[name]=path.win32.normalize(expanded);
  }
  if(roots.LocalDisk!=='C:\\')throw new Error('The Local disk shortcut is deliberately limited to C:\\');
  return{...config,roots};
}
