import assert from 'node:assert/strict';
import {normaliseNotificationSiteRules,notificationMatchesPrioritySite} from '../src/aurora-notification-sites.mjs';
import {normaliseNotifications} from '../src/aurora-notifications.mjs';

const facebook='https://www.facebook.com',instagram='https://www.instagram.com';
const rules=normaliseNotificationSiteRules([{appId:'Chrome',origin:facebook},{appId:'Chrome',origin:instagram}]);
assert.deepEqual(rules,[{appId:'chrome',origin:facebook},{appId:'chrome',origin:instagram}]);
assert.deepEqual(normaliseNotificationSiteRules([{appId:' Chrome ',origin:' HTTPS://WWW.FACEBOOK.COM:443/ '},{appId:'chrome',origin:facebook}]),[{appId:'chrome',origin:facebook}],'Rules canonicalise the HTTPS origin and deduplicate');
assert.deepEqual(normaliseNotificationSiteRules(null),[]);
assert.deepEqual(normaliseNotificationSiteRules({appId:'Chrome',origin:facebook}),[]);
assert.equal(normaliseNotificationSiteRules(Array.from({length:50},(_,i)=>({appId:'Chrome',origin:`https://site${i}.example`}))).length,32);
for(const appId of ['Microsoft Edge','ChromeBeta','Chrome.other','*','',null])assert.deepEqual(normaliseNotificationSiteRules([{appId,origin:facebook}]),[],'No broad browser sender matching');
for(const origin of ['http://www.facebook.com','https://www.facebook.com/messages','https://www.facebook.com/?q=1','https://www.facebook.com/#fragment','https://name@www.facebook.com','https://name:password@www.facebook.com','https://www.facebook.com\\','https://www.facebook.com/./','https://www.facebook.com/../','https://www.face book.com','https://'+ 'x'.repeat(2049),'*','',null]){
  assert.deepEqual(normaliseNotificationSiteRules([{appId:'Chrome',origin}]),[],`Invalid rule origin ${origin}`);
}

const launch=(origin=facebook+'/',overrides={})=>[
  overrides.kind??'0',overrides.type??'0',overrides.profile??'Default',
  overrides.embeddedSender??'Chrome',overrides.incognito??'0',origin,
  overrides.notificationId??'opaque-notification-id',
].join('|');
const item=(args=launch(),appId='Chrome')=>({appId,args,appName:'Untrusted application label',title:'Untrusted title',body:'Untrusted body'});
const matches=(args=launch(),appId='Chrome')=>notificationMatchesPrioritySite(item(args,appId),rules);
assert.equal(matches(),true);
assert.equal(matches(launch(instagram+'/')),true);
assert.equal(matches(launch(facebook,{type:'1',profile:'Profile 1',notificationId:'identifier|may|contain|pipes'})),true);
assert.equal(matches(launch('https://WWW.FACEBOOK.COM:443/',{embeddedSender:'CHROME'}),'chrome'),true,'Case and the default HTTPS port canonicalise without broadening origin');
assert.equal(notificationMatchesPrioritySite(item(),[]),false);
assert.equal(notificationMatchesPrioritySite(null,rules),false);
assert.equal(notificationMatchesPrioritySite({},rules),false);

for(const origin of [
  'http://www.facebook.com/','https://facebook.com/','https://m.facebook.com/',
  'https://www.facebook.com.attacker.invalid/','https://www.facebook.com./',
  'https://www.facebook.com:8443/','https://www.instagram.com:8443/',
  'https://attacker.invalid/?site=https://www.facebook.com',
  'https://www.facebook.com@attacker.invalid/','https://attacker@www.facebook.com/',
  'https://username:password@www.facebook.com/',
  'https://www.facebook.com/messages','https://www.facebook.com/../',
  'https://www.facebook.com/?q=1','https://www.facebook.com/#fragment',
  'https://www.facebook.com\\@attacker.invalid/',' https://www.facebook.com/',
  'https://www.facebook.com/ ','https://www.facebook.com/\n',
  '//www.facebook.com/','www.facebook.com','javascript:alert(1)',
  'https://www.facebook.com%2f.attacker.invalid/',
])assert.equal(matches(launch(origin)),false,`Origin must be an exact configured HTTPS origin: ${origin}`);

for(const patch of [{kind:'1'},{kind:'2'},{kind:'3'},{kind:'00'},{type:'2'},{type:'-1'},{type:'01'},{profile:''},{profile:' '},{profile:'x'.repeat(257)},{embeddedSender:'Microsoft Edge'},{embeddedSender:'Chrome.other'},{embeddedSender:' Chrome'},{incognito:'1'},{incognito:'true'},{incognito:''},{notificationId:''},{notificationId:' '}])assert.equal(matches(launch(facebook+'/',patch)),false,`Malformed or unsupported Chromium launch metadata ${JSON.stringify(patch)}`);
for(const args of [null,42,{},'', '0|0|Default|Chrome|0|https://www.facebook.com/', '0|0|Default|0|https://www.facebook.com/|legacy-id', launch().replace('Default','Default\u0000'),launch().replace('Default','Default\r\n'),launch(facebook,{notificationId:'x'.repeat(4096)})])assert.equal(matches(args),false,'Unknown, private, legacy or oversized launch forms fail closed');
for(const appId of ['Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!App','other.app','Chrome.other',''])assert.equal(matches(launch(),appId),false,'Another Windows sender cannot borrow Chrome launch syntax');
const textSpoof=item(launch('https://attacker.invalid/'));Object.assign(textSpoof,{appName:'Facebook',title:facebook,body:instagram});assert.equal(notificationMatchesPrioritySite(textSpoof,rules),false,'Display text cannot confer site priority');

// Exercise the actual Seelen-to-Aurora normalisation boundary using a synthetic
// Windows toast. No live notification, browser or account is accessed.
const raw={id:73,appName:'Google Chrome',appUmid:'Chrome',date:1804230000000,content:{'@launch':launch(instagram+'/'),visual:{binding:{$value:[{text:{$value:'Synthetic test'}},{text:{$value:'An unrelated text label'}}]}}}};
const normalised=normaliseNotifications([raw]).items[0];
assert.equal(normalised.args,raw.content['@launch']);
assert.equal(notificationMatchesPrioritySite(normalised,rules),true,'Seelen root @launch survives the existing production normaliser');
const noMetadata=structuredClone(raw);delete noMetadata.content['@launch'];noMetadata.content.visual.binding.$value.push({text:{'@placement':'attribution',$value:instagram}});
assert.equal(notificationMatchesPrioritySite(normaliseNotifications([noMetadata]).items[0],rules),false,'Attribution-looking text without root launch metadata is insufficient');
assert.equal(notificationMatchesPrioritySite(normalised,rules),true,'Classifying the same item has no stateful side effects');
assert.ok(!('profile' in normalised)&&!('siteOrigin' in normalised),'The helper does not attach profile or site data to the original item');
console.log('Chrome notification sites: pinned 156 launch schema, exact sender and HTTPS origins, canonical rules, spoof/malformed/private rejection, bounded inputs and existing Seelen normalisation boundary passed. Synthetic local fixtures only.');
