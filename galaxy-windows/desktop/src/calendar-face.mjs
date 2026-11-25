const weekdayFormat = new Intl.DateTimeFormat('en-AU', {weekday:'long',timeZone:'UTC'});
const dateFormat = new Intl.DateTimeFormat('en-AU', {day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});

// The existing calendar grid uses a Monday-first local civil week.
export function calendarProgress(date) {
  const day = date.getDate();
  // Format the same civil date used by the bars even if Windows changes zones
  // after these Intl formatters were constructed.
  const civil = new Date(0);
  civil.setUTCFullYear(date.getFullYear(), date.getMonth(), day);
  const monthLength = new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
  const next = new Date(date.getTime());
  next.setHours(24,0,0,0);
  return {
    label:dateFormat.format(civil), weekday:weekdayFormat.format(civil),
    weekDay:(date.getDay()+6)%7+1, day, monthLength, nextMidnight:next.getTime()
  };
}

export function mountCalendarFace({button,reading}) {
  const doc=button.ownerDocument,win=doc.defaultView;
  const make=(cls,text)=>{const span=doc.createElement('span');span.className=cls;if(text)span.textContent=text;return span;};
  const weekday=make('ag-calendar-weekday'),date=doc.createElement('time');
  const grid=make('ag-calendar-meters');
  function meter(name){
    const row=make('ag-calendar-meter'),label=make('ag-calendar-meter-name',name);
    const track=doc.createElement('progress'),count=make('ag-calendar-count');
    track.setAttribute('aria-label',name+' progress');row.append(label,track,count);grid.append(row);
    return (value,max)=>{track.max=max;track.value=value;count.textContent=value+'/'+max;};
  }
  const week=meter('Week'),month=meter('Month');
  reading.classList.add('ag-calendar-face');reading.replaceChildren(weekday,date,grid);
  let timer=0,signature='';
  function refresh(){
    win.clearTimeout(timer);timer=0;
    if(doc.hidden)return;
    const now=new win.Date(),progress=calendarProgress(now);
    const iso=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(progress.day).padStart(2,'0')].join('-');
    if(iso!==signature){
      signature=iso;weekday.textContent=progress.weekday;date.textContent=progress.label;date.dateTime=iso;
      week(progress.weekDay,7);month(progress.day,progress.monthLength);
      button.setAttribute('aria-label','Calendar, '+progress.weekday+', '+progress.label+'. Week '+progress.weekDay+' of 7. Month '+progress.day+' of '+progress.monthLength+'. Open calendar.');
    }
    timer=win.setTimeout(refresh,Math.max(1,progress.nextMidnight-now.getTime()));
  }
  doc.addEventListener('visibilitychange',refresh);
  win.addEventListener('focus',refresh);win.addEventListener('pageshow',refresh);
  refresh();
  return ()=>{win.clearTimeout(timer);doc.removeEventListener('visibilitychange',refresh);win.removeEventListener('focus',refresh);win.removeEventListener('pageshow',refresh);};
}
