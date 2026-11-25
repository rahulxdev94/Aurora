import assert from 'node:assert/strict';
import {PALETTES,getPalette,applyPalette,parsePalettePreference,serialisePalettePreference} from '../src/aurora-palettes.mjs';
const linear=n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;};
const luminance=hex=>[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16))).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
assert.equal(PALETTES.length,5);assert.equal(new Set(PALETTES.map(p=>p.id)).size,5);assert.equal(getPalette('gold').name,'Solar Gold');assert.equal(PALETTES.filter(p=>p.mode==='light').length,1);
let minimum=21;
for(const p of PALETTES){
  for(const v of Object.values(p.tokens))assert.match(v,/^#[0-9A-F]{6}$/,'Palette tokens are opaque six-digit hex colours');
  for(const fg of ['text','muted','accent','accent2','success','warning','danger','info'])for(const bg of ['background','surface','surfaceRaised']){
    const ratio=contrast(p.tokens[fg],p.tokens[bg]);minimum=Math.min(minimum,ratio);assert.ok(ratio>=4.5,`${p.name} ${fg}/${bg}: ${ratio.toFixed(2)}`);
  }
  assert.ok(contrast(p.tokens.accentText,p.tokens.accent)>=4.5,p.name+' filled button labels');
  const vars=new Map(),events=[];const node={dataset:{},style:{setProperty:(k,v)=>vars.set(k,v)},ownerDocument:{defaultView:{CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}}},dispatchEvent:e=>events.push(e)};
  assert.equal(applyPalette(node,p.id),p);assert.equal(node.dataset.auroraPalette,p.id);assert.equal(node.style.colorScheme,p.mode);assert.equal(vars.get('--au-surface-raised'),p.tokens.surfaceRaised);assert.equal(vars.get('--au-accent-text'),p.tokens.accentText);assert.equal(events.length,1);assert.equal(events[0].detail.id,p.id);
  assert.equal(parsePalettePreference(serialisePalettePreference(p.id)),p.id);
}
for(const value of [null,undefined,{},'{}','not json',{schema_version:2,palette_id:'gold'},{schema_version:1,palette_id:'<style>'}])assert.equal(parsePalettePreference(value),null);
console.log(`Five local palettes: all primary/muted/accent/status text on all three opaque reading planes and filled buttons meet 4.5:1; minimum ${minimum.toFixed(2)}:1. Token application and persisted IDs validated.`);
