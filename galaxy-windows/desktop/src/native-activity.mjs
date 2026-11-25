// Forward real activity between Galaxy Atlas's own windows. No command execution.
export function initNativeActivity({root,subscribe}){
  let disposed=false,stop=null;
  const win=root.ownerDocument.defaultView;
  Promise.resolve().then(()=>subscribe('galaxy-atlas:activity',event=>{
    const detail=event?.payload;
    if(disposed||!detail||typeof detail.message!=='string'||!['info','success','error','busy'].includes(detail.kind))return;
    root.dispatchEvent(new win.CustomEvent('galaxy-atlas:activity',{detail:{message:detail.message.slice(0,160),kind:detail.kind}}));
  })).then(unlisten=>{if(disposed)unlisten?.();else stop=unlisten;}).catch(()=>{});
  return()=>{disposed=true;stop?.();};
}
