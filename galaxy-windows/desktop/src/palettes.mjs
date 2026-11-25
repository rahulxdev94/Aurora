// Local semantic palettes. No remote assets or account data are used to switch.
export const PALETTE_EVENTS=Object.freeze({request:'galaxy-atlas:palette-request',state:'galaxy-atlas:palette-state'});
export const PALETTE_FILE='theme-preference.json';
export const PALETTE_STORAGE='galaxy-atlas.palette.v1';
const palette=(id,name,mode,tokens)=>Object.freeze({id,name,mode,tokens:Object.freeze(tokens)});
export const PALETTES=Object.freeze([
  palette('gold','Solar Gold','dark',{background:'#090A0D',surface:'#16181D',surfaceRaised:'#25282F',text:'#F4F3ED',muted:'#ADB0B8',border:'#777D88',accent:'#D6B466',accent2:'#D8DCE3',accentText:'#090A0D',success:'#A6DA95',warning:'#EBCB8B',danger:'#F38BA8',info:'#89B4FA'}),
  palette('arctic','Arctic Blue','dark',{background:'#2E3440',surface:'#3B4252',surfaceRaised:'#3D4454',text:'#ECEFF4',muted:'#D8DEE9',border:'#7A899E',accent:'#88C0D0',accent2:'#8FBCBB',accentText:'#202833',success:'#A3BE8C',warning:'#EBCB8B',danger:'#F2A3AB',info:'#88C0D0'}),
  palette('violet','Violet Night','dark',{background:'#21222C',surface:'#282A36',surfaceRaised:'#343447',text:'#F8F8F2',muted:'#C1B9D5',border:'#898099',accent:'#BD93F9',accent2:'#FF79C6',accentText:'#211629',success:'#50FA7B',warning:'#F1FA8C',danger:'#FF9595',info:'#8BE9FD'}),
  palette('evergreen','Evergreen','dark',{background:'#272E33',surface:'#2E383C',surfaceRaised:'#343F44',text:'#D3C6AA',muted:'#B4B7A5',border:'#7F9582',accent:'#A7C080',accent2:'#7FBBB3',accentText:'#202B24',success:'#A7C080',warning:'#DBBC7F',danger:'#EFA6A6',info:'#8BC7CA'}),
  palette('porcelain','Porcelain','light',{background:'#EFF1F5',surface:'#E6E9EF',surfaceRaised:'#F8F9FC',text:'#4C4F69',muted:'#5C5F77',border:'#7C7F93',accent:'#1E5CD7',accent2:'#8034E8',accentText:'#FFFFFF',success:'#226C1E',warning:'#855600',danger:'#C20E36',info:'#1E5CD7'})
]);
export function getPalette(id){return PALETTES.find(p=>p.id===id)||null;}
export function parsePalettePreference(value){
  try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed?.schema_version===1&&getPalette(parsed.palette_id)?parsed.palette_id:null;}catch{return null;}
}
export function serialisePalettePreference(id){if(!getPalette(id))throw new Error('Unknown palette');return JSON.stringify({schema_version:1,palette_id:id});}
export function paletteVariables(palette){
  if(!getPalette(palette?.id))throw new Error('Unknown palette');
  return Object.fromEntries(Object.entries(palette.tokens).map(([name,value])=>['--au-'+name.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()),value]));
}
export function applyPalette(element,id){
  const selected=getPalette(id);if(!element||!selected)return null;
  element.dataset.auroraPalette=id;element.dataset.auroraColourMode=selected.mode;
  for(const [key,value] of Object.entries(paletteVariables(selected)))element.style.setProperty(key,value);
  element.style.setProperty('--au-mode',selected.mode);
  element.style.colorScheme=selected.mode;
  const win=element.ownerDocument?.defaultView;
  if(win?.CustomEvent&&element.dispatchEvent)element.dispatchEvent(new win.CustomEvent('galaxy-atlas:palette-change',{detail:{id,tokens:selected.tokens,mode:selected.mode}}));
  return selected;
}
