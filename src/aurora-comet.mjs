/** Decorative flame layers. The parent button retains every interaction. */
export function createComet(model) {
  if (!model?.ownerDocument) return () => {};
  const doc=model.ownerDocument, train=doc.createElement('span');
  train.className='ag-comet-train';train.setAttribute('aria-hidden','true');
  for(const name of ['veil','outer','inner','tongue','flare','core']) {
    const layer=doc.createElement('i');layer.className='ag-comet-'+name;train.append(layer);
  }
  const embers=doc.createElement('span');embers.className='ag-comet-embers';
  for(let index=0;index<14;index++) {
    const ember=doc.createElement('i');ember.className='ag-comet-ember';
    ember.style.setProperty('--ember-delay',(-index*.173)+'s');
    ember.style.setProperty('--ember-duration',(1.12+(index%5)*.19)+'s');
    ember.style.setProperty('--ember-lane',((index%7)-3)*.29+'em');
    ember.style.setProperty('--ember-size',(.075+(index%3)*.028)+'em');
    embers.append(ember);
  }
  train.append(embers);model.classList.add('ag-burning-comet');model.append(train);
  return ()=>{train.remove();model.classList.remove('ag-burning-comet');};
}
