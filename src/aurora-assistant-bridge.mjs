// Read one local, expiring status file. This never reads chat history or microphones.
export const ASSISTANT_STATUS_FILE='assistant-presence.json';
export const ASSISTANT_POLL_MS=2000;
export const ASSISTANT_MAX_AGE_MS=60000;
const states=new Set(['idle','working','error']);

export function normaliseAssistantPresence(input,now=Date.now()){
  if(typeof input==='string'){
    if(input.length>8192)throw new Error('Assistant status is too large');
    input=JSON.parse(input);
  }
  if(input?.schema_version!==1||input.source!=='Codex'||!states.has(input.state))throw new Error('Unsupported assistant status');
  if(typeof input.id!=='string'||!input.id||input.id.length>128)throw new Error('Missing assistant status identity');
  if(!Number.isFinite(input.observedAt)||!Number.isFinite(input.expiresAt)||input.expiresAt<=input.observedAt||input.expiresAt-input.observedAt>ASSISTANT_MAX_AGE_MS)throw new Error('Invalid assistant status lifetime');
  if(!Number.isFinite(now)||input.observedAt>now+1000||input.expiresAt<=now||now-input.observedAt>ASSISTANT_MAX_AGE_MS)return null;
  const message=typeof input.message==='string'?input.message.replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,240):'';
  if(!message)return null;
  return {id:input.id,state:input.state,source:'Codex',message,observedAt:input.observedAt,expiresAt:input.expiresAt};
}

export function initAssistantBridge({root,invoke,SeelenCommand,now=()=>Date.now()}={}){
  if(!root?.ownerDocument||typeof invoke!=='function')return()=>{};
  const doc=root.ownerDocument,win=doc.defaultView;
  let disposed=false,pending=false,timer=0,lastId='',connection=null;
  const connectionState=value=>{
    if(disposed||connection===value)return;
    connection=value;
    if(!value)lastId='';
    root.dispatchEvent(new win.CustomEvent('aurora:assistant-connection',{detail:{connected:value,label:value?'Codex updates':'Desktop activity'}}));
  };
  async function read(){
    if(disposed||pending||doc.hidden)return;
    pending=true;
    try{
      const raw=await invoke(SeelenCommand?.ReadFile||'read_file',{filename:ASSISTANT_STATUS_FILE});
      if(disposed||doc.hidden)return;
      const entry=normaliseAssistantPresence(raw,now());
      connectionState(Boolean(entry));
      if(entry&&entry.id!==lastId){
        lastId=entry.id;
        root.dispatchEvent(new win.CustomEvent('aurora:assistant-status',{detail:entry}));
      }
    }catch{connectionState(false);}
    finally{pending=false;}
  }
  function schedule(){
    if(disposed)return;
    timer=win.setTimeout(()=>{void read();schedule();},doc.hidden?10000:ASSISTANT_POLL_MS);
  }
  function visibility(){win.clearTimeout(timer);void read();schedule();}
  doc.addEventListener('visibilitychange',visibility);
  void read();schedule();
  return()=>{if(disposed)return;disposed=true;win.clearTimeout(timer);doc.removeEventListener('visibilitychange',visibility);};
}
