import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const file of (await fs.readdir(path.join(project,'tests'))).filter(name=>name.endsWith('.mjs')).sort()){
  const result=spawnSync(process.execPath,[path.join(project,'tests',file)],{cwd:project,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
