import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.join(here,'theme-source');
const output=path.resolve(process.argv[2]||path.join(here,'galaxy-stage/themes/galaxy-atlas'));
const read=name=>fs.readFile(path.join(source,name),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const kebab=value=>value.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
const tokens=JSON.parse(await read('galaxy-palette.json'));
const components=JSON.parse(await read('components.json'));
const baseSettings=await read('base-settings.yml');
const baseDefaults=Object.fromEntries([...baseSettings.matchAll(/name:\s*(--[\w-]+)[\s\S]*?initialValue:\s*([^\r\n]+)/g)].map(([,name,value])=>[name,JSON.parse(value)]));
const defaults={...baseDefaults,...Object.fromEntries(Object.entries(tokens).map(([key,value])=>['--au-'+kebab(key),value]))};
const alphas={background:['f7','70'],surface:['f7'],surfaceRaised:['f7','d9','f2','ed','eb'],text:['42','26','40','35'],muted:['30'],accent:['33','0a','0d','55','45','a6'],accent2:['80','29','4a','26','75','b3']};
for(const [key,values]of Object.entries(alphas))for(const alpha of values)defaults['--au-dock-'+kebab(key)+'-'+alpha]='color-mix(in srgb,var(--au-'+kebab(key)+') '+(parseInt(alpha,16)/255*100).toFixed(6)+'%,transparent)';
defaults['--au-dock-icon-filter']='drop-shadow(0 2px 3px #00000024)';
const defaultCss='/* Declared once; Seelen byTheme values in the widget layer win. */\n:where(:root){\n'+Object.entries(defaults).map(([key,value])=>'  '+key+': '+value+';').join('\n')+'\n}\n';
const motion=await read('native-motion.css'),dock=await read('galaxy-dock.css');
await fs.mkdir(path.join(output,'styles'),{recursive:true});
const compiled={},warnings=[];
async function css(name,text){
  // These vendored sources use native CSS nesting, with SCSS-style whole-line comments.
  const input=text.replace(/^[\t ]*\/\/[^\r\n]*(?:\r?\n|$)/gm,'');
  const result=await transform(input,{loader:'css',target:'chrome120',minify:false,legalComments:'eof',sourcefile:name});
  if(result.warnings.length)warnings.push(...result.warnings.map(item=>({source:name,text:item.text})));
  compiled[name]=result.code;await fs.writeFile(path.join(output,name),result.code);return result.code;
}
const shared=await css('shared.css',(await read('base/shared/index.scss'))+'\n'+defaultCss);
for(const [widget,file]of Object.entries(components)){
  if(!widget.startsWith('@seelen/'))throw Error('Unexpected non-native widget dependency: '+widget);
  const name='styles/'+widget.split('/')[1]+'.css';
  await css(name,(await read('base/'+file))+'\n/* Maintained native motion and functional state finish. */\n'+motion+'\n'+dock);
}
if(warnings.length)throw Error('CSS build warnings: '+JSON.stringify(warnings));

const colourSettings='  - group:\n      header:\n        en: Galaxy colours\n      items:\n'+Object.entries(tokens).map(([key,value])=>'        - syntax: <color>\n          name: --au-'+kebab(key)+'\n          label:\n            en: '+key.replace(/[A-Z]/g,l=>' '+l.toLowerCase()).replace(/^./,l=>l.toUpperCase())+'\n          initialValue: '+JSON.stringify(value)+'\n').join('');
const metadata='id: "@galaxy-atlas/motion"\nmetadata:\n  displayName:\n    en: Galaxy Atlas\n  description:\n    en: Self-contained Galaxy Atlas glass, native dock and shell surfaces.\n  tags: [galaxy, glass, dock, desktop]\n  appTargetVersion: [2, 8, 10]\nsettings:'+baseSettings+'\n'+colourSettings+'\nstyles:\n'+Object.keys(components).map(widget=>'  '+JSON.stringify(widget)+': !include styles/'+widget.split('/')[1]+'.css').join('\n')+'\nsharedStyles: !include shared.css\n';
await fs.writeFile(path.join(output,'metadata.yml'),metadata);
for(const name of ['LICENSE','NOTICE.md','CREDITS.md','SOURCE-PROVENANCE.txt'])await fs.copyFile(path.join(source,'base',name),path.join(output,name));
await fs.writeFile(path.join(output,'README.txt'),`Galaxy Atlas native Seelen theme\n\nOne resource: @galaxy-atlas/motion. No other theme is required.\n\nNative dock pins, running windows, media controls, app launching, focus and drag\nremain owned by Seelen. This package contains paint and native CSS motion only.\nThe optional Galaxy Atlas motion companion supplies the finite, click-through\nwave-rim glint; the theme works without that companion.\n\nActivation is a separate installer step. Select this resource as the single\nGalaxy theme, preserving unrelated active themes and all byWidget dock settings.\nDo not replace data/seelen-weg/state.yml. Outlook and every existing pin remain\nunchanged. Neither old theme folder is a runtime dependency.\n\nRebuild: use Node22+ and esbuild0.28.2, then run\nnode source/build-theme.mjs <new-output-folder>\nThe canonical copy is scripts/galaxy-motion/build-theme.mjs in the project.\nAll local inputs, upstream licence and attribution are included. No runtime\nnetwork request, external font or external asset is used.\n`);
await fs.mkdir(path.join(output,'source'),{recursive:true});
await fs.cp(source,path.join(output,'source/theme-source'),{recursive:true});
await fs.copyFile(fileURLToPath(import.meta.url),path.join(output,'source/build-theme.mjs'));

const texts=[shared,...Object.values(compiled)];
const declarations=new Map(),references=new Map();
for(const [file,text]of Object.entries(compiled)){
  for(const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)){const rows=declarations.get(match[1])||[];rows.push({file,value:match[2].trim()});declarations.set(match[1],rows);}
  for(const match of text.matchAll(/@property\s+(--[\w-]+)/g))declarations.set(match[1],[...(declarations.get(match[1])||[]),{file,value:'registered @property'}]);
  for(const match of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)){const rows=references.get(match[1])||[];rows.push({file,fallback:Boolean(match[2])});references.set(match[1],rows);}
}
const settingsNames=new Set([...metadata.matchAll(/name:\s*(--[\w-]+)/g)].map(match=>match[1]));
const variables=[...new Set([...declarations.keys(),...references.keys(),...settingsNames])].sort().map(name=>({name,setting:settingsNames.has(name),defaultValue:defaults[name]??null,definitions:declarations.get(name)||[],references:references.get(name)||[],hostProvided:!declarations.has(name)&&!settingsNames.has(name)&&/^(--config-|--system-|--weg-|--color-)/.test(name)}));
const unresolved=variables.filter(item=>!item.definitions.length&&!item.setting&&!item.hostProvided&&item.references.some(row=>!row.fallback));
if(unresolved.length)throw Error('Undeclared CSS variables: '+JSON.stringify(unresolved.map(item=>item.name)));
for(const [file,text]of Object.entries(compiled))if(/url\(\s*['"]?(?:https?:|file:|[A-Za-z]:)/i.test(text))throw Error('External runtime asset in '+file);
const files={};
async function inventory(folder,prefix=''){for(const entry of(await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=prefix+entry.name;if(entry.isDirectory())await inventory(path.join(folder,entry.name),name+'/');else if(name!=='manifest.json')files[name]=hash(await fs.readFile(path.join(folder,entry.name)));}}
await inventory(output);
const manifest={formatVersion:1,id:'@galaxy-atlas/motion',displayName:'Galaxy Atlas',appTargetVersion:[2,8,10],requiresThemeIds:[],genericWidgetIds:Object.keys(components),builder:{node:'>=22',esbuild:'0.28.2',command:'node scripts/galaxy-motion/build-theme.mjs <output-folder>'},nativeGlint:{optional:true,durationMs:2050,topCornerRadiusCssPx:28,bottomCornerRadiusCssPx:18,input:'passive native broker; no theme scripts'},preservesNativeDockState:true,settingsVariables:[...settingsNames].sort(),variables,files};
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,id:manifest.id,widgets:manifest.genericWidgetIds.length,settings:settingsNames.size,variables:variables.length,unresolved:unresolved.length,files:Object.keys(files).length,manifestHash:hash(JSON.stringify(manifest))},null,2));
