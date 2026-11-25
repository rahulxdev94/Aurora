/* Local site preferences for the verified Chrome Windows notification sender.
 * Pinned to the installed Chrome 156.0.8078.80 NORMAL toast launch format:
 * https://github.com/chromium/chromium/blob/156.0.8078.80/chrome/browser/notifications/win/notification_launch_id.cc
 * https://github.com/chromium/chromium/blob/156.0.8078.80/chrome/browser/notifications/win/notification_template_builder.cc
 * Seelen can expose Toast.@launch; its plain-text fallback omits the value.
 * Text's placement="attribution" is not preserved, so it cannot identify sites.
 * Display text, notification identifiers and profiles never decide site identity.
 */
const CHROME_SENDER='chrome';
const MAX_RULES=32,MAX_ORIGIN_LENGTH=2048,MAX_LAUNCH_LENGTH=4096;
const controls=/[\u0000-\u001f\u007f]/;

function httpsOrigin(value,{trim=false}={}){
  if(typeof value!=='string'||value.length>MAX_ORIGIN_LENGTH)return null;
  const raw=trim?value.trim():value;
  // An origin has no credentials, path, query or fragment. Reject ambiguous
  // separators before URL canonicalisation can hide a path or backslash.
  if(!raw||/[\s\\]/.test(raw)||controls.test(raw)||!/^https:\/\/[^/?#]+\/?$/i.test(raw))return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||!url.hostname||url.pathname!=='/'||url.search||url.hash)return null;
    return url.origin;
  }catch{return null;}
}

/** V1 admits the observed Chrome AUMID only, never a browser-name pattern. */
export function normaliseNotificationSiteRules(values){
  if(!Array.isArray(values))return[];
  const result=[],seen=new Set();
  for(const value of values){
    if(!value||typeof value.appId!=='string'||value.appId.trim().toLowerCase()!==CHROME_SENDER)continue;
    const origin=httpsOrigin(value.origin,{trim:true});if(!origin)continue;
    const key=CHROME_SENDER+'|'+origin;if(seen.has(key))continue;
    seen.add(key);result.push({appId:CHROME_SENDER,origin});
    if(result.length===MAX_RULES)break;
  }
  return result;
}

/** Classify native launch metadata only. No data is persisted or returned. */
export function notificationMatchesPrioritySite(item,rules){
  const sender=typeof item?.appId==='string'?item.appId.trim().toLowerCase():'';
  if(sender!==CHROME_SENDER||typeof item.args!=='string'||item.args.length===0||item.args.length>MAX_LAUNCH_LENGTH||controls.test(item.args))return false;
  const tokens=item.args.split('|');
  // NORMAL | WEB_PERSISTENT / WEB_NON_PERSISTENT | profile | AUMID |
  // incognito | origin | notification-id (the final field may contain pipes).
  // Context menus and action-button launch formats are deliberately unsupported.
  if(tokens.length<7||tokens[0]!=='0'||!['0','1'].includes(tokens[1]))return false;
  if(!tokens[2].trim()||tokens[2].length>256||tokens[3].toLowerCase()!==sender||tokens[4]!=='0')return false;
  if(!tokens.slice(6).join('|').trim())return false;
  const origin=httpsOrigin(tokens[5]);if(!origin)return false;
  return normaliseNotificationSiteRules(rules).some(rule=>rule.appId===sender&&rule.origin===origin);
}
