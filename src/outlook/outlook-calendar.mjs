import {config} from '../config.mjs';
/* Native desktop only. Reads one Seelen-scoped cache; never writes Outlook events. */
export const CACHE_FILENAME='outlook-calendar.json';
export const TIMEZONE=config.timezone;
export const STALE_AFTER_MS=2*60*60*1000;
const POLL_MS=60000,MAX_BYTES=2*1024*1024;
const hasOffset=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value));
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const trim=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function sydneyDate(value){const parts=dateParts.formatToParts(new Date(value));return['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');}
const humanDate=value=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const humanStamp=value=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:TIMEZONE,timeZoneName:'short'}).format(new Date(value));
const humanTime=value=>new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone:TIMEZONE}).format(new Date(value));

export function normaliseCache(input){
  if(typeof input==='string'){if(input.length>MAX_BYTES)throw new Error('Calendar cache is too large');input=JSON.parse(input);}
  if(input?.schema_version!==1||input.source!=='Outlook'||input.timezone!==TIMEZONE||!['ok','error'].includes(input.status)||!hasOffset(input.generated_at))throw new Error('Unsupported calendar cache');
  if(!Array.isArray(input.events)||input.events.length>2000)throw new Error('Invalid calendar event list');
  const success=hasOffset(input.last_success)?input.last_success:null;
  let coverage=null;
  if(input.coverage!==null&&input.coverage!==undefined){
    const {start,end}=input.coverage;
    if(!hasOffset(start)||!hasOffset(end)||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>2*366*86400000)throw new Error('Invalid coverage range');
    coverage={start,end,firstDate:sydneyDate(start),lastDate:sydneyDate(Date.parse(end)-1)};
  }
  if(input.status==='ok'&&(!success||!coverage))throw new Error('Successful cache is missing coverage or refresh time');
  if(input.events.length&&(!success||!coverage))throw new Error('Events are missing their source coverage');
  const keys=new Set(),events=[];
  for(const raw of input.events){
    if(typeof raw?.id!=='string'||!raw.id||raw.id.length>2048||typeof raw.all_day!=='boolean')throw new Error('Invalid event identity');
    let event={id:raw.id,title:trim(raw.title,300)||'Untitled event',allDay:raw.all_day,location:trim(raw.location,240)};
    if(raw.all_day){
      if(!validDay(raw.start_date)||!validDay(raw.end_date_exclusive)||raw.end_date_exclusive<=raw.start_date)throw new Error('Invalid all-day date range');
      const endMs=Date.parse(raw.end_date_exclusive+'T00:00:00Z');
      event={...event,startDate:raw.start_date,endDate:new Date(endMs-86400000).toISOString().slice(0,10),start:raw.start_date,end:raw.end_date_exclusive};
    }else{
      if(!hasOffset(raw.start)||!hasOffset(raw.end)||Date.parse(raw.end)<Date.parse(raw.start))throw new Error('Timed event requires explicit offset and increasing times');
      event={...event,start:raw.start,end:raw.end,startDate:sydneyDate(raw.start),endDate:sydneyDate(Math.max(Date.parse(raw.start),Date.parse(raw.end)-1))};
    }
    const key=event.id+'|'+event.start;
    if(!keys.has(key)){keys.add(key);events.push(event);}
  }
  events.sort((a,b)=>a.startDate.localeCompare(b.startDate)||(a.allDay===b.allDay?(a.allDay?String(a.start).localeCompare(String(b.start)):Date.parse(a.start)-Date.parse(b.start)):a.allDay?-1:1));
  return{schemaVersion:1,source:'Outlook',calendarName:trim(input.calendar_name,100)||'Calendar',timezone:TIMEZONE,generatedAt:input.generated_at,lastSuccess:success,status:input.status,error:input.status==='error'?'Calendar refresh unavailable':null,coverage,events};
}

export function cacheStatus(cache,readError=false,now=Date.now()){
  if(!cache?.lastSuccess)return'unavailable';
  if(readError||cache.status==='error')return'offline';
  const age=now-Date.parse(cache.lastSuccess);
  return age>STALE_AFTER_MS||age< -5*60*1000?'stale':'current';
}
export const eventsOnDate=(cache,date)=>cache?.events.filter(event=>event.startDate<=date&&event.endDate>=date)||[];
export const coveredDate=(cache,date)=>Boolean(cache?.coverage&&date>=cache.coverage.firstDate&&date<=cache.coverage.lastDate);
export function eventTime(event){
  if(event.allDay)return event.startDate===event.endDate?'All day':'All day · '+humanDate(event.startDate)+' to '+humanDate(event.endDate);
  const start=humanTime(event.start),end=humanTime(event.end);
  return event.startDate===event.endDate?start+' to '+end:start+' '+humanDate(event.startDate)+' to '+end+' '+humanDate(event.endDate);
}

const STYLE=`
#aurora-home-preview .aco-status{margin:0 20px 16px;padding:10px 12px;background:#102538;border:1px solid #88bedc24;border-radius:9px;color:#b9cfe1;font-size:11px;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere}
#aurora-home-preview .aco-source{color:#d9eaf5;font-size:12px;font-weight:500}
#aurora-home-preview .aco-status[data-state=stale],#aurora-home-preview .aco-status[data-state=offline]{border-color:#d5b97c55}
#aurora-home-preview .aco-status[data-state=stale] .aco-state,#aurora-home-preview .aco-status[data-state=offline] .aco-state{color:#ead2a1}
#aurora-home-preview .aco-widget-status{font-size:11px;color:#b5cce1;line-height:1.5;margin-top:10px;overflow-wrap:anywhere}
#aurora-home-preview .aco-day-events{padding-bottom:15px;margin-bottom:15px;border-bottom:1px solid #aac9f021}
#aurora-home-preview .aco-day-events h3,#aurora-home-preview .aco-agenda h3{font-size:15px;margin:0 0 9px}
#aurora-home-preview .aco-event-list{display:flex;flex-direction:column;gap:8px}
#aurora-home-preview .aco-event{padding:10px;border-left:2px solid #8fc5ed;border-radius:0 7px 7px 0;background:#6ba4cc0b;min-width:0}
#aurora-home-preview .aco-event-title{font-size:12px;color:#e0edf6;overflow-wrap:anywhere}
#aurora-home-preview .aco-event-meta{font-size:11px;color:#adc4d8;margin-top:4px;overflow-wrap:anywhere}
#aurora-home-preview .aco-empty{font-size:11px;color:#aac1d5;line-height:1.5}
#aurora-home-preview .aco-agenda{margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid #aac9f021}
#aurora-home-preview .aco-agenda-period{font-size:11px;color:#adc4d8;margin-bottom:12px}
#aurora-home-preview .ac-grid button.aco-has-event:before{content:'';position:absolute;left:calc(50% - 8px);bottom:5px;width:4px;height:4px;border-radius:50%;background:currentColor}
@media(max-width:700px){#aurora-home-preview .aco-status{margin:0 13px 13px}}
`;

export async function initOutlookCalendar({root,invoke,SeelenCommand}={}){
  if(!root||typeof invoke!=='function'||!SeelenCommand?.ReadFile||root.dataset.auroraOutlookReady)return()=>{};
  const calendar=root.querySelector('.ah-calendar'),layer=root.querySelector('.ac-layer'),panel=layer?.querySelector('.ac-window');
  if(!calendar||!layer||!panel)return()=>{};
  root.dataset.auroraOutlookReady='true';
  const doc=root.ownerDocument,win=doc.defaultView;
  const create=(tag,className,value)=>{const el=doc.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=value;return el;};
  const put=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  const style=create('style');style.textContent=STYLE;root.append(style);
  const status=create('div','aco-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const source=create('span','aco-source','Outlook · Calendar · Read only'),stateLabel=create('span','aco-state'),refreshed=create('span','aco-refreshed'),coverageLabel=create('span','aco-coverage');status.append(source,stateLabel,refreshed,coverageLabel);
  panel.querySelector('.ac-toolbar').after(status);
  const widgetStatus=create('p','aco-widget-status','Outlook · Loading saved calendar');calendar.querySelector('.ac-open').after(widgetStatus);
  const daySection=create('section','aco-day-events'),dayList=create('div','aco-event-list');daySection.setAttribute('aria-label','Outlook events for selected day');daySection.append(create('h3','','Outlook events'),dayList);panel.querySelector('.ac-task-panel').prepend(daySection);
  const agendaSection=create('section','aco-agenda'),agendaPeriod=create('p','aco-agenda-period'),agendaList=create('div','aco-event-list');agendaSection.append(create('h3','','Outlook events'),agendaPeriod,agendaList);panel.querySelector('.ac-agenda').prepend(agendaSection);
  put(panel.querySelector('[data-ac-view="agenda"]'),'Agenda');put(panel.querySelector('.ac-agenda-head h3'),'Local tasks');
  put(panel.querySelector('.ac-note'),'Outlook events are read-only. Local tasks stay on this PC. Booking reminders remain with Dot.');
  let cache=null,readError=false,stopped=false,busy=false,timer=null,lastRead=0;
  const selectedButton=panel.querySelector('[data-ac-date][aria-pressed="true"]');
  let selected=selectedButton?.dataset.acDate||sydneyDate(Date.now()),monthKey=(panel.querySelector('[data-ac-date]')?.dataset.acDate||selected).slice(0,7);

  function fillList(target,events,empty,agenda=false){
    const fragment=doc.createDocumentFragment();
    if(!events.length)fragment.append(create('p','aco-empty',empty));
    for(const event of events){
      const row=create('article','aco-event');row.append(create('div','aco-event-title',event.title));
      row.append(create('div','aco-event-meta',(agenda?humanDate(event.startDate)+' · ':'')+eventTime(event)));
      if(event.location)row.append(create('div','aco-event-meta',event.location));
      fragment.append(row);
    }
    target.replaceChildren(fragment);
  }
  function render(){
    if(stopped)return;
    const state=cacheStatus(cache,readError),hasCache=Boolean(cache?.lastSuccess);
    status.dataset.state=state;
    put(source,'Outlook · '+(cache?.calendarName||'Calendar')+' · Read only');
    put(stateLabel,{current:'Saved Outlook calendar is up to date',stale:'Saved Outlook calendar is stale (over two hours)',offline:hasCache?'Refresh unavailable · Showing last saved events':'Refresh unavailable',unavailable:'Outlook calendar is not available yet'}[state]);
    put(refreshed,hasCache?'Last refreshed '+humanStamp(cache.lastSuccess):'No successful calendar refresh recorded');
    put(coverageLabel,cache?.coverage?'Synced range: '+humanDate(cache.coverage.firstDate)+' to '+humanDate(cache.coverage.lastDate):'No synced date range');
    put(widgetStatus,'Outlook · '+(hasCache?(state==='current'?'Updated ':'Saved ')+humanStamp(cache.lastSuccess)+(state==='stale'?' · stale':state==='offline'?' · offline':''):'Not synced'));
    const selectedEvents=eventsOnDate(cache,selected);
    const empty=!hasCache?'Outlook events will appear after the first successful refresh.':!coveredDate(cache,selected)?'This date is outside the synced range.':state==='current'?'No Outlook events on this date.':'No events in the saved calendar for this date.';
    fillList(dayList,selectedEvents,empty);
    const monthStart=monthKey+'-01',monthEnd=monthKey+'-31';
    const agendaEvents=cache?.events.filter(event=>event.startDate<=monthEnd&&event.endDate>=monthStart)||[];
    const monthCovered=cache?.coverage&&monthEnd>=cache.coverage.firstDate&&monthStart<=cache.coverage.lastDate;
    put(agendaPeriod,'Saved events for '+new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(monthStart+'T12:00:00Z'))+' · Australia/Sydney');
    fillList(agendaList,agendaEvents,!hasCache?'Outlook events will appear after the first successful refresh.':!monthCovered?'This month is outside the synced range.':state==='current'?'No Outlook events in the synced part of this month.':'No events in the saved calendar for this month.',true);
    panel.querySelectorAll('[data-ac-date]').forEach(button=>{
      const events=eventsOnDate(cache,button.dataset.acDate);button.classList.toggle('aco-has-event',events.length>0);
      if(!button.dataset.acoBaseLabel)button.dataset.acoBaseLabel=button.getAttribute('aria-label')||button.dataset.acDate;
      button.setAttribute('aria-label',button.dataset.acoBaseLabel+(events.length?', '+events.length+' Outlook event'+(events.length===1?'':'s'):''));
    });
  }
  function emit(){root.dispatchEvent(new win.CustomEvent('aurora:outlook-updated',{detail:{state:cacheStatus(cache,readError),eventCount:cache?.events.length||0,lastSuccess:cache?.lastSuccess||null,coverage:cache?.coverage||null}}));}
  async function refresh(){
    if(stopped||busy)return;
    busy=true;lastRead=Date.now();
    try{const raw=await invoke(SeelenCommand.ReadFile,{filename:CACHE_FILENAME});if(stopped)return;const parsed=normaliseCache(raw);cache=!parsed.lastSuccess&&cache?.lastSuccess?{...cache,status:'error',generatedAt:parsed.generatedAt,error:'Calendar refresh unavailable'}:parsed;readError=false;}
    catch{if(stopped)return;readError=true;}
    finally{busy=false;}
    render();emit();
  }
  const onRender=event=>{const state=event.detail;if(!state||!validDay(state.selectedDate))return;selected=state.selectedDate;monthKey=String(state.year).padStart(4,'0')+'-'+String(state.month+1).padStart(2,'0');render();};
  const onOpen=()=>{render();void refresh();};
  const onVisibility=()=>{if(!doc.hidden&&Date.now()-lastRead>=POLL_MS)void refresh();};
  root.addEventListener('aurora:calendar-render',onRender);root.addEventListener('aurora:calendar-open',onOpen);doc.addEventListener('visibilitychange',onVisibility);
  render();emit();await refresh();
  timer=setInterval(()=>{render();if(!doc.hidden)void refresh();},POLL_MS);
  return()=>{stopped=true;clearInterval(timer);root.removeEventListener('aurora:calendar-render',onRender);root.removeEventListener('aurora:calendar-open',onOpen);doc.removeEventListener('visibilitychange',onVisibility);};
}
