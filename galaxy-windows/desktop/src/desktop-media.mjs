import releaseChart from './netflix-au-chart.json';

const YOUTUBE='https://www.youtube.com/', NETFLIX='https://www.netflix.com/browse';
const NASA='UCLA_DiR1FfKNvjuUpBHmylQ';
const channelPattern=/^UC[A-Za-z0-9_-]{22}$/;
const videoPattern=/^[A-Za-z0-9_-]{11}$/;
const palettes=['Nebula','Ember','Tidal'];
const HOUR=3600000;
export function channelId(input){
  const value=String(input??'').trim();
  if(channelPattern.test(value))return value;
  try {
    const url=new URL(value);
    if(url.protocol==='https:'&&['youtube.com','www.youtube.com'].includes(url.host)&&!url.username&&!url.password){
      return /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(url.pathname)?.[1]||'';
    }
  }catch{}
  return '';
}
export function spotifySession(rows){
  if(!Array.isArray(rows))return null;
  const matches=rows.filter(row=>/^(?:SpotifyAB\.SpotifyMusic_zpdnekdrzrea0!Spotify|Spotify(?:\.exe)?)$/i.test(row?.umid));
  return matches.find(row=>row.playing)||matches.find(row=>row.default)||matches[0]||null;
}
function validChart(value){
  return /^\d{4}-\d\d-\d\d$/.test(value?.week)&&['films','tv'].every(key=>Array.isArray(value[key])&&value[key].length===10&&value[key].every(name=>typeof name==='string'&&name.trim()));
}
function dateLabel(value){
  const time=new Date(value);return Number.isFinite(+time)?time.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'';
}
async function publicFeed(win,path,signal){
  const session=JSON.parse(await win.__auroraNative.readGalaxyMotion());
  if(!Number.isInteger(session.port)||session.port<1||session.port>65535||!/^[a-f0-9]{64}$/.test(session.token))throw Error('Local helper unavailable');
  const response=await win.fetch('http://127.0.0.1:'+session.port+path,{
    headers:{Authorization:'Bearer '+session.token},signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'
  });
  if(!response.ok)throw Error('Public feed unavailable');
  return response.json();
}
export function mountDesktopMedia({host,launch,document:doc,window:win,invoke,subscribe,SeelenCommand,SeelenEvent}){
  let visible=false,epoch=0,unsubscribe=null,spotify=null,sessionRevision=0,category='films',abort=null;
  const read=(key,otherwise)=>{try{return JSON.parse(win.localStorage.getItem('atlasMedia.'+key))??otherwise;}catch{return otherwise;}};
  const save=(key,value)=>{try{win.localStorage.setItem('atlasMedia.'+key,JSON.stringify(value));}catch{}};
  let channels=read('channels',[]);channels=(Array.isArray(channels)?channels:[]).filter(channelPattern.test.bind(channelPattern)).slice(0,5);
  let uploads=read('uploads',{});if(!uploads||typeof uploads!=='object')uploads={};
  let chart=read('top10',releaseChart);if(!validChart(chart)||chart.week<releaseChart.week)chart=releaseChart;
  let palette=read('spotify.palette','Nebula');if(!palettes.includes(palette))palette='Nebula';
  const node=(tag,cls,label)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(label!=null)el.textContent=label;return el;};
  function button(label,action){const b=node('button','atlas-action',label);b.type='button';b.addEventListener('click',action);return b;}
  function open(target){return async()=>{if(!await launch(target))feedback.textContent='Couldn’t open the app or website.';};}
  function card(kind,title){const item=node('article','atlas-desk-card atlas-media-'+kind);item.append(node('h3','',title));grid.append(item);return item;}
  const wrapper=node('div','atlas-media-wrap'),grid=node('div','atlas-media-grid'),feedback=node('p','atlas-feedback');
  feedback.setAttribute('role','status');wrapper.append(node('h2','','Media'),grid,feedback);host.append(wrapper);
  const player=card('player','Spotify'), art=node('div','atlas-vinyl'),song=node('strong','atlas-song'),artist=node('p'),controls=node('div','atlas-actions');
  art.setAttribute('aria-hidden','true');const switcher=node('div','atlas-media-palettes');
  const previous=button('Previous',()=>control('MediaPrev')),toggle=button('Play',()=>control('MediaTogglePlayPause')),next=button('Next',()=>control('MediaNext'));
  controls.append(previous,toggle,next,button('Open Spotify',open('spotify:')));
  for(const colour of palettes)switcher.append(button(colour,()=>{palette=colour;save('spotify.palette',colour);drawPlayer();}));
  player.append(art,song,artist,controls,switcher);
  function drawPlayer(){
    player.dataset.palette=palette.toLowerCase();player.dataset.playing=String(!!spotify?.playing);
    song.textContent=spotify?.title||'Spotify is idle';
    artist.textContent=spotify?.author||(spotify?'Windows media session':'Play something in Spotify to see it here.');
    toggle.textContent=spotify?.playing?'Pause':'Play';
    [previous,toggle,next].forEach(b=>b.disabled=!spotify);
    for(const b of switcher.children)b.setAttribute('aria-pressed',String(b.textContent===palette));
  }
  async function getPlayer(){return spotifySession(await invoke(SeelenCommand.GetMediaSessions));}
  async function control(command){
    const expected=spotify?.umid,request=epoch;if(!expected)return;
    try{
      const current=await getPlayer();if(!visible||epoch!==request)return;
      spotify=current;drawPlayer();if(current?.umid!==expected)return;
      await invoke(SeelenCommand[command],{id:expected});await refreshPlayer(request);
    }catch{if(visible&&request===epoch)feedback.textContent='Spotify couldn’t accept that control.';}
  }
  async function refreshPlayer(request){
    const revision=sessionRevision;
    try{const item=await getPlayer();if(visible&&request===epoch&&revision===sessionRevision){spotify=item;drawPlayer();}}
    catch{if(visible&&request===epoch&&revision===sessionRevision){spotify=null;drawPlayer();}}
  }
  const youtube=card('youtube','YouTube'), uploadStatus=node('p'),videoList=node('div','atlas-media-list'),manage=node('details','atlas-media-manage');
  const channelList=node('div','atlas-channel-list'),form=node('form','atlas-link-form'),input=node('input'),add=node('button','atlas-action','Add channel');
  input.placeholder='Channel ID or youtube.com/channel/…';input.setAttribute('aria-label','YouTube channel ID or channel URL');input.maxLength=180;
  form.append(input,add);manage.append(node('summary','','Choose channels'),channelList,form,button('Add NASA',()=>addChannel(NASA)));
  form.addEventListener('submit',event=>{event.preventDefault();addChannel(input.value);});
  youtube.append(uploadStatus,videoList,manage,button('Open YouTube Home',open(YOUTUBE)));
  function addChannel(value){
    const id=channelId(value);
    if(!id){feedback.textContent='Enter a YouTube channel ID or a full /channel/ link.';return;}
    if(!channels.includes(id)&&channels.length>=5){feedback.textContent='Remove a channel before adding another.';return;}
    if(!channels.includes(id))channels.push(id);
    input.value='';feedback.textContent='';save('channels',channels);reload();
  }
  function drawVideos(message){
    channelList.replaceChildren();videoList.replaceChildren();
    const all=[];
    for(const id of channels){
      const feed=uploads[id];const label=feed?.name||id;
      channelList.append(button('Remove '+label,()=>{channels=channels.filter(x=>x!==id);delete uploads[id];save('uploads',uploads);save('channels',channels);reload();}));
      if(Array.isArray(feed?.videos))for(const v of feed.videos)if(videoPattern.test(v.id)&&typeof v.title==='string')all.push({...v,channel:label});
    }
    all.sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
    for(const v of all.slice(0,8)){
      const item=button(v.title,open(YOUTUBE+'watch?v='+v.id));item.append(node('small','',v.channel+' · '+dateLabel(v.published)));videoList.append(item);
    }
    const checked=channels.map(id=>uploads[id]?.checkedAt).filter(Number.isFinite);
    uploadStatus.textContent=!channels.length?'Choose channels to see their latest uploads.':message||(checked.length?'Selected channels · checked '+dateLabel(Math.min(...checked)):'Checking selected channels…');
  }
  const netflix=card('netflix','Netflix Australia'),period=node('p'),chartList=node('ol','atlas-media-ranks'),tabs=node('div','atlas-actions');
  const chartButtons=['films','tv'].map(key=>button(key==='films'?'Films':'TV',()=>{category=key;drawChart();}));tabs.append(...chartButtons);
  let chartStatus='';
  netflix.append(period,tabs,chartList,button('Open Netflix',open(NETFLIX)),button('Official chart',open('https://www.netflix.com/tudum/top10/australia')));
  function drawChart(){
    period.textContent='Australian Top 10 · week ending '+dateLabel(chart.week)+' · '+(chartStatus||'Netflix');
    chartButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(category===(i?'tv':'films'))));
    chartList.replaceChildren(...chart[category].map(title=>node('li','',title)));
  }
  async function refreshFeeds(request,signal){
    const active=()=>visible&&epoch===request&&!signal.aborted;
    const chosen=channels.slice();let missed=false;
    const jobs=chosen.map(async id=>{
      if(Date.now()-Number(uploads[id]?.checkedAt)<HOUR/2)return;
      try{
        const feed=await publicFeed(win,'/media/uploads?channel='+id,signal);
        if(!active()||feed.channel!==id||!Array.isArray(feed.videos))throw Error('Invalid channel');
        uploads[id]={name:feed.name,videos:feed.videos.slice(0,12),checkedAt:Date.now()};save('uploads',uploads);
      }catch{missed=true;}
    });
    if(Date.now()-Number(chart.checkedAt||0)>=6*HOUR)jobs.push((async()=>{
      try{
        const next=await publicFeed(win,'/media/top10',signal);
        if(!active())return;
        if(!validChart(next)||next.week<chart.week)throw Error('Invalid chart');
        chart={...next,checkedAt:Date.now()};save('top10',chart);chartStatus='Netflix';
      }catch{if(active())chartStatus='saved Netflix chart';}
    })());
    await Promise.all(jobs);if(active()){drawVideos(missed?'Refresh unavailable · showing saved uploads where available.':'');drawChart();}
  }
  function reload(){
    if(abort)abort.abort();const request=++epoch;
    drawVideos();drawChart();if(!visible)return;
    abort=new win.AbortController();refreshFeeds(request,abort.signal);refreshPlayer(request);
  }
  let tick=0;
  function setActive(next){
    if(next===visible)return;visible=next;reload();
    if(next){
      sessionRevision++;
      Promise.resolve().then(()=>subscribe(SeelenEvent.MediaSessions,event=>{
        if(visible){sessionRevision++;spotify=spotifySession(event?.payload??event);drawPlayer();}
      })).then(fn=>{if(!visible||tick!==timerKey){if(typeof fn==='function')fn();}else unsubscribe=fn;}).catch(()=>{});
      const timerKey=tick=win.setInterval(()=>{if(!doc.hidden)reload();},5*60*1000);
      refreshPlayer(epoch);
    }else{win.clearInterval(tick);tick=0;if(typeof unsubscribe==='function')unsubscribe();unsubscribe=null;}
  }
  drawPlayer();drawVideos();drawChart();
  return{setActive,dispose(){setActive(false);wrapper.remove();}};
}
