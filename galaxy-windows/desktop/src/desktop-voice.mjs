const callsEndpoint='https://api.openai.com/v1/realtime/calls';
const demoText='This is the local voice demo. The light follows my reply. You can interrupt me, or end the session.';

export function mountDesktopVoice({host,window:win,document:doc}) {
  const make=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const button=(label,id,run)=>{const b=make('button','atlas-voice-button',label);b.type='button';b.dataset.voiceAction=id;b.addEventListener('click',run);return b;};
  const title=make('h3','','Voice session'),status=make('p','atlas-voice-status','Ready for a local demo or an API session.');
  status.setAttribute('role','status');
  const lamp=make('span','atlas-voice-lamp');lamp.setAttribute('aria-hidden','true');
  const heading=make('div','atlas-voice-heading');heading.append(lamp,title);
  const transcript=make('p','atlas-voice-transcript');transcript.setAttribute('aria-label','Assistant transcript');
  const controls=make('div','atlas-voice-controls');
  const settings=make('details','atlas-voice-setup'),summary=make('summary','','Connect OpenAI Realtime');
  const disclosure=make('p','','Connecting sends your microphone audio to OpenAI and uses your API billing. Leaving this page ends the session.');
  const label=make('label','atlas-voice-token','Temporary Realtime client secret');
  const key=make('input');key.type='password';key.autocomplete='off';key.spellcheck=false;key.placeholder='ek_…';key.maxLength=2048;label.append(key);
  const docs=make('a','','How to create a temporary secret');docs.href='https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime';docs.target='_blank';docs.rel='noopener noreferrer';
  const price=make('a','','API pricing');price.href='https://openai.com/api/pricing/';price.target='_blank';price.rel='noopener noreferrer';
  const links=make('div','atlas-voice-links');links.append(docs,price);
  const connect=button('Connect microphone','connect',connectLive),demo=button('Play local voice demo','demo',startDemo);
  const mute=button('Mute mic','mute',toggleMute),interrupt=button('Interrupt','interrupt',stopReply),end=button('End','end',()=>finish('Session ended.'));
  controls.append(demo,mute,interrupt,end);settings.append(summary,disclosure,label,links,connect);
  host.append(heading,status,controls,transcript,settings);
  let current=null,visible=true,disposed=false;
  const reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
  function paint(){
    const s=current,active=Boolean(s),live=s?.kind==='live',listening=live&&s?.ready;
    demo.hidden=active;settings.hidden=active;mute.hidden=!listening;
    mute.textContent=s?.muted?'Unmute mic':'Mute mic';mute.setAttribute('aria-pressed',String(Boolean(s?.muted)));
    interrupt.hidden=!s||!(s.kind==='demo'||s.ready&&(s.response||s.playing));end.hidden=!active;
    transcript.hidden=!transcript.textContent;
    host.dataset.voiceState=s?.kind==='demo'?'demo':listening?'connected':active?'connecting':'ready';
  }
  function level(value){
    host.style.setProperty('--voice-output',String(value));
    host.dataset.voiceSpeaking=String(value>.045);
  }
  function meter(s,analyser){
    const samples=new Uint8Array(analyser.fftSize);
    let last=0;
    const read=now=>{
      if(current!==s)return;
      if(now-last>=(reduced.matches?125:32)){
        analyser.getByteTimeDomainData(samples);let total=0;
        for(const v of samples)total+=((v-128)/128)**2;
        level(Math.min(1,Math.sqrt(total/samples.length)*5));last=now;
      }
      if(s.kind==='demo'&&s.audio.duration>0){
        const words=demoText.split(' '),shown=Math.ceil(words.length*Math.min(1,s.audio.currentTime/s.audio.duration));
        const caption=words.slice(0,shown).join(' ');
        if(transcript.textContent!==caption){transcript.textContent=caption;transcript.hidden=!caption;}
      }
      s.raf=win.requestAnimationFrame(read);
    };
    win.cancelAnimationFrame(s.raf);s.raf=win.requestAnimationFrame(read);
  }
  function attachOutput(s,source,playThroughGraph){
    s.source?.disconnect();s.analyser?.disconnect();s.gain?.disconnect();s.source=source;
    const a=s.context.createAnalyser();a.fftSize=512;s.analyser=a;
    const gain=s.context.createGain();gain.gain.value=playThroughGraph?1:0;s.gain=gain;
    source.connect(a);a.connect(gain);gain.connect(s.context.destination);meter(s,a);
  }
  function finish(message,clearText=false) {
    const s=current;current=null;key.value='';
    if(s){
      s.token='';s.abort.abort();win.clearTimeout(s.timeout);win.cancelAnimationFrame(s.raf);
      s.local?.getTracks().forEach(track=>track.stop());
      if(s.pc){s.pc.ontrack=s.pc.onconnectionstatechange=null;s.pc.close();}
      if(s.channel){s.channel.onclose=s.channel.onerror=s.channel.onmessage=s.channel.onopen=null;if(s.channel.readyState!=='closed')s.channel.close();}
      s.source?.disconnect();s.analyser?.disconnect();s.gain?.disconnect();
      s.audio.onended=null;s.audio.pause();s.audio.srcObject=null;s.audio.removeAttribute('src');s.audio.load();
      void s.context.close().catch(()=>{});
    }
    if(clearText)transcript.textContent='';
    if(message)status.textContent=message;
    level(0);paint();
  }
  function begin(kind){
    if(disposed||!visible||current||doc.hidden)return null;
    const Context=win.AudioContext||win.webkitAudioContext;
    if(!Context){status.textContent='Audio playback is unavailable in this host.';return null;}
    const s={kind,context:new Context(),audio:doc.createElement('audio'),abort:new win.AbortController(),response:null,playing:false,muted:false,ready:false,parts:new Map()};
    s.audio.autoplay=true;s.audio.setAttribute('playsinline','');current=s;transcript.textContent='';settings.open=false;paint();return s;
  }
  function mediaFailure(s,prefix,e){
    if(current!==s)return;
    const reason=e?.name==='NotAllowedError'?'Microphone or audio permission was declined.':e?.name==='NotFoundError'?'No microphone is available.':prefix;
    finish(reason);
  }
  async function startDemo(){
    let s;
    try{
      s=begin('demo');if(!s)return;
      status.textContent='Local demo · synthetic voice';
      s.audio.src=typeof __ATLAS_VOICE_DEMO__==='string'?__ATLAS_VOICE_DEMO__:new URL('voice-demo.mp3',doc.baseURI).href;
      attachOutput(s,s.context.createMediaElementSource(s.audio),true);
      s.audio.onended=()=>{if(current===s){transcript.textContent=demoText;finish('Local voice demo finished.');}};
      await s.context.resume();if(current===s)await s.audio.play();
    }catch(e){mediaFailure(s,'The local voice sample could not play.',e);}
  }
  function eventFromProvider(s,raw){
    if(current!==s)return;
    let e;try{e=JSON.parse(raw);}catch{return;}
    if(e.type==='response.created')s.response=e.response?.id||null;
    if(e.type==='response.done'&&(!s.response||e.response?.id===s.response))s.response=null;
    if(e.type==='output_audio_buffer.started')s.playing=true;
    if(e.type==='output_audio_buffer.stopped'||e.type==='output_audio_buffer.cleared')s.playing=false;
    if(e.type==='response.output_audio_transcript.delta'||e.type==='response.output_audio_transcript.done'){
      const id=[e.item_id||e.response_id,e.content_index||0].join('.');
      if(typeof e.transcript==='string')s.parts.set(id,e.transcript);
      else if(typeof e.delta==='string')s.parts.set(id,(s.parts.get(id)||'')+e.delta);
      transcript.textContent=[...s.parts.values()].join('\n\n');
    }
    if(e.type==='error')status.textContent='The voice service reported an error. You can end the session and reconnect.';
    paint();
  }
  async function connectLive(){
    if(current||!visible||disposed)return;
    let token=key.value.trim();
    if(!/^ek_[A-Za-z0-9._-]+$/.test(token)){key.value='';status.textContent='Paste a temporary Realtime client secret beginning with ek_.';key.focus();return;}
    if(!win.isSecureContext||!win.RTCPeerConnection||!win.navigator.mediaDevices?.getUserMedia){key.value='';status.textContent='This host does not expose secure microphone and WebRTC access.';return;}
    key.value='';let s;
    try{
      s=begin('live');if(!s)return;s.token=token;token='';
      status.textContent='Connecting microphone…';
      s.timeout=win.setTimeout(()=>{if(current===s&&!s.ready)finish('Connection timed out. Check microphone access and try a fresh client secret.');},45000);
      await s.context.resume();if(current!==s)return;
      const local=await win.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true},video:false});
      if(current!==s){local.getTracks().forEach(t=>t.stop());return;}s.local=local;
      const pc=new win.RTCPeerConnection();s.pc=pc;
      pc.onconnectionstatechange=()=>{if(current===s&&['closed','failed'].includes(pc.connectionState))finish('Voice connection closed.');};
      pc.ontrack=async ev=>{
        if(current!==s||ev.track.kind!=='audio')return;
        const remote=ev.streams[0]||new win.MediaStream([ev.track]);s.audio.srcObject=remote;
        try{attachOutput(s,s.context.createMediaStreamSource(remote),false);await s.audio.play();}
        catch(e){mediaFailure(s,'Remote audio could not play in this host.',e);}
      };
      for(const track of local.getAudioTracks())pc.addTrack(track,local);
      const channel=pc.createDataChannel('oai-events');s.channel=channel;
      channel.onmessage=e=>eventFromProvider(s,e.data);
      channel.onerror=()=>{if(current===s)finish('Voice control channel failed.');};
      channel.onclose=()=>{if(current===s)finish('Voice session closed.');};
      channel.onopen=()=>{if(current!==s)return;s.ready=true;win.clearTimeout(s.timeout);status.textContent='Connected · microphone on';paint();};
      const offer=await pc.createOffer();
      if(current!==s)return;
      await pc.setLocalDescription(offer);if(current!==s)return;
      const request=win.fetch(callsEndpoint,{method:'POST',headers:{'Content-Type':'application/sdp',Authorization:'Bearer '+s.token},body:offer.sdp,signal:s.abort.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
      s.token='';const response=await request;if(current!==s)return;
      if(!response.ok){finish(response.status===401||response.status===403?'The temporary secret was rejected. Use a fresh one.':'The API could not establish this session (HTTP '+response.status+').');return;}
      const answer=await response.text();if(current===s)await pc.setRemoteDescription({type:'answer',sdp:answer});
    }catch(e){mediaFailure(s,'Could not connect to the Realtime API.',e);}
    finally{token='';}
  }
  function toggleMute(){
    const s=current;if(!s?.local)return;
    s.muted=!s.muted;s.local.getAudioTracks().forEach(t=>{t.enabled=!s.muted;});
    status.textContent=s.muted?'Connected · microphone muted':'Connected · microphone on';paint();
  }
  function stopReply(){
    const s=current;if(!s)return;
    if(s.kind==='demo'){finish('Local demo interrupted.');return;}
    if(s.channel?.readyState!=='open')return;
    try{
      if(s.response)s.channel.send(JSON.stringify({type:'response.cancel',response_id:s.response}));
      if(s.response||s.playing)s.channel.send(JSON.stringify({type:'output_audio_buffer.clear'}));
      s.response=null;s.playing=false;status.textContent=s.muted?'Interrupted · microphone muted':'Interrupted · listening';paint();
    }catch{finish('The voice session disconnected.');}
  }
  const onVisibility=()=>{if(doc.hidden&&current)finish('Session ended when the desktop was hidden.',true);};
  const onHide=()=>{if(current)finish('Session ended.',true);};
  doc.addEventListener('visibilitychange',onVisibility);win.addEventListener('pagehide',onHide);
  paint();
  return {setActive(active){visible=Boolean(active);if(!visible){if(current)finish('Session ended when you left the AI page.',true);key.value='';}},dispose(){disposed=true;finish('',true);doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('pagehide',onHide);host.replaceChildren();}};
}
