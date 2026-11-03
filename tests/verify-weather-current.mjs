import {config} from '../src/config.mjs';
import assert from 'node:assert/strict';
import {normaliseWeatherPayload,currentWeatherState,CURRENT_WEATHER_MAX_AGE,initLiveData,WEATHER_URL,ENABLE_GPU_TEMPERATURE_HELPER} from '../src/live-data/live-data.mjs';

const now=Date.parse('2026-11-03T12:35:00Z');
const raw={timezone:'Australia/Sydney',utc_offset_seconds:39600,current:{time:1793709000,temperature_2m:18.2,weather_code:0},daily:{time:Array.from({length:7},(_,i)=>1793624400+i*86400),weather_code:[95,53,53,3,80,51,0],temperature_2m_max:Array(7).fill(25),temperature_2m_min:Array(7).fill(15),precipitation_probability_max:Array(7).fill(70)}};
const parsed=normaliseWeatherPayload(raw,now);
assert.equal(parsed.current.time,'2026-11-03T12:30:00.000Z');
assert.equal(parsed.daily[0].date,'2026-11-03');
assert.equal(parsed.daily[6].date,'2026-11-09');
assert.equal(parsed.current.condition,'sunny');assert.equal(parsed.daily[0].condition,'thunder');
assert.equal(currentWeatherState(parsed,now).status,'ok');
assert.equal(currentWeatherState(parsed,Date.parse(parsed.current.time)+CURRENT_WEATHER_MAX_AGE+1).status,'stale');
assert.equal(currentWeatherState({...parsed,status:'stale'},now).status,'stale');
assert.equal(currentWeatherState(parsed,Date.parse(parsed.current.time)-6*60000).status,'unavailable');
const legacy={...raw,daily:{...raw.daily,time:parsed.daily.map(day=>day.date)},current:{...raw.current,time:'2026-11-03T23:30'}};
assert.equal(normaliseWeatherPayload(legacy,now).current.time,parsed.current.time);
assert.equal(normaliseWeatherPayload({...legacy,utc_offset_seconds:undefined},now).current,null);
assert.equal(normaliseWeatherPayload({...raw,current:{...raw.current,time:'2026-11-03T23:30+11:00'}},now).current.time,parsed.current.time);
for(const value of [null,'invalid','2026-02-30T23:30+11:00','2026-11-03T29:30',NaN])assert.equal(normaliseWeatherPayload({...raw,current:{...raw.current,time:value}},now).current,null);
for(const code of [null,999,'51',NaN])assert.equal(normaliseWeatherPayload({...raw,current:{...raw.current,weather_code:code}},now).current,null);
assert.equal(normaliseWeatherPayload({...raw,current:null},now).daily.length,7);
const firstDst=Date.parse('2026-04-04T00:00:00+11:00')/1000;
const dst=normaliseWeatherPayload({...raw,daily:{...raw.daily,time:Array.from({length:7},(_,i)=>firstDst+i*86400)}},now);
assert.deepEqual(dst.daily.map(day=>day.date),['2026-04-04','2026-04-05','2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10']);
assert.equal(new URL(WEATHER_URL).searchParams.get('timeformat'),'unixtime');
assert.equal(ENABLE_GPU_TEMPERATURE_HELPER,false);

class Events{
  listeners=new Map();
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);}
}
class Element extends Events{
  constructor(tag='div'){super();this.tag=tag;this.dataset={};this.attrs={};this.children=[];this.className='';this.style={setProperty(){}};this.ownText='';}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join(' ');}
  setAttribute(name,value){this.attrs[name]=String(value);}
  removeAttribute(name){delete this.attrs[name];}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;}}
  replaceChildren(...children){this.ownText='';this.children=[];this.append(...children);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  matches(selector){
    const tag=selector.match(/^[a-z]+/)?.[0];if(tag&&tag!==this.tag)return false;
    for(const match of selector.matchAll(/\.([\w-]+)/g))if(!this.className.split(' ').includes(match[1]))return false;
    for(const match of selector.matchAll(/\[data-([\w-]+)\]/g)){const key=match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(!(key in this.dataset))return false;}
    return true;
  }
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const document=new Events(),root=new Element(),weatherPanel=new Element('section'),forecast=new Element(),badge=new Element(),panel=new Element(),content=new Element();
weatherPanel.className='ah-weather';forecast.className='ah-forecast';badge.className='ah-sample';panel.className='ah-window';content.className='ah-window-content';panel.dataset.panel='weather';
root.ownerDocument=document;root.append(weatherPanel,panel);weatherPanel.append(badge,forecast);panel.append(content);document.hidden=false;document.createElement=tag=>new Element(tag);document.defaultView={CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
let time=now,nextId=0,calls=0,fail=false,cleanup;const timers=new Map(),intervals=new Map(),cache=new Map();
const originals={fetch:globalThis.fetch,localStorage:globalThis.localStorage,MutationObserver:globalThis.MutationObserver,setTimeout,clearTimeout,setInterval,clearInterval,now:Date.now};
Date.now=()=>time;globalThis.fetch=async()=>{calls++;if(fail)throw new Error('offline');return{ok:true,text:async()=>JSON.stringify(raw)};};
globalThis.localStorage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)};
globalThis.MutationObserver=class{observe(){}disconnect(){}};
globalThis.setTimeout=(fn,ms)=>{timers.set(++nextId,{fn,ms});return nextId;};globalThis.clearTimeout=id=>timers.delete(id);
globalThis.setInterval=(fn,ms)=>{intervals.set(++nextId,{fn,ms});return nextId;};globalThis.clearInterval=id=>intervals.delete(id);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const click=target=>root.dispatchEvent({type:'click',target,preventDefault(){},stopPropagation(){}});
try{
  config.weather.enabled=true;
  cleanup=await initLiveData({root});await settle();
  assert.equal(calls,1);assert.equal(forecast.children.length,7);
  assert.equal(forecast.children[0].children[0].textContent,'Now');
  assert.equal(forecast.children[0].dataset.condition,'sunny');
  assert.equal(forecast.children[1].dataset.condition,'rain');
  assert.match(content.textContent,/Now · Clear sky/);assert.match(content.textContent,/Today’s forecast/);assert.match(content.textContent,/Thunderstorm/);
  assert.equal([...timers.values()].filter(timer=>timer.ms===15*60000).length,1);
  const refresh=root.querySelector('.ah-live-weather-refresh');
  fail=true;click(refresh);await settle();
  assert.equal(calls,2);assert.equal(forecast.children.length,7);assert.equal(forecast.children[0].dataset.condition,'unavailable');assert.match(forecast.children[0].textContent,/stale/);
  assert.equal([...timers.values()].filter(timer=>timer.ms===60000).length,1);
  fail=false;click(refresh);await settle();assert.equal(forecast.children[0].dataset.condition,'sunny');
  assert.equal([...timers.values()].filter(timer=>timer.ms===15*60000).length,1,'manual refresh must not duplicate polling loops');
  time=Date.parse(parsed.current.time)+CURRENT_WEATHER_MAX_AGE+1;for(const timer of intervals.values())timer.fn();
  assert.equal(forecast.children[0].dataset.condition,'unavailable','an expired current condition must stop its animation');
  cleanup();cleanup=null;assert.equal(timers.size,0);assert.equal(intervals.size,0);assert.equal(root.querySelector('.ah-live-weather-footer'),null);assert.equal(root.dataset.ahLiveDataReady,undefined);
  config.weather.enabled=false;const beforeDisabled=calls;cleanup=await initLiveData({root});await settle();assert.equal(calls,beforeDisabled,'Default-off weather makes no request, including with a cached forecast');assert.equal(root.querySelector('.ah-live-weather-refresh').disabled,true);assert.match(root.querySelector('.ah-live-weather-status').textContent,/disabled/);assert.equal(intervals.size,0,'Disabled weather has no expiry poll');cleanup();cleanup=null;
}finally{
  config.weather.enabled=false;cleanup?.();Object.assign(globalThis,{fetch:originals.fetch,localStorage:originals.localStorage,MutationObserver:originals.MutationObserver,setTimeout:originals.setTimeout,clearTimeout:originals.clearTimeout,setInterval:originals.setInterval,clearInterval:originals.clearInterval});Date.now=originals.now;
}
console.log('Weather checks passed: current vs daily rendering, valid/invalid and explicit-offset times, DST daily labels, stale/missing/future current conditions, cache-preserving refresh failures, single manual-refresh timer, expiry and disposal. No network, helper or UI calls.');
