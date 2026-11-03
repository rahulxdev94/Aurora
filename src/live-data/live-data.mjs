import {config} from '../config.mjs';
/* Desktop-only adapter. This module is never part of the in-chat preview. */
export const WEATHER_URL='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(config.weather.latitude),longitude:String(config.weather.longitude),current:'temperature_2m,weather_code',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:config.timezone,forecast_days:'7',timeformat:'unixtime'});
export const GPU_URL='http://127.0.0.1:18764/status.json';
export const ENABLE_GPU_TEMPERATURE_HELPER=false;
const WEATHER_INTERVAL=15*60*1000,MAX_CACHE_AGE=24*60*60*1000,GPU_INTERVAL=5000,CACHE_KEY='auroraWeather.v1.'+config.weather.city+'.'+config.timezone;
const validNumber=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
export const CURRENT_WEATHER_MAX_AGE=45*60*1000;
const weatherDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function providerTime(value,offset){
  if(validNumber(value,0,253402300799))return value*1000;
  if(typeof value!=='string')return NaN;
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
    const local=value.replace(/(?:Z|[+-]\d{2}:\d{2})$/,''),wall=Date.parse(local+'Z');
    return Number.isFinite(wall)&&new Date(wall).toISOString().startsWith(local)?Date.parse(value):NaN;
  }
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)||!validNumber(offset,-50400,50400))return NaN;
  const wallTime=Date.parse(value+'Z');
  if(!Number.isFinite(wallTime)||!new Date(wallTime).toISOString().startsWith(value))return NaN;
  return wallTime-offset*1000;
}
export function currentWeatherState(weather,now=Date.now()){
  const current=weather?.current,at=Date.parse(current?.time),age=now-at;
  if(!current||!Number.isFinite(at)||age < -5*60*1000)return{status:'unavailable',current:null};
  return{status:age>CURRENT_WEATHER_MAX_AGE||weather.status!=='ok'?'stale':'ok',current};
}

export function mapWeatherCode(code){
  const map={0:['sunny','Clear sky'],1:['partly','Mainly clear'],2:['partly','Partly cloudy'],3:['cloudy','Overcast'],45:['cloudy','Fog'],48:['cloudy','Rime fog'],51:['rain','Light drizzle'],53:['rain','Drizzle'],55:['rain','Heavy drizzle'],56:['rain','Freezing drizzle'],57:['rain','Heavy freezing drizzle'],61:['rain','Light rain'],63:['rain','Rain'],65:['rain','Heavy rain'],66:['rain','Freezing rain'],67:['rain','Heavy freezing rain'],71:['snow','Light snow'],73:['snow','Snow'],75:['snow','Heavy snow'],77:['snow','Snow grains'],80:['rain','Light showers'],81:['rain','Showers'],82:['rain','Heavy showers'],85:['snow','Snow showers'],86:['snow','Heavy snow showers'],95:['thunder','Thunderstorm'],96:['thunder','Thunderstorm with hail'],99:['thunder','Thunderstorm with heavy hail']};
  map[97]=['thunder','Heavy thunderstorm'];
  const [condition,label]=map[code]||['cloudy','Unknown conditions'];return{condition,label};
}

export function normaliseWeatherPayload(raw,receivedAt=Date.now()){
  const daily=raw?.daily;
  if(raw?.timezone!==config.timezone||!daily||!Array.isArray(daily.time)||daily.time.length!==7)throw new Error('Invalid seven-day forecast');
  const dates=daily.time.map(value=>{
    // Daily labels use the provider's request-time offset, including across DST.
    // Current Unix time is an absolute instant and is formatted with the configured zone.
    if(typeof value==='number'&&validNumber(value,0,253402300799)&&validNumber(raw.utc_offset_seconds,-50400,50400))return new Date((value+raw.utc_offset_seconds)*1000).toISOString().slice(0,10);
    return value;
  });
  const days=dates.map((date,i)=>{
    const minC=daily.temperature_2m_min?.[i],maxC=daily.temperature_2m_max?.[i],weatherCode=daily.weather_code?.[i],rain=daily.precipitation_probability_max?.[i];
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validNumber(minC,-80,65)||!validNumber(maxC,-80,65)||minC>maxC||!Number.isInteger(weatherCode))throw new Error('Invalid forecast day');
    const dateMs=Date.parse(date+'T00:00:00Z');
    if(!Number.isFinite(dateMs)||new Date(dateMs).toISOString().slice(0,10)!==date)throw new Error('Invalid forecast date');
    if(i&&dateMs-Date.parse(dates[i-1]+'T00:00:00Z')!==86400000)throw new Error('Forecast dates are not consecutive');
    return{date,minC,maxC,weatherCode,rainChancePct:validNumber(rain,0,100)?rain:null,...mapWeatherCode(weatherCode)};
  });
  const current=raw.current;
  const currentTime=providerTime(current?.time,raw.utc_offset_seconds),currentCode=mapWeatherCode(current?.weather_code);
  const currentValid=current&&validNumber(current.temperature_2m,-80,65)&&Number.isInteger(current.weather_code)&&currentCode.label!=='Unknown conditions'&&Number.isFinite(currentTime);
  return{schemaVersion:1,city:config.weather.city,timezone:config.timezone,receivedAt,status:'ok',error:null,current:currentValid?{temperatureC:current.temperature_2m,weatherCode:current.weather_code,...currentCode,time:new Date(currentTime).toISOString()}:null,daily:days};
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
  let weather=config.weather.enabled?readCache():null,gpu={status:'unavailable',temperatureC:null,name:'NVIDIA GPU'},weatherTimer,weatherAgeTimer,gpuTimer,stopped=false,selectedDate=null,queued=false,weatherBusy=false,gpuBusy=false,weatherViewKey='';
  let nativeCpu={...normaliseNativeCpuUsage(null),status:'pending',initialComplete:false},nativeGpu={...normaliseNativeGpuUsage(null),status:'pending',initialComplete:false};
  const pending=new Set();
  const node=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=value;return el;};
  const icons=()=>{if(win.lucide?.createIcons)win.lucide.createIcons({attrs:{width:16,height:16}});};
  const timeLabel=value=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:config.timezone}).format(new Date(value));
  const dateLabel=date=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  const clockLabel=value=>new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone:config.timezone}).format(new Date(value));
  const temperature=value=>Number.isFinite(value)?Math.round(value)+'°':'Unavailable';
  const gpuText=()=>gpu.temperatureC===null?'Unavailable':temperature(gpu.temperatureC)+'C'+(gpu.status==='ok'?'':' · stale');
  const usageText=reading=>reading.usagePct===null?'Unavailable':Math.round(reading.usagePct)+'%';
  const footer=node('div','ah-live-weather-footer');footer.style.cssText='display:flex;align-items:center;gap:6px;margin-top:4px;min-width:0;height:15px;';
  const status=node('p','ah-live-weather-status');status.style.cssText='font-size:10px;line-height:15px;color:#a9bfd9;margin:0;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';status.setAttribute('aria-live','polite');
  const attribution=node('a','ah-live-weather-source','Open-Meteo');attribution.href='https://open-meteo.com/';attribution.target='_blank';attribution.rel='noopener noreferrer';attribution.style.cssText='font-size:10px;color:#b6d6ef;flex:none;';
  const refresh=node('button','ah-live-weather-refresh cursor-interaction','↻');refresh.type='button';refresh.dataset.liveWeatherRefresh='true';refresh.setAttribute('aria-label','Refresh '+config.weather.city+' weather');refresh.title='Refresh '+config.weather.city+' weather. Automatic refresh every 15 minutes.';refresh.style.cssText='font-size:15px;line-height:15px;padding:0 3px;color:#b6d6ef;background:transparent;border:0;flex:none;';
  footer.append(status,attribution,refresh);weatherPanel.append(footer);

  async function fetchJSON(url,timeout){
    const controller=new AbortController();pending.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{const response=await fetch(url,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);const raw=await response.text();if(raw.length>100000)throw new Error('Unexpected response size');return JSON.parse(raw);}
    finally{clearTimeout(timer);pending.delete(controller);}
  }
  function renderWeather(){
    const hasData=Boolean(weather?.daily?.length),stale=weather?.status==='stale';
    const today=weatherDate(Date.now()),currentState=currentWeatherState(weather),current=currentState.current;
    weatherViewKey=today+':'+currentState.status;
    const badge=weatherPanel.querySelector('.ah-sample');text(badge,hasData?(stale?'Cached forecast':'Current + forecast'):'Weather unavailable');
    weatherPanel.setAttribute('aria-label',config.weather.city+' current weather and seven-day forecast');
    text(status,currentState.status==='ok'?'Now '+clockLabel(current.time)+' · '+config.weather.city:currentState.status==='stale'?'Current stale · '+clockLabel(current.time):hasData?'Current unavailable · '+config.weather.city:config.weather.enabled?'Weather unavailable':'Weather disabled');
    status.title=hasData?[config.weather.city+' model conditions, not a local rain sensor.',current?'Condition time '+timeLabel(current.time):'Current condition unavailable.','Forecast fetched '+timeLabel(weather.receivedAt),stale?'Refresh unavailable.':'Checks every 15 minutes.'].join(' '):config.weather.enabled?'Waiting for a weather connection.':'Weather is disabled. Enable it in your local configuration.';
    refresh.disabled=!config.weather.enabled||weatherBusy;
    forecast.replaceChildren();
    if(!hasData){const empty=node('span','','No forecast data');empty.style.cssText='font-size:11px;color:#a9bfd9;grid-column:1/-1;padding:14px 0;';forecast.append(empty);return;}
    weather.daily.filter(day=>day.date>=today).forEach((day,index)=>{
      const isToday=day.date===today,nowReady=isToday&&currentState.status==='ok',condition=isToday?(nowReady?current.condition:'unavailable'):day.condition;
      const button=node('button','ah-weather-day cursor-interaction');button.type='button';button.dataset.weather=String(index);button.dataset.liveWeatherDate=day.date;button.dataset.condition=condition;
      button.setAttribute('aria-label',isToday?(nowReady?'Now in '+config.weather.city+', '+current.label+', '+Math.round(current.temperatureC)+' degrees Celsius. Model time '+timeLabel(current.time)+'. Open for today\'s forecast.':'Current weather '+currentState.status+'. Open for today\'s forecast.'):(stale?'Cached forecast':'Forecast')+', '+dateLabel(day.date)+', '+day.label+', high '+Math.round(day.maxC)+', low '+Math.round(day.minC)+' degrees Celsius');
      const label=node('span','',isToday?'Now':new Intl.DateTimeFormat('en-AU',{weekday:'short',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))),range=node('span');
      range.append(node('strong','',isToday?(nowReady?temperature(current.temperatureC):'N/A'):temperature(day.maxC)),node('em','',isToday?(nowReady?'current':currentState.status==='stale'?'stale':'no data'):temperature(day.minC)));
      const art=makeWeatherArt(document,condition);if(condition==='unavailable'){art.textContent='?';art.style.cssText='display:grid;place-items:center;font-size:20px;color:#91a3b8;';}
      button.append(label,art,range);forecast.append(button);
    });
    icons();renderOpenPanel();
  }
  function renderSensors(){
    root.querySelectorAll('.ah-sensor').forEach(button=>{
      const isGpu=button.querySelector('span')?.textContent.includes('GPU');
      if(isGpu&&gpu.temperatureC!==null)text(button.querySelector('span'),'GPU core temperature');
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
      button.setAttribute('aria-label',(isGpu?'GPU core temperature: '+gpuText():'CPU temperature: unavailable')+'. '+label+': '+usageText(reading)+'. Seelen host reported value.');
    });
    renderOpenPanel();
  }
  function buttonClose(){const button=node('button','ah-primary cursor-interaction','Back home');button.type='button';button.dataset.action='close';return button;}
  function renderOpenPanel(){
    if(panel.dataset.panel==='sensors'){
      let details=content.querySelector('.ah-live-sensor-details');
      if(!details){details=node('div','ah-live-sensor-details');details.append(node('span','ah-panel-badge','Hardware readings'),node('h3','','System pulse'));
        const readings=node('div','ah-category-tags');readings.append(node('span','ah-live-cpu','CPU temperature: unavailable'),node('span','ah-live-gpu'),node('span','ah-native-cpu-usage'),node('span','ah-native-gpu-usage'));details.append(readings,node('p','ah-native-cpu-info'),node('p','ah-live-gpu-info'),node('p','ah-native-usage-source'),node('p','ah-live-gpu-status'));const actions=node('div','ah-panel-actions');actions.append(buttonClose());details.append(actions);content.replaceChildren(details);}
      text(details.querySelector('.ah-live-gpu'),'GPU core temperature: '+gpuText());
      text(details.querySelector('.ah-native-cpu-usage'),'CPU usage: '+usageText(nativeCpu));
      text(details.querySelector('.ah-native-gpu-usage'),'GPU usage: '+usageText(nativeGpu));
      text(details.querySelector('.ah-native-cpu-info'),nativeCpu.name+(nativeCpu.validCoreCount?' · Average of '+nativeCpu.validCoreCount+' / '+nativeCpu.totalCoreCount+' cores reported':''));
      const memory=Number.isFinite(nativeGpu.dedicatedMemoryUsedBytes)&&Number.isFinite(nativeGpu.dedicatedMemoryTotalBytes)?Math.round(nativeGpu.dedicatedMemoryUsedBytes/1048576)+' / '+Math.round(nativeGpu.dedicatedMemoryTotalBytes/1048576)+' MiB VRAM':'';
      text(details.querySelector('.ah-live-gpu-info'),[nativeGpu.name,memory].filter(Boolean).join(' · '));
      text(details.querySelector('.ah-native-usage-source'),'Usage source: Seelen host, last reported values.');
      text(details.querySelector('.ah-live-gpu-status'),gpu.updatedAt?'GPU core temperature '+(gpu.status==='ok'?'reported ':'last read ')+timeLabel(gpu.updatedAt)+' · NVIDIA telemetry. CPU temperature is unavailable.':'GPU core temperature is not connected. CPU temperature is deferred.');
    }
    if(panel.dataset.panel==='weather'){
      const day=weather?.daily?.find(item=>item.date===selectedDate)||weather?.daily?.find(item=>item.date>=weatherDate(Date.now()));
      const today=day?.date===weatherDate(Date.now()),currentState=currentWeatherState(weather),current=currentState.current,nowReady=currentState.status==='ok';
      const key=(weather?.receivedAt||'none')+':'+(day?.date||'none')+':'+(weather?.status||'unavailable')+':'+today+':'+currentState.status;
      if(content.querySelector('.ah-live-weather-detail')?.dataset.key===key)return;
      const details=node('div','ah-live-weather-detail');details.dataset.key=key;
      details.append(node('span','ah-panel-badge',day?(today?config.weather.city+' current conditions':weather.status==='stale'?'Cached '+config.weather.city+' forecast':config.weather.city+' forecast'):'Forecast unavailable'),node('h3','',day?(today?'Now · '+(nowReady?current.label:'current '+currentState.status):dateLabel(day.date)+' · '+day.label):config.weather.city+' outlook'));
      if(day){const condition=today?(nowReady?current.condition:'unavailable'):day.condition,detail=node('div','ah-wm-detail'),stage=node('div','ah-wm-stage');stage.dataset.condition=condition;stage.setAttribute('role','img');stage.setAttribute('aria-label',today?(nowReady?current.label:'Current weather '+currentState.status):day.label);stage.append(makeWeatherArt(document,condition));detail.append(stage);
        const summary=node('div','ah-wm-selection');
        if(today){summary.append(node('span','',nowReady?temperature(current.temperatureC)+' now':'Current weather '+currentState.status),node('span','ah-wm-range',current?'Model time '+timeLabel(current.time):'No valid current condition returned.'));}
        else summary.append(node('span','',temperature(day.maxC)+' high / '+temperature(day.minC)+' low'),node('span','ah-wm-range',day.rainChancePct===null?'':'Rain chance '+Math.round(day.rainChancePct)+'%'));
        detail.append(summary);details.append(detail);
        if(today)details.append(node('h4',"",'Today’s forecast'),node('p','',day.label+' · '+temperature(day.maxC)+' high / '+temperature(day.minC)+' low'+(day.rainChancePct===null?'':' · rain chance '+Math.round(day.rainChancePct)+'%')),node('p','',"Today’s forecast represents the most severe condition expected across the day. Current conditions use the configured city’s model data and may differ at your location."));
        details.append(node('p','',(weather.status==='stale'?'Cached forecast from ':'Forecast fetched ')+timeLabel(weather.receivedAt)+' · Open-Meteo. Checks every 15 minutes.'));
      }else details.append(node('div','ah-wm-detail'),node('p','',config.weather.enabled?'A forecast is not available. The next update will retry automatically.':'Weather is disabled in your local configuration.'));
      const sourceLink=node('a','ah-live-weather-source','Weather data by Open-Meteo');sourceLink.href='https://open-meteo.com/';sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';details.append(sourceLink);
      const actions=node('div','ah-panel-actions');actions.append(buttonClose());details.append(actions);content.replaceChildren(details);icons();
    }
  }
  async function updateWeather(){
    if(!config.weather.enabled||stopped||document.hidden||weatherBusy)return;
    clearTimeout(weatherTimer);weatherBusy=true;refresh.disabled=true;
    let delay=WEATHER_INTERVAL;
    try{const raw=await fetchJSON(WEATHER_URL,10000);if(stopped)return;weather=normaliseWeatherPayload(raw);try{localStorage.setItem(CACHE_KEY,JSON.stringify({schemaVersion:1,receivedAt:weather.receivedAt,raw}));}catch{} }
    catch{if(stopped)return;weather=weather&&Date.now()-weather.receivedAt<=MAX_CACHE_AGE?{...weather,status:'stale',error:'Forecast refresh failed'}:null;delay=60000;}
    finally{weatherBusy=false;if(!stopped)refresh.disabled=!config.weather.enabled;}
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
  const onClick=event=>{const refreshButton=event.target.closest('[data-live-weather-refresh]');if(refreshButton&&weatherPanel.contains(refreshButton)){event.preventDefault();event.stopPropagation();updateWeather();return;}const card=event.target.closest('.ah-weather-day[data-live-weather-date]');if(card&&forecast.contains(card))selectedDate=card.dataset.liveWeatherDate;};
  const onVisibility=()=>{clearTimeout(weatherTimer);clearTimeout(gpuTimer);if(document.hidden){pending.forEach(controller=>controller.abort());return;}updateWeather();updateGpu();};
  const queue=()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;if(!stopped)renderOpenPanel();});}};
  const observer=new MutationObserver(queue);observer.observe(content,{childList:true,subtree:true});observer.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  root.addEventListener('click',onClick,true);document.addEventListener('visibilitychange',onVisibility);
  const emitUsage=()=>root.dispatchEvent(new win.CustomEvent('aurora:usage-updated',{detail:{cpu:{...nativeCpu},gpu:{...nativeGpu}}}));
  const usageConnection=connectNativeUsage({invoke,subscribe,SeelenCommand,SeelenEvent,onCpu:reading=>{if(stopped)return;nativeCpu=reading;renderSensors();emitUsage();},onGpu:reading=>{if(stopped)return;nativeGpu=reading;renderSensors();emitUsage();}});
  renderWeather();renderSensors();updateWeather();updateGpu();
  if(config.weather.enabled)weatherAgeTimer=setInterval(()=>{if(!stopped&&!document.hidden&&weatherViewKey!==weatherDate(Date.now())+':'+currentWeatherState(weather).status)renderWeather();},60000);
  return()=>{stopped=true;usageConnection.dispose();clearTimeout(weatherTimer);clearInterval(weatherAgeTimer);clearTimeout(gpuTimer);pending.forEach(controller=>controller.abort());observer.disconnect();root.removeEventListener('click',onClick,true);document.removeEventListener('visibilitychange',onVisibility);footer.remove();delete root.dataset.ahLiveDataReady;};
}
