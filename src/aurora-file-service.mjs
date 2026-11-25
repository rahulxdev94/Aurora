export function createFileService({baseUrl='http://127.0.0.1:18765',token,fetchImpl=globalThis.fetch}={}){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)||typeof token!=='string'||token.length<32||typeof fetchImpl!=='function')throw new Error('Aurora file access is not connected.');
  async function request(route,input,{signal}={}){
    const timeout=AbortSignal.timeout(route==='/operation'?120000:route==='/gpu-temperature'?5000:30000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;
    try{response=await fetchImpl(baseUrl+route,{method:input===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(input===undefined?{}:{'Content-Type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input),signal:combined,credentials:'omit',cache:'no-store'});}
    catch(error){if(route==='/operation')throw Object.assign(new Error('The operation result could not be confirmed. Refresh this location before trying again.'),{code:'OPERATION_UNCERTAIN'});if(error.name==='AbortError'||error.name==='TimeoutError')throw error;throw Object.assign(new Error('Aurora’s local file connection is unavailable.'),{code:'OFFLINE'});}
    const result=await response.json();if(!response.ok||result?.ok!==true)throw Object.assign(new Error(result?.error?.message||'The file request could not be completed.'),{code:result?.error?.code||'FILE_ERROR'});return result.data;
  }
  return Object.freeze({health:options=>request('/health',undefined,options),list:(path,{hidden=false,...options}={})=>request('/list',{path,hidden},options),search:(root,query,{limit=300,...options}={})=>request('/search',{root,query,limit},options),preview:(path,{textLimit,...options}={})=>request('/preview',{path,...(Number.isInteger(textLimit)?{textLimit}:{})},options),operation:(input,options)=>request('/operation',input,options),trash:options=>request('/trash',{},options),reportGraphics:(input,options)=>request('/graphics',input,options),gpuTemperature:options=>request('/gpu-temperature',{},options)});
}
