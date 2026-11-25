import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

const source=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(process.argv[2]||path.join(source,'dist'));
await fs.mkdir(out,{recursive:true});
const configPath=process.env.GALAXY_DESKTOP_CONFIG || path.join(source,'../../config.example.json');
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
const voiceDemo='data:audio/mpeg;base64,'+(await fs.readFile(path.join(source,'voice-demo.mp3'))).toString('base64');
await build({entryPoints:[path.join(source,'src/desktop.mjs')],outfile:path.join(out,'index.js'),
  bundle:true,format:'esm',platform:'browser',target:'chrome120',legalComments:'eof',minify:true,
  define:{__AURORA_BUILD_CONFIG__:JSON.stringify(config),__ATLAS_VOICE_DEMO__:JSON.stringify(voiceDemo)}});
const files={};
const pageCss=['glass-cards.css','surface-light.css','desktop-pages.css','desktop-media.css','desktop-voice.css'];
for(const name of ['index.js','index.html','index.css','voice-demo.mp3','metadata.yml','LICENSE-AGPL-3.0.txt','LICENSE-lucide.txt','THIRD-PARTY-NOTICES.txt']){
  if(name!=='index.js')await fs.copyFile(path.join(source,name),path.join(out,name));
  if(name==='index.css')for(const file of pageCss){
    const rules=await fs.readFile(path.join(source,'src',file),'utf8');
    await fs.appendFile(path.join(out,name),'\n'+(file.startsWith('desktop-')?'#aurora-home-preview {\n'+rules+'\n}':rules));
  }
  const bytes=await fs.readFile(path.join(out,name));
  files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
await fs.writeFile(path.join(out,'build-manifest.json'),JSON.stringify({widget_id:'@galaxy-atlas/desktop',seelen_target:'2.8.10',files},null,2)+'\n');
console.log('Built Galaxy Atlas desktop at '+out);
