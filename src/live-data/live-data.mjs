import {config} from '../config.mjs';
/* Desktop-only adapter. This module is never part of the in-chat preview. */
export const WEATHER_URL='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(config.weather.latitude),longitude:String(config.weather.longitude),current:'temperature_2m,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:config.timezone,forecast_days:'7'});
export const GPU_URL='http://127.0.0.1:18764/status.json';
export const ENABLE_GPU_TEMPERATURE_HELPER=false;
const WEATHER_INTERVAL=15*60*1000,MAX_CACHE_AGE=24*60*60*1000,GPU_INTERVAL=5000,CACHE_KEY='auroraWeather.v1.'+config.weather.city+'.'+config.timezone;
const validNumber=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};

export function mapWeatherCode(code){
  const map={0:['sunny','Clear sky'],1:['partly','Mainly clear'],2:['partly','Partly cloudy'],3:['cloudy','Overcast'],45:['cloudy','Fog'],48:['cloudy','Rime fog'],51:['rain','Light drizzle'],53:['rain','Drizzle'],55:['rain','Heavy drizzle'],56:['rain','Freezing drizzle'],57:['rain','Heavy freezing drizzle'],61:['rain','Light rain'],63:['rain','Rain'],65:['rain','Heavy rain'],66:['rain','Freezing rain'],67:['rain','Heavy freezing rain'],71:['snow','Light snow'],73:['snow','Snow'],75:['snow','Heavy snow'],77:['snow','Snow grains'],80:['rain','Light showers'],81:['rain','Showers'],82:['rain','Heavy showers'],85:['snow','Snow showers'],86:['snow','Heavy snow showers'],95:['thunder','Thunderstorm'],96:['thunder','Thunderstorm with hail'],99:['thunder','Thunderstorm with heavy hail']};
  map[97]=['thunder','Heavy thunderstorm'];
  const [condition,label]=map[code]||['cloudy','Unknown conditions'];return{condition,label};
}

export function normaliseWeatherPayload(raw,receivedAt=Date.now()){
  const daily=raw?.daily;
  if(raw?.timezone!==config.timezone||!daily||!Array.isArray(daily.time)||daily.time.length!==7)throw new Error('Invalid seven-day forecast');
  const days=daily.time.map((date,i)=>{
    const minC=daily.temperature_2m_min?.[i],maxC=daily.temperature_2m_max?.[i],weatherCode=daily.weather_code?.[i],rain=daily.precipitation_probability_max?.[i];
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validNumber(minC,-80,65)||!validNumber(maxC,-80,65)||minC>maxC||!Number.isInteger(weatherCode))throw new Error('Invalid forecast day');
    const dateMs=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(dateMs)||new Date(dateMs).toISOString().slice(0,10)!==date)throw new Error('Invalid forecast date');
    if(i&&dateMs-Date.parse(daily.time[i-1]+'T00:00:00Z')!==86400000)throw new Error('Forecast dates are not consecutive');
    return{date,minC,maxC,weatherCode,rainChancePct:validNumber(rain,0,100)?rain:null,...mapWeatherCode(weatherCode)};
  });
  const current=raw.current;
  return{schemaVersion:1,city:config.weather.city,timezone:config.timezone,receivedAt,status:'ok',error:null,current:current&&validNumber(current.temperature_2m,-80,65)?{temperatureC:current.temperature_2m,weatherCode:current.weather_code,...mapWeatherCode(current.weather_code),time:typeof current.time==='string'?current.time:null}:null,daily:days};
}

export function normaliseGpuPayload(raw,now=Date.now()){
  const gpu=raw?.gpu;
  if(raw?.schemaVersion!==1||gpu?.source!=='nvidia-smi')throw new Error('Unexpected telemetry source');
  const updated=Date.parse(gpu.updatedAt),age=now-updated;
  const validTemp=validNumber(gpu.temperatureC,-20,130);
  const status=gpu.status==='ok'&&validTemp&&Number.isFinite(updated)&&age>=-5000&&age<20000?'ok':validTemp&&Number.isFinite(updated)?'stale':'unavailable';
  return{source:'nvidia-smi',name:typeof gpu.name==='string'?gpu.name.slice(0,128):'NVIDIA GPU',temperatureC:validTemp?gpu.temperatureC:null,utilisationPct:validNumber(gpu.utilisationPct,0,100)?gpu.utilisationPct:null,memoryUsedMiB:validNumber(gpu.memoryUsedMiB,0,1048576)?gpu.memoryUsedMiB:null,memoryTotalMiB:validNumber(gpu.memoryTotalMiB,0,1048576)?gpu.memoryTotalMiB:null,updatedAt:Number.isFinite(updated)?gpu.updatedAt:null,status};
}

export function normaliseNativeCpuUsage(raw){
  const cores=Array.isArray(raw)?raw:[];
  const valid=cores.filter(core=>validNumber(core?.usage,0,100));
  const usagePct=valid.length?valid.reduce((sum,core)=>sum+core.usage,0)/valid.length:null;
  const brand=valid.find(core=>typeof core.brand==='string'&&core.brand.trim())?.brand;
  return{source:'Seelen host',status:usagePct===null?'unavailable':'reported',initialComplete:true,usagePct,name:brand?brand.trim().slice(0,128):'CPU',validCoreCount:valid.length,totalCoreCount:cores.length};
}

export function normaliseNativeGpuUsage(raw){
  const adapters=Array.isArray(raw)?raw:[];
  const adapter=adapters.find(gpu=>typeof gpu?.name==='string'&&validNumber(gpu.usage,0,100));
  const usagePct=validNumber(adapter?.usage,0,100)?adapter.usage:null;
  return{source:'Seelen host',status:usagePct===null?'unavailable':'reported',initialComplete:true,usagePct,id:typeof adapter?.id==='string'?adapter.id.slice(0,128):null,name:adapter?adapter.name.slice(0,128):'GPU not reported',dedicatedMemoryUsedBytes:validNumber(adapter?.dedicatedMemoryUsed,0,Number.MAX_SAFE_INTEGER)?adapter.dedicatedMemoryUsed:null,dedicatedMemoryTotalBytes:validNumber(adapter?.dedicatedMemoryTotal,0,Number.MAX_SAFE_INTEGER)?adapter.dedicatedMemoryTotal:null};
}

export function connectNativeUsage({invoke,subscribe,SeelenCommand,SeelenEvent,onCpu=()=>{},onGpu=()=>{}}={}){
  let disposed=false;
  const unsubscribers=[],revisions={cpu:0,gpu:0};
  const sources=[
    {key:'cpu',event:SeelenEvent?.SystemCoresChanged||'system::cores-changed',command:SeelenCommand?.GetSystemCores||'get_system_cores',parse:normaliseNativeCpuUsage,emit:onCpu},
    {key:'gpu',event:SeelenEvent?.SystemGpusChanged||'system::gpus-changed',command:SeelenCommand?.GetSystemGpus||'get_system_gpus',parse:normaliseNativeGpuUsage,emit:onGpu}
  ];
  const ready=(async()=>{
    // Bind both event sources before querying. A query cannot overwrite an event
    // received while that query was in flight.
    await Promise.allSettled(sources.map(async source=>{
      if(typeof subscribe!=='function')return;
      const unsubscribe=await subscribe(source.event,event=>{
        if(disposed)return;revisions[source.key]++;source.emit(source.parse(event?.payload));
      });
      if(typeof unsubscribe==='function'){if(disposed)unsubscribe();else unsubscribers.push(unsubscribe);}
    }));
    await Promise.allSettled(sources.map(async source=>{
      if(disposed)return;
      const revision=revisions[source.key];
      try{
        if(typeof invoke!=='function')throw new Error('Native host unavailable');
        const raw=await invoke(source.command);
        if(!disposed&&revision===revisions[source.key])source.emit(source.parse(raw));
      }catch{if(!disposed&&revision===0&&revisions[source.key]===0)source.emit(source.parse(null));}
    }));
  })();
  return{ready,dispose(){if(disposed)return;disposed=true;for(const unsubscribe of unsubscribers.splice(0)){try{unsubscribe();}catch{}}}};
}

function readCache(){
  try{
    const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
    if(cached?.schemaVersion!==1||!Number.isFinite(cached.receivedAt)||Date.now()-cached.receivedAt<0||Date.now()-cached.receivedAt>MAX_CACHE_AGE)return null;
    const validated=normaliseWeatherPayload(cached.raw,cached.receivedAt);
    return{...validated,status:'stale',error:'Refreshing saved forecast'};
  }catch{return null;}
}

function makeWeatherArt(document,kind){
  const art=document.createElement('span');art.className='ah-wm-art';art.dataset.condition=kind;art.setAttribute('aria-hidden','true');
  const shape=name=>{const el=document.createElement('span');el.className=name+' ah-wm-moving';art.append(el);return el;};
  if(kind==='sunny'||kind==='partly'){const sun=shape('ah-wm-sun'),rays=document.createElement('span');rays.className='ah-wm-rays ah-wm-moving';sun.append(rays);}
  if(['cloudy','rain','snow','thunder'].includes(kind))shape('ah-wm-cloud ah-wm-cloud-back');
  if(['partly','cloudy','rain','snow','thunder'].includes(kind))shape('ah-wm-cloud');
  if(kind==='rain'||kind==='thunder')for(let i=0;i<6;i++)shape('ah-wm-drop').style.setProperty('--ah-wm-i',i);
  if(kind==='snow')for(let i=0;i<7;i++)shape('ah-wm-flake').style.setProperty('--ah-wm-i',i);
  if(kind==='thunder'){const bolt=shape('ah-wm-bolt'),icon=document.createElement('i');icon.dataset.lucide='zap';icon.setAttribute('aria-hidden','true');bolt.append(icon);}
  return art;
}

export async function initLiveData({root,invoke,SeelenCommand,subscribe,SeelenEvent}={}){
  // Native usage uses fixed read-only Seelen commands/events, never Run or a shell.
  if(!root||root.dataset.ahLiveDataReady)return()=>{};
  root.dataset.ahLiveDataReady='true';
  const document=root.ownerDocument,win=document.defaultView,forecast=root.querySelector('.ah-forecast'),weatherPanel=root.querySelector('.ah-weather');
  const panel=root.querySelector('.ah-window'),content=root.querySelector('.ah-window-content');
  if(!forecast||!weatherPanel||!panel||!content)return()=>{};
  let weather=config.weather.enabled?readCache():null,gpu={status:'unavailable',temperatureC:null,name:'NVIDIA GPU'},weatherTimer,gpuTimer,stopped=false,selectedDate=null,queued=false,weatherBusy=false,gpuBusy=false;
  let nativeCpu={...normaliseNativeCpuUsage(null),status:'pending',initialComplete:false},nativeGpu={...normaliseNativeGpuUsage(null),status:'pending',initialComplete:false};
  const pending=new Set();
  const node=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=value;return el;};
  const icons=()=>{if(win.lucide?.createIcons)win.lucide.createIcons({attrs:{width:16,height:16}});};
  const timeLabel=value=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:config.timezone}).format(new Date(value));
  const dateLabel=date=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  const temperature=value=>Number.isFinite(value)?Math.round(value)+'°':'Unavailable';
  const gpuText=()=>gpu.temperatureC===null?'Unavailable':temperature(gpu.temperatureC)+'C'+(gpu.status==='ok'?'':' · stale');
  const usageText=reading=>reading.usagePct===null?'Unavailable':Math.round(reading.usagePct)+'%';
  const status=node('p','ah-live-weather-status');status.style.cssText='font-size:11px;color:#a9bfd9;margin:10px 0 0;';status.setAttribute('aria-live','polite');
  const attribution=node('a','ah-live-weather-source','Open-Meteo');attribution.href='https://open-meteo.com/';attribution.target='_blank';attribution.rel='noopener noreferrer';attribution.style.cssText='font-size:11px;color:#b6d6ef;display:inline-block;margin-top:6px;';
  weatherPanel.append(status,attribution);

  async function fetchJSON(url,timeout){
    const controller=new AbortController();pending.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await fetch(url,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);const raw=await response.text();if(raw.length>100000)throw new Error('Unexpected response size');return JSON.parse(raw);}
    finally{clearTimeout(timer);pending.delete(controller);}
  }
  function renderWeather(){
    const hasData=Boolean(weather?.daily?.length),stale=weather?.status==='stale';
    const badge=weatherPanel.querySelector('.ah-sample');text(badge,hasData?(stale?'Cached forecast':'Live forecast'):'Weather unavailable');
    weatherPanel.setAttribute('aria-label',config.weather.city+' seven-day weather forecast');
    text(status,hasData?(stale?'Cached data · ':'Updated ')+timeLabel(weather.receivedAt)+(stale?(weather.error==='Refreshing saved forecast'?' · refreshing':' · refresh unavailable'):'' ):config.weather.enabled?'Forecast unavailable. Waiting for a connection.':'Forecast disabled. Enable weather in your local configuration.');
    forecast.replaceChildren();
    if(!hasData){const empty=node('span','','No forecast data');empty.style.cssText='font-size:11px;color:#a9bfd9;grid-column:1/-1;padding:14px 0;';forecast.append(empty);return;}
    weather.daily.forEach((day,index)=>{
      const button=node('button','ah-weather-day cursor-interaction');button.type='button';button.dataset.weather=String(index);button.dataset.liveWeatherDate=day.date;button.dataset.condition=day.condition;
      button.setAttribute('aria-label',(stale?'Cached forecast':'Forecast')+', '+dateLabel(day.date)+', '+day.label+', high '+Math.round(day.maxC)+', low '+Math.round(day.minC)+' degrees Celsius');
      const label=node('span','',new Intl.DateTimeFormat('en-AU',{weekday:'short',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))),range=node('span');
      range.append(node('strong','',temperature(day.maxC)),node('em','',temperature(day.minC)));
      button.append(label,makeWeatherArt(document,day.condition),range);forecast.append(button);
    });
    icons();renderOpenPanel();
  }
  function renderSensors(){
    root.querySelectorAll('.ah-sensor').forEach(button=>{
      const isGpu=button.querySelector('span')?.textContent.includes('GPU');
      text(button.querySelector('strong'),isGpu?gpuText():'Unavailable');
      let usage=button.querySelector('.ah-native-usage');
      if(!usage){
        usage=node('span','ah-native-usage');
        const line=node('span','ah-native-usage-line');
        line.append(node('span','ah-native-usage-label',isGpu?'GPU usage':'CPU usage'),node('strong','ah-native-usage-value','Unavailable'));
        const track=node('span','ah-native-usage-track');track.setAttribute('role','meter');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
        track.style.display='none';
        const fill=node('span','ah-native-usage-fill');fill.style.width='0';track.append(fill);usage.append(line,track);button.append(usage);
      }
      const reading=isGpu?nativeGpu:nativeCpu,label=isGpu?'GPU usage':'CPU usage';
      text(usage.querySelector('.ah-native-usage-value'),usageText(reading));
      const track=usage.querySelector('.ah-native-usage-track');track.style.display=reading.usagePct===null?'none':'block';
      if(reading.usagePct!==null){track.setAttribute('aria-valuenow',String(reading.usagePct));track.setAttribute('aria-label',label+', Seelen host reading');usage.querySelector('.ah-native-usage-fill').style.width=reading.usagePct+'%';}
      else track.removeAttribute('aria-valuenow');
      button.setAttribute('aria-label',(isGpu?'GPU temperature: '+gpuText():'CPU temperature: unavailable')+'. '+label+': '+usageText(reading)+'. Seelen host reported value.');
    });
    renderOpenPanel();
  }
  function buttonClose(){const button=node('button','ah-primary cursor-interaction','Back home');button.type='button';button.dataset.action='close';return button;}
  function renderOpenPanel(){
    if(panel.dataset.panel==='sensors'){
      let details=content.querySelector('.ah-live-sensor-details');
      if(!details){details=node('div','ah-live-sensor-details');details.append(node('span','ah-panel-badge','Hardware readings'),node('h3','','System pulse'));
        const readings=node('div','ah-category-tags');readings.append(node('span','ah-live-cpu','CPU temperature: unavailable'),node('span','ah-live-gpu'),node('span','ah-native-cpu-usage'),node('span','ah-native-gpu-usage'));details.append(readings,node('p','ah-native-cpu-info'),node('p','ah-live-gpu-info'),node('p','ah-native-usage-source'),node('p','ah-live-gpu-status'));const actions=node('div','ah-panel-actions');actions.append(buttonClose());details.append(actions);content.replaceChildren(details);}
      text(details.querySelector('.ah-live-gpu'),'GPU temperature: '+gpuText());
      text(details.querySelector('.ah-native-cpu-usage'),'CPU usage: '+usageText(nativeCpu));
      text(details.querySelector('.ah-native-gpu-usage'),'GPU usage: '+usageText(nativeGpu));
      text(details.querySelector('.ah-native-cpu-info'),nativeCpu.name+(nativeCpu.validCoreCount?' · Average of '+nativeCpu.validCoreCount+' / '+nativeCpu.totalCoreCount+' cores reported':''));
      const memory=Number.isFinite(nativeGpu.dedicatedMemoryUsedBytes)&&Number.isFinite(nativeGpu.dedicatedMemoryTotalBytes)?Math.round(nativeGpu.dedicatedMemoryUsedBytes/1048576)+' / '+Math.round(nativeGpu.dedicatedMemoryTotalBytes/1048576)+' MiB VRAM':'';
      text(details.querySelector('.ah-live-gpu-info'),[nativeGpu.name,memory].filter(Boolean).join(' · '));
      text(details.querySelector('.ah-native-usage-source'),'Usage source: Seelen host, last reported values.');
      text(details.querySelector('.ah-live-gpu-status'),gpu.updatedAt?'GPU temperature '+(gpu.status==='ok'?'reported ':'last read ')+timeLabel(gpu.updatedAt)+' · NVIDIA telemetry. CPU temperature is unavailable.':'GPU temperature is not connected. CPU temperature is deferred.');
    }
    if(panel.dataset.panel==='weather'){
      const day=weather?.daily?.find(item=>item.date===selectedDate)||weather?.daily?.[0];
      const key=(weather?.receivedAt||'none')+':'+(day?.date||'none')+':'+(weather?.status||'unavailable');
      if(content.querySelector('.ah-live-weather-detail')?.dataset.key===key)return;
      const details=node('div','ah-live-weather-detail');details.dataset.key=key;
      details.append(node('span','ah-panel-badge',day?(weather.status==='stale'?'Cached '+config.weather.city+' forecast':config.weather.city+' forecast'):'Forecast unavailable'),node('h3','',day?dateLabel(day.date)+' · '+day.label:config.weather.city+' outlook'));
      if(day){const detail=node('div','ah-wm-detail'),stage=node('div','ah-wm-stage');stage.dataset.condition=day.condition;stage.setAttribute('role','img');stage.setAttribute('aria-label',day.label);stage.append(makeWeatherArt(document,day.condition));detail.append(stage);
        const summary=node('div','ah-wm-selection');summary.append(node('span','',temperature(day.maxC)+' high / '+temperature(day.minC)+' low'),node('span','ah-wm-range',day.rainChancePct===null?'':'Rain chance '+Math.round(day.rainChancePct)+'%'));detail.append(summary);details.append(detail,node('p','',(weather.status==='stale'?'Cached forecast from ':'Updated ')+timeLabel(weather.receivedAt)+' · Open-Meteo.'));
      }else details.append(node('div','ah-wm-detail'),node('p','','A forecast is not available. The next update will retry automatically.'));
      const sourceLink=node('a','ah-live-weather-source','Weather data by Open-Meteo');sourceLink.href='https://open-meteo.com/';sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';details.append(sourceLink);
      const actions=node('div','ah-panel-actions');actions.append(buttonClose());details.append(actions);content.replaceChildren(details);icons();
    }
  }
  async function updateWeather(){
    if(!config.weather.enabled||stopped||document.hidden||weatherBusy)return;
    weatherBusy=true;
    let delay=WEATHER_INTERVAL;
    try{const raw=await fetchJSON(WEATHER_URL,10000);if(stopped)return;weather=normaliseWeatherPayload(raw);try{localStorage.setItem(CACHE_KEY,JSON.stringify({schemaVersion:1,receivedAt:weather.receivedAt,raw}));}catch{} }
    catch{if(stopped)return;weather=weather&&Date.now()-weather.receivedAt<=MAX_CACHE_AGE?{...weather,status:'stale',error:'Forecast refresh failed'}:null;delay=60000;}
    finally{weatherBusy=false;}
    renderWeather();if(!stopped&&!document.hidden)weatherTimer=setTimeout(updateWeather,delay);
  }
  async function updateGpu(){
    if(!ENABLE_GPU_TEMPERATURE_HELPER||stopped||document.hidden||gpuBusy)return;
    gpuBusy=true;
    try{const raw=await fetchJSON(GPU_URL,2500);if(stopped)return;gpu=normaliseGpuPayload(raw);}
    catch{if(stopped)return;gpu={...gpu,status:gpu.temperatureC===null?'unavailable':'stale'};}
    finally{gpuBusy=false;}
    renderSensors();if(!stopped&&!document.hidden)gpuTimer=setTimeout(updateGpu,GPU_INTERVAL);
  }
  const onClick=event=>{const card=event.target.closest('.ah-weather-day[data-live-weather-date]');if(card&&forecast.contains(card))selectedDate=card.dataset.liveWeatherDate;};
  const onVisibility=()=>{clearTimeout(weatherTimer);clearTimeout(gpuTimer);if(document.hidden){pending.forEach(controller=>controller.abort());return;}updateWeather();updateGpu();};
  const queue=()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;if(!stopped)renderOpenPanel();});}};
  const observer=new MutationObserver(queue);observer.observe(content,{childList:true,subtree:true});observer.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  root.addEventListener('click',onClick,true);document.addEventListener('visibilitychange',onVisibility);
  const emitUsage=()=>root.dispatchEvent(new win.CustomEvent('aurora:usage-updated',{detail:{cpu:{...nativeCpu},gpu:{...nativeGpu}}}));
  const usageConnection=connectNativeUsage({invoke,subscribe,SeelenCommand,SeelenEvent,onCpu:reading=>{if(stopped)return;nativeCpu=reading;renderSensors();emitUsage();},onGpu:reading=>{if(stopped)return;nativeGpu=reading;renderSensors();emitUsage();}});
  renderWeather();renderSensors();updateWeather();updateGpu();
  return()=>{stopped=true;usageConnection.dispose();clearTimeout(weatherTimer);clearTimeout(gpuTimer);pending.forEach(controller=>controller.abort());observer.disconnect();root.removeEventListener('click',onClick,true);document.removeEventListener('visibilitychange',onVisibility);};
}
