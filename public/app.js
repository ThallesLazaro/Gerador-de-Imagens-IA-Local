const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const BASE_TITLE='Gerador de Imagens IA Local';
if('scrollRestoration' in history) history.scrollRestoration='manual';
const els={
  appStatus:$('#appStatus'),thread:$('#thread'),heroNote:$('#emptyState'),composer:$('#composer'),prompt:$('#prompt'),mode:$('#modeSelect'),send:$('#sendBtn'),
  upload:$('#uploadBtn'),file:$('#fileInput'),attachments:$('#attachmentBar'),optionsBtn:$('#optionsBtn'),options:$('#optionsDialog'),
  quality:$('#quality'),ratio:$('#ratio'),width:$('#width'),height:$('#height'),seed:$('#seed'),temperature:$('#temperature'),memoryRetry:$('#memoryRetry'),videoOptions:$('#videoOptions'),videoEngine:$('#videoEngine'),duration:$('#duration'),fps:$('#fps'),motion:$('#motion'),
  locked:$('#lockedHint'),lockedText:$('#lockedText'),lockedAction:$('#lockedAction'),resourcesBtn:$('#resourcesBtn'),resourcesDialog:$('#resourcesDialog'),resourceGrid:$('#resourceGrid'),resourceSummary:$('#resourceSummary'),installAll:$('#installAllBtn'),installerBox:$('#installerBox'),installerTitle:$('#installerTitle'),installerPct:$('#installerPct'),installerBar:$('#installerBar'),installerMessage:$('#installerMessage'),installerLog:$('#installerLog'),installerToggle:$('#installerToggle'),installerDismiss:$('#installerDismiss'),installerJump:$('#installerJump'),
  galleryBtn:$('#galleryBtn'),gallery:$('#galleryDialog'),galleryGrid:$('#galleryGrid'),gallerySearch:$('#gallerySearch'),galleryFilter:$('#galleryFilter'),
  queueBtn:$('#queueBtn'),queueCount:$('#queueCount'),queueDialog:$('#queueDialog'),queueList:$('#queueList'),newChat:$('#newChatBtn'),
  promptBtn:$('#promptBtn'),promptDialog:$('#promptDialog'),systemPrompt:$('#systemPrompt'),savePrompt:$('#savePromptSettings'),
  firstRun:$('#firstRunDialog'),firstRunResources:$('#firstRunResources'),firstRunSkip:$('#firstRunSkip'),reloadModels:$('#reloadModelsBtn'),openModels:$('#openModelsBtn')
};

const modes={
  image:{label:'Imagem',resource:'image',upload:false,action:'Gerar',placeholder:'Descreva a imagem que você quer criar…'},
  video:{label:'Vídeo',resource:'videoAI',upload:true,action:'Gerar vídeo',placeholder:'Descreva o vídeo ou envie uma imagem para animar…'},
  edit:{label:'Editar',resource:'image',upload:true,action:'Editar',placeholder:'Envie uma imagem e descreva o que deve mudar…'},
  merge:{label:'Juntar',resource:'image',upload:true,action:'Juntar',placeholder:'Envie duas ou mais imagens e descreva como combinar…'},
  chat:{label:'Conversar',resource:'chat',upload:false,action:'Enviar',placeholder:'Converse com o assistente local…'}
};
const presets={
  image:{fast:{'1:1':[512,512],'16:9':[640,384],'9:16':[384,640],'4:3':[640,480],'3:4':[480,640]},normal:{'1:1':[768,768],'16:9':[768,448],'9:16':[448,768],'4:3':[768,576],'3:4':[576,768]},high:{'1:1':[1024,1024],'16:9':[1024,576],'9:16':[576,1024],'4:3':[1024,768],'3:4':[768,1024]},max:{'1:1':[1280,1280],'16:9':[1280,736],'9:16':[736,1280],'4:3':[1280,960],'3:4':[960,1280]}},
  video:{fast:{'1:1':[512,512],'16:9':[512,288],'9:16':[288,512],'4:3':[512,384],'3:4':[384,512]},normal:{'1:1':[640,640],'16:9':[640,384],'9:16':[384,640],'4:3':[640,480],'3:4':[480,640]},high:{'1:1':[768,768],'16:9':[768,448],'9:16':[448,768],'4:3':[768,576],'3:4':[576,768]},max:{'1:1':[1024,1024],'16:9':[1024,576],'9:16':[576,1024],'4:3':[1024,768],'3:4':[768,1024]}}
};
const HISTORY_PAGE_SIZE=24, HISTORY_MAX_MESSAGES=800;
const state={resources:{},runtime:{},catalog:null,attachments:[],running:false,currentJob:null,queue:[],progressTimer:null,progressStart:0,progressEstimate:30,activeGeneration:null,installerTimer:null,installerFollow:true,installerLast:'',titleAlert:false,hydrating:false,historyMessages:[],historyCursor:0,historyLoading:false};

// ---------- storage ----------
const DB='GeradorImagensIALocalMedia', LEGACY_DB='QwenStudioLocalMedia', STORE='generations';
function openNamedDb(name){return new Promise((ok,fail)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE)){const st=db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});st.createIndex('createdAt','createdAt')}};r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error)})}
function openDb(){return openNamedDb(DB)}
async function dbAdd(v){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readwrite'),r=tx.objectStore(STORE).add(v);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbPut(v){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readwrite'),r=tx.objectStore(STORE).put(v);r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbAll(){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).getAll();r.onsuccess=()=>ok((r.result||[]).sort((a,b)=>b.createdAt-a.createdAt));r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbGet(id){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(Number(id));r.onsuccess=()=>ok(r.result||null);r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbDelete(id){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readwrite'),r=tx.objectStore(STORE).delete(Number(id));r.onsuccess=()=>ok();r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function migrateLegacyStorage(){
  const pairs=[['qsl-thread','giia-thread'],['qsl-prefs','giia-prefs'],['qsl-first-run','giia-first-run']];
  for(const [oldKey,newKey] of pairs)if(localStorage.getItem(newKey)==null&&localStorage.getItem(oldKey)!=null)localStorage.setItem(newKey,localStorage.getItem(oldKey));
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('qsl-time:')){const nk='giia-time:'+k.slice(9);if(localStorage.getItem(nk)==null)localStorage.setItem(nk,localStorage.getItem(k));}}
  try{
    if(indexedDB.databases){const names=(await indexedDB.databases()).map(x=>x.name);if(!names.includes(LEGACY_DB))return}
    const current=await dbAll();if(current.length)return;
    const old=await openNamedDb(LEGACY_DB);const rows=await new Promise((ok,fail)=>{if(!old.objectStoreNames.contains(STORE)){ok([]);return}const tx=old.transaction(STORE,'readonly'),r=tx.objectStore(STORE).getAll();r.onsuccess=()=>ok(r.result||[]);r.onerror=()=>fail(r.error)});old.close();
    for(const row of rows)await dbPut(row);
  }catch(e){console.warn('Migração de histórico antigo não concluída:',e)}
}
function getMessages(){try{return JSON.parse(localStorage.getItem('giia-thread')||'[]')}catch{return []}}
function setMessages(m){let next=m.slice(-HISTORY_MAX_MESSAGES);while(next.length){try{localStorage.setItem('giia-thread',JSON.stringify(next));return}catch(e){if(e?.name!=='QuotaExceededError'&&e?.name!=='NS_ERROR_DOM_QUOTA_REACHED')throw e;next=next.slice(Math.max(1,Math.floor(next.length*.2)))}}localStorage.removeItem('giia-thread')}
function rememberMessage(m){const all=getMessages();all.push(m);setMessages(all)}
function removeMediaMessage(recordId){setMessages(getMessages().filter(m=>Number(m.recordId)!==Number(recordId)))}
function savePrefs(){localStorage.setItem('giia-prefs',JSON.stringify({mode:els.mode.value,quality:els.quality.value,ratio:els.ratio.value,width:els.width.value,height:els.height.value,temperature:els.temperature.value,memoryRetry:els.memoryRetry?.value||'auto',videoEngine:els.videoEngine.value,duration:els.duration.value,fps:els.fps.value,motion:els.motion.value,systemPrompt:els.systemPrompt.value}))}
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('giia-prefs')||'{}');for(const k of ['quality','ratio','width','height','temperature','memoryRetry','videoEngine','duration','fps','motion'])if(p[k]!=null&&els[k])els[k].value=p[k];if(p.mode&&modes[p.mode])els.mode.value=p.mode;if(p.systemPrompt)els.systemPrompt.value=p.systemPrompt}catch{}}

// ---------- generic UI ----------
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setTitle(t=BASE_TITLE,alert=false){document.title=t;state.titleAlert=alert}
function resetTitle(){setTitle(BASE_TITLE,false)}
window.addEventListener('focus',resetTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)resetTitle()});
function beep(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const c=new A(),n=c.currentTime;[880,1174,1567].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=f;g.gain.setValueAtTime(.0001,n+i*.15);g.gain.exponentialRampToValueAtTime(.055,n+i*.15+.02);g.gain.exponentialRampToValueAtTime(.0001,n+i*.15+.12);o.connect(g).connect(c.destination);o.start(n+i*.15);o.stop(n+i*.15+.14)});setTimeout(()=>c.close().catch(()=>{}),800)}catch{}}
function scrollToComposer(){setTimeout(()=>document.getElementById('composerAnchor')?.scrollIntoView({behavior:'smooth',block:'end'}),50)}
function scrollConversationBottom(behavior='smooth'){setTimeout(()=>window.scrollTo({top:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),behavior}),35)}
function scrollMessageIntoView(el,behavior='smooth'){setTimeout(()=>el?.querySelector('.message-content')?.scrollIntoView({behavior,block:'start'}),45)}
function openDialog(dialog){if(dialog&&!dialog.open)dialog.showModal()}
function messageShell(role,label=role==='user'?'Você':'Gerador de Imagens IA Local',at=Date.now()){const el=document.createElement('article');el.className=`message ${role}`;const when=new Date(Number(at)||Date.now());el.innerHTML=`<div class="avatar">${role==='user'?'V':'IA'}</div><div class="message-content"><div class="message-head"><strong>${label}</strong><small>${when.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></div></div>`;return {el,content:el.querySelector('.message-content')}}
function addTextMessage(role,text,{persist=true,chat=false}={}){const {el,content}=messageShell(role);const b=document.createElement('div');b.className='bubble';b.textContent=text;content.appendChild(b);els.thread.appendChild(el);if(persist)rememberMessage({role,kind:'text',text,chat,at:Date.now()});if(!state.hydrating)scrollConversationBottom();return el}
function addTyping(label='Respondendo…'){const {el,content}=messageShell('assistant');const b=document.createElement('div');b.className='bubble';b.innerHTML=`<span class="typing"><span>${escapeHtml(label)}</span><span class="typing-dots"><i></i><i></i><i></i></span></span>`;content.appendChild(b);els.thread.appendChild(el);if(!state.hydrating)scrollConversationBottom();return {el,bubble:b}}
function mediaMeta(r){return `${modes[r.mode]?.label||r.mode} • ${r.width||'?'}×${r.height||'?'}${r.duration?` • ${r.duration}s`:''}${r.seed?` • seed ${r.seed}`:''}${r.retryInfo?.autoRetry?' • resolução ajustada automaticamente':''}`}
function actionButton(text,fn,cls=''){const b=document.createElement('button');b.className=`action-btn ${cls}`.trim();b.textContent=text;b.onclick=fn;return b}

// ---------- media cards / thread ----------
function createGenerationMessage(job){
  const {el,content}=messageShell('assistant');
  const card=document.createElement('div');card.className='media-card';
  card.innerHTML=`<div class="media-frame"><div class="media-loader"><div class="loader-inner"><div class="typing"><span>${job.mode==='video'?'Gerando vídeo':'Gerando imagem'}</span><span class="typing-dots"><i></i><i></i><i></i></span></div><div class="loader-progress">1%</div><div class="loader-eta">Calculando tempo…</div><div class="progress-track"><div class="progress-fill"></div></div></div></div></div><div class="log-panel"><div class="log-head"><span>Log</span><button class="inline-link toggle-log">Mostrar log</button></div><pre class="terminal generation-log" hidden></pre></div><div class="media-footer"><span class="media-meta">Preparando ${modes[job.mode].label.toLowerCase()}…</span><div class="media-actions"><button class="action-btn cancel-job">Cancelar</button></div></div>`;
  content.appendChild(card);els.thread.appendChild(el);if(!state.hydrating)scrollConversationBottom();
  const refs={el,card,job,originalJob:{...job,files:[...job.files]},attemptLogs:[],frame:card.querySelector('.media-frame'),loader:card.querySelector('.media-loader'),pct:card.querySelector('.loader-progress'),eta:card.querySelector('.loader-eta'),bar:card.querySelector('.progress-fill'),meta:card.querySelector('.media-meta'),log:card.querySelector('.generation-log'),toggle:card.querySelector('.toggle-log'),actions:card.querySelector('.media-actions')};
  refs.toggle.onclick=()=>{refs.log.hidden=!refs.log.hidden;refs.toggle.textContent=refs.log.hidden?'Mostrar log':'Ocultar log';if(!refs.log.hidden)refs.log.scrollTop=refs.log.scrollHeight};
  card.querySelector('.cancel-job').onclick=()=>fetch('/api/cancel',{method:'POST'}).catch(()=>{});
  refs.logFollow=true;refs.log.addEventListener('scroll',()=>{refs.logFollow=refs.log.scrollHeight-refs.log.scrollTop-refs.log.clientHeight<18});
  return refs;
}
function resetGenerationLoader(refs,job,message){
  refs.job=job;refs.frame.classList.remove('failed');refs.frame.innerHTML=`<div class="media-loader"><div class="loader-inner"><div class="typing"><span>${escapeHtml(message||'Tentando novamente…')}</span><span class="typing-dots"><i></i><i></i><i></i></span></div><div class="loader-progress">1%</div><div class="loader-eta">Nova tentativa em ${job.width}×${job.height}</div><div class="progress-track"><div class="progress-fill"></div></div></div></div>`;
  refs.loader=refs.frame.querySelector('.media-loader');refs.pct=refs.frame.querySelector('.loader-progress');refs.eta=refs.frame.querySelector('.loader-eta');refs.bar=refs.frame.querySelector('.progress-fill');refs.meta.textContent=`Tentando ${job.width}×${job.height}…`;
}
async function renderCompletedMedia(record,{persist=false}={}){
  const {el,content}=messageShell('assistant');const card=buildCompletedCard(record);content.appendChild(card);els.thread.appendChild(el);if(persist)rememberMessage({role:'assistant',kind:'media',recordId:record.id,at:Date.now()});if(!state.hydrating)scrollConversationBottom();return el
}
function buildCompletedCard(record){
  const card=document.createElement('div');card.className='media-card';const frame=document.createElement('div');frame.className='media-frame';const url=URL.createObjectURL(record.blob);const media=document.createElement(record.type==='video'?'video':'img');media.src=url;if(record.type==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else{media.alt=record.prompt||'Imagem gerada';media.loading='lazy';media.decoding='async'}frame.appendChild(media);
  const footer=document.createElement('div');footer.className='media-footer';const meta=document.createElement('span');meta.className='media-meta';meta.textContent=mediaMeta(record);const actions=document.createElement('div');actions.className='media-actions';
  actions.append(
    actionButton('Baixar',()=>downloadRecord(record)),
    actionButton('Reutilizar',()=>reuseRecord(record)),
    actionButton('Mesma seed',()=>reuseRecord(record,true))
  );
  if(record.type==='image')actions.append(actionButton('Editar',()=>useAsEdit(record)),actionButton('Virar vídeo',()=>useAsVideo(record)));
  actions.append(actionButton('Excluir',()=>deleteRecord(record,card.closest('.message')),'danger'));
  footer.append(meta,actions);card.append(frame,footer);return card
}
async function createStoredMessageElement(m){
  const {el,content}=messageShell(m.role,m.role==='user'?'Você':'Gerador de Imagens IA Local',m.at);
  if(m.kind==='text'){
    const b=document.createElement('div');b.className='bubble';b.textContent=m.text||'';content.appendChild(b);return el;
  }
  if(m.kind==='media'){
    const r=await dbGet(m.recordId);if(!r)return null;content.appendChild(buildCompletedCard(r));return el;
  }
  return null;
}
async function renderStoredRange(from,to,{prepend=false}={}){
  const fragment=document.createDocumentFragment();
  for(const m of state.historyMessages.slice(from,to)){const el=await createStoredMessageElement(m);if(el)fragment.appendChild(el)}
  if(prepend)els.thread.insertBefore(fragment,els.thread.firstChild);else els.thread.appendChild(fragment);
}
async function loadOlderMessages(){
  if(state.historyLoading||state.historyCursor<=0)return;
  state.historyLoading=true;
  const oldHeight=document.documentElement.scrollHeight,oldY=window.scrollY;
  const from=Math.max(0,state.historyCursor-HISTORY_PAGE_SIZE),to=state.historyCursor;
  try{
    await renderStoredRange(from,to,{prepend:true});state.historyCursor=from;
    const delta=document.documentElement.scrollHeight-oldHeight;
    const root=document.documentElement,previous=root.style.scrollBehavior;root.style.scrollBehavior='auto';window.scrollTo(0,oldY+delta);requestAnimationFrame(()=>{root.style.scrollBehavior=previous});
  }finally{state.historyLoading=false}
}
async function hydrateThread(){
  state.hydrating=true;els.thread.innerHTML='';state.historyMessages=getMessages();
  state.historyCursor=Math.max(0,state.historyMessages.length-HISTORY_PAGE_SIZE);
  await renderStoredRange(state.historyCursor,state.historyMessages.length);
  els.heroNote.hidden=state.historyMessages.length>0;state.hydrating=false;scrollConversationBottom('auto');
}
let historyScrollFrame=0;
window.addEventListener('scroll',()=>{if(historyScrollFrame)return;historyScrollFrame=requestAnimationFrame(()=>{historyScrollFrame=0;if(window.scrollY<=220)loadOlderMessages()})},{passive:true});
function finishGenerationCard(refs,record){
  refs.frame.innerHTML='';const url=URL.createObjectURL(record.blob);const media=document.createElement(record.type==='video'?'video':'img');media.src=url;if(record.type==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else media.alt=record.prompt||'Imagem gerada';refs.frame.appendChild(media);
  refs.card.querySelector('.log-panel')?.remove();refs.meta.textContent=mediaMeta(record);refs.actions.innerHTML='';
  refs.actions.append(actionButton('Baixar',()=>downloadRecord(record)),actionButton('Reutilizar',()=>reuseRecord(record)),actionButton('Mesma seed',()=>reuseRecord(record,true)));
  if(record.type==='image')refs.actions.append(actionButton('Editar',()=>useAsEdit(record)),actionButton('Virar vídeo',()=>useAsVideo(record)));
  refs.actions.append(actionButton('Excluir',()=>deleteRecord(record,refs.el),'danger'));
  rememberMessage({role:'assistant',kind:'media',recordId:record.id,at:Date.now()});
  scrollConversationBottom();
}
function failGenerationCard(refs,info={}){
  const title=info.errorTitle||'Falha na geração';
  const message=info.error||info.message||'Não foi possível concluir a geração.';
  const suggestions=Array.isArray(info.suggestions)?info.suggestions:[];
  refs.loader?.remove();refs.frame.classList.add('failed');refs.frame.innerHTML='';
  const box=document.createElement('div');box.className='generation-error';
  box.innerHTML=`<div class="generation-error-icon">!</div><div class="generation-error-copy"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>${suggestions.length?`<ul>${suggestions.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}</div>`;
  refs.frame.appendChild(box);refs.meta.textContent=info.errorCode==='CANCELLED'?'Cancelado':'Não concluído';refs.actions.innerHTML='';
  const original=refs.originalJob||refs.job;
  if(original)refs.actions.append(actionButton('Tentar novamente',()=>launchJob({...original,files:[...original.files]})));
  if(original&&info.errorCode==='GPU_OUT_OF_MEMORY'&&refs.memoryRetryMode!=='off'){
    refs.actions.append(actionButton('Tentar em 75%',()=>launchJob(scaleJob(original,.75))),actionButton('Tentar em 50%',()=>launchJob(scaleJob(original,.5))));
  }
  if(info.errorCode==='GPU_OUT_OF_MEMORY'||info.errorCode==='MODEL_FILE_MISSING'||info.errorCode==='MODEL_INCOMPATIBLE')refs.actions.append(actionButton('Recursos IA',async()=>{await refreshResources();openDialog(els.resourcesDialog)}));
  refs.card.querySelector('.log-panel')?.classList.add('has-error');
  if(refs.log){const combined=[...(refs.attemptLogs||[]),...(Array.isArray(info.log)?info.log:[])];if(combined.length)refs.log.textContent=combined.join('\n');refs.log.hidden=true;refs.toggle.textContent='Mostrar log técnico'}
  scrollConversationBottom();
}

// ---------- media actions ----------
function downloadRecord(r){const a=document.createElement('a');a.href=URL.createObjectURL(r.blob);a.download=r.filename||`${r.type}_${r.id}`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function filesFromRecord(r){return (r.sourceFiles||[]).map(x=>new File([x.blob],x.name||'referencia.png',{type:x.type||x.blob?.type||'image/png',lastModified:x.lastModified||Date.now()}))}
async function reuseRecord(r,sameSeed=false){
  els.mode.value=r.mode||'image';setMode();const j=r.jobSettings||{};
  if(j.quality)els.quality.value=j.quality;els.ratio.value='custom';els.width.value=r.width||j.width||els.width.value;els.height.value=r.height||j.height||els.height.value;
  if(j.memoryRetry&&els.memoryRetry)els.memoryRetry.value=j.memoryRetry;if(j.videoEngine)els.videoEngine.value=j.videoEngine;if(j.duration)els.duration.value=j.duration;if(j.fps)els.fps.value=j.fps;if(j.motion)els.motion.value=j.motion;if(j.temperature!=null)els.temperature.value=j.temperature;
  els.prompt.value=r.prompt||'';els.seed.value=sameSeed?(r.seed||''):'';state.attachments=filesFromRecord(r);renderAttachments();savePrefs();scrollToComposer();els.prompt.focus();
}
async function attachRecord(r){if(r.type!=='image')return;const file=new File([r.blob],r.filename||`image_${r.id}.png`,{type:r.blob.type||'image/png'});state.attachments=[file];renderAttachments()}
async function useAsEdit(r){els.mode.value='edit';setMode();els.prompt.value='';await attachRecord(r);scrollToComposer();els.prompt.focus()}
async function useAsVideo(r){els.mode.value='video';setMode();els.prompt.value='Anime esta imagem com movimento natural e detalhes vivos.';await attachRecord(r);scrollToComposer();els.prompt.focus()}
async function deleteRecord(r,messageEl=null){if(!confirm('Excluir esta geração da conversa, galeria e arquivo de saída?'))return;try{await dbDelete(r.id);removeMediaMessage(r.id);if(r.filename)await fetch(`/api/output/${encodeURIComponent(r.filename)}`,{method:'DELETE'}).catch(()=>{});messageEl?.remove();await renderGallery()}catch(e){alert(`Não foi possível excluir: ${e.message}`)}}


async function loadModelCatalog(){
  try{
    const r=await fetch('/modelos.json',{cache:'no-store'});
    if(!r.ok)throw new Error('Não foi possível carregar modelos.json.');
    state.catalog=await r.json();
    return state.catalog;
  }catch(e){
    console.warn(e);
    state.catalog=null;
    return null;
  }
}

// ---------- resources ----------
async function refreshResources(){try{const r=await fetch('/api/resources',{cache:'no-store'}),d=await r.json();state.resources=d.resources||{};state.runtime=d.runtime||{};renderResources(d.installer);updateAvailability();const installed=Object.values(state.resources).filter(x=>x.installed).length;els.appStatus.textContent=`${installed}/${Object.keys(state.resources).length} recursos ativos`;return d}catch{els.appStatus.textContent='Servidor indisponível';return null}}
function modeAvailable(mode=els.mode.value){if(mode==='chat')return !!state.resources.chat?.installed;if(['image','edit','merge'].includes(mode))return !!state.resources.image?.installed;if(mode==='video'){return els.videoEngine.value==='ai'?!!state.resources.videoAI?.installed:!!state.resources.videoLight?.installed}return true}
function updateAvailability(){for(const opt of els.mode.options){const m=opt.value;const available=m==='video'?(!!state.resources.videoAI?.installed||!!state.resources.videoLight?.installed):modeAvailable(m);opt.disabled=!available;opt.textContent=`${modes[m].label}${opt.disabled?' • não instalado':''}`};if(els.mode.value==='video'&&!modeAvailable('video')){if(state.resources.videoLight?.installed)els.videoEngine.value='light';else if(state.resources.videoAI?.installed)els.videoEngine.value='ai'}updateLockHint()}
function updateLockHint(){const mode=els.mode.value;let resource=modes[mode].resource;if(mode==='video')resource=els.videoEngine.value==='ai'?'videoAI':'videoLight';const ok=modeAvailable(mode);els.locked.hidden=ok;els.send.disabled=!ok;if(!ok)els.lockedText.textContent=`${state.resources[resource]?.label||'Este recurso'} ainda não está instalado.`}
async function manageChatRuntime(action='load'){try{const r=await fetch(`/api/resources/chat/${action}`,{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao atualizar o Chat.');await refreshResources();}catch(e){alert(e.message)}}
function renderResources(installer){
  const entries=Object.values(state.resources);els.resourceSummary.textContent=`${entries.filter(r=>r.installed).length} de ${entries.length} instalados`;els.resourceGrid.innerHTML='';
  for(const r of entries){
    const rt=state.runtime?.[r.id]||{};
    const card=document.createElement('article');card.className=`resource-card ${r.installed?'installed':''}`;const sel=r.selected||{variant:r.defaultVariant};
    let runtimeText='Não carregado';
    let runtimeHint='';
    if(r.id==='chat'){runtimeText=rt.running?'Carregado na memória':'Descarregado';runtimeHint=rt.model?`Modelo ativo: ${rt.model}`:'O Chat permanece em memória até você descarregar.'}
    else if(r.id==='image'){runtimeText='Sob demanda';runtimeHint=rt.model?`Modelo padrão: ${rt.model} • encoder: ${rt.encoder||'—'}`:'Carrega somente durante a geração e descarrega ao concluir.'}
    else if(r.id==='videoAI'){
      runtimeText=r.installed?'Modelo pronto • sob demanda':'Verificando componentes';
      const c=r.components||{};
      const bits=[`Modelo: ${c.modelReady?'pronto':'ausente'}`,`Python: ${c.pythonReady?'pronto':'ausente'}`,`model_index.json: ${c.modelIndexReady?'encontrado':'não encontrado'}`,`FFmpeg externo: ${c.ffmpegReady?'disponível':'opcional'}`];
      runtimeHint=bits.join(' • ')+(c.pipelineDir?` • ${c.pipelineDir}`:'');
    }
    else if(r.id==='videoLight'){runtimeText='Disponível localmente';runtimeHint='Usa FFmpeg somente durante a criação do vídeo.'}
    card.innerHTML=`<h3>${escapeHtml(r.label)}</h3><p>${escapeHtml(r.description||'')}</p><div class="resource-status"><span class="status-pill ${r.installed?'ok':''}">${r.installed?'Instalado':'Não instalado'}</span><small>${escapeHtml(r.sizeHint||'')}</small></div><div class="resource-runtime"><strong>${escapeHtml(runtimeText)}</strong><small>${escapeHtml(runtimeHint)}</small></div><div class="resource-model"><label><span>Modelo / variante</span><select class="variant-select">${(r.variants||[]).map(v=>`<option value="${escapeHtml(v.id)}" ${v.id===sel.variant?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}</select></label><div class="variant-help"></div><div class="custom-fields"></div></div><div class="resource-actions"><button class="action-btn install">${r.installed?'Reparar / aplicar':'Instalar'}</button>${r.installed?'<button class="action-btn danger remove">Remover</button>':''}${r.id==='chat'&&r.installed?`<button class="action-btn runtime-chat">${rt.running?'Descarregar':'Carregar agora'}</button>`:''}</div>`;
    const select=card.querySelector('.variant-select'),help=card.querySelector('.variant-help'),custom=card.querySelector('.custom-fields');
    const refreshVariant=()=>{const v=(r.variants||[]).find(x=>x.id===select.value)||{};const tags=[];if(v.uncensored===true)tags.push('<span class="model-tag uncensored">Sem censura</span>');if(v.sizeGB)tags.push(`<span class="model-tag">${escapeHtml(v.sizeGB)} GB</span>`);if(v.encoderSizeGB&&v.diffusionSizeGB)tags.push(`<span class="model-tag">Encoder ${escapeHtml(v.encoderSizeGB)} GB + denoiser ${escapeHtml(v.diffusionSizeGB)} GB</span>`);if(r.id==='image'&&v.encoderFilename){const cr=state.resources.chat;const cv=(cr?.variants||[]).find(x=>x.id===(cr?.selected?.variant||cr?.defaultVariant));if(cv?.filename===v.encoderFilename)tags.push('<span class="model-tag shared">Encoder compartilhado com Chat • sem download duplicado</span>')}help.innerHTML=`${tags.length?`<div class="variant-tags">${tags.join('')}</div>`:''}<small>${escapeHtml(v.description||'')}</small>`;custom.innerHTML='';if(v.custom){
      if(r.id==='chat')custom.innerHTML=`<label><span>URL direta do GGUF</span><input data-key="url" value="${escapeHtml(sel.url||'')}"></label><label><span>Nome do arquivo (.gguf)</span><input data-key="filename" value="${escapeHtml(sel.filename||'modelo-chat.gguf')}"></label>`;
      if(r.id==='image')custom.innerHTML=`<label><span>URL do denoiser GGUF</span><input data-key="diffusionUrl" value="${escapeHtml(sel.diffusionUrl||'')}"></label><label><span>Nome do denoiser</span><input data-key="diffusionFilename" value="${escapeHtml(sel.diffusionFilename||'modelo-imagem.gguf')}"></label><label><span>URL do encoder GGUF</span><input data-key="encoderUrl" value="${escapeHtml(sel.encoderUrl||'')}"></label><label><span>Nome do encoder</span><input data-key="encoderFilename" value="${escapeHtml(sel.encoderFilename||'encoder.gguf')}"></label><label><span>URL do mmproj</span><input data-key="mmprojUrl" value="${escapeHtml(sel.mmprojUrl||'')}"></label><label><span>Nome do mmproj</span><input data-key="mmprojFilename" value="${escapeHtml(sel.mmprojFilename||'mmproj.gguf')}"></label><label><span>URL do VAE</span><input data-key="vaeUrl" value="${escapeHtml(sel.vaeUrl||'')}"></label><label><span>Nome do VAE</span><input data-key="vaeFilename" value="${escapeHtml(sel.vaeFilename||'vae.safetensors')}"></label>`;
      if(r.id==='videoAI')custom.innerHTML=`<label><span>Repo ID no Hugging Face</span><input data-key="repo" value="${escapeHtml(sel.repo||'')}"></label><label><span>Pasta local</span><input data-key="folder" value="${escapeHtml(sel.folder||'video-model')}"></label>`;
    }};select.onchange=refreshVariant;refreshVariant();
    const selection=()=>{const v=(r.variants||[]).find(x=>x.id===select.value)||{};const data={variant:select.value};for(const i of custom.querySelectorAll('[data-key]'))data[i.dataset.key]=i.value.trim();for(const k of ['url','filename','diffusionUrl','diffusionFilename','encoderUrl','encoderFilename','mmprojUrl','mmprojFilename','vaeUrl','vaeFilename','repo','folder'])if(data[k]==null&&v[k]!=null)data[k]=v[k];return data};
    card.querySelector('.install').onclick=()=>installResource(r.id,r.installed?'repair':'install',selection());card.querySelector('.remove')?.addEventListener('click',()=>{if(confirm(`Remover ${r.label}?`))installResource(r.id,'remove',selection())});
    card.querySelector('.runtime-chat')?.addEventListener('click',()=>manageChatRuntime(rt.running?'unload':'load'));
    els.resourceGrid.appendChild(card)
  }
  updateInstaller(installer)
}
async function installResource(id,action='install',selection={}){try{const r=await fetch(`/api/resources/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao iniciar.');startInstallerPoll();return true}catch(e){alert(e.message);return false}}
function startInstallerPoll(){clearInterval(state.installerTimer);state.installerFollow=true;state.installerTimer=setInterval(pollInstaller,900);pollInstaller()}
async function pollInstaller(){try{const r=await fetch('/api/install-progress',{cache:'no-store'}),d=await r.json();updateInstaller(d);if(!d.running){clearInterval(state.installerTimer);state.installerTimer=null;await refreshResources()}}catch{}}
function updateInstaller(d={}){
  els.installerBox.hidden=!d.running&&!d.error;
  if(els.installerBox.hidden){
    els.installerLog.hidden=true;
    if(els.installerToggle)els.installerToggle.textContent='Mostrar log';
    if(!state.running)setTitle(BASE_TITLE,false);
    return;
  }
  els.installerTitle.textContent=d.resource?`${d.action==='remove'?'Removendo':'Instalando'} ${state.resources[d.resource]?.label||d.resource}`:'Instalação';
  const raw=Math.max(0,Math.min(100,Math.round(d.progress||0)));
  const shown=d.running&&raw>=100?99:raw;
  els.installerPct.textContent=`${shown}%`;
  els.installerBar.style.width=`${shown}%`;
  els.installerMessage.textContent=d.running&&raw>=100?'Finalizando e validando arquivos…':(d.message||'');
  els.installerBox.classList.toggle('has-error',!!d.error);
  if(els.installerDismiss)els.installerDismiss.hidden=!d.error;
  if(d.running&&!state.running){if(document.hidden)setTitle(`${shown}% • Instalando recursos • ${BASE_TITLE}`,false);else setTitle(BASE_TITLE,false)}
  const text=(d.log||[]).join('\n');
  if(text!==state.installerLast){const left=els.installerLog.scrollLeft;state.installerLast=text;els.installerLog.textContent=text;els.installerLog.scrollLeft=left;if(state.installerFollow){els.installerLog.scrollTop=els.installerLog.scrollHeight;els.installerJump.hidden=true}else els.installerJump.hidden=false}
}
async function installAll(){for(const id of ['chat','image','videoLight','videoAI']){await refreshResources();if(state.resources[id]?.installed)continue;const ok=await installResource(id,'install',{});if(!ok)break;while(true){await new Promise(r=>setTimeout(r,1200));const p=await fetch('/api/install-progress',{cache:'no-store'}).then(r=>r.json()).catch(()=>({running:false,error:true}));updateInstaller(p);if(!p.running){if(p.error)return;break}}}}

// ---------- modes / composer ----------
function setMode(){const mode=els.mode.value,m=modes[mode];els.prompt.placeholder=m.placeholder;els.send.textContent=m.action;els.upload.hidden=!m.upload;els.file.multiple=mode==='merge';els.videoOptions.hidden=mode!=='video';if(mode==='video'&&els.ratio.value==='1:1')els.ratio.value='16:9';state.attachments=[];renderAttachments();applyPreset();updateLockHint();savePrefs()}
function applyPreset(){if(els.ratio.value==='custom')return;const base=els.mode.value==='video'?presets.video:presets.image;const d=base[els.quality.value]?.[els.ratio.value];if(d){els.width.value=d[0];els.height.value=d[1]}}
function renderAttachments(){els.attachments.innerHTML='';els.attachments.hidden=!state.attachments.length;state.attachments.forEach((f,i)=>{const d=document.createElement('div');d.className='attachment';const img=document.createElement('img'),url=URL.createObjectURL(f);img.src=url;img.onload=img.onerror=()=>setTimeout(()=>URL.revokeObjectURL(url),2000);const s=document.createElement('span');s.textContent=f.name;const b=document.createElement('button');b.type='button';b.textContent='×';b.onclick=()=>{state.attachments.splice(i,1);renderAttachments()};d.append(img,s,b);els.attachments.appendChild(d)})}
function snapshotJob(){return {mode:els.mode.value,prompt:els.prompt.value.trim(),files:[...state.attachments],quality:els.quality.value,width:Number(els.width.value),height:Number(els.height.value),seed:els.seed.value.trim()||String(Math.floor(Math.random()*2147483646)+1),temperature:Number(els.temperature.value||.7),memoryRetry:els.memoryRetry?.value||'auto',videoEngine:els.videoEngine.value,duration:Number(els.duration.value),fps:Number(els.fps.value),motion:els.motion.value}}
function validateJob(j){if(!j.prompt&&!(j.mode==='video'&&j.files.length))return 'Digite um prompt.';if(j.mode==='edit'&&j.files.length<1)return 'Envie uma imagem para editar.';if(j.mode==='merge'&&j.files.length<2)return 'Envie pelo menos duas imagens para juntar.';if(!modeAvailable(j.mode))return 'Ative o recurso necessário antes de continuar.';return null}
function enqueue(job){state.queue.push(job);renderQueue();addTextMessage('assistant',`Adicionado à fila: ${modes[job.mode].label}.`,{persist:false})}
function renderQueue(){els.queueCount.textContent=state.queue.length;els.queueList.innerHTML=state.queue.length?'':'<div class="bubble">A fila está vazia.</div>';state.queue.forEach((j,i)=>{const d=document.createElement('div');d.className='queue-item';d.innerHTML=`<div><strong>${modes[j.mode].label}</strong><br><small>${escapeHtml(j.prompt.slice(0,90)||'Sem prompt')}</small></div>`;const b=actionButton('Remover',()=>{state.queue.splice(i,1);renderQueue()},'danger');d.appendChild(b);els.queueList.appendChild(d)})}
function runNext(){if(state.running||!state.queue.length)return;executeJob(state.queue.shift());renderQueue()}
function launchJob(job){const copy={...job,files:[...(job.files||[])]};if(state.running)enqueue(copy);else executeJob(copy)}

// ---------- generation ----------
function estimateSeconds(job){
  const key=`giia-time:${job.mode}:${job.videoEngine||''}:${job.quality}:${job.width}x${job.height}`,learn=Number(localStorage.getItem(key));
  if(learn>0)return Math.max(12,learn);
  if(job.mode==='video')return job.videoEngine==='ai'?Math.max(120,job.duration*28):Math.max(35,job.duration*4);
  if(job.mode==='edit')return 75;
  if(job.mode==='merge')return 95;
  return 50;
}
function learnTime(job,sec){
  const key=`giia-time:${job.mode}:${job.videoEngine||''}:${job.quality}:${job.width}x${job.height}`,old=Number(localStorage.getItem(key));
  localStorage.setItem(key,String(old>0?old*.72+sec*.28:sec));
}
function fmt(sec){sec=Math.max(0,Math.round(sec));if(sec<60)return `${sec}s`;return `${Math.floor(sec/60)}m ${String(sec%60).padStart(2,'0')}s`}
function roundDim(n){return Math.max(256,Math.round(Number(n||256)/32)*32)}
function scaleJob(job,factor){return {...job,width:roundDim(job.width*factor),height:roundDim(job.height*factor),files:[...job.files]}}
function isMemoryError(info){return info?.errorCode==='GPU_OUT_OF_MEMORY'}
function lastFfmpegSeconds(text=''){
  const matches=[...String(text).matchAll(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  if(!matches.length)return null;
  const m=matches[matches.length-1];return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
}
function inferProgressStage(job,log=[]){
  const text=log.join('\n'),lower=text.toLowerCase();
  if(job.mode==='video'&&job.videoEngine==='ai'){
    if(/conclu[ií]do:/.test(lower))return {base:99,ceiling:99,label:'Finalizando vídeo…'};
    if(lower.includes('codificando mp4'))return {base:91,ceiling:98,label:'Codificando MP4…'};
    if(lower.includes('gerando frames por ia'))return {base:38,ceiling:89,label:'Gerando frames por IA…'};
    if(lower.includes('carregando ltx-video'))return {base:18,ceiling:36,label:'Carregando modelo de vídeo…'};
    if(lower.includes('dispositivo:'))return {base:12,ceiling:20,label:'Preparando motor de vídeo…'};
    if(lower.includes('carregando bibliotecas'))return {base:5,ceiling:14,label:'Carregando bibliotecas…'};
    return {base:2,ceiling:8,label:'Preparando vídeo IA…'};
  }
  if(job.mode==='video'){
    if(lower.includes('montando vídeo')){
      const done=lastFfmpegSeconds(text),dur=Math.max(1,Number(job.duration||1));
      if(done!=null)return {base:72+Math.min(1,done/dur)*24,ceiling:98,label:'Codificando vídeo…'};
      return {base:72,ceiling:96,label:'Montando vídeo…'};
    }
    if(lower.includes('gerando imagem-base'))return {base:8,ceiling:68,label:'Gerando imagem-base…'};
    return {base:2,ceiling:10,label:'Preparando vídeo…'};
  }
  if(/salvando|saving|write.*image|output.*png/.test(lower))return {base:97,ceiling:99,label:'Salvando resultado…'};
  if(/decode_first_stage completed|decodificando|vae decode|decode.*completed/.test(lower))return {base:92,ceiling:98,label:'Decodificando imagem…'};
  if(/generating image:|qwen_image_2_1 build|transformer_blocks/.test(lower))return {base:43,ceiling:90,label:'Gerando imagem…'};
  if(/get_learned_condition completed/.test(lower))return {base:38,ceiling:46,label:'Prompt processado…'};
  if(/qwen3vl build|conditioner|learned_condition/.test(lower))return {base:28,ceiling:42,label:job.mode==='image'?'Processando prompt…':'Processando prompt e referências…'};
  if(/encode_first_stage completed|preprocess ref/.test(lower))return {base:21,ceiling:31,label:'Preparando imagens de referência…'};
  if(/generate_image/.test(lower))return {base:18,ceiling:25,label:'Preparando geração…'};
  if(/loading vae|loading llm vision|loading llm|loading diffusion model/.test(lower))return {base:6,ceiling:18,label:'Carregando modelos…'};
  return {base:2,ceiling:10,label:'Preparando geração…'};
}
function smartProgress(job,log,elapsed,estimate,previous=1){
  const stage=inferProgressStage(job,log);
  const tau=Math.max(10,estimate*.72);
  const timeDriven=2+(1-Math.exp(-elapsed/tau))*90;
  let pct=Math.max(stage.base,Math.min(stage.ceiling,timeDriven));
  pct=Math.max(previous||1,pct);
  if(stage.base>=99)pct=Math.min(99,pct);
  const overdue=elapsed>=estimate;
  const eta=overdue?null:Math.max(1,estimate-elapsed);
  return {pct,eta,overdue,stage};
}
async function requestGeneration(job){const fd=new FormData();for(const [k,v] of Object.entries({mode:job.mode,prompt:job.prompt,width:job.width,height:job.height,seed:job.seed,videoEngine:job.videoEngine,duration:job.duration,fps:job.fps,motion:job.motion}))fd.append(k,v??'');for(const f of job.files)fd.append('images',f,f.name);const r=await fetch('/api/generate',{method:'POST',body:fd}),d=await r.json();if(!r.ok||!d.ok){const err=new Error(d.error||'Falha na geração.');err.details=d;throw err}return d}
async function executeJob(job){
  if(state.running){enqueue(job);return}
  state.running=true;state.currentJob=job;els.heroNote.hidden=true;
  els.seed.value=job.seed;const userEl=addTextMessage('user',job.prompt||'Criar a partir da imagem enviada.',{persist:true,chat:job.mode==='chat'});scrollMessageIntoView(userEl);
  els.prompt.value='';state.attachments=[];renderAttachments();
  if(job.mode==='chat'){
    const typing=addTyping('Respondendo…');
    try{const hist=getMessages().filter(m=>m.chat&&m.kind==='text').slice(-20).map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.text}));const sys=els.systemPrompt.value.trim();if(sys)hist.unshift({role:'system',content:sys});const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:job.prompt,messages:hist,temperature:job.temperature})}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Falha no chat.');typing.el.remove();const answer=addTextMessage('assistant',d.content||'(sem resposta)',{persist:true,chat:true});scrollMessageIntoView(answer);beep();if(document.hidden)setTitle(`RESPOSTA PRONTA • ${BASE_TITLE}`,true)}catch(e){typing.el.remove();addTextMessage('assistant',`Erro: ${e.message}`,{persist:true,chat:true})}finally{state.running=false;setTimeout(runNext,150)}return
  }
  const refs=createGenerationMessage(job);state.activeGeneration=refs;scrollMessageIntoView(refs.el);
  const retryMode=job.memoryRetry||els.memoryRetry?.value||'auto';refs.memoryRetryMode=retryMode;
  const attempts=[{job:{...job,files:[...job.files]},factor:1,label:'original'}];
  if(retryMode==='auto'){const seen=new Set([`${job.width}x${job.height}`]);for(const [factor,label] of [[.75,'75%'],[.5,'50%']]){const next=scaleJob(job,factor),key=`${next.width}x${next.height}`;if(!seen.has(key)){seen.add(key);attempts.push({job:next,factor,label})}}}
  let finalError=null,success=false;
  try{
    for(let i=0;i<attempts.length;i++){
      const attempt=attempts[i],attemptJob=attempt.job;refs.job=attemptJob;state.currentJob=attemptJob;
      if(i>0){refs.attemptLogs.push(`--- Tentativa automática ${i+1}: ${attemptJob.width}x${attemptJob.height} (${attempt.label}) ---`);resetGenerationLoader(refs,attemptJob,`Memória insuficiente. Tentando novamente em ${attemptJob.width}×${attemptJob.height}…`);scrollMessageIntoView(refs.el)}
      const attemptStarted=Date.now();startProgress(attemptJob,refs);
      try{
        const d=await requestGeneration(attemptJob);const rec=await saveResult(d,attemptJob,{requestedWidth:job.width,requestedHeight:job.height,autoRetry:i>0,retryFactor:attempt.factor});stopProgress();updateGenerationProgress(refs,100,0,[],{label:'Concluído'});finishGenerationCard(refs,rec);els.seed.value=d.seed||attemptJob.seed;learnTime(attemptJob,(Date.now()-attemptStarted)/1000);beep();if(document.hidden)setTitle(`CRIADO COM SUCESSO • ${BASE_TITLE}`,true);success=true;break
      }catch(e){stopProgress();finalError=e.details||{errorTitle:'Falha na geração',error:e.message,errorCode:'GENERATION_FAILED',suggestions:['Abra o log técnico para ver os detalhes.']};if(!(isMemoryError(finalError)&&retryMode==='auto'&&i<attempts.length-1))break;refs.attemptLogs.push(...(Array.isArray(finalError.log)?finalError.log:[]));}
    }
    if(!success){failGenerationCard(refs,finalError||{errorTitle:'Falha na geração',error:'Não foi possível concluir.',errorCode:'GENERATION_FAILED'});if(document.hidden)setTitle(`ERRO • ${BASE_TITLE}`,true)}
  }finally{state.running=false;state.activeGeneration=null;state.currentJob=null;await refreshResources();setTimeout(runNext,250)}
}
function startProgress(job,refs){
  stopProgress();const token=(refs.progressToken||0)+1;refs.progressToken=token;refs.lastPct=1;state.progressStart=Date.now();state.progressEstimate=estimateSeconds(job);state.progressTimer=setInterval(()=>pollProgress(job,refs,token),1000);pollProgress(job,refs,token)
}
async function pollProgress(job,refs,token){
  try{
    const d=await fetch('/api/progress',{cache:'no-store'}).then(r=>r.json());if(token!==refs.progressToken)return;
    const elapsed=(Date.now()-state.progressStart)/1000,log=d.log||[];
    const smart=smartProgress(job,log,elapsed,state.progressEstimate,refs.lastPct);refs.lastPct=smart.pct;
    updateGenerationProgress(refs,smart.pct,smart.eta,log,smart.stage,smart.overdue)
  }catch{}
}
function updateGenerationProgress(refs,pct,eta,log,stage={label:'Processando…'},overdue=false){
  const p=Math.max(0,Math.min(100,Math.round(pct)));refs.pct.textContent=`${p}%`;
  let etaText='';
  if(p>=100)etaText='Concluído';
  else if(overdue||eta==null)etaText=`${stage.label} Mais tempo que o previsto.`;
  else etaText=`${stage.label} Previsão: ~${fmt(eta)} restantes.`;
  refs.eta.textContent=etaText;refs.bar.style.width=`${p}%`;
  refs.meta.textContent=p>=100?'Concluído':`${stage.label} • ${p}%${overdue?' • estimativa excedida':` • ~${fmt(eta)}`}`;
  const text=[...(refs.attemptLogs||[]),...(log||[])].join('\n');if(text!==refs.log.textContent){const left=refs.log.scrollLeft;refs.log.textContent=text;refs.log.scrollLeft=left;if(refs.logFollow)refs.log.scrollTop=refs.log.scrollHeight}
  const titleStatus=p>=100?'Concluído':overdue?'Processando…':`~${fmt(eta)}`;if(document.hidden)setTitle(p>=100?`100% • Concluído • ${BASE_TITLE}`:`${p}% • ${titleStatus} • ${state.currentJob?.mode==='video'?'Vídeo':'Imagem'} IA`,false);else setTitle(BASE_TITLE,false)
}
function stopProgress(){clearInterval(state.progressTimer);state.progressTimer=null;if(!state.titleAlert)setTitle(BASE_TITLE,false)}
async function saveResult(d,job={},retryInfo={}){const r=await fetch(d.url);if(!r.ok)throw new Error('Não foi possível guardar o resultado.');const blob=await r.blob();const sourceFiles=(job.files||[]).map(f=>({name:f.name,type:f.type,lastModified:f.lastModified,blob:f.slice(0,f.size,f.type)}));const jobSettings={quality:job.quality,width:job.width,height:job.height,temperature:job.temperature,memoryRetry:job.memoryRetry||'auto',videoEngine:job.videoEngine,duration:job.duration,fps:job.fps,motion:job.motion};const rec={createdAt:Date.now(),type:d.type,mode:d.mode,prompt:d.prompt||'',seed:d.seed,width:d.width,height:d.height,duration:d.duration||null,fps:d.fps||null,filename:d.filename,blob,sourceFiles,jobSettings,retryInfo};rec.id=await dbAdd(rec);return rec}

// ---------- gallery ----------
async function renderGallery(){const all=await dbAll(),q=els.gallerySearch.value.trim().toLowerCase(),f=els.galleryFilter.value;const list=all.filter(r=>(!q||(r.prompt||'').toLowerCase().includes(q))&&(f==='all'||r.type===f));els.galleryGrid.innerHTML='';if(!list.length){els.galleryGrid.innerHTML='<div class="bubble">Nada salvo ainda.</div>';return}for(const r of list){const card=document.createElement('article');card.className='gallery-card';const thumb=document.createElement('div');thumb.className='gallery-thumb';const url=URL.createObjectURL(r.blob),m=document.createElement(r.type==='video'?'video':'img');m.src=url;if(r.type==='video'){m.muted=true;m.preload='metadata'}thumb.appendChild(m);const info=document.createElement('div');info.className='gallery-info';const title=document.createElement('strong');title.textContent=r.prompt||'Sem prompt';const meta=document.createElement('small');meta.textContent=mediaMeta(r);const acts=document.createElement('div');acts.className='gallery-actions';acts.append(actionButton('Usar',()=>{reuseRecord(r);els.gallery.close()}),actionButton('Excluir',()=>deleteRecord(r,null),'danger'));info.append(title,meta,acts);card.append(thumb,info);els.galleryGrid.appendChild(card)}}

// ---------- events ----------
els.composer.addEventListener('submit',e=>{e.preventDefault();const j=snapshotJob(),err=validateJob(j);if(err){addTextMessage('assistant',err,{persist:false});return}state.running?enqueue(j):executeJob(j)});
els.prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();els.composer.requestSubmit()}});
els.mode.onchange=setMode;els.videoEngine.onchange=()=>{updateAvailability();applyPreset();savePrefs()};els.optionsBtn.onclick=()=>openDialog(els.options);
els.file.onchange=()=>{const incoming=[...els.file.files].filter(f=>f.type.startsWith('image/'));const limit=els.mode.value==='merge'?8:1;state.attachments=[...state.attachments,...incoming].slice(0,limit);renderAttachments();els.file.value=''};
window.addEventListener('paste',e=>{if(!modes[els.mode.value].upload)return;const incoming=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(!incoming.length)return;const limit=els.mode.value==='merge'?8:1;state.attachments=[...state.attachments,...incoming].slice(0,limit);renderAttachments()});
els.resourcesBtn.onclick=async()=>{await refreshResources();openDialog(els.resourcesDialog)};els.lockedAction.onclick=async()=>{await refreshResources();openDialog(els.resourcesDialog)};els.galleryBtn.onclick=async()=>{await renderGallery();openDialog(els.gallery)};els.queueBtn.onclick=()=>{renderQueue();openDialog(els.queueDialog)};els.promptBtn.onclick=()=>openDialog(els.promptDialog);els.newChat.onclick=()=>{if(confirm('Limpar somente esta conversa? A galeria será preservada.')){localStorage.removeItem('giia-thread');hydrateThread();els.heroNote.hidden=false}};
$$('[data-start-mode]').forEach(b=>b.onclick=()=>{const mode=b.dataset.startMode;if(!modes[mode])return;const opt=[...els.mode.options].find(o=>o.value===mode);if(opt?.disabled){refreshResources().then(()=>openDialog(els.resourcesDialog));return}els.mode.value=mode;setMode();scrollToComposer();els.prompt.focus()});
if(els.installerDismiss)els.installerDismiss.onclick=()=>{els.installerBox.hidden=true;els.installerLog.hidden=true;els.installerToggle.textContent='Mostrar log'};
$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
els.gallerySearch.oninput=renderGallery;els.galleryFilter.onchange=renderGallery;els.installAll.onclick=installAll;

els.reloadModels.onclick=async()=>{await loadModelCatalog();await refreshResources();alert('modelos.json recarregado.');};
els.openModels.onclick=async()=>{try{const r=await fetch('/api/open-modelos',{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível abrir modelos.json.')}catch(e){alert(e.message)}};
els.installerToggle.onclick=()=>{els.installerLog.hidden=!els.installerLog.hidden;els.installerToggle.textContent=els.installerLog.hidden?'Mostrar log':'Ocultar log';if(!els.installerLog.hidden){state.installerFollow=true;els.installerLog.scrollTop=els.installerLog.scrollHeight}};
els.installerLog.addEventListener('scroll',()=>{const near=els.installerLog.scrollHeight-els.installerLog.scrollTop-els.installerLog.clientHeight<18;state.installerFollow=near;els.installerJump.hidden=near});els.installerJump.onclick=()=>{state.installerFollow=true;els.installerLog.scrollTop=els.installerLog.scrollHeight;els.installerJump.hidden=true};
[els.quality,els.ratio].forEach(el=>el.onchange=()=>{applyPreset();savePrefs()});[els.width,els.height].forEach(el=>el.oninput=()=>{els.ratio.value='custom';savePrefs()});[els.seed,els.temperature,els.memoryRetry,els.duration,els.fps,els.motion].filter(Boolean).forEach(el=>el.onchange=savePrefs);
els.savePrompt.onclick=()=>{savePrefs();els.promptDialog.close()};
$$('[data-preset]').forEach(b=>b.onclick=()=>{const map={cinematic:'cinematic, dramatic lighting, detailed composition, strong visual storytelling',anime:'anime style, expressive lighting, dynamic composition, detailed linework',realistic:'photorealistic, natural lighting, realistic textures, fine detail',product:'professional product photography, clean studio lighting, premium commercial composition'};els.prompt.value=[els.prompt.value.trim(),map[b.dataset.preset]].filter(Boolean).join(', ');els.promptDialog.close();scrollToComposer()});
els.firstRunResources.onclick=async()=>{els.firstRun.close();await refreshResources();openDialog(els.resourcesDialog)};els.firstRunSkip.onclick=()=>{localStorage.setItem('giia-first-run','1');els.firstRun.close()};

async function boot(){await migrateLegacyStorage();loadPrefs();await loadModelCatalog();await hydrateThread();await refreshResources();if(!modeAvailable(els.mode.value)){const first=['image','video','chat','edit','merge'].find(modeAvailable);if(first)els.mode.value=first}setMode();renderQueue();scrollConversationBottom('auto');if(!localStorage.getItem('giia-first-run')&&Object.values(state.resources).every(r=>!r.installed)){openDialog(els.firstRun)}setInterval(refreshResources,15000)}
boot();
