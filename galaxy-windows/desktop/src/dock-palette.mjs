/* Live palette configuration for the existing Galaxy Atlas Motion theme.
 * Seelen 2.8.10 emits settings-changed after StateWriteSettings; its theming
 * tool reapplies CSS variables without restarting the host or its widgets.
 * This module is inert until syncDockPalette is explicitly called.
 */
const THEME_IDS=['@galaxy-atlas/motion'];
const PALETTE_IDS=new Set(['gold','arctic','violet','evergreen','porcelain']);
const TOKENS=['background','surface','surfaceRaised','text','muted','border','accent','accent2','accentText','success','warning','danger','info'];
const ALPHAS={
  background:['f7','70'],surface:['f7'],surfaceRaised:['f7','d9','f2','ed','eb'],
  text:['42','26','40','35'],muted:['30'],
  accent:['33','0a','0d','55','45','a6'],accent2:['80','29','4a','26','75','b3'],
};
const kebab=value=>value.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
export const DOCK_PALETTE_VARIABLES=Object.freeze([
  ...TOKENS.map(key=>'--au-'+kebab(key)),
  ...Object.entries(ALPHAS).flatMap(([key,alphas])=>alphas.map(alpha=>'--au-dock-'+kebab(key)+'-'+alpha)),
  '--au-dock-icon-filter',
]);
const managedVariables=[...DOCK_PALETTE_VARIABLES,'--au-dock-frame','--au-dock-tile','--au-dock-frame-fill','--au-dock-frame-edge','--au-dock-frame-shadow','--au-dock-glass','--au-dock-tile-edge','--au-dock-tile-fill','--au-dock-tile-shadow','--au-dock-tile-hover','--au-dock-separator'];
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
let pending=Promise.resolve();

/** Gold removes our overrides so all original theme colour literals return. */
export function dockPaletteVariables(palette){
  if(!record(palette)||!PALETTE_IDS.has(palette.id))throw new TypeError('Unknown Galaxy Atlas dock palette');
  if(palette.mode!=='dark'&&palette.mode!=='light')throw new TypeError('Invalid Galaxy Atlas palette mode');
  if(palette.id==='gold')return{};
  if(!record(palette.tokens))throw new TypeError('Galaxy Atlas palette tokens are required');
  const colours={};
  for(const key of TOKENS){
    const value=palette.tokens[key];
    if(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value))throw new TypeError('Invalid Galaxy Atlas palette colour: '+key);
    colours[key]=value.toLowerCase();
  }
  const variables=Object.fromEntries(TOKENS.map(key=>['--au-'+kebab(key),colours[key]]));
  for(const [key,alphas] of Object.entries(ALPHAS))for(const alpha of alphas)variables['--au-dock-'+kebab(key)+'-'+alpha]=colours[key]+alpha;
  // Keep the original icon artwork. Removing the silver-only grayscale and
  // brightening treatment keeps native icons legible on light palettes too.
  variables['--au-dock-icon-filter']='drop-shadow(0 2px 3px #00000024)';
  return variables;
}

/**
 * Call only for an explicit palette selection (or an opted-in saved selection).
 * Each queued change reads fresh settings and patches only the active Galaxy Atlas
 * Motion theme. Native permission/read/write failures reject the promise.
 */
export async function syncDockPalette({invoke,SeelenCommand,palette,design}={}){
  if(typeof invoke!=='function'||!SeelenCommand?.StateGetSettings||!SeelenCommand?.StateWriteSettings)throw new TypeError('Seelen settings commands are unavailable');
  const variables=dockPaletteVariables(palette),paletteId=palette.id;
  if(design==='universe'){
    variables['--au-dock-frame']='0';
    variables['--au-dock-tile']='50%';
    variables['--au-dock-frame-fill']='transparent';
    variables['--au-dock-frame-edge']='transparent';
    variables['--au-dock-frame-shadow']='none';
    variables['--au-dock-glass']='none';
    variables['--au-dock-tile-edge']='transparent';
    variables['--au-dock-tile-fill']='radial-gradient(circle,#a8c5ff16,transparent 69%)';
    variables['--au-dock-tile-shadow']='none';
    variables['--au-dock-tile-hover']='radial-gradient(circle,#e2bafc50,transparent 72%)';
    variables['--au-dock-separator']='0';
  }
  const operation=pending.catch(()=>{}).then(async()=>{
    const settings=await invoke(SeelenCommand.StateGetSettings);
    if(!record(settings)||!Array.isArray(settings.activeThemes)||!record(settings.byTheme))throw new Error('Seelen returned invalid theme settings');
    // The last enabled overlay wins the same way as Seelen's theme cascade.
    const themeId=[...settings.activeThemes].reverse().find(id=>THEME_IDS.includes(id));
    if(!themeId)throw new Error('Enable Galaxy Atlas Motion before matching the dock palette');
    const previous=settings.byTheme[themeId];
    if(previous!==undefined&&!record(previous))throw new Error('Galaxy Atlas Motion settings are invalid');
    const theme={...(previous||{})};
    for(const key of managedVariables)delete theme[key];
    Object.assign(theme,variables);
    const old=previous||{};
    const changed=managedVariables.some(key=>own(old,key)!==own(theme,key)||old[key]!==theme[key]);
    if(!changed)return{status:'unchanged',themeId,paletteId};
    await invoke(SeelenCommand.StateWriteSettings,{settings:{...settings,byTheme:{...settings.byTheme,[themeId]:theme}}});
    return{status:'saved',themeId,paletteId};
  });
  pending=operation.catch(()=>{});
  return operation;
}
