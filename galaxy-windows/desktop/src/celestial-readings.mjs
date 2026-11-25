const validConditions = new Set(['sunny','partly','cloudy','rain','snow','thunder']);
const text = node => node?.textContent?.trim() || '';
export function monthOrbit(date) {
  const days = new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
  const day = date.getDate();
  const start = new Date(date.getFullYear(),date.getMonth(),1);
  const next = new Date(date.getFullYear(),date.getMonth()+1,1);
  const fraction = (date.getTime()-start.getTime())/(next.getTime()-start.getTime());
  const angle = fraction*Math.PI*2-Math.PI/2;
  return {days,day,fraction,x:Math.cos(angle)*72,y:Math.sin(angle)*54};
}
export function orbitalRate(percent) {
  return Number.isFinite(percent) && percent>=0 && percent<=100 ? 1+4*percent/100 : 1;
}
export function readWeather(widget) {
  const status = text(widget?.querySelector('.ah-live-weather-status'));
  const now = [...(widget?.querySelectorAll('.ah-weather-day[data-live-weather-date]')||[])].find(el=>text(el.firstElementChild).toLowerCase()==='now');
  const city = now?.getAttribute('aria-label')?.match(/^Now in ([^,]+),/i)?.[1] || (widget?.getAttribute('aria-label') || '').match(/^(.+?) current weather/i)?.[1] || text(widget?.querySelector('.ah-section-head h2')).replace(/\s+outlook$/i,'');
  const state = text(now?.querySelector('em'));
  if (state!=='current' || !validConditions.has(now?.dataset.condition)) {
    const stale=state==='stale'||/current stale/i.test(status);
    return {state:stale?'stale':'unavailable',condition:'unknown',label:stale?'Stale reading':'Unavailable',city,temperature:''};
  }
  const label=now.getAttribute('aria-label')?.split(',')[1]?.trim()||({sunny:'Clear sky',partly:'Partly cloudy',cloudy:'Cloudy',rain:'Rain',snow:'Snow',thunder:'Thunderstorm'})[now.dataset.condition];
  return {state:'current',condition:now.dataset.condition,label,city,temperature:text(now.querySelector('strong'))};
}
function readCpu(widget) {
  const label=[...(widget?.querySelectorAll('.ah-native-usage-label')||[])].find(el=>/^cpu usage$/i.test(text(el)));
  const val=label?.closest('.ah-native-usage')?.querySelector('[role=meter]')?.getAttribute('aria-valuenow');
  if(val==null||val.trim()==='')return null;
  const n=Number(val);return Number.isFinite(n)&&n>=0&&n<=100 ? n : null;
}
export function installWorldIndicators({root,controls,stage}){
  const doc=root.ownerDocument,win=doc.defaultView;
  function model(id){return controls.get(id).button.querySelector('.ag-model');}
  function add(parent,cls){const node=doc.createElement('i');node.className=cls;node.setAttribute('aria-hidden','true');parent.append(node);return node;}
  const system=model('system'), calendar=model('calendar'),weather=model('weather');
  const plane=add(system,'ag-binary-plane'), disc=add(plane,'ag-binary-disc');add(disc,'ag-binary-a');add(disc,'ag-binary-b');
  const sun=add(calendar,'ag-month-sun'), atmo=add(weather,'ag-planet-atmosphere');add(atmo,'ag-weather-clouds');add(atmo,'ag-precipitation');
  const motionQuery=win.matchMedia('(prefers-reduced-motion: reduce)');
  const spin=disc.animate?.([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:22000,iterations:Infinity,easing:'linear'});
  let frame=0,rate=1,target=1,stamp=0,lastMinute='',disposed=false,lastState,wasMoving;
  const moving=()=>!doc.hidden&&root.dataset.motion==='full'&&root.dataset.paused!=='true'&&!motionQuery.matches;
  function smoothRate(t){
    frame=0;if(disposed||!moving()||!spin)return;
    const dt=Math.min(.12,Math.max(.01,(t-(stamp||t-16))/1000));stamp=t;
    rate+=(target-rate)*(1-Math.exp(-dt/.65));
    if(Math.abs(target-rate)<.008)rate=target;
    spin.updatePlaybackRate(rate);
    if(rate!==target)frame=win.requestAnimationFrame(smoothRate);
  }
  function syncMotion(){
    const run=moving();
    if(run!==wasMoving){wasMoving=run;if(run){spin?.play();stamp=0;}else{spin?.pause();win.cancelAnimationFrame(frame);frame=0;}}
    if(run&&spin&&!frame&&rate!==target){stamp=0;frame=win.requestAnimationFrame(smoothRate);}
  }
  function update(date=new Date()){
    const cpu=readCpu(root.querySelector('.ah-sensors')), forecast=readWeather(root.querySelector('.ah-weather'));
    target=orbitalRate(cpu);syncMotion();
    const key=[date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes()].join('/');
    if(key!==lastMinute){
      lastMinute=key;const orbit=monthOrbit(date);
      sun.style.setProperty('--month-x',orbit.x.toFixed(2)+'%');sun.style.setProperty('--month-y',orbit.y.toFixed(2)+'%');
      sun.title='Day '+orbit.day+' of '+orbit.days+' in the local month';calendar.dataset.monthDay=String(orbit.day);
    }
    weather.dataset.sky=forecast.condition;weather.dataset.reading=forecast.state;
    system.dataset.cpu=cpu===null?'unavailable':String(cpu);
    lastState={cpu,weather:forecast,month:monthOrbit(date)};
    return lastState;
  }
  stage.__auroraWorldIndicators={get state(){return {...lastState,rate,target,mode:moving()?'full':'still',binaryPhaseMs:spin?.currentTime??null};}};
  const change=()=>syncMotion();
  motionQuery.addEventListener?.('change',change);doc.addEventListener('visibilitychange',change);
  return {update,dispose(){disposed=true;win.cancelAnimationFrame(frame);spin?.cancel();motionQuery.removeEventListener?.('change',change);doc.removeEventListener('visibilitychange',change);delete stage.__auroraWorldIndicators;plane.remove();sun.remove();atmo.remove();}};
}
