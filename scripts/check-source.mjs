import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const roots=['src','scripts','tests','themes','licenses'];
const topFiles=['.gitignore','README.md','LICENSE','THIRD-PARTY-NOTICES.md','SOURCE-MANIFEST.txt','package.json','package-lock.json','config.example.json'];
const localOnly=new Set(['.git','node_modules','dist','.build','config.local.json']);
for(const entry of await fs.readdir(project,{withFileTypes:true}))if(!roots.includes(entry.name)&&!topFiles.includes(entry.name)&&!localOnly.has(entry.name))throw new Error('Unexpected publication-root entry: '+entry.name);
const files=[];
async function walk(relative){for(const entry of await fs.readdir(path.join(project,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(entry.isSymbolicLink())throw new Error('Publication must not contain symlinks');if(entry.isDirectory())await walk(name);else files.push(name);}}
for(const root of roots)await walk(root);
files.push(...topFiles);
const allowed=/\.(?:mjs|html|css|scss|json|yml|md|txt)$|(?:^|\/)LICENSE$|^\.gitignore$/;
for(const file of files){
  if(!allowed.test(file))throw new Error('Unexpected source asset: '+file);
  if(/(?:node_modules|\.git|android|flutter|phone|cache|logs)\//i.test(file))throw new Error('Excluded source directory: '+file);
  const text=await fs.readFile(path.join(project,file),'utf8');
  if(/codex:\/\/threads\/[a-z0-9-]+/i.test(text)||/\.codex[\\/]+visualizations/i.test(text))throw new Error('Private chat or workspace reference in '+file);
  if(/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})/.test(text))throw new Error('Possible credential in '+file);
  for(const match of text.matchAll(/[A-Z]:[\\/]+Users[\\/]+([A-Za-z0-9_.-]+)/g))if(!['Example','Public'].includes(match[1]))throw new Error('Personal profile path in '+file);
}
const declared=(await fs.readFile(path.join(project,'SOURCE-MANIFEST.txt'),'utf8')).trim().split(/\r?\n/).sort();
if(JSON.stringify(declared)!==JSON.stringify(files.sort()))throw new Error('Source manifest differs from the publication allowlist');
console.log('Publication allowlist checked: '+files.length+' text source/licence files; no private configuration, caches, logs, binaries, phone assets or build outputs included.');
