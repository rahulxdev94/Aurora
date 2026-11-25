// One-shot commands written by local mouse launchers. No global mouse hooks or polling.
export const MOUSE_COMMAND_FILE='mouse-command.json';
export const MOUSE_COMMAND_MAX_AGE_MS=10000;
export const MOUSE_COMMAND_ACTIONS=Object.freeze({
  home:'show-home',files:'files',notifications:'notifications',focus:'start-focus',
  work:'workspace-work',create:'workspace-create',relax:'workspace-relax',
  calendar:'show-calendar',controls:'quick-controls','alerts-on':'notifications-all',
  'motion-full':'motion-full','motion-reduced':'motion-reduced','motion-off':'motion-off'
});

export function parseMouseCommand(input,{now=Date.now(),maxAge=MOUSE_COMMAND_MAX_AGE_MS}={}){
  if(typeof input==='string'){
    if(input.length>2048)return null;
    try{input=JSON.parse(input);}catch{return null;}
  }
  if(!input||input.version!==1||typeof input.action!=='string'||!Object.hasOwn(MOUSE_COMMAND_ACTIONS,input.action))return null;
  if(typeof input.nonce!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(input.nonce))return null;
  if(!Number.isFinite(input.at)||input.at<=0||!Number.isFinite(now))return null;
  const lifetime=Math.min(30000,Math.max(1000,Number(maxAge)||MOUSE_COMMAND_MAX_AGE_MS));
  if(input.at>now+1000||now-input.at>lifetime)return null;
  return Object.freeze({version:1,action:input.action,command:MOUSE_COMMAND_ACTIONS[input.action],nonce:input.nonce,at:input.at});
}

/** consume(entry) clears only the same pending nonce and may return false if replaced. */
export function createMouseCommandConsumer({read,consume,dispatch,now=()=>Date.now(),maxSeen=128}={}){
  if(typeof read!=='function'||typeof consume!=='function'||typeof dispatch!=='function')throw new Error('Mouse command access requires read, consume and dispatch functions.');
  let disposed=false,pending=null,rerun=false;
  const seen=new Map(),seenLimit=Math.max(16,Math.min(512,Number(maxSeen)||128));
  async function consumeOne(){
    try{
      const raw=await read();if(disposed)return false;
      const entry=parseMouseCommand(raw,{now:now()});if(!entry||seen.has(entry.nonce))return false;
      if(await consume(entry)===false||disposed)return false;
      seen.set(entry.nonce,now());
      for(const [nonce,at] of seen)if(now()-at>60000)seen.delete(nonce);
      while(seen.size>seenLimit)seen.delete(seen.keys().next().value);
      return await dispatch(entry.command,entry)!==false;
    }catch{return false;}
  }
  async function drain(){
    let handled=false;
    do{rerun=false;handled=await consumeOne()||handled;}while(rerun&&!disposed);
    return handled;
  }
  return Object.freeze({
    run(){if(disposed)return Promise.resolve(false);if(pending){rerun=true;return pending;}pending=drain().finally(()=>{pending=null;});return pending;},
    dispose(){disposed=true;seen.clear();}
  });
}

/** Native trigger adapter. File access stays inside the current widget's data folder. */
export function createMouseCommandTrigger({read,write,getHandler,now=()=>Date.now(),readyTimeout=2000}={}){
  if(typeof read!=='function'||typeof write!=='function'||typeof getHandler!=='function')throw new Error('Mouse triggers require widget file access and a command handler.');
  let disposed=false;
  const waiting=new Set(),timeout=Math.max(0,Math.min(2500,Number(readyTimeout)||0));
  const handler=()=>{const value=getHandler();return typeof value==='function'?value:null;};
  function waitForHandler(){
    return new Promise(resolve=>{
      const started=Date.now();let timer;
      const finish=value=>{clearTimeout(timer);waiting.delete(cancel);resolve(value);};
      const cancel=()=>finish(null);
      const check=()=>{
        if(disposed)return finish(null);
        let current;try{current=handler();}catch{return finish(null);}
        if(current)return finish(current);
        const remaining=timeout-(Date.now()-started);
        if(remaining<=0)return finish(null);
        timer=setTimeout(check,Math.min(40,remaining));
      };
      waiting.add(cancel);check();
    });
  }
  const consumer=createMouseCommandConsumer({
    read,now,
    consume:async entry=>{
      if(disposed||!handler())return false;
      const current=parseMouseCommand(await read(),{now:now()});
      if(disposed||!handler()||!current||current.nonce!==entry.nonce||current.action!==entry.action||current.at!==entry.at)return false;
      await write('{}');
      return !disposed;
    },
    dispatch:command=>{if(disposed)return false;return handler()?.(command)??false;}
  });
  return Object.freeze({
    async handle(args={}){
      if(disposed)return false;
      const customArgs=args?.customArgs;
      const explicit=customArgs!=null&&Object.hasOwn(customArgs,'auroraCommand');
      if(explicit&&typeof customArgs.auroraCommand!=='string')return false;
      const current=await waitForHandler();
      if(disposed||!current)return false;
      if(explicit){try{return await current(customArgs.auroraCommand)!==false;}catch{return false;}}
      return consumer.run();
    },
    dispose(){disposed=true;consumer.dispose();for(const cancel of waiting)cancel();waiting.clear();}
  });
}
