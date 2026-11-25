/* Local, explainable virtual categories. This module makes no network requests. */
export const FILE_CATEGORIES=Object.freeze([
  {id:'career',label:'Work and career',icon:'briefcase-business'},
  {id:'identity',label:'Identity and immigration',icon:'contact-round'},
  {id:'finance',label:'Money and receipts',icon:'wallet-cards'},
  {id:'home',label:'Home and property',icon:'house'},
  {id:'travel',label:'Travel and bookings',icon:'plane'},
  {id:'health',label:'Health',icon:'heart-pulse'},
  {id:'learning',label:'Study and learning',icon:'book-open'},
  {id:'projects',label:'Projects and code',icon:'code-xml'},
  {id:'images',label:'Images',icon:'image'},
  {id:'video',label:'Video',icon:'film'},
  {id:'audio',label:'Audio',icon:'audio-lines'},
  {id:'archives',label:'Archives',icon:'archive'},
  {id:'apps',label:'Apps and shortcuts',icon:'app-window'},
  {id:'private',label:'Private files',icon:'lock-keyhole'},
  {id:'folders',label:'Folders',icon:'folder'},
  {id:'documents',label:'Documents',icon:'file-text'},
  {id:'other',label:'Other files',icon:'file'}
]);
const categories=new Map(FILE_CATEGORIES.map(value=>[value.id,value]));
const normalise=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/[^a-z0-9. ]+/g,' ').replace(/\s+/g,' ').trim();
const extOf=entry=>String(entry?.extension||String(entry?.name||'').split('.').slice(1).at(-1)||'').replace(/^\./,'').toLowerCase().slice(0,20);
export const intelligenceKey=entry=>String(entry?.path||entry?.name||'').replaceAll('\\','/').toLowerCase();
const textExtensions=new Set('txt md json csv tsv yml yaml log ini xml html css js mjs cjs ts tsx jsx py ps1 sh sql rs c cpp h java toml gitignore'.split(' '));
const sensitiveName=/(?:^|[ ._-])(?:passwords?|credentials?|secrets?|tokens?|private[ ._-]?key)(?:$|[ ._-])|\.(?:pem|key|pfx|p12|kdbx)$/i;
export function canInspectFile(entry){return entry?.kind==='file'&&textExtensions.has(extOf(entry))&&!sensitiveName.test(entry.name||'')&&Number.isFinite(entry.size)&&entry.size>0&&entry.size<=4*1024*1024;}
const rule=(category,terms)=>({category,terms:terms.map(([term,weight=3])=>({term,weight,pattern:new RegExp('(?:^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i')}))});
const rules=[
  rule('career',[['curriculum vitae',8],['resume',7],['cv',7],['cover letter',7],['selection criteria',7],['job application',7],['employment',3],['professional experience',5],['work experience',4],['vacancy',4],['position description',5],['referee',2],['recruitment',3],['career',3]]),
  rule('identity',[['passport',8],['visa',6],['immigration',6],['birth certificate',8],['identity document',7],['proof of identity',7],['citizenship',6],['licence',3],['license',3],['police check',6],['national identity',6]]),
  rule('finance',[['invoice',6],['receipt',6],['tax return',7],['bank statement',7],['payment terms',5],['amount due',4],['subtotal',3],['gst',2],['transaction',3],['salary',3],['payslip',7],['budget',5],['account balance',5],['superannuation',5],['purchase order',5]]),
  rule('home',[['tenancy',7],['lease agreement',7],['rental agreement',7],['landlord',5],['property inspection',6],['electricity bill',6],['water bill',6],['gas bill',6],['rent',3],['strata',5],['mortgage',5],['household',3],['home inventory',6]]),
  rule('travel',[['itinerary',7],['boarding pass',8],['flight booking',7],['departure',3],['arrival',3],['hotel booking',7],['accommodation',5],['booking reference',5],['e ticket',6],['travel',4],['reservation',3],['check in',3],['airport',4]]),
  rule('health',[['prescription',7],['medical certificate',7],['pathology',7],['diagnosis',5],['medication',5],['patient',4],['clinical',4],['health insurance',6],['dental',4],['vaccination',6],['hospital',3],['appointment',1]]),
  rule('learning',[['assignment',5],['lecture',5],['course outline',7],['unit outline',7],['assessment',4],['tutorial',5],['student',3],['university',3],['learning',3],['training',3],['study notes',6],['exam',5],['syllabus',7]]),
  rule('projects',[['package.json',7],['readme',4],['source code',6],['repository',5],['dependency',3],['dependencies',3],['git commit',5],['function',2],['import',2],['export',2],['const',2],['project',3],['design brief',5],['implementation',3]])
];
const formats=[['images',/^(?:png|jpe?g|gif|webp|heic|heif|bmp|svg|ico|avif|tiff?)$/],['video',/^(?:mp4|mkv|mov|avi|webm|m4v)$/],['audio',/^(?:mp3|wav|flac|aac|m4a|ogg|aiff?)$/],['archives',/^(?:zip|7z|rar|tar|gz|bz2|xz)$/],['apps',/^(?:lnk|url|exe|msi|appx|msix)$/],['projects',/^(?:js|mjs|cjs|ts|tsx|jsx|py|ps1|sh|sql|rs|c|cpp|h|java|toml|css|html)$/],['documents',/^(?:pdf|docx?|xlsx?|pptx?|txt|md|rtf|csv|tsv|odt|ods|json|log|xml|yml|yaml)$/]];
const result=(category,extra)=>({category,label:categories.get(category).label,matchedTerms:[],...extra});
export function classifyFile(entry,{text='',contentInspected=false}={}){
  const name=normalise(entry?.name||''),body=normalise(typeof text==='string'?text.slice(0,12000):'');
  if(sensitiveName.test(entry?.name||''))return result('private',{confidence:'strong',source:'name',reason:'Sensitive filename. Contents are excluded from automatic inspection.'});
  if(contentInspected&&/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AWS_ACCESS_KEY_ID|OPENAI_API_KEY|CLIENT_SECRET)\s*[:=]/i.test(text))return result('private',{confidence:'strong',source:'content',reason:'Credential-like text detected locally. It is excluded from category matching.'});
  const scores=rules.map(({category,terms})=>{
    const nameMatches=terms.filter(term=>term.pattern.test(name)),contentMatches=body?terms.filter(term=>term.pattern.test(body)):[];
    const nameScore=nameMatches.reduce((sum,term)=>sum+term.weight*1.7,0),contentScore=contentMatches.reduce((sum,term)=>sum+term.weight,0);
    return{category,score:nameScore+contentScore,source:contentMatches.length&&contentScore>=nameScore*.6?'content':'name',terms:(contentScore>=nameScore*.6&&contentMatches.length?contentMatches:nameMatches).map(term=>term.term)};
  }).sort((a,b)=>b.score-a.score);
  const top=scores[0],next=scores[1];
  if(top.score>=4.8){
    const confidence=top.score>=10&&top.score-next.score>=3?'strong':'suggested';
    const matchedTerms=top.terms.slice(0,3);
    return result(top.category,{confidence,source:top.source,matchedTerms,reason:(top.source==='content'?'Text contains ':'Filename suggests ')+matchedTerms.map(term=>'“'+term+'”').join(', ')+(entry.kind==='folder'?'. Folder contents have not been scanned.':'.')+(confidence==='suggested'?' Review this suggestion.':'')});
  }
  if(entry?.kind==='folder')return result('folders',{confidence:'format',source:'format',reason:'A folder. Its contents have not been scanned.'});
  const ext=extOf(entry),format=formats.find(([,pattern])=>pattern.test(ext));
  if(format)return result(format[0],{confidence:'format',source:'format',reason:contentInspected?'File format. No clear topic was found in the inspected text.':'File format. Content has not been inspected.'});
  return result('other',{confidence:'unclassified',source:'format',reason:'No clear category yet. The file stays in its current location.'});
}
const cancelled=()=>typeof DOMException==='function'?new DOMException('Category scan cancelled','AbortError'):Object.assign(new Error('Category scan cancelled'),{name:'AbortError'});
export async function categoriseEntries(entries,{readText,signal,onUpdate,maxContentFiles=40,concurrency=3}={}){
  if(signal?.aborted)throw cancelled();
  const source=Array.isArray(entries)?entries.slice(0,5000):[],items=new Map(source.map(entry=>[intelligenceKey(entry),classifyFile(entry)]));
  const eligible=source.filter(canInspectFile),limit=Math.max(0,Math.min(100,Math.floor(Number(maxContentFiles)||0))),queue=typeof readText==='function'?eligible.slice(0,limit):[];
  let cursor=0,inspected=0,errors=0,completed=0;
  const snapshot=()=>({items:new Map(items),inspected,eligible:eligible.length,limited:eligible.length>queue.length,errors});
  const notify=()=>{if(!signal?.aborted)onUpdate?.(snapshot());};notify();
  async function worker(){
    while(cursor<queue.length){
      if(signal?.aborted)throw cancelled();const entry=queue[cursor++];
      try{
        const text=await readText(entry,{signal,textLimit:16384});if(signal?.aborted)throw cancelled();
        if(typeof text==='string'){items.set(intelligenceKey(entry),classifyFile(entry,{text,contentInspected:true}));inspected++;}
      }catch(error){if(signal?.aborted||error?.name==='AbortError')throw cancelled();errors++;}
      completed++;if(completed%8===0)notify();
    }
  }
  await Promise.all(Array.from({length:Math.min(queue.length,Math.max(1,Math.min(4,Math.floor(Number(concurrency)||1))))},worker));
  if(signal?.aborted)throw cancelled();notify();return snapshot();
}
