// Fixed read-only NVIDIA query used by the existing local Aurora service.
// https://docs.nvidia.com/deploy/nvidia-smi/index.html#selective-query-options
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const runFile=promisify(execFile);
const EXECUTABLE='C:\\Windows\\System32\\nvidia-smi.exe';
const QUERY='--query-gpu=uuid,name,temperature.gpu,utilization.gpu,memory.used,memory.total';
const UUID=/^GPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const numeric=(value,min,max)=>{
  const raw=typeof value==='string'?value.trim():'';
  if(!/^-?\d+(?:\.\d+)?$/.test(raw))return null;
  const number=Number(raw);return Number.isFinite(number)&&number>=min&&number<=max?number:null;
};
function csvLine(line){
  const fields=[];let field='',quoted=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(char==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){fields.push(field.trim());field='';}
    else field+=char;
  }
  if(quoted)throw new Error('NVIDIA returned invalid CSV');
  fields.push(field.trim());return fields;
}
export function parseGpuTelemetry(output,expectedUuid,at=new Date().toISOString()){
  if(!UUID.test(expectedUuid)||typeof output!=='string'||output.length>16384)throw new Error('Invalid NVIDIA response');
  const rows=output.trim().split(/\r?\n/).filter(Boolean).map(csvLine);
  if(rows.length!==1||rows[0].length!==6||rows[0][0].toLowerCase()!==expectedUuid.toLowerCase())throw new Error('NVIDIA returned a different GPU');
  const row=rows[0],temperatureC=numeric(row[2],-20,130),name=row[1].replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,128);
  if(!name)throw new Error('NVIDIA did not identify the GPU');
  return{source:'nvidia-smi',uuid:row[0],name,temperatureC,utilisationPct:numeric(row[3],0,100),memoryUsedMiB:numeric(row[4],0,1048576),memoryTotalMiB:numeric(row[5],0,1048576),status:temperatureC===null?'unavailable':'ok',updatedAt:at,message:temperatureC===null?'The NVIDIA driver is not reporting this GPU temperature.':null};
}
async function query(uuid){
  const result=await runFile(EXECUTABLE,[QUERY,'--format=csv,noheader,nounits','--id='+uuid],{windowsHide:true,shell:false,timeout:3000,maxBuffer:16384,encoding:'utf8'});
  return result.stdout;
}
export function createGpuTelemetry(config={},dependencies={}){
  if(config.enabled!==undefined&&typeof config.enabled!=='boolean')throw new Error('GPU telemetry enabled must be a boolean');
  const enabled=config.enabled===true,uuid=typeof config.uuid==='string'?config.uuid:'';
  if(enabled&&!UUID.test(uuid))throw new Error('GPU telemetry requires the verified NVIDIA GPU UUID');
  const now=dependencies.now||Date.now,read=dependencies.query||query;
  let pending=null,previous=null,lastAttempt=-Infinity;
  const unavailable=(at,message)=>({schemaVersion:1,updatedAt:at,gpu:{source:'nvidia-smi',uuid:enabled?uuid:null,name:null,temperatureC:null,utilisationPct:null,memoryUsedMiB:null,memoryTotalMiB:null,status:'unavailable',updatedAt:null,message}});
  async function sample(){
    const at=new Date(now()).toISOString();
    if(!enabled)return unavailable(at,'GPU temperature is not connected.');
    if(pending)return pending;
    // Coalesce callers and bound polling even if several Aurora windows request it.
    if(previous&&now()-lastAttempt>=0&&now()-lastAttempt<5000)return previous;
    lastAttempt=now();
    pending=(async()=>{
      try{
        const output=await Promise.resolve().then(()=>read(uuid)),sampledAt=new Date(now()).toISOString();
        previous={schemaVersion:1,updatedAt:sampledAt,gpu:parseGpuTelemetry(output,uuid,sampledAt)};
      }catch{
        const failedAt=new Date(now()).toISOString(),last=previous?.gpu;
        previous=last?.temperatureC!==null&&Number.isFinite(last?.temperatureC)&&last?.updatedAt
          ?{schemaVersion:1,updatedAt:failedAt,gpu:{...last,status:'stale',message:'NVIDIA telemetry is temporarily unavailable.'}}
          :unavailable(failedAt,'NVIDIA telemetry is temporarily unavailable.');
      }finally{pending=null;}
      return previous;
    })();
    return pending;
  }
  return Object.freeze({enabled,read:sample});
}
