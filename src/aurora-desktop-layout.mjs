// Layout only. The existing core, file library and local draft panel keep their owners.
const instances=new WeakMap();

export function initAuroraDesktopLayout({root,resetFocusTimer}={}){
  if(!root?.ownerDocument||!root.querySelector('.ah-desktop'))return()=>{};
  if(instances.has(root))return instances.get(root);
  const focus=root.querySelector('.ah-focus'),consolePanel=root.querySelector('.ap-console');
  const previousFlag=root.dataset.focusWidgetRemoved,hadClass=root.classList.contains('adl-clean');
  const hidden=[];let disposed=false;
  // The original timer and clock share an update interval. Reset the private
  // focus deadline through its existing action before hiding the timer DOM.
  if(typeof resetFocusTimer==='function')resetFocusTimer();
  else focus?.querySelector('[data-action="timer-reset"]')?.click();
  for(const element of [focus,consolePanel]){
    if(!element)continue;
    hidden.push({element,hidden:element.hidden,inert:element.inert,aria:element.getAttribute('aria-hidden')});
    element.hidden=true;element.inert=true;element.setAttribute('aria-hidden','true');
  }
  root.dataset.focusWidgetRemoved='true';root.classList.add('adl-clean');
  const stopFocus=event=>{
    const target=event.target?.closest?.('[data-action],[data-command],[data-app],.ah-focus');
    if(!target)return;
    if(target.closest('.ah-focus')||target.dataset.command==='start-focus'||target.dataset.app==='Focus'||['timer','timer-reset'].includes(target.dataset.action)){
      event.preventDefault();event.stopImmediatePropagation();
    }
  };
  root.addEventListener('click',stopFocus,true);root.addEventListener('change',stopFocus,true);
  const cleanup=()=>{
    if(disposed)return;disposed=true;
    root.removeEventListener('click',stopFocus,true);root.removeEventListener('change',stopFocus,true);
    for(const value of hidden){value.element.hidden=value.hidden;value.element.inert=value.inert;if(value.aria===null)value.element.removeAttribute('aria-hidden');else value.element.setAttribute('aria-hidden',value.aria);}
    if(previousFlag===undefined)delete root.dataset.focusWidgetRemoved;else root.dataset.focusWidgetRemoved=previousFlag;
    if(!hadClass)root.classList.remove('adl-clean');instances.delete(root);
  };
  instances.set(root,cleanup);return cleanup;
}
