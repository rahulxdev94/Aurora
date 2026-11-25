import {validateCompanionLaunchers} from './companion-launchers.mjs';
import {mountDesktopVoice} from './desktop-voice.mjs';
import {CHATGPT_APP} from './config.mjs';

const STORE='galaxy-atlas.opened-chat-links.v1';
const PUBLISHERS=new Set(['openai.chatgpt-desktop_2p2nqsd0c76g0!chatgpt','openai.codex_2p2nqsd0c76g0!app']);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function chatLink(input){
  try{
    const url=new URL(input);
    const path=/^\/c\/([^/]+)\/?$/.exec(url.pathname);
    if(url.protocol==='https:'&&['chatgpt.com','chat.openai.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password&&path&&UUID.test(path[1]))return 'https://chatgpt.com/c/'+path[1].toLowerCase();
  }catch{}
  return null;
}

export function aiNotices(items,dotUrl=''){
  const dots=[],chats=[];
  for(const item of items||[]){
    if(!PUBLISHERS.has(String(item.appId||'').toLowerCase()))continue;
    const target=String(item.args||'').trim();
    const url=chatLink(target);
    if(url&&!chats.some(row=>row.url===url))chats.push({url,title:item.title,at:item.at});
    let dot=false;
    try{
      const u=new URL(target);
      dot=!u.username&&!u.password&&!u.port&&(
        (u.protocol==='codex:'&&u.hostname==='dots'&&!u.search&&!u.hash)||
        (u.protocol==='https:'&&u.hostname==='chatgpt.com'&&/^\/dots(?:\/|$)/.test(u.pathname))||
        (!!dotUrl&&target===dotUrl));
    }catch{}
    if(dot)dots.push({title:item.title,body:item.body,at:item.at});
  }
  return {dots:dots.slice(0,5),chats:chats.slice(0,8)};
}

export function mountDesktopAi({host,launch,window:win,document:doc,config}){
  const make=(tag,cls,text)=>{const el=doc.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
  const button=(label,action)=>{const b=make('button','atlas-action cursor-interaction',label);b.type='button';b.addEventListener('click',action);return b;};
  const settings=validateCompanionLaunchers(config.launchers||{});
  const voiceNative=settings.voiceHotkeyConfigured&&settings.voiceLauncher;
  const message=make('p','atlas-feedback');message.setAttribute('role','status');
  async function open(target,success){
    const ok=await launch(target);message.textContent=ok?(success||'Opened in Windows.'):'Windows could not open this action.';return ok;
  }
  const header=make('header','atlas-page-head');header.append(make('h2','','AI'));
  const cards=make('div','atlas-ai-cards');
  const chat=make('section','atlas-desk-card atlas-chat-card');chat.append(make('h3','','ChatGPT'),make('p','','Ask a question or continue a conversation.'));
  const chatOpen=async()=>await open(CHATGPT_APP,'Opened ChatGPT.')||await open('https://chatgpt.com/','Opened ChatGPT in your browser.');
  const actions=make('div','atlas-actions');actions.append(button('Open ChatGPT',chatOpen));
  if(voiceNative)actions.append(button('ChatGPT Voice',()=>open(settings.voiceLauncher,'Sent the configured Windows voice shortcut.')));
  chat.append(actions);
  const dot=make('section','atlas-desk-card');dot.append(make('h3','','My Dot'),
    button('Open My Dot',()=>open(settings.scarlettUrl||'https://chatgpt.com/dots')),make('h4','','Dot updates'));
  const dotRows=make('div','atlas-simple-list');dot.append(dotRows);
  const anchor=make('section','atlas-desk-card');anchor.append(make('h3','','Anchor'));
  if(settings.anchorUrl)anchor.append(make('p','','Your reminders on the web.'),button('Open Anchor website',()=>open(settings.anchorUrl)));
  else anchor.append(make('p','','Anchor has no configured Windows destination.'));
  const history=make('section','atlas-desk-card');history.append(make('h3','','Recent chats'));
  const recent=make('div','atlas-simple-list');
  const linkBox=make('details','atlas-chat-link');linkBox.append(make('summary','','Open a chat link'));
  const form=make('form','atlas-link-form'),field=make('input',''),title=make('input','');
  field.type='url';field.required=true;field.placeholder='https://chatgpt.com/c/…';field.setAttribute('aria-label','ChatGPT conversation link');
  title.maxLength=150;title.placeholder='Name (optional)';title.setAttribute('aria-label','Conversation name');
  const submit=make('button','atlas-action cursor-interaction','Open chat');submit.type='submit';
  form.append(field,title,submit);linkBox.append(form);history.append(recent,linkBox);
  const voice=make('section','atlas-desk-card atlas-ai-voice');
  const voiceWidget=mountDesktopVoice({host:voice,window:win,document:doc});
  cards.append(chat,dot,history,anchor,voice);host.append(header,cards,message);
  let active=false;
  function read(){
    try{const rows=JSON.parse(win.localStorage.getItem(STORE)||'[]');return Array.isArray(rows)?rows.filter(x=>x&&chatLink(x.url)&&typeof x.title==='string').slice(0,8):[];}catch{return [];}
  }
  async function openConversation(link,name){
    if(!await open(link))return;
    const next=[{url:link,title:String(name||'ChatGPT conversation').slice(0,150),at:Date.now()},...read().filter(x=>x.url!==link)].slice(0,8);
    try{win.localStorage.setItem(STORE,JSON.stringify(next));}catch{}
    field.value=title.value='';linkBox.open=false;render();
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();const link=chatLink(field.value.trim());
    if(!link){message.textContent='Use a ChatGPT conversation link containing /c/.';field.focus();return;}
    void openConversation(link,title.value.trim());
  });
  function render(){
    if(!active)return;
    const picked=aiNotices(win.__auroraNotifications?.aiNotificationCandidates?.()||[],settings.scarlettUrl);
    const rows=[...read(),...picked.chats].filter((r,i,a)=>a.findIndex(x=>x.url===r.url)===i).slice(0,8);
    recent.replaceChildren(...rows.map(row=>button(row.title,()=>openConversation(row.url,row.title))));
    if(rows.length)recent.prepend(make('p','','Opened here or linked from a ChatGPT notification.'));
    if(!rows.length)recent.append(make('p','','Chats opened here appear here. Open ChatGPT’s sidebar for your full history.'));
    dotRows.replaceChildren(...picked.dots.map(row=>{
      const el=make('article','');el.append(make('strong','',row.title));if(row.body)el.append(make('p','',row.body.slice(0,380)));return el;
    }));
    if(!picked.dots.length)dotRows.append(make('p','','No Windows notifications linked to My Dot.'));
  }
  win.addEventListener('galaxy-atlas:notifications-changed',render);
  return {setActive(next){active=next;voiceWidget?.setActive?.(next);render();},
    dispose(){win.removeEventListener('galaxy-atlas:notifications-changed',render);voiceWidget?.dispose?.();}};
}
