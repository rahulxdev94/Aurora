import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const roots=['src','scripts','tests','themes','licenses','docs','galaxy-windows'];
const topFiles=['.gitignore','README.md','LICENSE','THIRD-PARTY-NOTICES.md','SOURCE-MANIFEST.txt','package.json','package-lock.json','config.example.json'];
const localOnly=new Set(['.git','node_modules','dist','.build','config.local.json']);
for(const entry of await fs.readdir(project,{withFileTypes:true}))if(!roots.includes(entry.name)&&!topFiles.includes(entry.name)&&!localOnly.has(entry.name))throw new Error('Unexpected publication-root entry: '+entry.name);
const buildOutputs=new Set([
  'galaxy-windows/desktop/node_modules','galaxy-windows/desktop/dist',
  'galaxy-windows/launcher/GalaxyAtlas.exe','galaxy-windows/launcher/launcher-build-report.json',
  'galaxy-windows/motion/GalaxyAtlasMotion.exe',
]);
const files=[];
async function walk(relative){for(const entry of await fs.readdir(path.join(project,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(buildOutputs.has(name))continue;if(entry.isSymbolicLink())throw new Error('Publication must not contain symlinks');if(entry.isDirectory())await walk(name);else files.push(name);}}
for(const root of roots)await walk(root);
files.push(...topFiles);
const allowed=/\.(?:mjs|html|css|scss|json|yml|md|txt)$|(?:^|\/)LICENSE$|^\.gitignore$/;
// Exact public native sources and unchanged upstream theme artwork. Do not open
// the wider publication tree to native executables, scripts or arbitrary images.
const extraTextSources=new Set([
  'galaxy-windows/launcher/Build-GalaxyAtlasLauncher.ps1',
  'galaxy-windows/launcher/GalaxyAtlasLauncher.cs',
  'galaxy-windows/motion/GalaxyDockGlint.cs',
  'galaxy-windows/motion/GalaxyMotionHost.cs',
  'galaxy-windows/motion/MotionChannel.cs',
  'galaxy-windows/motion/PublicMediaFeeds.cs',
  'galaxy-windows/motion/build.ps1',

  'scripts/galaxy-motion/GalaxyDockGlint.cs',
  'scripts/galaxy-motion/GalaxyMotionHost.cs',
  'scripts/galaxy-motion/MotionChannel.cs',
  'scripts/galaxy-motion/build.ps1',
  'scripts/galaxy-motion/theme-source/base/.gitignore',
  'scripts/galaxy-motion/theme-source/base/extras/aurora-start-icon-pack/glass-wave-start-mask.svg',
  'scripts/galaxy-motion/theme-source/base/extras/aurora-start-icon-pack/glass-wave-start-shell.svg',
]);
const publicAssets=new Map([
  ['galaxy-windows/desktop/voice-demo.mp3','d1beecbcd732055b2a684f687aaecdfc13fcb418a10de57985593dfc8490eaf6'],
  ['galaxy-windows/launcher/galaxy-atlas.ico','d412f7c632a5eebeb66ca223e1192b95e68f24df115d9b91e68430daf2047132'],

  ['scripts/galaxy-motion/theme-source/base/assets/aurora-glass-banner-21x9.png','1966f53fc93e25c8727ae3f79ad2c298f2f751449893aa413a0fad2be67d9de6'],
  ['scripts/galaxy-motion/theme-source/base/assets/aurora-glass-icon-1x1.png','6e25b69eb2de3c9a4a40a9e7e5e1bb561ebb861d154c2567933162c195d98938'],
  ['scripts/galaxy-motion/theme-source/base/assets/screenshots/application-launcher.png','0eed7291b2de465636ea80e24d8f57fec3d8c19dcdaed5ea32c6f6aa78c7e5ac'],
  ['scripts/galaxy-motion/theme-source/base/assets/screenshots/calendar-popup.png','ccc04d8ebd9c8b453f9808f03498cd3e1f8721da484b6ac5a2c6aefa3424e3ad'],
]);
for(const file of files){
  if(!allowed.test(file)&&!extraTextSources.has(file)&&!publicAssets.has(file))throw new Error('Unexpected source asset: '+file);
  if(/(?:node_modules|\.git|android|flutter|phone|cache|logs)\//i.test(file))throw new Error('Excluded source directory: '+file);
  if(publicAssets.has(file)){
    const bytes=await fs.readFile(path.join(project,file));
    if(createHash('sha256').update(bytes).digest('hex')!==publicAssets.get(file))throw new Error('Public asset hash differs: '+file);
    continue;
  }
  const text=await fs.readFile(path.join(project,file),'utf8');
  if(/codex:\/\/threads\/[a-z0-9-]+/i.test(text)||/\.codex[\\/]+visualizations/i.test(text))throw new Error('Private chat or workspace reference in '+file);
  if(/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})/.test(text))throw new Error('Possible credential in '+file);
  for(const match of text.matchAll(/[A-Z]:[\\/]+Users[\\/]+([A-Za-z0-9_.-]+)/g))if(!['Example','Public'].includes(match[1]))throw new Error('Personal profile path in '+file);
}
const declared=(await fs.readFile(path.join(project,'SOURCE-MANIFEST.txt'),'utf8')).trim().split(/\r?\n/).sort();
if(JSON.stringify(declared)!==JSON.stringify(files.sort()))throw new Error('Source manifest differs from the publication allowlist');
console.log('Publication allowlist checked: '+files.length+' source/licence files, including '+publicAssets.size+' hash-pinned public artwork/audio files; no private configuration, caches, logs, executables, phone assets or build outputs included.');
