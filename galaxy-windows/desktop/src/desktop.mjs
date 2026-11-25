import {startGalaxy} from './galaxy-profile.mjs';
import {mountDesktopPages} from './desktop-pages.mjs';
import {getCurrentWebviewWindow} from '@tauri-apps/api/webviewWindow';
import {emitTo} from '@tauri-apps/api/event';
if(window.__TAURI_INTERNALS__){
  const self=getCurrentWebviewWindow();
  const target={kind:'WebviewWindow',label:self.label};
  const listening=self.listen('internal::liveness-ping',()=>{void emitTo(target,'internal::liveness-pong',{}).catch(()=>{});});
  window.addEventListener('pagehide',()=>{void listening.then(off=>off()).catch(()=>{});},{once:true});
}
import {initThemeSelector} from './theme-selector.mjs';
import {initNativeNotifications} from './notifications.mjs';
import {initPlaybackReactive} from './playback-reactive.mjs';
import {initNativeActivity} from './native-activity.mjs';
import {initSearchIntegration} from './search-integration.mjs';
import {initOutlookCalendar} from './outlook-calendar.mjs';
import {initWindowLaunch} from './window-launch.mjs';
import {initInteractiveSurfaces} from './interactive-surfaces.mjs';
import {initSystemControls} from './system-controls.mjs';
import {createIcons,Activity,AlignCenter,Anchor,AppWindow,Archive,ArrowLeft,ArrowUpRight,AudioLines,BadgeCheck,Bell,Bot,BriefcaseBusiness,CalendarDays,ChevronLeft,ChevronRight,CircleCheck,CircleDot,CirclePause,Clapperboard,Cloud,CloudLightning,CloudRain,CloudSnow,CloudSun,Columns2,Cpu,Download,FilePenLine,FolderOpen,Folders,Globe2,Grid2x2,House,Images,Inbox,Layers3,Mail,Microchip,Minus,MoonStar,MousePointer2,NotebookPen,Orbit,PanelLeft,PanelRight,PanelTop,Pause,Pencil,Play,PlaySquare,RotateCcw,Search,SlidersHorizontal,Snowflake,Sparkles,Square,Star,StarOff,Sun,Timer,Wind,X,Zap} from 'lucide';
import {initialiseNative,finishNative,invoke,subscribe,SeelenCommand,SeelenEvent,nativeStatus,attachFileBrowser,FOLDERS,DESKTOP,KNOWN_ROOTS} from './native-bridge.mjs';
import {initLiveData} from './live-data.mjs';
globalThis.lucide={createIcons:(options={})=>createIcons({icons:{Activity,AlignCenter,Anchor,AppWindow,Archive,ArrowLeft,ArrowUpRight,AudioLines,BadgeCheck,Bell,Bot,BriefcaseBusiness,CalendarDays,ChevronLeft,ChevronRight,CircleCheck,CircleDot,CirclePause,Clapperboard,Cloud,CloudLightning,CloudRain,CloudSnow,CloudSun,Columns2,Cpu,Download,FilePenLine,FolderOpen,Folders,Globe2,Grid2x2,House,Images,Inbox,Layers3,Mail,Microchip,Minus,MoonStar,MousePointer2,NotebookPen,Orbit,PanelLeft,PanelRight,PanelTop,Pause,Pencil,Play,PlaySquare,RotateCcw,Search,SlidersHorizontal,Snowflake,Sparkles,Square,Star,StarOff,Sun,Timer,Wind,X,Zap},...options})};
try {
await initialiseNative();
document.getElementById('aurora-home-preview').dataset.desktopDesign='universe';

(() => {
  const root = document.getElementById('aurora-home-preview');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => { if (globalThis.lucide) globalThis.lucide.createIcons({attrs:{width:16,height:16}}); };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(pointer: fine)');
  const sydney = () => {
    const parts = new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date());
    const value = type => Number(parts.find(p => p.type === type).value);
    return {year:value('year'),month:value('month')-1,day:value('day')};
  };
  const today = sydney();
  const state = {motion:reduced.matches?'reduced':'full',pointer:true,month:today.month,year:today.year,selected:today.day,selectedMonth:today.month,selectedYear:today.year,minutes:25,remaining:1500,deadline:null,phase:'ready',panel:null,minimised:null,accent:'#D6B466',depth:1,workspace:'work',illumination:1,sound:false,notices:[]};
  const folders = [
    {name:'Work',short:'Work & Career',colour:'#619fdf',icon:'briefcase-business',items:['Résumés','Applications','Qualifications','Employment records']},
    {name:'Personal',short:'Personal',colour:'#a189d7',icon:'badge-check',items:['Documents','Records','References']},
    {name:'Finance',short:'Money & Home',colour:'#7bbda6',icon:'house',items:['Banking','Rent and home','Tax and super']},
    {name:'Projects',short:'Projects',colour:'#6cbac6',icon:'layers-3',items:['Example project','Source archives','Development notes']},
    {name:'Media',short:'Photos & Videos',colour:'#cb91bc',icon:'images',items:['Photos','Screenshots','Recordings']},
    {name:'Documents',short:'Documents & Notes',colour:'#d4a578',icon:'notebook-pen',items:['Documents','Notes','Technical logs']},
    {name:'Apps',short:'Apps',colour:'#8da6c3',icon:'app-window',items:['Applications','Games','Shortcuts']},
    {name:'Archives',short:'Archives',colour:'#94a4b7',icon:'archive',items:['Compressed files','Preserved bundles']}
  ];
  const apps = [
    {name:'ChatGPT',icon:'sparkles',kind:'chat'}, {name:'Library',icon:'folder-open',kind:'library'},
    {name:'YouTube',icon:'play-square'}, {name:'Netflix',icon:'clapperboard'}, {name:'Gmail',icon:'mail'},
    {name:'Outlook',icon:'inbox'},
    {name:'Projects',icon:'layers-3',kind:'folder',folder:3}, {name:'Calendar',icon:'calendar-days',kind:'calendar'},
    {name:'Focus',icon:'orbit',kind:'focus'}, {name:'Appearance',icon:'sliders-horizontal',kind:'appearance'}
  ];
  const commands = [
    {id:'start-focus',name:'Start focus',hint:'Begin your focus timer',icon:'timer',keywords:'focus timer start work'},
    {id:'open-projects',name:'Open Projects',hint:'Your project collection',icon:'layers-3',keywords:'open projects folder library'},
    {id:'show-calendar',name:'Show calendar',hint:'Dates and month navigation',icon:'calendar-days',keywords:'show calendar date month today'},
    {id:'change-motion',name:'Change motion',hint:'Set the scene’s pace',icon:'orbit',keywords:'change motion animations effects'},
    {id:'workspace-work',name:'Work workspace',hint:'Library and focus first',icon:'briefcase-business',keywords:'workspace work mode focus'},
    {id:'workspace-create',name:'Create workspace',hint:'Give your ideas centre stage',icon:'sparkles',keywords:'workspace create mode creative'},
    {id:'workspace-relax',name:'Relax workspace',hint:'A quieter orbit',icon:'moon-star',keywords:'workspace relax mode calm'},
    {id:'motion-full',name:'Motion: Full',hint:'Orbit, parallax and hover depth',icon:'orbit',keywords:'motion full animation on'},
    {id:'motion-reduced',name:'Motion: Reduced',hint:'Keep the scene still',icon:'circle-dot',keywords:'motion reduced animation calm'},
    {id:'motion-off',name:'Motion: Off',hint:'Switch off all movement',icon:'circle-pause',keywords:'motion off animation disable'},
    {id:'quick-controls',name:'Quick controls',hint:'Scene light and optional sound',icon:'sliders-horizontal',keywords:'quick controls sound illumination brightness light'},
    {id:'notifications',name:'Windows notifications',hint:'Messages from Windows apps',icon:'bell',keywords:'notifications notification centre center activity history'}
  ];
  let draft = '';
  let toastTimeout;
  let returnFocus = null;
  let audioContext = null;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const readSaved = value => {
    const saved = value?.privateContent?.auroraHome || value?.auroraHome;
    if (!saved || saved.version !== 1) return;
    if (['full','reduced','off'].includes(saved.motion)) state.motion = reduced.matches && saved.motion === 'full' ? 'reduced' : saved.motion;
    if (typeof saved.pointer === 'boolean') state.pointer = saved.pointer;
    if (['work','create','relax'].includes(saved.workspace)) state.workspace=saved.workspace;
    if (typeof saved.illumination==='number'&&saved.illumination>=.6&&saved.illumination<=1.4) state.illumination=saved.illumination;
    if (/^#[0-9a-f]{6}$/i.test(saved.accent || '')) state.accent = ({'#82e8f9':'#D6B466','#b9a1ff':'#D8DCE3','#aadbc5':'#E4CE9B','#55e5cf':'#D6B466','#ffd166':'#D6B466','#f5a5d2':'#D8DCE3','#6acfff':'#E4CE9B'}[saved.accent.toLowerCase()] || saved.accent);
    if (Number.isInteger(saved.month) && saved.month>=0 && saved.month<12 && Number.isInteger(saved.year) && saved.year>1900 && saved.year<2200) {state.month=saved.month;state.year=saved.year;}
  };
  readSaved(window.openai?.widgetState);
  const save = () => {
    if (!window.openai?.setWidgetState) return;
    const snapshot = {version:1,motion:state.motion,pointer:state.pointer,month:state.month,year:state.year,accent:state.accent,workspace:state.workspace,illumination:state.illumination};
    window.openai.setWidgetState({modelContent:{concept:'Galaxy Atlas',motion:state.motion,workspace:state.workspace,companionPointer:state.pointer,accent:state.accent},privateContent:{...(window.openai?.widgetState?.privateContent||{}),auroraHome:snapshot}}).catch(()=>{});
  };
  function toast(message) {
    const el = $('.ah-toast'); el.textContent=message;el.classList.add('ah-show');
    clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('ah-show'),3200);
  }
  function addNotice(message) {
    state.notices.unshift({message,at:Date.now()});state.notices=state.notices.slice(0,12);
    renderNotices();
  }
  function renderNotices() {
    if(window.__auroraNotifications){window.__auroraNotifications.renderBadge();return;}
    const badge=$('.ah-notification-count');badge.textContent='0';badge.hidden=true;
    $('.ah-notification-button').setAttribute('aria-label','Windows notifications');
  }
  async function playTap() {
    if(!state.sound||!audioContext||document.hidden)return;
    try{
      if(audioContext.state==='suspended')await audioContext.resume();
      const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(740,now);oscillator.frequency.exponentialRampToValueAtTime(520,now+.065);
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.018,now+.006);gain.gain.exponentialRampToValueAtTime(.0001,now+.075);
      oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(now);oscillator.stop(now+.08);
    }catch(_){state.sound=false;renderAppearance();}
  }
  function setWorkspace(workspace) {
    if(!['work','create','relax'].includes(workspace))return;
    state.workspace=workspace;state.accent={work:'#D6B466',create:'#D8DCE3',relax:'#E4CE9B'}[workspace];
    renderAppearance();save();addNotice(`${workspace[0].toUpperCase()+workspace.slice(1)} workspace selected`);
    toast({work:'Work space: your library and focus timer.',create:'Create space: your AI companion takes centre stage.',relax:'Relax space: a softer scene and your weekly outlook.'}[workspace]);
  }
  window.__auroraRunCommand=runCommand;
  function runCommand(id) {
    if(id==='start-focus'&&root.dataset.focusWidgetRemoved==='true')return;
    if(id==='open-projects'){closePanel();void window.__auroraNative.openFolder(3);return;}
    if(id.startsWith('workspace-')){closePanel();setWorkspace(id.slice(10));return;}
    if(id.startsWith('motion-')){state.motion=id.slice(7);renderAppearance();save();addNotice(`Motion set to ${state.motion}`);closePanel();toast(`Motion: ${state.motion}`);return;}
    if(id==='start-focus'){
      closePanel();if(!state.deadline){if(!state.remaining)state.remaining=state.minutes*60;state.deadline=Date.now()+state.remaining*1000;state.phase='running';renderTimer();addNotice(`${state.minutes}-minute focus session started`);}
      $('.ah-focus').scrollIntoView({behavior:state.motion==='full'?'smooth':'auto',block:'nearest'});toast('Your focus timer is running.');
    }else if(id==='open-projects')openPanel('folder',{index:3,name:folders[3].name});
    else if(id==='show-calendar')launchApp('Calendar');
    else if(id==='change-motion'||id==='quick-controls')openPanel('quick-controls');
    else if(id==='notifications')openPanel('notifications');
  }
  function renderAppearance() {
    root.dataset.motion=state.motion;root.style.setProperty('--ah-accent',state.accent);root.style.setProperty('--ah-depth',state.depth);
    root.dataset.workspace=state.workspace;root.style.setProperty('--ah-illumination',state.illumination);
    $$('[data-workspace]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.workspace===state.workspace)));
    $('.ah-workspace-caption').textContent={work:'Room to focus',create:'Room to imagine',relax:'Room to recharge'}[state.workspace];
    $('.ah-motion').value=state.motion;
    $('.ah-pointer-toggle').setAttribute('aria-pressed',String(state.pointer));
    if (!state.pointer || state.motion==='off') $('.ah-pointer').style.opacity='0';
    const select=$('[data-panel-motion]');if(select)select.value=state.motion;
    const pointer=$('[data-panel-pointer]');if(pointer)pointer.textContent=state.pointer?'Companion on':'Companion off';
    const sound=$('[data-panel-sound]');if(sound){sound.innerHTML=icon(state.sound?'volume-2':'volume-x')+(state.sound?'Sounds on':'Sounds off');sound.setAttribute('aria-pressed',String(state.sound));}
    const light=$('[data-illumination]');if(light)light.value=String(Math.round(state.illumination*100));
    const lightValue=$('.ah-illumination-value');if(lightValue)lightValue.textContent=`${Math.round(state.illumination*100)}%`;
  }
  function renderCalendar() {
    $('.ah-month').textContent = new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric'}).format(new Date(state.year,state.month,1));
    const first=(new Date(state.year,state.month,1).getDay()+6)%7;
    const days=new Date(state.year,state.month+1,0).getDate();
    let html=Array.from({length:first},()=>'<span aria-hidden="true"></span>').join('');
    for(let d=1;d<=days;d++){
      const isToday=d===today.day&&state.month===today.month&&state.year===today.year;
      const isSelected=d===state.selected&&state.month===state.selectedMonth&&state.year===state.selectedYear;
      const label=new Intl.DateTimeFormat('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(state.year,state.month,d));
      html+=`<button type="button" class="cursor-interaction ${isToday?'ah-today':''} ${isSelected?'ah-selected':''}" data-day="${d}" aria-label="${escape(label)}" aria-pressed="${isSelected}">${d}</button>`;
    }
    $('.ah-calendar-days').innerHTML=html;
    $('.ah-selected-date').textContent=new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short'}).format(new Date(state.selectedYear,state.selectedMonth,state.selected));
  }
  function renderClock() {
    const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',minute:'2-digit',hour12:true}).formatToParts(new Date());
    $('.ah-time').textContent=parts.filter(p=>['hour','literal','minute'].includes(p.type)).map(p=>p.value).join('').trim();
    $('.ah-period').textContent=parts.find(p=>p.type==='dayPeriod')?.value.toUpperCase()||'';
    $('.ah-date').textContent=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',weekday:'long',day:'numeric',month:'long'}).format(new Date());
  }
  function renderTimer() {
    if(state.deadline){state.remaining=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));if(state.remaining===0){state.deadline=null;state.phase='complete';toast('Focus session complete. Take a moment to reset.');addNotice('Focus session completed');}}
    const mins=Math.floor(state.remaining/60),secs=state.remaining%60;
    $('.ah-timer').textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    $('.ah-timer-label').textContent={ready:'Ready',running:'Focusing',paused:'Paused',complete:'Complete'}[state.phase];
    const progress=Math.min(100,Math.max(0,(1-state.remaining/(state.minutes*60))*100));
    $('.ah-timer-ring').style.setProperty('--progress',`${progress*3.6}deg`);
    $('.ah-timer-ring').setAttribute('aria-valuenow',String(Math.round(progress)));
    const button=$('.ah-start');const label=state.deadline?'Pause':state.phase==='paused'?'Resume':'Start';
    if(button.dataset.label!==label){button.innerHTML=icon(state.deadline?'pause':'play')+`<span>${label}</span>`;button.dataset.label=label;icons();}
  }
  function renderFolders(container,expanded=false) {
    container.innerHTML=folders.map((f,i)=>`<button type="button" class="ah-folder cursor-interaction" data-folder="${i}" aria-label="Open ${escape(f.name)}" style="--folder-color:${f.colour}"><span class="ah-folder-symbol" aria-hidden="true"></span><span class="ah-folder-label">${escape(f.short)}</span></button>`).join('');
  }
  function renderWeather() {
    const samples=[['cloud-sun',24,17,'Partly cloudy'],['sun',25,18,'Sunny'],['cloud',22,17,'Cloudy'],['cloud-rain',21,16,'Light showers'],['cloud-sun',23,17,'Partly cloudy'],['sun',26,18,'Sunny'],['cloud-sun',24,18,'Partly cloudy']];
    $('.ah-forecast').innerHTML=samples.map((sample,i)=>{
      const day=new Date(today.year,today.month,today.day+i);
      const label=i===0?'Today':new Intl.DateTimeFormat('en-AU',{weekday:'short'}).format(day);
      return `<button type="button" class="ah-weather-day cursor-interaction" data-weather="${i}" aria-label="Sample forecast, ${label}, ${sample[3]}, ${sample[1]} to ${sample[2]} degrees Celsius"><span>${label}</span>${icon(sample[0])}<span><strong>${sample[1]}°</strong><em>${sample[2]}°</em></span></button>`;
    }).join('');
  }
  window.__auroraOpenPanel=openPanel;
  function openPanel(kind,extra={}) {
    if(kind==='library'){void window.__auroraNative.openLibrary();return;}
    if(kind==='files'){void window.__auroraNative.openDesktop();return;}
    if(document.activeElement&&root.contains(document.activeElement)&&!$('.ah-window').contains(document.activeElement))returnFocus=document.activeElement;
    state.panel={kind,...extra};state.minimised=null;$('.ah-dock-restore').hidden=true;
    $('.ah-window-layer').hidden=false;$('.ah-window').dataset.panel=kind;
    const names={chat:'ChatGPT · draft space',draft:'ChatGPT · draft preview',launcher:'Launchpad',library:'Your library',folder:extra.name||'Collection',app:extra.name||'Application',appearance:'Make it yours',weather:'Sydney outlook',sensors:'System pulse','quick-controls':'Quick controls',notifications:'Windows notifications'};
    $('.ah-window-name').textContent=names[kind]||'Galaxy Atlas';
    $('.ah-window').setAttribute('aria-label',names[kind]||'Galaxy Atlas');
    const content=$('.ah-window-content');
    if(kind==='launcher'){
      content.innerHTML=`<h3>Find a space. Make a move.</h3><label class="ah-field">${icon('search')}<input type="search" class="ah-app-search" placeholder="Search apps or type a command" aria-label="Search apps and commands"></label><div class="ah-command-heading">COMMANDS</div><div class="ah-command-list"></div><div class="ah-app-grid"></div>`;
      renderApps('');
    }else if(kind==='chat'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('sparkles')}Your AI space</span><h3>What’s on your mind?</h3><label class="ah-draft-label" for="ah-draft-input">Your draft</label><textarea id="ah-draft-input" placeholder="An idea, a question, a plan…" maxlength="4000">${escape(draft)}</textarea><div class="ah-suggestions"><button type="button" class="ah-suggestion cursor-interaction" data-draft-prompt="Help me plan my week.">Plan my week</button><button type="button" class="ah-suggestion cursor-interaction" data-draft-prompt="Help me develop a creative idea.">Explore an idea</button><button type="button" class="ah-suggestion cursor-interaction" data-draft-prompt="Help me work through a problem step by step.">Work through a problem</button></div><button type="button" class="ah-primary cursor-interaction" data-action="draft-preview">Review draft ${icon('arrow-up-right')}</button><p>Review your draft here, then copy it into the Galaxy Atlas chat.</p>`;
    }else if(kind==='draft'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('file-pen-line')}Review your draft</span><h3>Ready for your next conversation.</h3><div class="ah-draft-preview">${escape(draft)}</div><div class="ah-panel-actions"><button type="button" class="ah-primary cursor-interaction" data-action="edit-draft">${icon('pencil')}Edit draft</button><button type="button" class="ah-secondary cursor-interaction" data-action="close">Done</button></div><p><button type="button" class="ah-primary cursor-interaction" data-native-draft>Open Galaxy Atlas chat (copy draft first)</button></p>`;
    }else if(kind==='library'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('folder-open')}Your existing categories</span><h3>Everything has a place.</h3><p>Choose a collection to explore its purpose.</p><div class="ah-folders" style="margin-top:20px"></div>`;
      renderFolders(content.querySelector('.ah-folders'),true);
    }else if(kind==='folder'){
      const f=folders[extra.index];
      content.innerHTML=`<div class="ah-category-symbol">${icon(f.icon)}</div><h3>${escape(f.name)}</h3><p>Category preview</p><div class="ah-category-tags">${f.items.map(item=>`<span>${escape(item)}</span>`).join('')}</div><div class="ah-panel-actions"><button type="button" class="ah-secondary cursor-interaction" data-action="library">${icon('arrow-left')}All collections</button></div><p>This collection opens in File Explorer.</p>`;
    }else if(kind==='app'){
      const app=apps.find(a=>a.name===extra.name)||{icon:'app-window',name:extra.name};
      content.innerHTML=`<div class="ah-category-symbol">${icon(app.icon)}</div><h3>${escape(app.name)}</h3><span class="ah-panel-badge">Preview shortcut</span><p>This is where ${escape(app.name)} would open from your desktop. This concept stays on this page.</p><div class="ah-panel-actions"><button type="button" class="ah-primary cursor-interaction" data-action="launcher">${icon('grid-2x2')}Back to Launchpad</button></div>`;
    }else if(kind==='appearance'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('sliders-horizontal')}Personalise this concept</span><h3>A space that feels like you.</h3><div class="ah-appearance-grid"><label class="ah-appearance-item">Motion<select class="ah-select" data-panel-motion><option value="full">Full orbit</option><option value="reduced">Reduced motion</option><option value="off">Motion off</option></select></label><div class="ah-appearance-item"><span>Accent light</span><div class="ah-colours">${[['#D6B466','Gold'],['#D8DCE3','Silver'],['#E4CE9B','Champagne']].map(([value,label])=>`<button type="button" class="ah-colour cursor-interaction" style="--colour:${value}" data-colour="${value}" aria-label="${label} accent" aria-pressed="${state.accent===value}"></button>`).join('')}</div></div><div class="ah-appearance-item"><span>Pointer companion</span><button type="button" class="ah-secondary cursor-interaction" data-action="pointer" data-panel-pointer></button></div><div class="ah-appearance-item"><span>Workspace</span><button type="button" class="ah-secondary cursor-interaction" data-action="home">${icon('house')}Return home</button></div></div>`;
      renderAppearance();
    }else if(kind==='quick-controls'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('sliders-horizontal')}This desktop</span><h3>Set the atmosphere.</h3><div class="ah-appearance-grid"><div class="ah-appearance-item"><label class="ah-illumination-line" for="ah-scene-light"><span>Scene illumination</span><output class="ah-illumination-value" for="ah-scene-light">100%</output></label><input id="ah-scene-light" class="ah-illumination" data-illumination type="range" min="60" max="140" step="5" value="100"><span class="ah-control-note">Adjusts the scene, not your screen.</span></div><label class="ah-appearance-item">Motion<select class="ah-select" data-panel-motion><option value="full">Full orbit</option><option value="reduced">Reduced motion</option><option value="off">Motion off</option></select></label><div class="ah-appearance-item"><span>Interaction sounds</span><button type="button" class="ah-secondary cursor-interaction" data-action="sound" data-panel-sound aria-pressed="false">Sounds off</button><span class="ah-control-note">Soft tones on your clicks. Off by default.</span></div><div class="ah-appearance-item"><span>Pointer companion</span><button type="button" class="ah-secondary cursor-interaction" data-action="pointer" data-panel-pointer></button><span class="ah-control-note">Follows you inside this scene.</span></div></div>`;
      renderAppearance();
    }else if(kind==='notifications'){
      if(window.__auroraNotifications)window.__auroraNotifications.renderPanel(content);
      else content.innerHTML='<h3>Windows notifications</h3><p>Notification feed is starting. Reopen this panel in a moment.</p>';
    }else if(kind==='weather'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('cloud-sun')}Sample forecast</span><h3>A week at a glance.</h3><p>The forecast cards use illustrative weather data to show the design. A live Sydney forecast is not connected in this concept.</p><div class="ah-panel-actions"><button type="button" class="ah-primary cursor-interaction" data-action="close">Back home</button></div>`;
    }else if(kind==='sensors'){
      content.innerHTML=`<span class="ah-panel-badge">${icon('activity')}Hardware readings</span><h3>Real readings, when connected.</h3><div class="ah-category-tags"><span>CPU temperature: not connected</span><span>GPU temperature: not connected</span></div><p>The final desktop would display verified sensor readings. This concept does not simulate temperatures.</p><div class="ah-panel-actions"><button type="button" class="ah-primary cursor-interaction" data-action="close">Back home</button></div>`;
    }
    if(['folder','app','chat','draft'].includes(kind))addNotice(kind==='draft'?'ChatGPT draft previewed locally':kind==='chat'?'ChatGPT draft space opened':`${names[kind]} preview opened`);
    icons();
    requestAnimationFrame(()=>{$('.ah-window').scrollIntoView({behavior:'auto',block:'nearest'});const focus=content.querySelector('input,textarea,button,select');if(focus)focus.focus({preventScroll:true});});
  }
  function renderApps(query) {
    const grid=$('.ah-app-grid');if(!grid)return;
    const normalised=query.toLowerCase().replace(/^[/>]/,'').trim();
    const words=normalised.split(/\s+/).filter(Boolean);
    const matches=value=>words.every(word=>value.toLowerCase().includes(word));
    const filtered=apps.filter(a=>matches(a.name));
    const matchedCommands=normalised?commands.filter(command=>matches(command.name+' '+command.keywords)):commands.slice(0,4);
    const commandList=$('.ah-command-list');
    if(commandList)commandList.innerHTML=matchedCommands.map(command=>`<button type="button" class="ah-command cursor-interaction" data-command="${command.id}">${icon(command.icon)}<span>${command.name}<small>${command.hint}</small></span></button>`).join('');
    const commandHeading=$('.ah-command-heading');if(commandHeading)commandHeading.hidden=!matchedCommands.length;
    grid.innerHTML=filtered.length?filtered.map(a=>`<button type="button" class="ah-app-tile cursor-interaction" data-app="${escape(a.name)}">${icon(a.icon)}<span>${escape(a.name)}</span></button>`).join(''):matchedCommands.length?'':'<div class="ah-empty">No matching spaces or commands. Try another name.</div>';
    icons();
  }
  window.__auroraClosePanel=closePanel;
  function closePanel(minimise=false) {
    if(minimise&&state.panel){state.minimised={...state.panel};$('.ah-dock-restore').hidden=false;$('.ah-dock-restore span').textContent=$('.ah-window-name').textContent.split(' · ')[0];}
    state.panel=null;$('.ah-window-layer').hidden=true;
    if(returnFocus&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});
  }
  function launchApp(name) {
    if(name==='Focus'&&root.dataset.focusWidgetRemoved==='true')return;
    if(window.__auroraNative.handlesApp(name)){closePanel();void window.__auroraNative.openApp(name);return;}
    const app=apps.find(a=>a.name===name);
    if(!app)return;
    if(app.kind==='chat'||app.kind==='library'||app.kind==='appearance')openPanel(app.kind);
    else if(app.kind==='folder')openPanel('folder',{index:app.folder,name:folders[app.folder].name});
    else if(app.kind==='calendar'){closePanel();$('.ah-calendar').scrollIntoView({behavior:state.motion==='full'?'smooth':'auto',block:'nearest'});toast('Select a date or browse another month.');}
    else if(app.kind==='focus'){closePanel();$('.ah-focus').scrollIntoView({behavior:state.motion==='full'?'smooth':'auto',block:'nearest'});$('.ah-start').focus({preventScroll:true});}
    else openPanel('app',{name:app.name});
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target||!root.contains(target))return;
    if(state.sound&&target.dataset.action!=='sound')playTap();
    if(target.dataset.command){runCommand(target.dataset.command);return;}
    if(target.dataset.workspace){setWorkspace(target.dataset.workspace);return;}
    if(target.dataset.folder!==undefined){const index=Number(target.dataset.folder);closePanel();void window.__auroraNative.openFolder(index);return;}
    if(target.dataset.day){state.selected=Number(target.dataset.day);state.selectedMonth=state.month;state.selectedYear=state.year;renderCalendar();toast(new Intl.DateTimeFormat('en-AU',{weekday:'long',day:'numeric',month:'long'}).format(new Date(state.year,state.month,state.selected)));return;}
    if(target.dataset.weather!==undefined){openPanel('weather');return;}
    if(target.dataset.app){launchApp(target.dataset.app);return;}
    if(target.dataset.prompt){draft=target.dataset.prompt;openPanel('chat');return;}
    if(target.dataset.draftPrompt){draft=target.dataset.draftPrompt;$('#ah-draft-input').value=draft;$('#ah-draft-input').focus();return;}
    if(target.dataset.colour){state.accent=target.dataset.colour;renderAppearance();$$('[data-colour]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.colour===state.accent)));save();return;}
    const action=target.dataset.action;
    if(action==='compose-chat')openPanel('chat');else if(action==='chat'){void window.__auroraNative.openApp('ChatGPT');closePanel();}else if(['library','launcher','appearance','sensors','quick-controls','notifications'].includes(action))openPanel(action);
    else if(action==='home'){closePanel();root.scrollIntoView({behavior:state.motion==='full'?'smooth':'auto',block:'nearest'});}
    else if(action==='close')closePanel();
    else if(action==='minimise')closePanel(true);
    else if(action==='restore'&&state.minimised){const panel={...state.minimised};openPanel(panel.kind,panel);}
    else if(action==='prev-month'||action==='next-month'){state.month+=action==='prev-month'?-1:1;if(state.month<0){state.month=11;state.year--;}if(state.month>11){state.month=0;state.year++;}renderCalendar();save();}
    else if(action==='today'){Object.assign(state,{month:today.month,year:today.year,selected:today.day,selectedMonth:today.month,selectedYear:today.year});renderCalendar();save();}
    else if(action==='timer'){if(state.deadline){state.remaining=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));state.deadline=null;state.phase='paused';addNotice('Focus session paused');}else{if(!state.remaining)state.remaining=state.minutes*60;state.deadline=Date.now()+state.remaining*1000;state.phase='running';addNotice('Focus session started');}renderTimer();}
    else if(action==='timer-reset'){state.deadline=null;state.remaining=state.minutes*60;state.phase='ready';renderTimer();addNotice('Focus timer reset');}
    else if(action==='pointer'){state.pointer=!state.pointer;renderAppearance();save();}
    else if(action==='draft-preview'){draft=$('#ah-draft-input').value.trim();if(!draft){toast('Add an idea or question to preview your draft.');$('#ah-draft-input').focus();return;}openPanel('draft');}
    else if(action==='edit-draft')openPanel('chat');
    else if(action==='clear-notices'){state.notices=[];renderNotices();toast('Preview activity cleared.');}
    else if(action==='sound'){
      if(state.sound){state.sound=false;addNotice('Interaction sounds turned off');renderAppearance();icons();}
      else{
        try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Unavailable');audioContext=audioContext||new Audio({latencyHint:'interactive'});state.sound=true;audioContext.resume().then(()=>playTap()).catch(()=>{state.sound=false;renderAppearance();toast('Sound is unavailable in this preview.');});addNotice('Interaction sounds turned on');renderAppearance();icons();}
        catch(_){state.sound=false;toast('Sound is unavailable in this preview.');}
      }
    }
  });
  root.addEventListener('input',event=>{if(event.target.matches('.ah-app-search'))renderApps(event.target.value);if(event.target.matches('#ah-draft-input'))draft=event.target.value;if(event.target.matches('[data-illumination]')){state.illumination=Number(event.target.value)/100;renderAppearance();}});
  root.addEventListener('change',event=>{
    if(event.target.matches('.ah-motion,[data-panel-motion]')){state.motion=event.target.value;renderAppearance();save();addNotice(`Motion set to ${state.motion}`);}
    if(event.target.matches('[data-illumination]')){save();addNotice(`Scene illumination set to ${Math.round(state.illumination*100)}%`);}
    if(event.target.matches('.ah-focus select')){state.minutes=Number(event.target.value);state.deadline=null;state.remaining=state.minutes*60;state.phase='ready';renderTimer();}
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('.ah-app-search')){event.preventDefault();const result=$('.ah-command-list button')||$('.ah-app-grid button');result?.click();return;}
    if(event.key==='Escape'&&state.panel){event.preventDefault();closePanel();}
    if(event.key==='/'&&!event.target.matches('input,textarea,select')){event.preventDefault();openPanel('launcher');}
    if(event.key==='Tab'&&state.panel){
      const controls=[...$('.ah-window').querySelectorAll('button,input,textarea,select')].filter(el=>!el.disabled&&!el.hidden);
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('.ah-window-shade').addEventListener('click',()=>closePanel());

  for(let i=0;i<42;i++){const star=document.createElement('span');star.className='ah-star';star.style.cssText=`left:${(i*73.17)%100}%;top:${(i*41.73)%100}%;--s:${i%9};width:${i%5===0?3:2}px;height:${i%5===0?3:2}px`;$('.ah-stars').append(star);}
  let pointerX=0,pointerY=0,currentX=0,currentY=0,pointerInside=false,frame=0;
  const companionPointer=$('.ah-pointer');
  function pointerFrame(){frame=0;if(!pointerInside||document.hidden||!state.pointer||state.motion==='off')return;const smoothing=state.motion==='full'?.22:1;currentX+=(pointerX-currentX)*smoothing;currentY+=(pointerY-currentY)*smoothing;companionPointer.style.transform=`translate(${currentX}px,${currentY}px)`;if(Math.abs(pointerX-currentX)+Math.abs(pointerY-currentY)>.2)frame=requestAnimationFrame(pointerFrame);}
  root.addEventListener('pointermove',event=>{
    if(!finePointer.matches)return;
    const rect=root.getBoundingClientRect();pointerX=event.clientX-rect.left+14;pointerY=event.clientY-rect.top+14;
    const hide=event.target.closest('input,textarea,select');
    pointerInside=true;companionPointer.style.opacity=state.pointer&&state.motion!=='off'&&!hide?'1':'0';
    if(!frame)frame=requestAnimationFrame(pointerFrame);
    if(state.motion==='full'){
      root.style.setProperty('--ah-px',((event.clientX-rect.left)/rect.width-.5)*2);
      root.style.setProperty('--ah-py',Math.max(-1,Math.min(1,((event.clientY-rect.top)/Math.min(rect.height,800)-.5)*2)));
    }
  });
  root.addEventListener('pointerenter',event=>{const rect=root.getBoundingClientRect();currentX=event.clientX-rect.left+14;currentY=event.clientY-rect.top+14;pointerInside=true;});
  root.addEventListener('pointerleave',()=>{pointerInside=false;companionPointer.style.opacity='0';root.style.setProperty('--ah-px',0);root.style.setProperty('--ah-py',0);if(frame)cancelAnimationFrame(frame);frame=0;});
  $$('[data-tilt]').forEach(panel=>{
    panel.addEventListener('pointermove',event=>{if(state.motion!=='full'||!finePointer.matches)return;const r=panel.getBoundingClientRect();panel.style.setProperty('--tilt-x',`${-(event.clientY-r.top-r.height/2)/r.height*5*state.depth}deg`);panel.style.setProperty('--tilt-y',`${(event.clientX-r.left-r.width/2)/r.width*5*state.depth}deg`);});
    panel.addEventListener('pointerleave',()=>{panel.style.setProperty('--tilt-x','0deg');panel.style.setProperty('--tilt-y','0deg');});
  });
  document.addEventListener('visibilitychange',()=>{root.dataset.paused=String(document.hidden);if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}if(document.hidden&&audioContext?.state==='running')audioContext.suspend().catch(()=>{});if(!document.hidden){renderClock();renderTimer();}});
  const mediaChange=()=>{if(reduced.matches&&state.motion==='full'){state.motion='reduced';renderAppearance();}};
  reduced.addEventListener?.('change',mediaChange);
  window.addEventListener('openai:set_globals',event=>{const incoming=event.detail?.globals?.widgetState;if(incoming){readSaved(incoming);renderAppearance();renderCalendar();}});
  renderFolders($('.ah-folders'));renderWeather();renderCalendar();renderClock();renderTimer();renderAppearance();icons();
  setInterval(()=>{if(!root.isConnected)return;if(!document.hidden){renderClock();renderTimer();}},1000);
  if(globalThis.Tweak){
    const tweakState={accent:state.accent,depth:state.depth,motion:state.motion};
    const tweak=new Tweak({container:root,onChange:()=>{state.accent=tweakState.accent;state.depth=tweakState.depth;state.motion=tweakState.motion;renderAppearance();}});
    tweak.addColorPicker(tweakState,'accent',{label:'Accent light',reference:'--ah-accent'});
    tweak.addSlider(tweakState,'depth',{label:'Hover depth',min:0,max:2,step:.25,reference:'ah.depth'});
    tweak.addSelect(tweakState,'motion',{label:'Motion',options:[{label:'Full orbit',value:'full'},{label:'Reduced',value:'reduced'},{label:'Off',value:'off'}],reference:'ah.motion'});
  }
})();

;



;

(() => {
  'use strict';
  const root=document.getElementById('aurora-home-preview');
  if(!root || root.dataset.ahWmReady)return;
  const forecast=root.querySelector('.ah-forecast'),panel=root.querySelector('.ah-window'),content=root.querySelector('.ah-window-content');
  if(!forecast || !panel || !content)return;
  root.dataset.ahWmReady='true';
  const kinds={sunny:'Sunny',partly:'Partly cloudy',cloudy:'Cloudy',rain:'Light rain',snow:'Snow',thunder:'Thunderstorm',wind:'Wind'};
  const conditions=['partly','sunny','cloudy','rain','partly','sunny','partly'];
  let selected=null,queued=false;
  const create=(tag,className)=>{const node=document.createElement(tag);if(className)node.className=className;return node;};
  const icons=()=>{if(window.lucide?.createIcons)window.lucide.createIcons({attrs:{width:16,height:16}});};
  function makeArt(kind){
    const art=create('span','ah-wm-art');art.dataset.condition=kind;art.setAttribute('aria-hidden','true');
    const shape=className=>{const node=create('span',className+' ah-wm-moving');art.append(node);return node;};
    if(kind==='sunny'||kind==='partly'){
      const sun=shape('ah-wm-sun');sun.append(create('span','ah-wm-rays ah-wm-moving'));
    }
    if(['cloudy','rain','snow','thunder'].includes(kind))shape('ah-wm-cloud ah-wm-cloud-back');
    if(['partly','cloudy','rain','snow','thunder'].includes(kind))shape('ah-wm-cloud');
    if(kind==='rain'||kind==='thunder')for(let i=0;i<6;i++){const drop=shape('ah-wm-drop');drop.style.setProperty('--ah-wm-i',i);}
    if(kind==='snow')for(let i=0;i<7;i++){const flake=shape('ah-wm-flake');flake.style.setProperty('--ah-wm-i',i);}
    if(kind==='thunder'){
      const bolt=shape('ah-wm-bolt'),icon=create('i');icon.dataset.lucide='zap';icon.setAttribute('aria-hidden','true');bolt.append(icon);
    }
    if(kind==='wind')for(let i=0;i<3;i++){const line=shape('ah-wm-wind');line.style.setProperty('--ah-wm-i',i);}
    return art;
  }
  function readCard(card){
    const index=Number(card.dataset.weather),label=card.getAttribute('aria-label')||'';
    const parts=label.split(',').map(part=>part.trim());
    return{index,kind:conditions[index]||'partly',day:card.querySelector('span')?.textContent.trim()||parts[1]||'Selected day',condition:parts[2]||kinds[conditions[index]]||'Partly cloudy',high:card.querySelector('strong')?.textContent.trim()||'',low:card.querySelector('em')?.textContent.trim()||''};
  }
  function decorateCards(){
    forecast.querySelectorAll('.ah-weather-day[data-weather]').forEach(card=>{
      if(card.querySelector('.ah-wm-art'))return;
      const data=readCard(card),existing=[...card.children].find(child=>child.tagName.toLowerCase()==='svg'||child.hasAttribute('data-lucide'));
      const art=makeArt(data.kind);if(existing)existing.replaceWith(art);else card.insertBefore(art,card.children[1]||null);
    });
    if(!selected){const first=forecast.querySelector('.ah-weather-day[data-weather]');if(first)selected=readCard(first);}
  }
  function updateDetail(detail,kind){
    const stage=detail.querySelector('.ah-wm-stage'),name=detail.querySelector('.ah-wm-condition'),range=detail.querySelector('.ah-wm-range'),note=detail.querySelector('.ah-wm-demo-note');
    if(!stage || !name || !range || !note)return;
    stage.dataset.condition=kind;stage.replaceChildren(makeArt(kind));
    const sample=kind===selected.kind;
    name.textContent=sample?selected.day+' · '+selected.condition:kinds[kind];
    range.textContent=sample&&selected.high&&selected.low?selected.high+' / '+selected.low+' · Sample':'Animation demo';
    note.textContent=sample?'Sample forecast. Select a condition to preview its animation.':'Demo condition, separate from the sample forecast.';
    icons();
  }
  function decorateDetail(){
    if(panel.dataset.panel!=='weather'||!selected||content.querySelector('.ah-wm-detail'))return;
    const detail=create('div','ah-wm-detail'),stage=create('div','ah-wm-stage');
    stage.setAttribute('role','img');stage.setAttribute('aria-label','Weather animation preview');
    const selection=create('div','ah-wm-selection'),name=create('span','ah-wm-condition'),range=create('span','ah-wm-range');
    selection.setAttribute('aria-live','polite');selection.append(name,range);
    const label=create('label','ah-wm-demo-label');label.append(document.createTextNode('Weather animation preview'));
    const select=create('select','ah-wm-demo-select cursor-interaction');select.setAttribute('aria-label','Weather animation preview condition');
    Object.entries(kinds).forEach(([value,text])=>{const option=create('option');option.value=value;option.textContent=text;select.append(option);});
    select.value=selected.kind;label.append(select);
    const note=create('p','ah-wm-demo-note');detail.append(stage,selection,label,note);
    const actions=content.querySelector('.ah-panel-actions');content.insertBefore(detail,actions||null);
    select.addEventListener('change',()=>{stage.setAttribute('aria-label',kinds[select.value]+' animation preview');updateDetail(detail,select.value);});
    updateDetail(detail,selected.kind);stage.setAttribute('aria-label',selected.condition+' animation preview');
  }
  function refresh(){queued=false;decorateCards();decorateDetail();}
  function queue(){if(!queued){queued=true;queueMicrotask(refresh);}}
  root.addEventListener('click',event=>{
    const card=event.target.closest('.ah-weather-day[data-weather]');if(!card||!forecast.contains(card))return;
    selected=readCard(card);queue();
  },true);
  const observer=new MutationObserver(queue);
  observer.observe(forecast,{childList:true,subtree:true});observer.observe(content,{childList:true,subtree:true});
  observer.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  const visibility=()=>{root.dataset.ahWmHidden=String(document.hidden);};
  document.addEventListener('visibilitychange',visibility);
  visibility();refresh();
})();

;

(() => {
  const root=document.getElementById('aurora-home-preview');
  if(!root||root.dataset.calendarExpanded)return;
  root.dataset.calendarExpanded='true';
  const calendar=root.querySelector('.ah-calendar');
  if(!calendar)return;
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons=()=>{if(globalThis.lucide)globalThis.lucide.createIcons({attrs:{width:16,height:16}});};
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=t=>parts.find(p=>p.type===t).value;
  const today=`${part('year')}-${part('month')}-${part('day')}`;
  const dateKey=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const toDate=key=>{const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12);};
  const human=key=>new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'long'}).format(toDate(key));
  let selected=today,month=Number(part('month'))-1,year=Number(part('year')),view='month',sequence=0,opener=null;
  const tasks=window.__auroraNative.loadTasks(); sequence=Math.max(0,...tasks.map(task=>task.id)); const persistTasks=()=>window.__auroraNative.saveTasks(tasks);
  const openButton=document.createElement('button');openButton.type='button';openButton.className='ac-open cursor-interaction';openButton.innerHTML=`${icon('calendar-days')} Open calendar`;
  calendar.append(openButton);
  const summary=document.createElement('div');summary.className='ac-tasks-widget';summary.innerHTML=`<div class="ah-section-head" style="margin-bottom:0"><h2>Things to do</h2><button type="button" class="ah-text-button cursor-interaction" data-ac-open-add>Add task</button></div><p class="ac-task-summary">No local tasks</p>`;calendar.append(summary);
  const layer=document.createElement('div');layer.className='ac-layer';layer.hidden=true;
  layer.innerHTML=`<section class="ac-window" role="dialog" aria-modal="true" aria-label="Calendar and things to do" data-view="month"><header class="ac-bar"><h2>${icon('calendar-days')} Calendar</h2><button type="button" class="ah-icon-button cursor-interaction" data-ac-close aria-label="Close calendar">${icon('x')}</button></header><div class="ac-toolbar"><div class="ac-month-controls"><button type="button" class="ah-icon-button cursor-interaction" data-ac-step="-1" aria-label="Previous calendar month">${icon('chevron-left')}</button><span class="ac-month-label"></span><button type="button" class="ah-icon-button cursor-interaction" data-ac-step="1" aria-label="Next calendar month">${icon('chevron-right')}</button></div><div class="ac-view-controls" aria-label="Calendar view"><button type="button" class="cursor-interaction" data-ac-today>Today</button><button type="button" class="cursor-interaction" data-ac-view="month" aria-pressed="true">All dates</button><button type="button" class="cursor-interaction" data-ac-view="agenda" aria-pressed="false">Things to do</button></div></div><div class="ac-layout"><section class="ac-month-grid" aria-label="All dates in selected month"><div class="ac-week" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="ac-grid"></div><label class="ac-jump">Jump to date<input type="date" aria-label="Jump to date" value="${today}" min="1900-01-01" max="2199-12-31"></label></section><section class="ac-task-panel"><h3>Things to do</h3><p class="ac-selected-label"></p><div class="ac-task-list"></div><form class="ac-form"><label>New task<input name="task" type="text" aria-label="New task" placeholder="What would you like to do?" maxlength="160" required autocomplete="off"></label><div class="ac-form-bottom"><label>Time (optional)<input name="time" type="time" aria-label="Task time, optional"></label><button type="submit" class="ah-primary cursor-interaction">Add task</button></div><p class="ac-feedback" role="status" aria-live="polite"></p></form></section><section class="ac-agenda"><div class="ac-agenda-head"><h3>Your task list</h3><button type="button" class="ah-primary cursor-interaction" data-ac-new>Add task</button></div><div class="ac-agenda-list"></div></section></div><p class="ac-note">Local tasks are saved on this PC. Outlook is not connected.</p></section>`;
  root.append(layer);
  const $=s=>layer.querySelector(s);
  const panel=$('.ac-window');
  const addButton=$('.ac-form button');addButton.type='button';addButton.dataset.acAdd='true';
  const rows=list=>list.length?list.map(t=>`<div class="ac-task-row ${t.done?'ac-done':''}"><label><input type="checkbox" data-ac-check="${t.id}" ${t.done?'checked':''} aria-label="Complete ${esc(t.title)}"><span><span class="ac-task-title">${esc(t.title)}</span><small>${human(t.date)}${t.time?' · '+t.time:''}</small></span></label><button type="button" class="ah-icon-button cursor-interaction" data-ac-delete="${t.id}" aria-label="Remove ${esc(t.title)}">${icon('x')}</button></div>`).join(''):'<p class="ac-empty">Nothing planned here yet.</p>';
  function render(){
    panel.dataset.view=view;
    $('.ac-month-label').textContent=new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric'}).format(new Date(year,month,1));
    const offset=(new Date(year,month,1).getDay()+6)%7,days=new Date(year,month+1,0).getDate();
    $('.ac-grid').innerHTML='<span></span>'.repeat(offset)+Array.from({length:days},(_,i)=>{const key=dateKey(year,month,i+1);return `<button type="button" class="cursor-interaction ${key===today?'ac-today':''} ${tasks.some(t=>t.date===key&&!t.done)?'ac-has-task':''}" data-ac-date="${key}" aria-label="${human(key)}, ${year}" aria-pressed="${key===selected}">${i+1}</button>`;}).join('');
    $('.ac-selected-label').textContent=human(selected);
    $('.ac-jump input').value=selected;
    $('.ac-task-list').innerHTML=rows(tasks.filter(t=>t.date===selected));
    $('.ac-agenda-list').innerHTML=rows([...tasks].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)));
    layer.querySelectorAll('[data-ac-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.acView===view)));
    const pending=tasks.filter(t=>!t.done).length;
    summary.querySelector('.ac-task-summary').textContent=tasks.length?`${pending} task${pending===1?'':'s'} remaining · Saved on this PC`:'No local tasks';
    icons();
    root.dispatchEvent(new CustomEvent('galaxy-atlas:calendar-render',{detail:{selectedDate:selected,year,month,view}}));
  }
  function open(add=false){opener=document.activeElement;layer.hidden=false;view='month';render();root.dispatchEvent(new CustomEvent('galaxy-atlas:calendar-open'));requestAnimationFrame(()=>{panel.scrollIntoView({block:'start',behavior:root.dataset.motion==='full'?'smooth':'auto'});(add?$('.ac-form input'): $('[data-ac-close]')).focus({preventScroll:true});});}
  function close(){layer.hidden=true;if(opener?.isConnected)opener.focus({preventScroll:true});}
  openButton.addEventListener('click',()=>open());
  summary.querySelector('button').addEventListener('click',()=>open(true));
  root.addEventListener('click',e=>{const b=e.target.closest('[data-app="Calendar"],[data-command="show-calendar"]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();const mainClose=root.querySelector('.ah-window-layer:not([hidden]) [data-action="close"]');if(mainClose)mainClose.click();open();},true);
  layer.addEventListener('click',e=>{
    if(e.target===layer){close();return;}
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-ac-close')){close();return;}
    if(b.dataset.acStep){month+=Number(b.dataset.acStep);if(month<0){month=11;year--;}if(month>11){month=0;year++;}year=Math.max(1900,Math.min(2199,year));render();}
    if(b.dataset.acDate){selected=b.dataset.acDate;render();}
    if(b.hasAttribute('data-ac-today')){selected=today;month=Number(part('month'))-1;year=Number(part('year'));view='month';render();}
    if(b.dataset.acView){view=b.dataset.acView;render();}
    if(b.hasAttribute('data-ac-new')){view='month';render();$('.ac-form input').focus();}
    if(b.hasAttribute('data-ac-add'))addTask();
    if(b.dataset.acDelete){const index=tasks.findIndex(t=>t.id===Number(b.dataset.acDelete));if(index>=0)tasks.splice(index,1);persistTasks();render();}
  });
  layer.addEventListener('change',e=>{if(e.target.matches('.ac-jump input')&&e.target.value){selected=e.target.value;const d=toDate(selected);year=d.getFullYear();month=d.getMonth();render();}if(e.target.dataset.acCheck){const t=tasks.find(t=>t.id===Number(e.target.dataset.acCheck));if(t)t.done=e.target.checked;persistTasks();render();}});
  function addTask(){const field=$('.ac-form input[name=task]'),title=field.value.trim();if(!title){field.focus();return;}tasks.push({id:++sequence,title,date:selected,time:$('.ac-form input[name=time]').value,done:false});persistTasks();field.value='';render();$('.ac-feedback').textContent='Saved on this PC.';field.focus();}
  $('.ac-form').addEventListener('submit',e=>{e.preventDefault();addTask();});
  $('.ac-form input[name=task]').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addTask();}});
  layer.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const controls=[...layer.querySelectorAll('button,input')].filter(el=>el.getClientRects().length&&!el.disabled),first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  render();
})();

;

(() => {
  'use strict';
  const root = document.getElementById('aurora-home-preview');
  if (!root || root.dataset.ahWaReady) return;
  const panel = root.querySelector('.ah-window');
  const bar = root.querySelector('.ah-window-bar');
  const layer = root.querySelector('.ah-window-layer');
  const content = root.querySelector('.ah-window-content');
  const barActions = bar?.querySelector('div');
  if (!panel || !bar || !layer || !content || !barActions) return;
  root.dataset.ahWaReady = 'true';

  const mobile = window.matchMedia('(max-width:700px)');
  const favourites = new Set();
  const placement = {mode:'centre',x:0,y:96};
  let drag = null, frame = 0, menuContext = null, lastPanel = '', wasOpen = false;
  let latestSnapshot = window.openai?.widgetState || {};
  const icons = () => { if (window.lucide?.createIcons) window.lucide.createIcons({attrs:{width:16,height:16}}); };
  const makeIcon = name => { const el=document.createElement('i');el.dataset.lucide=name;el.setAttribute('aria-hidden','true');return el; };
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const nameOf = button => (button?.getAttribute('aria-label') || '').replace(/^Preview\s+/,'').trim();
  const categoryName = () => [...(content.querySelector('h3')?.childNodes || [])].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim();
  const folderFor = name => [...root.querySelectorAll('.ah-folder[data-folder]')].find(button=>nameOf(button)===name);
  const announce = message => { live.textContent=message; };

  const snap = document.createElement('div');
  snap.className='ah-wa-snap-controls';snap.setAttribute('role','group');snap.setAttribute('aria-label','Panel position');
  [['left','panel-left','Snap panel left'],['centre','square','Centre panel'],['right','panel-right','Snap panel right']].forEach(([mode,icon,label])=>{
    const button=document.createElement('button');button.type='button';button.className='ah-icon-button cursor-interaction';
    button.dataset.ahWaSnap=mode;button.setAttribute('aria-label',label);button.dataset.tooltip=label;
    button.append(makeIcon(icon));snap.append(button);
  });
  barActions.prepend(snap);
  const live=document.createElement('div');live.className='ah-wa-live';live.setAttribute('aria-live','polite');root.append(live);
  const menu=document.createElement('div');menu.id='aurora-home-folder-actions';menu.className='ah-wa-folder-menu';
  menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','Folder actions');
  const menuName=document.createElement('div');menuName.className='ah-wa-menu-name';menu.append(menuName);
  const preview=document.createElement('button');preview.type='button';preview.className='cursor-interaction';preview.append(makeIcon('folder-open'),document.createTextNode('Preview category'));
  const favourite=document.createElement('button');favourite.type='button';favourite.className='cursor-interaction';
  const favouriteLabel=document.createElement('span');favourite.append(makeIcon('star'),favouriteLabel);
  menu.append(preview,favourite);root.append(menu);

  function readSaved(snapshot) {
    const saved=snapshot?.privateContent?.auroraWindowActions;
    if (!saved || saved.version!==1) return;
    favourites.clear();
    if (Array.isArray(saved.favourites)) saved.favourites.filter(name=>typeof name==='string'&&name.length<100).slice(0,16).forEach(name=>favourites.add(name));
    if (['left','centre','right','free'].includes(saved.position?.mode)) placement.mode=saved.position.mode;
    if (Number.isFinite(saved.position?.x)) placement.x=saved.position.x;
    if (Number.isFinite(saved.position?.y)) placement.y=saved.position.y;
  }
  function save() {
    if (!window.openai?.setWidgetState) return;
    const base=window.openai.widgetState || latestSnapshot;
    const snapshot={
      modelContent:{...(base.modelContent || {}),favouriteCategories:[...favourites]},
      privateContent:{...(base.privateContent || {}),auroraWindowActions:{version:1,favourites:[...favourites],position:{...placement}}}
    };
    latestSnapshot=snapshot;
    window.openai.setWidgetState(snapshot).catch(()=>{});
  }
  readSaved(latestSnapshot);

  function fitPanel() {
    if (layer.hidden) return;
    const isNotifications=panel.dataset.panel==='notifications';
    snap.hidden=mobile.matches || root.clientWidth<=700;
    if (snap.hidden && !isNotifications) {
      panel.classList.remove('ah-wa-placed','ah-wa-oversize');
      ['left','top','max-height'].forEach(property=>panel.style.removeProperty(property));
      return;
    }
    const margin=16, width=root.clientWidth, height=root.clientHeight;
    if (!width || !height) return;
    panel.classList.add('ah-wa-placed');
    let bottomEdge=height-margin;
    if (isNotifications) {
      // The footer already reserves the native dock's space. Keep this panel
      // above its real top edge, including when display scaling changes.
      const bounds=root.getBoundingClientRect(),footer=root.querySelector('.ah-bottom')?.getBoundingClientRect();
      if (bounds.height>0 && footer?.height>0) {
        const footerTop=(footer.top-bounds.top)*height/bounds.height;
        if (footerTop>margin && footerTop<height) bottomEdge=Math.min(bottomEdge,footerTop-margin);
      }
    }
    const availableHeight=isNotifications?Math.max(1,bottomEdge-margin):Math.max(160,height-margin*2);
    panel.style.maxHeight=availableHeight+'px';
    panel.classList.toggle('ah-wa-oversize',bar.offsetHeight+content.scrollHeight+2>availableHeight);
    const maxX=Math.max(margin,width-panel.offsetWidth-margin);
    const maxY=Math.max(margin,bottomEdge-panel.offsetHeight);
    if (placement.mode==='left') placement.x=margin;
    if (placement.mode==='centre' || (isNotifications && snap.hidden)) placement.x=(width-panel.offsetWidth)/2;
    if (placement.mode==='right') placement.x=maxX;
    placement.x=clamp(placement.x,margin,maxX);placement.y=clamp(placement.y,margin,maxY);
    panel.style.left=Math.round(placement.x)+'px';panel.style.top=Math.round(placement.y)+'px';
  }
  function updateFavourites() {
    let added=false;
    root.querySelectorAll('.ah-folder[data-folder]').forEach(button=>{
      const existing=button.querySelector('.ah-wa-favourite-marker');
      if (favourites.has(nameOf(button)) && !existing) {
        const marker=document.createElement('span');marker.className='ah-wa-favourite-marker';
        marker.setAttribute('role','img');marker.setAttribute('aria-label','Favourite');marker.append(makeIcon('star'));button.append(marker);added=true;
      } else if (!favourites.has(nameOf(button)) && existing) existing.remove();
    });
    const heading=panel.dataset.panel==='folder' ? content.querySelector('h3') : null;
    if (heading) {
      const existing=heading.querySelector('.ah-wa-favourite-heading');
      if (favourites.has(categoryName()) && !existing) {
        const marker=document.createElement('span');marker.className='ah-wa-favourite-heading';
        marker.append(makeIcon('star'),document.createTextNode('Favourite'));heading.append(marker);added=true;
      } else if (!favourites.has(categoryName()) && existing) existing.remove();
    }
    if (added) icons();
  }
  function enhance() {
    frame=0;
    updateFavourites();
    const open=!layer.hidden;
    if (!open) { if(wasOpen){endDrag();closeMenu(false);}wasOpen=false;return; }
    const panelKey=panel.dataset.panel+':'+(panel.dataset.panel==='folder'?categoryName():'');
    if (lastPanel!==panelKey || !wasOpen) { closeMenu(false);endDrag(); }
    lastPanel=panelKey;wasOpen=true;
    if (panel.dataset.panel==='folder' && !content.querySelector('.ah-wa-folder-actions')) {
      const actions=content.querySelector('.ah-panel-actions') || content;
      const button=document.createElement('button');button.type='button';button.className='ah-secondary ah-wa-folder-actions cursor-interaction';
      button.setAttribute('aria-label','Folder actions for '+categoryName());button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
      button.append(makeIcon('ellipsis'),document.createTextNode('Folder actions'));actions.append(button);icons();
    }
    fitPanel();
    if (menuContext && !menu.hidden) fitMenu(menuContext.x,menuContext.y);
  }
  function schedule() { if(!frame) frame=requestAnimationFrame(enhance); }
  function endDrag() {
    if (!drag) return;
    const id=drag.id;drag=null;panel.classList.remove('ah-wa-dragging');
    if (bar.hasPointerCapture?.(id)) bar.releasePointerCapture(id);
  }
  function fitMenu(x,y) {
    menu.style.left=Math.round(clamp(x,12,Math.max(12,root.clientWidth-menu.offsetWidth-12)))+'px';
    menu.style.top=Math.round(clamp(y,12,Math.max(12,root.clientHeight-menu.offsetHeight-12)))+'px';
  }
  function openMenu(name,trigger,clientX,clientY) {
    if (!name) return;
    closeMenu(false);
    const bounds=root.getBoundingClientRect(), anchor=trigger.getBoundingClientRect();
    const sx=root.clientWidth/bounds.width,sy=root.clientHeight/bounds.height;
    const x=(Number.isFinite(clientX)?clientX:anchor.left)-bounds.left;
    const y=(Number.isFinite(clientY)?clientY:anchor.bottom+6)-bounds.top;
    menuContext={name,trigger,x:x*sx,y:y*sy};menuName.textContent=name;
    favouriteLabel.textContent=favourites.has(name)?'Remove from favourites':'Add to favourites';
    favourite.setAttribute('aria-pressed',String(favourites.has(name)));menu.hidden=false;
    if(trigger.classList.contains('ah-wa-folder-actions'))trigger.setAttribute('aria-expanded','true');
    fitMenu(menuContext.x,menuContext.y);preview.focus({preventScroll:true});
  }
  function closeMenu(restoreFocus) {
    const trigger=menuContext?.trigger;menu.hidden=true;menuContext=null;
    if(trigger?.isConnected){if(trigger.classList.contains('ah-wa-folder-actions'))trigger.setAttribute('aria-expanded','false');if(restoreFocus)trigger.focus({preventScroll:true});}
  }
  bar.addEventListener('pointerdown',event=>{
    if(event.button!==0 || mobile.matches || root.clientWidth<=700 || event.target.closest('button,input,textarea,select,a'))return;
    fitPanel();const bounds=root.getBoundingClientRect();
    drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:placement.x,y:placement.y,sx:root.clientWidth/bounds.width,sy:root.clientHeight/bounds.height,moved:false};
    placement.mode='free';panel.classList.add('ah-wa-dragging');bar.setPointerCapture(event.pointerId);event.preventDefault();
  });
  bar.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.id)return;
    placement.x=drag.x+(event.clientX-drag.startX)*drag.sx;placement.y=drag.y+(event.clientY-drag.startY)*drag.sy;
    drag.moved=true;fitPanel();
  });
  const finishDrag=event=>{if(!drag || event.pointerId!==drag.id)return;const moved=drag.moved;endDrag();if(moved)save();};
  bar.addEventListener('pointerup',finishDrag);bar.addEventListener('pointercancel',finishDrag);bar.addEventListener('lostpointercapture',()=>endDrag());
  snap.addEventListener('click',event=>{
    const button=event.target.closest('[data-ah-wa-snap]');if(!button)return;
    endDrag();placement.mode=button.dataset.ahWaSnap;fitPanel();save();announce(button.getAttribute('aria-label')+' selected.');
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('.ah-wa-folder-actions');
    if(button){if(menuContext?.trigger===button&&!menu.hidden)closeMenu(true);else openMenu(categoryName(),button);}
  });
  root.addEventListener('contextmenu',event=>{
    const folder=event.target.closest('.ah-folder[data-folder]');
    const inFolder=!layer.hidden && panel.dataset.panel==='folder' && content.contains(event.target);
    if(!folder&&!inFolder)return;
    if(event.target.closest('input,textarea,select'))return;
    event.preventDefault();
    const trigger=folder || content.querySelector('.ah-wa-folder-actions');if(!trigger)return;
    openMenu(folder?nameOf(folder):categoryName(),trigger,event.clientX||undefined,event.clientY||undefined);
  });
  root.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&event.target!==menuContext?.trigger&&!menuContext?.trigger?.contains(event.target))closeMenu(false);},true);
  root.addEventListener('keydown',event=>{
    if(menu.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeMenu(true);return;}
    if(!menu.contains(event.target))return;
    const items=[preview,favourite],index=items.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End','Tab'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Tab'&&((event.shiftKey&&index===0)||(!event.shiftKey&&index===items.length-1))){closeMenu(true);return;}
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+((event.key==='ArrowUp'||(event.key==='Tab'&&event.shiftKey))?-1:1)+items.length)%items.length;
      items[next].focus({preventScroll:true});
    }
  },true);
  preview.addEventListener('click',()=>{
    const name=menuContext?.name;if(!name)return;const folder=folderFor(name);closeMenu(false);
    if(folder)folder.click();announce(name+' category preview.');
  });
  favourite.addEventListener('click',()=>{
    const name=menuContext?.name;if(!name)return;
    if(favourites.has(name))favourites.delete(name);else favourites.add(name);
    const added=favourites.has(name);closeMenu(true);updateFavourites();save();announce(name+(added?' added to':' removed from')+' favourites in this preview.');
  });
  window.addEventListener('openai:set_globals',event=>{
    const incoming=event.detail?.globals?.widgetState;if(!incoming)return;
    latestSnapshot=incoming;readSaved(incoming);updateFavourites();schedule();
  });
  mobile.addEventListener('change',()=>{endDrag();schedule();});
  window.addEventListener('resize',schedule);
  const observer=new MutationObserver(schedule);
  observer.observe(content,{childList:true,subtree:true});
  observer.observe(layer,{attributes:true,attributeFilter:['hidden']});
  observer.observe(panel,{attributes:true,attributeFilter:['data-panel']});
  root.querySelectorAll('.ah-folders').forEach(container=>observer.observe(container,{childList:true,subtree:true}));
  if(window.ResizeObserver){const resize=new ResizeObserver(schedule);resize.observe(root);resize.observe(panel);const footer=root.querySelector('.ah-bottom');if(footer)resize.observe(footer);}
  icons();updateFavourites();schedule();
})();

const nativeActivityCleanup=initNativeActivity({root:document.getElementById('aurora-home-preview'),subscribe});
window.addEventListener('pagehide',()=>{nativeActivityCleanup();},{once:true});
const disposeSearchIntegration=initSearchIntegration({root:document.getElementById('aurora-home-preview'),invoke,SeelenCommand,searchWidgetId:'@galaxy-atlas/search',runCommand:window.__auroraRunCommand,closePanel:window.__auroraClosePanel,status:nativeStatus});
window.addEventListener('pagehide',disposeSearchIntegration,{once:true});
await finishNative();
window.__auroraNotifications=initNativeNotifications({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent,nativeStatus,popups:false});
initPlaybackReactive({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent,enabled:true});
initWindowLaunch({root:document.getElementById('aurora-home-preview')});
void initSystemControls({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent,nativeStatus,openPanel:()=>window.__auroraOpenPanel('quick-controls')}).then(cleanup=>window.addEventListener('pagehide',cleanup,{once:true})).catch(error=>{console.warn('Galaxy Atlas system controls unavailable',error);nativeStatus('System controls are unavailable.');});
const disposeSurfaces=initInteractiveSurfaces({root:document.getElementById('aurora-home-preview')});
window.addEventListener('pagehide',disposeSurfaces,{once:true});
void initOutlookCalendar({root:document.getElementById('aurora-home-preview'),invoke,SeelenCommand}).then(cleanup=>window.addEventListener('pagehide',cleanup,{once:true})).catch(console.warn);
void initLiveData({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent}).then(cleanup=>window.addEventListener('pagehide',cleanup,{once:true})).catch(error=>{console.warn('Galaxy Atlas live data unavailable',error);nativeStatus('Live data is unavailable.');});
} catch(error) { console.error('Galaxy Atlas startup failed',error); document.body.innerHTML='<main style="padding:32px;color:#d9edff;background:#101b2a;font:16px Segoe UI"><h1>Galaxy Atlas could not start</h1><p>The normal Windows desktop is still available. Disable Galaxy Atlas in Seelen settings, then review the startup log.</p></main>'; try { const {Widget}=await import('@seelen-ui/lib'); await Widget.self.ready({show:true}); } catch {} }

const disposeThemes=initThemeSelector({root:document.getElementById('aurora-home-preview'),invoke,SeelenCommand,homeWidgetId:'@galaxy-atlas/desktop',status:nativeStatus});
window.addEventListener('pagehide',disposeThemes,{once:true});
const stopGalaxy=startGalaxy({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent});
const stopDesktopPages=mountDesktopPages({root:document.getElementById('aurora-home-preview'),invoke,subscribe,SeelenCommand,SeelenEvent});
window.addEventListener('pagehide',stopDesktopPages,{once:true});
window.addEventListener('pagehide',stopGalaxy,{once:true});
