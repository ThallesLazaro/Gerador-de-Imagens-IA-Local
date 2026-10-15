const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const BASE_TITLE='Gerador de Imagens IA Local';
if('scrollRestoration' in history) history.scrollRestoration='manual';
const els={
  appStatus:$('#appStatus'),thread:$('#thread'),heroNote:$('#emptyState'),composerAnchor:$('#composerAnchor'),composer:$('#composer'),prompt:$('#prompt'),mode:$('#modeSelect'),send:$('#sendBtn'),
  upload:$('#uploadBtn'),file:$('#fileInput'),attachments:$('#attachmentBar'),optionsBtn:$('#optionsBtn'),options:$('#optionsDialog'),
  quality:$('#quality'),ratio:$('#ratio'),width:$('#width'),height:$('#height'),seed:$('#seed'),temperature:$('#temperature'),memoryRetry:$('#memoryRetry'),videoOptions:$('#videoOptions'),videoEngine:$('#videoEngine'),duration:$('#duration'),fps:$('#fps'),motion:$('#motion'),
  locked:$('#lockedHint'),lockedText:$('#lockedText'),lockedAction:$('#lockedAction'),resourcesBtn:$('#resourcesBtn'),resourcesDialog:$('#resourcesDialog'),resourceGrid:$('#resourceGrid'),resourceSummary:$('#resourceSummary'),installAll:$('#installAllBtn'),installerBox:$('#installerBox'),installerTitle:$('#installerTitle'),installerPct:$('#installerPct'),installerBar:$('#installerBar'),installerMessage:$('#installerMessage'),installerLog:$('#installerLog'),installerToggle:$('#installerToggle'),installerDismiss:$('#installerDismiss'),installerCancel:$('#installerCancel'),installerJump:$('#installerJump'),
  galleryBtn:$('#galleryBtn'),gallery:$('#galleryDialog'),galleryGrid:$('#galleryGrid'),gallerySearch:$('#gallerySearch'),galleryFilter:$('#galleryFilter'),galleryMore:$('#galleryMoreBtn'),
  queueBtn:$('#queueBtn'),queueCount:$('#queueCount'),queueDialog:$('#queueDialog'),queueList:$('#queueList'),newChat:$('#newChatBtn'),
  promptBtn:$('#promptBtn'),promptDialog:$('#promptDialog'),systemPrompt:$('#systemPrompt'),savePrompt:$('#savePromptSettings'),
  firstRun:$('#firstRunDialog'),firstRunResources:$('#firstRunResources'),firstRunSkip:$('#firstRunSkip'),reloadModels:$('#reloadModelsBtn'),openModels:$('#openModelsBtn'),catalogNote:$('#catalogNote')
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
const HISTORY_PAGE_SIZE=24, HISTORY_MAX_MESSAGES=800, QUEUE_MAX_ITEMS=8, QUEUE_MAX_BYTES=512*1024*1024;
const state={resources:{},runtime:{},catalog:null,serverAvailable:null,attachments:[],running:false,currentJob:null,queue:[],progressTimer:null,progressEpoch:0,progressStart:0,progressEstimate:30,activeGeneration:null,installerTimer:null,installerFollow:true,installerLast:'',installerRunning:false,installerError:null,installerCancelled:false,installerPollFailures:0,titleAlert:false,hydrating:false,historyMessages:[],messageCache:null,historyCursor:0,historyLoading:false,historySyncTimer:null,galleryOffset:0,galleryLoading:false,galleryUrls:[]};

// Toda ação que altera o servidor local recebe um cabeçalho não enviável por formulários externos.
// Isso bloqueia CSRF sem mudar a API visível para o restante da interface.
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,options={})=>{
  const method=String(options.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
  let next=options;
  try{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&['POST','PUT','PATCH','DELETE'].includes(method)){
      const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
      headers.set('X-Gerador-Local','1');
      next={...options,headers};
    }
  }catch{}
  return nativeFetch(input,next);
};

async function readJsonResponse(response,label='servidor'){
  const text=await response.text();
  try{return text?JSON.parse(text):{}}
  catch{const e=new Error(`O ${label} devolveu uma resposta inválida (${response.status}).`);e.details={ok:false,errorCode:'INVALID_RESPONSE',error:e.message,technical:text.slice(0,500),suggestions:['Tente novamente.','Se o problema continuar, execute DIAGNOSTICO.bat.']};throw e}
}
async function fetchJson(url,options={},label='servidor local'){
  let response;
  try{response=await fetch(url,options);state.serverAvailable=true}catch(e){state.serverAvailable=false;const err=new Error('Não foi possível comunicar com o servidor local. Verifique se a janela do ABRIR.bat continua aberta.');err.details={ok:false,errorCode:'SERVER_UNAVAILABLE',error:err.message,technical:e?.message||String(e),suggestions:['Confira se o ABRIR.bat continua aberto.','Se a janela fechou, abra o aplicativo novamente e tente de novo.']};throw err}
  const data=await readJsonResponse(response,label);return {response,data}
}

// ---------- storage ----------
const DB='GeradorImagensIALocalMedia', LEGACY_DB='QwenStudioLocalMedia', STORE='generations', SOURCE_STORE='sources', DB_VERSION=2;
function openNamedDb(name){return new Promise((ok,fail)=>{const version=name===DB?DB_VERSION:1;const r=indexedDB.open(name,version);r.onupgradeneeded=()=>{const db=r.result;let st;if(!db.objectStoreNames.contains(STORE)){st=db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true});st.createIndex('createdAt','createdAt');st.createIndex('filename','filename')}else{st=r.transaction.objectStore(STORE);if(!st.indexNames.contains('createdAt'))st.createIndex('createdAt','createdAt');if(name===DB&&!st.indexNames.contains('filename'))st.createIndex('filename','filename')}if(name===DB&&!db.objectStoreNames.contains(SOURCE_STORE)){const src=db.createObjectStore(SOURCE_STORE,{keyPath:'key'});src.createIndex('createdAt','createdAt')}};r.onsuccess=()=>{r.result.onversionchange=()=>{try{r.result.close()}catch{}};ok(r.result)};r.onerror=()=>fail(r.error);r.onblocked=()=>fail(new Error('O armazenamento local está bloqueado por outra aba do aplicativo. Feche as outras abas e tente novamente.'))})}
function openDb(){return openNamedDb(DB)}
async function sourceKey(file){try{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}catch{return `${file.name||''}|${file.type||''}|${file.size||0}|${file.lastModified||0}`}}
async function dbAdd(v,sourceFiles=[]){
  const prepared=[];
  for(const file of sourceFiles||[]){
    const key=await sourceKey(file);
    prepared.push({key,name:file.name||'referencia.png',type:file.type||'image/png',lastModified:file.lastModified||Date.now(),size:file.size||0,blob:file.slice(0,file.size,file.type),createdAt:Date.now()});
  }
  const grouped=new Map();
  for(const src of prepared){
    const current=grouped.get(src.key);
    if(current)current.count+=1;
    else grouped.set(src.key,{src,count:1});
  }
  const refs=prepared.map(x=>({key:x.key,name:x.name,type:x.type,lastModified:x.lastModified,size:x.size}));
  const db=await openDb();
  return new Promise((ok,fail)=>{
    let newId=null;
    const tx=db.transaction([STORE,SOURCE_STORE],'readwrite'),store=tx.objectStore(STORE),sources=tx.objectStore(SOURCE_STORE);
    const record={...v,sourceRefs:refs,sourceCount:refs.length};delete record.sourceFiles;
    for(const {src,count} of grouped.values()){
      const g=sources.get(src.key);
      g.onsuccess=()=>{const current=g.result;if(current)sources.put({...current,refs:Number(current.refs||0)+count});else sources.put({...src,refs:count})};
    }
    const r=store.add(record);r.onsuccess=()=>{newId=r.result};r.onerror=()=>fail(r.error);
    tx.oncomplete=()=>{db.close();ok(newId)};
    tx.onerror=()=>fail(tx.error||new Error('Falha ao salvar a geração.'));
    tx.onabort=()=>{db.close();fail(tx.error||new Error('Falha ao salvar a geração.'))};
  });
}
async function dbGet(id){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(Number(id));r.onsuccess=()=>ok(r.result||null);r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbPut(v){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(STORE,'readwrite'),r=tx.objectStore(STORE).put(v);r.onerror=()=>fail(r.error);tx.oncomplete=()=>{db.close();ok(r.result)};tx.onerror=()=>fail(tx.error||new Error('Falha ao atualizar o registro local.'))})}
async function dbGetSource(key){const db=await openDb();return new Promise((ok,fail)=>{const tx=db.transaction(SOURCE_STORE,'readonly'),r=tx.objectStore(SOURCE_STORE).get(String(key||''));r.onsuccess=()=>ok(r.result||null);r.onerror=()=>fail(r.error);tx.oncomplete=()=>db.close()})}
async function dbDelete(id){
  const db=await openDb();
  return new Promise((ok,fail)=>{
    const tx=db.transaction([STORE,SOURCE_STORE],'readwrite'),store=tx.objectStore(STORE),sources=tx.objectStore(SOURCE_STORE),g=store.get(Number(id));
    g.onerror=()=>fail(g.error);
    g.onsuccess=()=>{
      const rec=g.result;store.delete(Number(id));
      const counts=new Map();for(const ref of rec?.sourceRefs||[])counts.set(ref.key,(counts.get(ref.key)||0)+1);
      for(const [key,count] of counts){
        const r=sources.get(key);
        r.onsuccess=()=>{const src=r.result;if(!src)return;const next=Number(src.refs||1)-count;if(next<=0)sources.delete(key);else sources.put({...src,refs:next})};
      }
    };
    tx.oncomplete=()=>{db.close();ok()};
    tx.onerror=()=>fail(tx.error||new Error('Falha ao excluir o registro local.'));
    tx.onabort=()=>{db.close();fail(tx.error||new Error('Falha ao excluir o registro local.'))};
  });
}
async function dbAllLite(){const db=await openDb();return new Promise((ok,fail)=>{const rows=[],tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor();req.onsuccess=()=>{const cur=req.result;if(!cur)return;rows.push(recordLite(cur.value));cur.continue()};req.onerror=()=>fail(req.error);tx.oncomplete=()=>{db.close();ok(rows)};tx.onabort=()=>{db.close();fail(tx.error||new Error('Falha ao ler a Galeria local.'))}})}
async function dbGalleryPage({offset=0,limit=36,q='',type='all'}={}){
  const db=await openDb();
  return new Promise((ok,fail)=>{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE),index=store.index('createdAt');
    const rows=[];let matched=0,done=false;const needle=String(q||'').trim().toLowerCase();
    const req=index.openCursor(null,'prev');
    req.onerror=()=>fail(req.error);
    req.onsuccess=()=>{
      const cur=req.result;if(!cur||done){if(!done){done=true;ok({rows,hasMore:false})}return}
      const v=cur.value,matchType=type==='all'||v.type===type,matchQ=!needle||String(v.prompt||'').toLowerCase().includes(needle);
      if(matchType&&matchQ){
        if(matched++>=offset){rows.push(v.filename?recordLite(v):v);if(rows.length>limit){done=true;ok({rows:rows.slice(0,limit),hasMore:true});try{tx.abort()}catch{};return}}
      }
      cur.continue();
    };
    tx.oncomplete=()=>db.close();tx.onabort=()=>db.close();
  });
}
async function dbReconcileSources(){
  const db=await openDb();
  const records=[];const existing=new Map();
  try{
    await new Promise((ok,fail)=>{
      const tx=db.transaction([STORE,SOURCE_STORE],'readonly');
      const generations=tx.objectStore(STORE).openCursor();
      generations.onsuccess=()=>{const cur=generations.result;if(!cur)return;records.push({id:cur.primaryKey,refs:Array.isArray(cur.value?.sourceRefs)?cur.value.sourceRefs:[]});cur.continue()};
      generations.onerror=()=>fail(generations.error);
      const sources=tx.objectStore(SOURCE_STORE).openCursor();
      sources.onsuccess=()=>{const cur=sources.result;if(!cur)return;existing.set(String(cur.primaryKey),Number(cur.value?.refs||0));cur.continue()};
      sources.onerror=()=>fail(sources.error);
      tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);
    });
    const available=new Set(existing.keys()),expected=new Map(),recordFixes=[];
    for(const rec of records){
      const filtered=rec.refs.filter(ref=>available.has(String(ref?.key||'')));
      for(const ref of filtered){const key=String(ref.key);expected.set(key,(expected.get(key)||0)+1)}
      if(filtered.length!==rec.refs.length)recordFixes.push({id:rec.id,refs:filtered});
    }
    if(recordFixes.length){
      await new Promise((ok,fail)=>{
        const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
        for(const fix of recordFixes){
          const g=store.get(fix.id);g.onsuccess=()=>{const value=g.result;if(!value)return;store.put({...value,sourceRefs:fix.refs,sourceCount:fix.refs.length})};
        }
        tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);
      });
    }
    let removed=0,repaired=0;
    await new Promise((ok,fail)=>{
      const tx=db.transaction(SOURCE_STORE,'readwrite'),store=tx.objectStore(SOURCE_STORE),req=store.openCursor();
      req.onsuccess=()=>{const cur=req.result;if(!cur)return;const key=String(cur.primaryKey),want=Number(expected.get(key)||0);if(want<=0){cur.delete();removed++}else if(Number(cur.value?.refs||0)!==want){cur.update({...cur.value,refs:want});repaired++}cur.continue()};
      req.onerror=()=>fail(req.error);tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);
    });
    return {removed,repaired,missingReferences:recordFixes.reduce((n,x)=>n+1,0)};
  }finally{try{db.close()}catch{}}
}

function recoveredRecordFromOutput(file){const name=String(file.filename||''),parsedSeed=(name.match(/_(-?\d+)\.(?:png|mp4)$/i)||[])[1]||'';let mode=file.mode||(file.type==='video'?'video':'image');if(!file.mode&&/^qwen_edit_/i.test(name))mode='edit';else if(!file.mode&&/^qwen_merge_/i.test(name))mode='merge';const rec={createdAt:Number(file.createdAt||file.modifiedAt)||Date.now(),type:file.type==='video'?'video':'image',mode,prompt:file.prompt||'Arquivo recuperado da pasta outputs',seed:String(file.seed??parsedSeed??''),width:Number(file.width)||null,height:Number(file.height)||null,duration:Number(file.duration)||null,fps:Number(file.fps)||null,filename:name,sourceCount:0,jobSettings:{width:Number(file.width)||null,height:Number(file.height)||null,videoEngine:file.videoEngine||null,duration:Number(file.duration)||null,fps:Number(file.fps)||null,motion:file.motion||null},retryInfo:{},recovered:true};return rec}
async function reconcileMediaStorage(){
  try{
    const {response,data}=await fetchJson('/api/outputs/index',{cache:'no-store'},'arquivos de saída');
    if(!response.ok||!data.ok)return {removed:0,recovered:0};
    const files=Array.isArray(data.files)?data.files:[],physical=new Map(files.map(f=>[String(f.filename||''),f]));
    const records=await dbAllLite(),byFilename=new Map(),byId=new Map();let removed=0,recovered=0,legacyPreserved=0;
    for(const r of records){
      if(!r.filename){byId.set(Number(r.id),r);continue}
      if(!physical.has(r.filename)){
        const full=await dbGet(r.id);
        if(full?.blob instanceof Blob){full.filename='';full.recovered=true;full.legacyRecoveredBlob=true;await dbPut(full);const lite=recordLite(full);byId.set(Number(r.id),lite);legacyPreserved++;continue}
        await dbDelete(r.id);removeMediaMessage(r.id);removed++;continue
      }
      byFilename.set(r.filename,r);byId.set(Number(r.id),r);
    }
    for(const f of files){
      if(!f.filename||byFilename.has(f.filename))continue;
      const rec=recoveredRecordFromOutput(f);
      try{rec.id=await dbAdd(rec,[]);byFilename.set(f.filename,rec);byId.set(Number(rec.id),rec);recovered++}catch(e){console.warn('Não foi possível recuperar',f.filename,e)}
    }
    const original=getMessages(),synced=[];let threadChanged=false;
    for(const m of original){
      if(m?.kind!=='media'){synced.push(m);continue}
      const filename=m.media?.filename,recById=byId.get(Number(m.recordId));
      if(recById&&(!filename||!recById.filename||recById.filename===filename)){const lite=recordLite(recById);const changedFilename=(m.media?.filename||'')!==(lite.filename||'');if(changedFilename){synced.push({...m,media:lite});threadChanged=true}else synced.push(m);continue}

      if(!filename){threadChanged=true;continue}
      if(!physical.has(filename)){threadChanged=true;continue}
      const rec=byFilename.get(filename);
      if(rec){synced.push({...m,recordId:rec.id,media:recordLite(rec)});threadChanged=true}else synced.push(m)
    }
    if(threadChanged)setMessages(synced);
    const sourceRepair=await dbReconcileSources().catch(error=>{console.warn('Reconciliação das referências não concluída:',error);return {removed:0,repaired:0,error}});
    if(removed||recovered||legacyPreserved||threadChanged||sourceRepair.removed||sourceRepair.repaired){console.info(`Reconciliação da Galeria: ${removed} registro(s) removido(s), ${recovered} arquivo(s) recuperado(s), ${legacyPreserved} item(ns) legado(s) preservado(s), ${sourceRepair.removed||0} referência(s) órfã(s) removida(s).`)}
    return {removed,recovered,legacyPreserved,threadChanged,sourceRepair}
  }catch(e){console.warn('Reconciliação da Galeria não concluída:',e);return {removed:0,recovered:0,error:e}}
}

async function migrateLegacyStorage(){
  try{
    const pairs=[['qsl-thread','giia-thread'],['qsl-prefs','giia-prefs'],['qsl-first-run','giia-first-run']];
    for(const [oldKey,newKey] of pairs)if(localStorage.getItem(newKey)==null&&localStorage.getItem(oldKey)!=null)localStorage.setItem(newKey,localStorage.getItem(oldKey));
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('qsl-time:')){const nk='giia-time:'+k.slice(9);if(localStorage.getItem(nk)==null)localStorage.setItem(nk,localStorage.getItem(k));}}
  }catch(e){console.warn('Migração do localStorage antigo não concluída:',e)}
  try{
    if(indexedDB.databases){const names=(await indexedDB.databases()).map(x=>x.name);if(!names.includes(LEGACY_DB))return}
    const old=await openNamedDb(LEGACY_DB);
    if(!old.objectStoreNames.contains(STORE)){old.close();return}
    const dest=await openDb();let lastKey=null;
    while(true){
      const batch=await new Promise((ok,fail)=>{
        const tx=old.transaction(STORE,'readonly'),store=tx.objectStore(STORE),rows=[];
        const range=lastKey==null?null:IDBKeyRange.lowerBound(lastKey,true),req=store.openCursor(range);
        req.onsuccess=()=>{const cur=req.result;if(!cur||rows.length>=8){ok(rows);return}rows.push({key:cur.key,value:cur.value});cur.continue()};
        req.onerror=()=>fail(req.error);tx.onerror=()=>fail(tx.error);
      });
      if(!batch.length)break;
      await new Promise((ok,fail)=>{
        const tx=dest.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
        for(const row of batch){const g=store.get(row.key);g.onsuccess=()=>{const existing=g.result;if(!existing){store.put(row.value);return}const same=(existing.filename&&row.value?.filename&&existing.filename===row.value.filename)||(existing.createdAt&&row.value?.createdAt&&Number(existing.createdAt)===Number(row.value.createdAt)&&existing.type===row.value.type);if(!same){const clone={...row.value};delete clone.id;store.add(clone)}}}
        tx.oncomplete=()=>ok();tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error)
      });
      lastKey=batch[batch.length-1].key;
      if(batch.length<8)break;
    }
    old.close();dest.close();
    await new Promise(resolve=>{const d=indexedDB.deleteDatabase(LEGACY_DB);d.onsuccess=()=>resolve();d.onerror=()=>resolve();d.onblocked=()=>{console.warn('Banco legado ainda está aberto em outra aba; ele será removido em uma próxima inicialização.');resolve()}});
  }catch(e){console.warn('Migração de histórico antigo não concluída:',e)}
}
function getMessages(){
  if(Array.isArray(state.messageCache))return state.messageCache;
  try{const parsed=JSON.parse(localStorage.getItem('giia-thread')||'[]');state.messageCache=Array.isArray(parsed)?parsed:[];return state.messageCache}catch{state.messageCache=[];return state.messageCache}
}
function historyRevision(){try{return Number(localStorage.getItem('giia-thread-revision')||0)||0}catch{return 0}}
function nextHistoryRevision(){const next=Math.max(Date.now(),historyRevision()+1);try{localStorage.setItem('giia-thread-revision',String(next))}catch{}return next}
function setMessages(m){
  let next=m.slice(-HISTORY_MAX_MESSAGES);
  while(next.length){try{localStorage.setItem('giia-thread',JSON.stringify(next));state.messageCache=next;const revision=nextHistoryRevision();scheduleHistoryBackup(next,revision);return}catch(e){if(e?.name!=='QuotaExceededError'&&e?.name!=='NS_ERROR_DOM_QUOTA_REACHED'){console.warn('Histórico não pôde ser persistido no localStorage:',e);state.messageCache=next;const revision=nextHistoryRevision();scheduleHistoryBackup(next,revision);return}next=next.slice(Math.max(1,Math.floor(next.length*.2)))}}
  try{localStorage.removeItem('giia-thread')}catch{}state.messageCache=[];const revision=nextHistoryRevision();scheduleHistoryBackup([],revision)
}
function historyLastAt(messages=[]){return messages.reduce((max,m)=>Math.max(max,Number(m?.at||0)),0)}
function historySnapshot(messages=state.messageCache||getMessages()){return (messages||[]).slice(-HISTORY_MAX_MESSAGES)}
function sendHistoryBackup(snapshot,{keepalive=false,revision=historyRevision()}={}){return fetch('/api/history',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:historySnapshot(snapshot),revision}),keepalive}).catch(()=>{})}
function scheduleHistoryBackup(messages=state.messageCache||[],revision=historyRevision()){clearTimeout(state.historySyncTimer);const snapshot=historySnapshot(messages);state.historySyncTimer=setTimeout(()=>{state.historySyncTimer=null;sendHistoryBackup(snapshot,{revision})},350)}
function flushHistoryBackup(){
  clearTimeout(state.historySyncTimer);state.historySyncTimer=null;
  let fresh=[];try{const parsed=JSON.parse(localStorage.getItem('giia-thread')||'[]');fresh=Array.isArray(parsed)?parsed:[]}catch{fresh=historySnapshot()}
  const body=JSON.stringify({messages:historySnapshot(fresh),revision:historyRevision()});
  // fetch keepalive permite enviar o cabeçalho local de segurança; sendBeacon não permite headers personalizados.
  try{fetch('/api/history',{method:'PUT',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{})}catch{}
}
async function syncHistoryFromServer(){try{const r=await fetch('/api/history',{cache:'no-store'});if(!r.ok)return;const d=await r.json(),server=Array.isArray(d.messages)?d.messages.slice(-HISTORY_MAX_MESSAGES):[],local=getMessages();const serverLast=historyLastAt(server),localLast=historyLastAt(local),serverUpdated=Number(d.updatedAt||0);if(!server.length&&serverUpdated>localLast){setMessages([])}else if(server.length&&(!local.length||serverLast>localLast)){setMessages(server)}else if(local.length) scheduleHistoryBackup(local)}catch(e){console.warn('Backup do histórico não pôde ser sincronizado:',e)}}
async function clearConversationHistory(){clearTimeout(state.historySyncTimer);state.historySyncTimer=null;try{localStorage.removeItem('giia-thread')}catch{}state.messageCache=[];const revision=nextHistoryRevision();try{await fetch('/api/history',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})})}catch{}}

function rememberMessage(m){const all=getMessages();all.push(m);setMessages(all)}
function removeMediaMessage(recordId){setMessages(getMessages().filter(m=>Number(m.recordId)!==Number(recordId)))}
function savePrefs(){try{localStorage.setItem('giia-prefs',JSON.stringify({mode:els.mode.value,quality:els.quality.value,ratio:els.ratio.value,width:els.width.value,height:els.height.value,temperature:els.temperature.value,memoryRetry:els.memoryRetry?.value||'auto',videoEngine:els.videoEngine.value,duration:els.duration.value,fps:els.fps.value,motion:els.motion.value,systemPrompt:els.systemPrompt.value}))}catch(e){console.warn('Preferências não puderam ser salvas:',e)}}
function loadPrefs(){try{const p=JSON.parse(localStorage.getItem('giia-prefs')||'{}');for(const k of ['quality','ratio','width','height','temperature','memoryRetry','videoEngine','duration','fps','motion'])if(p[k]!=null&&els[k])els[k].value=p[k];if(p.mode&&modes[p.mode])els.mode.value=p.mode;if(p.systemPrompt)els.systemPrompt.value=p.systemPrompt}catch{}}

async function requestPersistentStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch{}}

// ---------- generic UI ----------
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setTitle(t=BASE_TITLE,alert=false){document.title=t;state.titleAlert=alert}
function resetTitle(){setTitle(BASE_TITLE,false)}
window.addEventListener('focus',resetTitle);document.addEventListener('visibilitychange',()=>{if(!document.hidden)resetTitle();else flushHistoryBackup()});window.addEventListener('pagehide',flushHistoryBackup);window.addEventListener('storage',e=>{if(e.key==='giia-thread')state.messageCache=null});
function beep(){try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const c=new A(),n=c.currentTime;[880,1174,1567].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=f;g.gain.setValueAtTime(.0001,n+i*.15);g.gain.exponentialRampToValueAtTime(.055,n+i*.15+.02);g.gain.exponentialRampToValueAtTime(.0001,n+i*.15+.12);o.connect(g).connect(c.destination);o.start(n+i*.15);o.stop(n+i*.15+.14)});setTimeout(()=>c.close().catch(()=>{}),800)}catch{}}
function scrollToComposer(){setTimeout(()=>document.getElementById('composerAnchor')?.scrollIntoView({behavior:'smooth',block:'end'}),50)}
function scrollConversationBottom(behavior='smooth'){setTimeout(()=>window.scrollTo({top:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),behavior}),35)}
function scrollMessageIntoView(el,behavior='smooth'){setTimeout(()=>el?.querySelector('.message-content')?.scrollIntoView({behavior,block:'start'}),45)}
function openDialog(dialog){if(dialog&&!dialog.open)dialog.showModal()}
function messageShell(role,label=role==='user'?'Você':'Gerador de Imagens IA Local',at=Date.now()){const el=document.createElement('article');el.className=`message ${role}`;const when=new Date(Number(at)||Date.now());el.innerHTML=`<div class="avatar">${role==='user'?'V':'IA'}</div><div class="message-content"><div class="message-head"><strong>${label}</strong><small>${when.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></div></div>`;return {el,content:el.querySelector('.message-content')}}
function addTextMessage(role,text,{persist=true,chat=false}={}){const {el,content}=messageShell(role);const b=document.createElement('div');b.className='bubble';b.textContent=text;content.appendChild(b);els.thread.appendChild(el);if(persist)rememberMessage({role,kind:'text',text,chat,at:Date.now()});if(!state.hydrating)scrollConversationBottom();return el}
function addTyping(label='Respondendo…'){const {el,content}=messageShell('assistant');const b=document.createElement('div');b.className='bubble';b.innerHTML=`<span class="typing"><span>${escapeHtml(label)}</span><span class="typing-dots"><i></i><i></i><i></i></span></span>`;content.appendChild(b);els.thread.appendChild(el);if(!state.hydrating)scrollConversationBottom();return {el,bubble:b}}
function mediaMeta(r){const size=r.width&&r.height?`${r.width}×${r.height}`:'dimensões não registradas';return `${modes[r.mode]?.label||r.mode} • ${size}${r.duration?` • ${r.duration}s`:''}${r.seed?` • seed ${r.seed}`:''}${r.retryInfo?.autoRetry?' • resolução ajustada automaticamente':''}${r.recovered?' • recuperado':''}`}
function actionButton(text,fn,cls=''){const b=document.createElement('button');b.type='button';b.className=`action-btn ${cls}`.trim();b.textContent=text;b.onclick=fn;return b}

// ---------- media cards / thread ----------
function createGenerationMessage(job){
  const {el,content}=messageShell('assistant');
  const card=document.createElement('div');card.className='media-card';
  card.setAttribute('aria-busy','true');card.innerHTML=`<div class="media-frame"><div class="media-loader"><div class="loader-inner"><div class="typing"><span>${job.mode==='video'?'Gerando vídeo':'Gerando imagem'}</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></div><div class="loader-progress">1%</div><div class="loader-eta">Calculando tempo…</div><div class="progress-track" role="progressbar" aria-label="Progresso da geração" aria-valuemin="0" aria-valuemax="100" aria-valuenow="1"><div class="progress-fill"></div></div></div></div></div><div class="log-panel"><div class="log-head"><span>Log</span><button type="button" class="inline-link toggle-log">Mostrar log</button></div><pre class="terminal generation-log" hidden></pre></div><div class="media-footer"><span class="media-meta">Preparando ${modes[job.mode].label.toLowerCase()}…</span><div class="media-actions"><button type="button" class="action-btn cancel-job">Cancelar</button></div></div>`;
  content.appendChild(card);els.thread.appendChild(el);if(!state.hydrating)scrollConversationBottom();
  const refs={el,card,job,originalJob:{...job,files:[...job.files]},attemptLogs:[],cancelRequested:false,frame:card.querySelector('.media-frame'),loader:card.querySelector('.media-loader'),pct:card.querySelector('.loader-progress'),eta:card.querySelector('.loader-eta'),bar:card.querySelector('.progress-fill'),meta:card.querySelector('.media-meta'),log:card.querySelector('.generation-log'),toggle:card.querySelector('.toggle-log'),actions:card.querySelector('.media-actions'),cancelBtn:card.querySelector('.cancel-job')};
  refs.toggle.onclick=()=>{refs.log.hidden=!refs.log.hidden;refs.toggle.textContent=refs.log.hidden?'Mostrar log':'Ocultar log';if(!refs.log.hidden)refs.log.scrollTop=refs.log.scrollHeight};
  refs.cancelBtn.onclick=()=>cancelGeneration(refs);
  refs.logFollow=true;refs.log.addEventListener('scroll',()=>{refs.logFollow=refs.log.scrollHeight-refs.log.scrollTop-refs.log.clientHeight<18});
  return refs;
}
async function cancelGeneration(refs){
  if(!refs||refs.cancelRequested)return;
  refs.cancelRequested=true;
  if(refs.cancelBtn){refs.cancelBtn.disabled=true;refs.cancelBtn.textContent='Cancelando…'}
  refs.meta.textContent='Cancelando geração…';
  const id=refs.job?.clientJobId||'';
  try{
    const r=await fetch('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok&&r.status!==409)throw new Error(d.error||'Não foi possível solicitar o cancelamento.');
  }catch(e){
    refs.cancelRequested=false;
    if(refs.cancelBtn){refs.cancelBtn.disabled=false;refs.cancelBtn.textContent='Cancelar'}
    refs.meta.textContent='Não foi possível cancelar agora.';
  }
}
function resetGenerationLoader(refs,job,message){
  refs.job=job;refs.card.setAttribute('aria-busy','true');refs.frame.classList.remove('failed');refs.frame.innerHTML=`<div class="media-loader"><div class="loader-inner"><div class="typing"><span>${escapeHtml(message||'Tentando novamente…')}</span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></div><div class="loader-progress">1%</div><div class="loader-eta">Nova tentativa em ${job.width}×${job.height}</div><div class="progress-track" role="progressbar" aria-label="Progresso da geração" aria-valuemin="0" aria-valuemax="100" aria-valuenow="1"><div class="progress-fill"></div></div></div></div>`;
  refs.loader=refs.frame.querySelector('.media-loader');refs.pct=refs.frame.querySelector('.loader-progress');refs.eta=refs.frame.querySelector('.loader-eta');refs.bar=refs.frame.querySelector('.progress-fill');refs.meta.textContent=`Tentando ${job.width}×${job.height}…`;
}
async function renderCompletedMedia(record,{persist=false}={}){
  const {el,content}=messageShell('assistant');const card=buildCompletedCard(record);content.appendChild(card);els.thread.appendChild(el);if(persist)rememberMessage({role:'assistant',kind:'media',recordId:record.id,media:recordLite(record),at:Date.now()});if(!state.hydrating)scrollConversationBottom();return el
}
function recordLite(r={}){const {blob,sourceFiles,sourceRefs,...rest}=r||{};return {...rest,sourceCount:Array.isArray(sourceFiles)?sourceFiles.length:Array.isArray(sourceRefs)?sourceRefs.length:Number(rest.sourceCount||0)}}
function outputMediaUrl(r={}){return r.filename?`/outputs/${encodeURIComponent(r.filename)}`:''}
function releaseElementObjectUrls(root){
  if(!root)return;
  const nodes=[];if(root?.dataset?.objectUrl)nodes.push(root);if(root.querySelectorAll)nodes.push(...root.querySelectorAll('[data-object-url]'));
  for(const node of nodes){const url=node.dataset.objectUrl;if(url){try{URL.revokeObjectURL(url)}catch{}delete node.dataset.objectUrl}}
}
function setRecordMediaSource(media,record){
  const direct=outputMediaUrl(record);
  if(direct){media.src=direct;return}
  if(record?.blob instanceof Blob){
    const url=URL.createObjectURL(record.blob);media.src=url;media.dataset.objectUrl=url;
    if(media.tagName==='IMG')media.addEventListener('load',()=>releaseElementObjectUrls(media),{once:true});
    media.addEventListener('error',()=>releaseElementObjectUrls(media),{once:true});
  }
}
async function fullRecord(r){if(!r?.id)return r;return await dbGet(r.id)||r}
async function recordMediaBlob(r){
  if(r?.blob instanceof Blob)return r.blob;
  const direct=outputMediaUrl(r);
  if(direct){const res=await fetch(direct,{cache:'no-store'});if(res.ok)return await res.blob()}
  const full=await fullRecord(r);if(full?.blob instanceof Blob)return full.blob;
  throw new Error('O arquivo desta geração não está mais disponível.')
}
function buildCompletedCard(record){
  const view=recordLite(record);const card=document.createElement('div');card.className='media-card';const frame=document.createElement('div');frame.className='media-frame';const media=document.createElement(record.type==='video'?'video':'img');setRecordMediaSource(media,record);if(record.type==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else{media.alt=record.prompt||'Imagem gerada';media.loading='lazy';media.decoding='async'}frame.appendChild(media);
  const footer=document.createElement('div');footer.className='media-footer';const meta=document.createElement('span');meta.className='media-meta';meta.textContent=mediaMeta(view);const actions=document.createElement('div');actions.className='media-actions';
  actions.append(
    actionButton('Baixar',()=>downloadRecord(view)),
    actionButton('Reutilizar',()=>reuseRecord(view)),
    actionButton('Mesma seed',()=>reuseRecord(view,true))
  );
  if(view.type==='image')actions.append(actionButton('Editar',()=>useAsEdit(view)),actionButton('Virar vídeo',()=>useAsVideo(view)));
  actions.append(actionButton('Excluir',()=>deleteRecord(view,card.closest('.message')),'danger'));
  footer.append(meta,actions);card.append(frame,footer);return card
}
async function createStoredMessageElement(m){
  const {el,content}=messageShell(m.role,m.role==='user'?'Você':'Gerador de Imagens IA Local',m.at);
  if(m.kind==='text'){
    const b=document.createElement('div');b.className='bubble';b.textContent=m.text||'';content.appendChild(b);return el;
  }
  if(m.kind==='media'){
    let r=m.media?{...m.media,id:m.recordId}:null;if((!r||!r.filename)&&m.recordId)r=await dbGet(m.recordId)||r;if(!r)return null;content.appendChild(buildCompletedCard(r));return el;
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
  state.hydrating=true;releaseElementObjectUrls(els.thread);els.thread.innerHTML='';state.historyMessages=getMessages();
  state.historyCursor=Math.max(0,state.historyMessages.length-HISTORY_PAGE_SIZE);
  await renderStoredRange(state.historyCursor,state.historyMessages.length);
  els.heroNote.hidden=state.historyMessages.length>0;state.hydrating=false;scrollConversationBottom('auto');
}
let historyScrollFrame=0;
window.addEventListener('scroll',()=>{if(historyScrollFrame)return;historyScrollFrame=requestAnimationFrame(()=>{historyScrollFrame=0;if(window.scrollY<=220)loadOlderMessages()})},{passive:true});
function finishGenerationCard(refs,record){
  refs.card.setAttribute('aria-busy','false');releaseElementObjectUrls(refs.frame);refs.frame.innerHTML='';const view=recordLite(record);const media=document.createElement(record.type==='video'?'video':'img');setRecordMediaSource(media,record);if(record.type==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else{media.alt=record.prompt||'Imagem gerada';media.loading='lazy';media.decoding='async'}refs.frame.appendChild(media);
  refs.card.querySelector('.log-panel')?.remove();refs.meta.textContent=mediaMeta(view);refs.actions.innerHTML='';
  refs.actions.append(actionButton('Baixar',()=>downloadRecord(view)),actionButton('Reutilizar',()=>reuseRecord(view)),actionButton('Mesma seed',()=>reuseRecord(view,true)));
  if(view.type==='image')refs.actions.append(actionButton('Editar',()=>useAsEdit(view)),actionButton('Virar vídeo',()=>useAsVideo(view)));
  const messageEl=refs.el;
  refs.actions.append(actionButton('Excluir',()=>deleteRecord(view,messageEl),'danger'));
  try{rememberMessage({role:'assistant',kind:'media',recordId:record.id,media:view,at:Date.now()})}catch(e){console.warn('Não foi possível salvar a mensagem da geração no histórico:',e)}
  // Libera prompt/anexos da tentativa concluída. O card final usa apenas metadados leves.
  refs.originalJob=null;refs.job=null;refs.attemptLogs=[];
  scrollConversationBottom();
}
function failGenerationCard(refs,info={}){
  refs.card.setAttribute('aria-busy','false');
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
  if(['GPU_OUT_OF_MEMORY','MODEL_FILE_MISSING','MODEL_INCOMPATIBLE','RUNTIME_MISSING','VULKAN_ERROR','VIDEO_RUNTIME_ERROR','INVALID_OUTPUT'].includes(info.errorCode))refs.actions.append(actionButton('Recursos IA',async()=>{await refreshResources(true);openDialog(els.resourcesDialog)}));
  refs.card.querySelector('.log-panel')?.classList.add('has-error');
  if(refs.log){const combined=[...(refs.attemptLogs||[]),...(Array.isArray(info.log)?info.log:[])];if(combined.length)refs.log.textContent=combined.join('\n');refs.log.hidden=true;refs.toggle.textContent='Mostrar log técnico'}
  scrollConversationBottom();
}

// ---------- media actions ----------
async function downloadRecord(r){
  const a=document.createElement('a');a.download=r.filename||`${r.type}_${r.id}`;
  const direct=outputMediaUrl(r);
  if(direct){a.href=direct;a.click();return}
  try{const blob=await recordMediaBlob(r),url=URL.createObjectURL(blob);a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){alert(e.message)}
}
async function filesFromRecord(r){if(Array.isArray(r.sourceFiles))return r.sourceFiles.map(x=>new File([x.blob],x.name||'referencia.png',{type:x.type||x.blob?.type||'image/png',lastModified:x.lastModified||Date.now()}));const out=[];for(const ref of r.sourceRefs||[]){const src=await dbGetSource(ref.key);if(src?.blob instanceof Blob)out.push(new File([src.blob],ref.name||src.name||'referencia.png',{type:ref.type||src.type||src.blob.type||'image/png',lastModified:ref.lastModified||src.lastModified||Date.now()}))}return out}
async function reuseRecord(r,sameSeed=false){
  const full=Number(r?.sourceCount||0)>0&&!Array.isArray(r?.sourceFiles)?await fullRecord(r):r;const base=full||r;
  els.mode.value=base.mode||'image';setMode();const j=base.jobSettings||{};
  if(j.quality)els.quality.value=j.quality;els.ratio.value='custom';els.width.value=base.width||j.width||els.width.value;els.height.value=base.height||j.height||els.height.value;
  if(j.memoryRetry&&els.memoryRetry)els.memoryRetry.value=j.memoryRetry;if(j.videoEngine)els.videoEngine.value=j.videoEngine;if(j.duration)els.duration.value=j.duration;if(j.fps)els.fps.value=j.fps;if(j.motion)els.motion.value=j.motion;if(j.temperature!=null)els.temperature.value=j.temperature;
  els.prompt.value=base.prompt||'';els.seed.value=sameSeed?(base.seed||''):'';state.attachments=await filesFromRecord(base);
  const expected=Number(base.sourceCount||0);if(expected>state.attachments.length){addTextMessage('assistant',state.attachments.length?'Algumas imagens de referência desta geração não estão mais disponíveis no armazenamento local.':'As imagens de referência desta geração não estão mais disponíveis no armazenamento local.',{persist:false})}
  renderAttachments();updateAvailability();savePrefs();scrollToComposer();els.prompt.focus();
}
async function attachRecord(r){if(r.type!=='image')return;const blob=await recordMediaBlob(r);const file=new File([blob],r.filename||`image_${r.id}.png`,{type:blob.type||'image/png'});state.attachments=[file];renderAttachments()}
async function useAsEdit(r){try{els.mode.value='edit';setMode();els.prompt.value='';await attachRecord(r);scrollToComposer();els.prompt.focus()}catch(e){alert(e.message)}}
async function useAsVideo(r){try{els.mode.value='video';setMode();els.prompt.value='Anime esta imagem com movimento natural e detalhes vivos.';await attachRecord(r);scrollToComposer();els.prompt.focus()}catch(e){alert(e.message)}}
async function deleteRecord(r,messageEl=null){
  if(!confirm('Excluir esta geração da conversa, galeria e arquivo de saída?'))return;
  let physicalDeleted=!r.filename;
  try{
    if(r.filename){const {response,data}=await fetchJson(`/api/output/${encodeURIComponent(r.filename)}`,{method:'DELETE'},'exclusão do arquivo');if(!response.ok)throw new Error(data.error||'Não foi possível excluir o arquivo físico.');physicalDeleted=true}
  }catch(e){alert(`Não foi possível excluir o arquivo: ${e.message}`);return}
  let localError=null;
  try{if(Number(r.id)>0)await dbDelete(r.id)}catch(e){localError=e}
  if(physicalDeleted){removeMediaMessage(r.id);if(messageEl){releaseElementObjectUrls(messageEl);messageEl.remove()}}
  await reconcileMediaStorage();await renderGallery();
  if(localError)alert('O arquivo foi excluído, mas o navegador não conseguiu limpar todo o registro local agora. A reconciliação automática tentará concluir essa limpeza na próxima abertura.');
}


async function loadModelCatalog(){
  try{
    const r=await fetch('/api/model-catalog',{cache:'no-store'});
    const d=await r.json();
    if(!r.ok||!d.ok)throw new Error(d.error||'Não foi possível carregar modelos.json.');
    state.catalog=d.catalog;
    return state.catalog;
  }catch(e){
    console.warn(e);
    state.catalog=null;
    state.catalogError=e.message||'modelos.json inválido.';
    return null;
  }
}

// ---------- resources ----------
async function refreshResources(render=!!els.resourcesDialog?.open){try{const r=await fetch(render?'/api/resources':'/api/resources?compact=1',{cache:'no-store'}),d=await r.json();state.serverAvailable=true;state.resources=d.resources||{};state.runtime=d.runtime||{};state.installerRunning=!!d.installer?.running;state.catalogError=d.catalogError||null;if(render){renderResources(d.installer);if(els.catalogNote){els.catalogNote.classList.toggle('has-error',!!state.catalogError);els.catalogNote.innerHTML=state.catalogError?`<strong>Erro em modelos.json:</strong> ${escapeHtml(state.catalogError)}`:'As variantes e URLs vêm de <code>modelos.json</code> na raiz do projeto. Você pode editar esse arquivo sem alterar o código.'}}updateAvailability();const installed=Object.values(state.resources).filter(x=>x.installed).length;els.appStatus.textContent=state.catalogError?'modelos.json precisa de correção':(state.installerRunning?'Instalação em andamento…':`${installed}/${Object.keys(state.resources).length} recursos ativos`);return d}catch{state.serverAvailable=false;els.appStatus.textContent='Servidor indisponível';updateAvailability();return null}}
function modeAvailable(mode=els.mode.value){if(mode==='chat')return !!state.resources.chat?.installed;if(['image','edit','merge'].includes(mode))return !!state.resources.image?.installed;if(mode==='video'){return els.videoEngine.value==='ai'?!!state.resources.videoAI?.installed:!!state.resources.videoLight?.installed}return true}
function updateAvailability(){for(const opt of els.mode.options){const m=opt.value;const available=m==='video'?(!!state.resources.videoAI?.installed||!!state.resources.videoLight?.installed):modeAvailable(m);opt.disabled=!available;opt.textContent=`${modes[m].label}${opt.disabled?' • não instalado':''}`};if(els.mode.value==='video'&&!modeAvailable('video')){if(state.resources.videoLight?.installed)els.videoEngine.value='light';else if(state.resources.videoAI?.installed)els.videoEngine.value='ai'}updateLockHint()}
function updateLockHint(){const mode=els.mode.value;let resource=modes[mode].resource;if(mode==='video')resource=els.videoEngine.value==='ai'?'videoAI':'videoLight';const ok=modeAvailable(mode),installing=state.installerRunning,offline=state.serverAvailable===false;els.locked.hidden=ok&&!installing&&!offline;els.send.disabled=!ok||installing||offline;if(offline)els.lockedText.textContent='Servidor local indisponível. Verifique se a janela do ABRIR.bat continua aberta.';else if(installing)els.lockedText.textContent='Aguarde a instalação atual terminar antes de iniciar uma nova operação.';else if(!ok)els.lockedText.textContent=`${state.resources[resource]?.label||'Este recurso'} ainda não está instalado.`}
async function manageChatRuntime(action='load'){try{const {response:r,data:d}=await fetchJson(`/api/resources/chat/${action}`,{method:'POST'},'Chat local');if(!r.ok)throw new Error(d.error||'Falha ao atualizar o Chat.');await refreshResources(true);}catch(e){alert(e.message)}}
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
    card.innerHTML=`<h3>${escapeHtml(r.label)}</h3><p>${escapeHtml(r.description||'')}</p><div class="resource-status"><span class="status-pill ${r.installed?'ok':''}">${r.installed?'Instalado':'Não instalado'}</span><small>${escapeHtml(r.sizeHint||'')}</small></div><div class="resource-runtime"><strong>${escapeHtml(runtimeText)}</strong><small>${escapeHtml(runtimeHint)}</small></div><div class="resource-model"><label><span>Modelo / variante</span><select class="variant-select">${(r.variants||[]).map(v=>`<option value="${escapeHtml(v.id)}" ${v.id===sel.variant?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}</select></label><div class="variant-help"></div><div class="custom-fields"></div></div><div class="resource-actions"><button type="button" class="action-btn install">${r.installed?'Reparar / aplicar':'Instalar'}</button>${r.installed?'<button type="button" class="action-btn danger remove">Remover</button>':''}${r.id==='chat'&&r.installed?`<button type="button" class="action-btn runtime-chat">${rt.running?'Descarregar':'Carregar agora'}</button>`:''}</div>`;
    const select=card.querySelector('.variant-select'),help=card.querySelector('.variant-help'),custom=card.querySelector('.custom-fields');
    const refreshVariant=()=>{const v=(r.variants||[]).find(x=>x.id===select.value)||{};const tags=[];if(v.uncensored===true)tags.push('<span class="model-tag uncensored">Sem censura</span>');if(v.sizeGB)tags.push(`<span class="model-tag">${escapeHtml(v.sizeGB)} GB</span>`);if(v.encoderSizeGB&&v.diffusionSizeGB)tags.push(`<span class="model-tag">Encoder ${escapeHtml(v.encoderSizeGB)} GB + denoiser ${escapeHtml(v.diffusionSizeGB)} GB</span>`);if(r.id==='image'&&v.encoderFilename){const cr=state.resources.chat;const cv=(cr?.variants||[]).find(x=>x.id===(cr?.selected?.variant||cr?.defaultVariant));if(cv?.filename===v.encoderFilename)tags.push('<span class="model-tag shared">Encoder compartilhado com Chat • sem download duplicado</span>')}help.innerHTML=`${tags.length?`<div class="variant-tags">${tags.join('')}</div>`:''}<small>${escapeHtml(v.description||'')}</small>`;custom.innerHTML='';if(v.custom){
      if(r.id==='chat')custom.innerHTML=`<label><span>URL direta do GGUF</span><input data-key="url" value="${escapeHtml(sel.url||'')}"></label><label><span>Nome do arquivo (.gguf)</span><input data-key="filename" value="${escapeHtml(sel.filename||'modelo-chat.gguf')}"></label>`;
      if(r.id==='image')custom.innerHTML=`<label><span>URL do denoiser GGUF</span><input data-key="diffusionUrl" value="${escapeHtml(sel.diffusionUrl||'')}"></label><label><span>Nome do denoiser</span><input data-key="diffusionFilename" value="${escapeHtml(sel.diffusionFilename||'modelo-imagem.gguf')}"></label><label><span>URL do encoder GGUF</span><input data-key="encoderUrl" value="${escapeHtml(sel.encoderUrl||'')}"></label><label><span>Nome do encoder</span><input data-key="encoderFilename" value="${escapeHtml(sel.encoderFilename||'encoder.gguf')}"></label><label><span>URL do mmproj</span><input data-key="mmprojUrl" value="${escapeHtml(sel.mmprojUrl||'')}"></label><label><span>Nome do mmproj</span><input data-key="mmprojFilename" value="${escapeHtml(sel.mmprojFilename||'mmproj.gguf')}"></label><label><span>URL do VAE</span><input data-key="vaeUrl" value="${escapeHtml(sel.vaeUrl||'')}"></label><label><span>Nome do VAE</span><input data-key="vaeFilename" value="${escapeHtml(sel.vaeFilename||'vae.safetensors')}"></label>`;
      if(r.id==='videoAI')custom.innerHTML=`<label><span>Repo ID no Hugging Face</span><input data-key="repo" value="${escapeHtml(sel.repo||'')}"></label><label><span>Pasta local</span><input data-key="folder" value="${escapeHtml(sel.folder||'video-model')}"></label>`;
    }};select.onchange=refreshVariant;refreshVariant();
    const selection=()=>{const v=(r.variants||[]).find(x=>x.id===select.value)||{};const data={variant:select.value};for(const i of custom.querySelectorAll('[data-key]'))data[i.dataset.key]=i.value.trim();for(const k of ['url','filename','diffusionUrl','diffusionFilename','encoderUrl','encoderFilename','mmprojUrl','mmprojFilename','vaeUrl','vaeFilename','repo','folder'])if(data[k]==null&&v[k]!=null)data[k]=v[k];return data};
    card.querySelector('.install').onclick=()=>installResource(r.id,r.installed?'repair':'install',selection());card.querySelector('.remove')?.addEventListener('click',()=>{if(confirm(`Remover ${r.label}?`))installResource(r.id,'remove',selection())});
    card.querySelector('.runtime-chat')?.addEventListener('click',()=>manageChatRuntime(rt.running?'unload':'load'));
    if(state.running||state.installerRunning)card.querySelectorAll('.install,.remove,.runtime-chat').forEach(btn=>{btn.disabled=true;btn.title=state.running?'Aguarde a operação de IA atual terminar.':'Aguarde a instalação atual terminar.'});
    els.resourceGrid.appendChild(card)
  }
  updateInstaller(installer)
}
async function installResource(id,action='install',selection={}){if(state.running||state.queue.length){alert('Conclua ou remova os itens da fila antes de alterar Recursos IA.');return false}state.installerCancelled=false;state.installerPollFailures=0;try{const {response:r,data:d}=await fetchJson(`/api/resources/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)},'instalador');if(!r.ok||!d.ok)throw new Error(d.error||'Falha ao iniciar.');state.installerRunning=true;updateAvailability();startInstallerPoll();return true}catch(e){alert(e.message);return false}}
function startInstallerPoll(){clearInterval(state.installerTimer);state.installerFollow=true;state.installerTimer=setInterval(pollInstaller,900);pollInstaller()}
async function pollInstaller(){
  try{
    const {response:r,data:d}=await fetchJson('/api/install-progress',{cache:'no-store'},'instalador');
    if(!r.ok)throw new Error(d.error||'Falha ao consultar a instalação.');
    state.installerPollFailures=0;state.installerRunning=!!d.running;state.installerError=d.error||null;state.installerCancelled=!!d.cancelRequested&&!d.running;updateInstaller(d);updateAvailability();
    if(!d.running){clearInterval(state.installerTimer);state.installerTimer=null;await refreshResources();setTimeout(runNext,100)}
  }catch(e){
    state.installerPollFailures=(state.installerPollFailures||0)+1;
    if(state.installerPollFailures>=3){clearInterval(state.installerTimer);state.installerTimer=null;state.installerRunning=false;state.installerError=e.message;updateInstaller({running:false,error:e.message,message:'Conexão com o servidor local perdida durante a instalação.',log:[state.installerLast,'Abra o ABRIR.bat novamente e verifique o estado em Recursos IA.'].filter(Boolean)});updateAvailability()}
  }
}
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
  els.installerBar.style.width=`${shown}%`;els.installerBar.parentElement?.setAttribute('aria-valuenow',String(shown));
  els.installerMessage.textContent=d.running&&raw>=100?'Finalizando e validando arquivos…':(d.message||'');
  els.installerBox.classList.toggle('has-error',!!d.error);
  if(els.installerDismiss)els.installerDismiss.hidden=!d.error;
  if(els.installerCancel){ els.installerCancel.hidden=!d.running; els.installerCancel.disabled=!!d.cancelRequested; els.installerCancel.textContent=d.cancelRequested?'Cancelando…':'Cancelar'; }
  if(d.running&&!state.running){if(document.hidden)setTitle(`${shown}% • Instalando recursos • ${BASE_TITLE}`,false);else setTitle(BASE_TITLE,false)}
  const text=(d.log||[]).join('\n');
  if(text!==state.installerLast){const left=els.installerLog.scrollLeft;state.installerLast=text;els.installerLog.textContent=text;els.installerLog.scrollLeft=left;if(state.installerFollow){els.installerLog.scrollTop=els.installerLog.scrollHeight;els.installerJump.hidden=true}else els.installerJump.hidden=false}
}
async function installAll(){for(const id of ['chat','image','videoLight','videoAI']){await refreshResources();if(state.resources[id]?.installed)continue;state.installerError=null;const ok=await installResource(id,'install',{});if(!ok)break;while(state.installerRunning)await new Promise(r=>setTimeout(r,350));if(state.installerError||state.installerCancelled)return}}

// ---------- modes / composer ----------
function setMode(){const mode=els.mode.value,m=modes[mode];els.prompt.placeholder=m.placeholder;els.send.textContent=m.action;els.upload.hidden=!m.upload;els.file.multiple=mode==='merge';els.videoOptions.hidden=mode!=='video';if(mode==='video'&&els.ratio.value==='1:1')els.ratio.value='16:9';state.attachments=[];renderAttachments();applyPreset();updateLockHint();savePrefs()}
function applyPreset(){if(els.ratio.value==='custom')return;const base=els.mode.value==='video'?presets.video:presets.image;const d=base[els.quality.value]?.[els.ratio.value];if(d){els.width.value=d[0];els.height.value=d[1]}}
function renderAttachments(){els.attachments.innerHTML='';els.attachments.hidden=!state.attachments.length;state.attachments.forEach((f,i)=>{const d=document.createElement('div');d.className='attachment';const img=document.createElement('img'),url=URL.createObjectURL(f);img.alt='';img.src=url;img.onload=img.onerror=()=>setTimeout(()=>URL.revokeObjectURL(url),2000);const s=document.createElement('span');s.textContent=f.name;const b=document.createElement('button');b.type='button';b.textContent='×';b.setAttribute('aria-label',`Remover ${f.name||'imagem'}`);b.title='Remover imagem';b.onclick=()=>{state.attachments.splice(i,1);renderAttachments()};d.append(img,s,b);els.attachments.appendChild(d)})}
function snapshotJob(){return {mode:els.mode.value,prompt:els.prompt.value.trim(),files:[...state.attachments],quality:els.quality.value,width:Number(els.width.value),height:Number(els.height.value),seed:els.seed.value.trim()||String(Math.floor(Math.random()*2147483646)+1),temperature:Number(els.temperature.value||.7),memoryRetry:els.memoryRetry?.value||'auto',videoEngine:els.videoEngine.value,duration:Number(els.duration.value),fps:Number(els.fps.value),motion:els.motion.value}}
function validateJob(j){if(!j.prompt&&!(j.mode==='video'&&j.files.length))return 'Digite um prompt.';if(j.mode==='edit'&&j.files.length<1)return 'Envie uma imagem para editar.';if(j.mode==='merge'&&j.files.length<2)return 'Envie pelo menos duas imagens para juntar.';if(!modeAvailable(j.mode))return 'Ative o recurso necessário antes de continuar.';return null}
function jobFileBytes(job){return (job?.files||[]).reduce((sum,f)=>sum+Number(f?.size||0),0)}
function queueFileBytes(){return state.queue.reduce((sum,j)=>sum+jobFileBytes(j),0)}
function enqueue(job){
  const nextBytes=queueFileBytes()+jobFileBytes(job);
  if(state.queue.length>=QUEUE_MAX_ITEMS){addTextMessage('assistant',`A fila aceita até ${QUEUE_MAX_ITEMS} itens por vez para evitar consumo excessivo de memória.`,{persist:false});return false}
  if(nextBytes>QUEUE_MAX_BYTES){addTextMessage('assistant','Este item não foi adicionado porque os anexos da fila ultrapassariam aproximadamente 512 MB em memória. Aguarde um item terminar e tente novamente.',{persist:false});return false}
  state.queue.push(job);renderQueue();addTextMessage('assistant',`Adicionado à fila: ${modes[job.mode].label}.`,{persist:false});return true
}
function renderQueue(){els.queueCount.textContent=state.queue.length;els.queueList.innerHTML=state.queue.length?'':'<div class="bubble">A fila está vazia.</div>';state.queue.forEach((j,i)=>{const d=document.createElement('div');d.className='queue-item';d.innerHTML=`<div><strong>${modes[j.mode].label}</strong><br><small>${escapeHtml(j.prompt.slice(0,90)||'Sem prompt')}</small></div>`;const b=actionButton('Remover',()=>{state.queue.splice(i,1);renderQueue()},'danger');d.appendChild(b);els.queueList.appendChild(d)})}
function runNext(){if(state.running||state.installerRunning||!state.queue.length)return;executeJob(state.queue.shift());renderQueue()}
function launchJob(job){const copy={...job,files:[...(job.files||[])]};if(state.running||state.installerRunning)enqueue(copy);else executeJob(copy)}

// ---------- generation ----------
function estimateSeconds(job){
  const key=`giia-time:${job.mode}:${job.videoEngine||''}:${job.quality}:${job.width}x${job.height}`;let learn=0;try{learn=Number(localStorage.getItem(key))}catch{}
  if(learn>0)return Math.max(12,learn);
  if(job.mode==='video')return job.videoEngine==='ai'?Math.max(120,job.duration*28):Math.max(35,job.duration*4);
  if(job.mode==='edit')return 75;
  if(job.mode==='merge')return 95;
  return 50;
}
function learnTime(job,sec){
  const key=`giia-time:${job.mode}:${job.videoEngine||''}:${job.quality}:${job.width}x${job.height}`;let old=0;try{old=Number(localStorage.getItem(key))}catch{}
  try{localStorage.setItem(key,String(old>0?old*.72+sec*.28:sec))}catch{}
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
function makeProgressId(){return globalThis.crypto?.randomUUID?.().replace(/-/g,'')||`job_${Date.now()}_${Math.random().toString(36).slice(2,10)}`}
async function requestGeneration(job){const fd=new FormData();for(const [k,v] of Object.entries({clientJobId:job.clientJobId||'',mode:job.mode,prompt:job.prompt,width:job.width,height:job.height,seed:job.seed,videoEngine:job.videoEngine,duration:job.duration,fps:job.fps,motion:job.motion}))fd.append(k,v??'');for(const f of job.files)fd.append('images',f,f.name);let r,d;try{({response:r,data:d}=await fetchJson('/api/generate',{method:'POST',body:fd},'motor de geração'))}catch(e){if(!e.details)e.details={errorTitle:'Servidor local indisponível',error:e.message,errorCode:'SERVER_UNAVAILABLE',suggestions:['Confira se o ABRIR.bat continua aberto.','Abra novamente o aplicativo e tente outra vez.']};throw e}if(!r.ok||!d.ok){const err=new Error(d.error||'Falha na geração.');err.details=d;throw err}return d}
async function executeJob(job){
  if(state.running||state.installerRunning){enqueue(job);return}
  state.running=true;state.currentJob=job;els.heroNote.hidden=true;
  els.seed.value=job.seed;const userEl=addTextMessage('user',job.prompt||'Criar a partir da imagem enviada.',{persist:true,chat:job.mode==='chat'});scrollMessageIntoView(userEl);
  els.prompt.value='';state.attachments=[];renderAttachments();
  if(job.mode==='chat'){
    const typing=addTyping('Respondendo…');
    try{const hist=getMessages().filter(m=>m.chat&&m.kind==='text').slice(-20).map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.text}));const sys=els.systemPrompt.value.trim();if(sys)hist.unshift({role:'system',content:sys});const {response:r,data:d}=await fetchJson('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:job.prompt,messages:hist,temperature:job.temperature})},'Chat local');if(!r.ok||!d.ok){const err=new Error(d.error||'Falha no chat.');err.details=d;throw err}typing.el.remove();const answer=addTextMessage('assistant',d.content||'(sem resposta)',{persist:true,chat:true});scrollMessageIntoView(answer);beep();if(document.hidden)setTitle(`RESPOSTA PRONTA • ${BASE_TITLE}`,true)}catch(e){typing.el.remove();const d=e.details||{};const extra=Array.isArray(d.suggestions)&&d.suggestions.length?`\n\n${d.suggestions.map(x=>`• ${x}`).join('\n')}`:'';addTextMessage('assistant',`Erro: ${d.error||e.message}${extra}`,{persist:true,chat:true})}finally{state.running=false;state.currentJob=null;setTimeout(runNext,150)}return
  }
  const refs=createGenerationMessage(job);state.activeGeneration=refs;scrollMessageIntoView(refs.el);
  const retryMode=job.memoryRetry||els.memoryRetry?.value||'auto';refs.memoryRetryMode=retryMode;
  const attempts=[{job:{...job,files:[...job.files]},factor:1,label:'original'}];
  if(retryMode==='auto'){const seen=new Set([`${job.width}x${job.height}`]);for(const [factor,label] of [[.75,'75%'],[.5,'50%']]){const next=scaleJob(job,factor),key=`${next.width}x${next.height}`;if(!seen.has(key)){seen.add(key);attempts.push({job:next,factor,label})}}}
  let finalError=null,success=false;
  try{
    for(let i=0;i<attempts.length;i++){
      if(refs.cancelRequested){finalError={errorTitle:'Geração cancelada',error:'A geração foi interrompida antes de terminar.',errorCode:'CANCELLED',suggestions:[]};break}
      const attempt=attempts[i],attemptJob=attempt.job;refs.job=attemptJob;state.currentJob=attemptJob;
      if(i>0){refs.attemptLogs.push(`--- Tentativa automática ${i+1}: ${attemptJob.width}x${attemptJob.height} (${attempt.label}) ---`);resetGenerationLoader(refs,attemptJob,`Memória insuficiente. Tentando novamente em ${attemptJob.width}×${attemptJob.height}…`);scrollMessageIntoView(refs.el)}
      const attemptStarted=Date.now();startProgress(attemptJob,refs);
      try{
        const d=await requestGeneration(attemptJob);if(refs.cancelRequested){if(d?.filename)await fetch(`/api/output/${encodeURIComponent(d.filename)}`,{method:'DELETE'}).catch(()=>{});finalError={errorTitle:'Geração cancelada',error:'A geração foi interrompida antes de terminar.',errorCode:'CANCELLED',suggestions:[]};break}if(refs.cancelBtn){refs.cancelBtn.disabled=true;refs.cancelBtn.textContent='Finalizando…'}const retryInfo={requestedWidth:job.width,requestedHeight:job.height,autoRetry:i>0,retryFactor:attempt.factor};let rec;try{rec=await saveResult(d,attemptJob,retryInfo);if(rec?.sourcePersistenceWarning)addTextMessage('assistant','A geração foi salva, mas o navegador não conseguiu guardar as imagens de referência por falta de espaço. O resultado final continua disponível; apenas a reutilização dessas referências pode não funcionar depois de reiniciar.',{persist:false})}catch(storageError){console.warn('Resultado criado, mas o histórico local não pôde ser salvo:',storageError);rec=fallbackResultRecord(d,attemptJob,retryInfo);addTextMessage('assistant','O resultado foi criado normalmente, mas não foi possível salvá-lo na Galeria local. Você ainda pode visualizar e baixar o arquivo desta conversa.',{persist:false})}stopProgress();updateGenerationProgress(refs,100,0,[],{label:'Concluído'});finishGenerationCard(refs,rec);els.seed.value=d.seed||attemptJob.seed;learnTime(attemptJob,(Date.now()-attemptStarted)/1000);beep();if(document.hidden)setTitle(`CRIADO COM SUCESSO • ${BASE_TITLE}`,true);success=true;break
      }catch(e){stopProgress();finalError=e.details||{errorTitle:'Falha na geração',error:e.message,errorCode:'GENERATION_FAILED',suggestions:['Abra o log técnico para ver os detalhes.']};if(refs.cancelRequested){finalError={...finalError,errorTitle:'Geração cancelada',error:'A geração foi interrompida antes de terminar.',errorCode:'CANCELLED',suggestions:[]};break}if(!(isMemoryError(finalError)&&retryMode==='auto'&&i<attempts.length-1))break;refs.attemptLogs.push(...(Array.isArray(finalError.log)?finalError.log:[]));}
    }
    if(!success){failGenerationCard(refs,finalError||{errorTitle:'Falha na geração',error:'Não foi possível concluir.',errorCode:'GENERATION_FAILED'});if(document.hidden)setTitle(`ERRO • ${BASE_TITLE}`,true)}
  }finally{state.running=false;state.activeGeneration=null;state.currentJob=null;if(els.resourcesDialog?.open)await refreshResources(true);else updateAvailability();setTimeout(runNext,250)}
}
function startProgress(job,refs){
  stopProgress();job.clientJobId=makeProgressId();const token=++state.progressEpoch;refs.progressToken=token;refs.lastPct=1;state.progressStart=Date.now();state.progressEstimate=estimateSeconds(job);state.progressTimer=setInterval(()=>pollProgress(job,refs,token),1000);pollProgress(job,refs,token)
}
async function pollProgress(job,refs,token){
  try{
    const d=await fetch('/api/progress',{cache:'no-store'}).then(r=>r.json());
    if(token!==state.progressEpoch||token!==refs.progressToken)return;
    // /api/progress pode responder por alguns milissegundos com o estado da geração anterior.
    // Só usamos o log quando o backend confirma o mesmo identificador deste job.
    if(!d.id||d.id!==job.clientJobId)return;
    refs.progressFailures=0;
    if(d.cancelRequested){refs.meta.textContent='Cancelando geração…';if(refs.cancelBtn){refs.cancelBtn.disabled=true;refs.cancelBtn.textContent='Cancelando…'}}
    const elapsed=(Date.now()-state.progressStart)/1000,log=d.log||[];
    const smart=smartProgress(job,log,elapsed,state.progressEstimate,refs.lastPct);refs.lastPct=smart.pct;
    updateGenerationProgress(refs,smart.pct,smart.eta,log,smart.stage,smart.overdue)
  }catch{refs.progressFailures=(refs.progressFailures||0)+1;if(refs.progressFailures>=3){refs.meta.textContent='Aguardando resposta do servidor local…';refs.eta.textContent='Conexão temporariamente indisponível. A geração será recuperada assim que o servidor responder.'}}
}
function updateGenerationProgress(refs,pct,eta,log,stage={label:'Processando…'},overdue=false){
  const p=Math.max(0,Math.min(100,Math.round(pct)));refs.pct.textContent=`${p}%`;
  let etaText='';
  if(p>=100)etaText='Concluído';
  else if(overdue||eta==null)etaText=`${stage.label} Mais tempo que o previsto.`;
  else etaText=`${stage.label} Previsão: ~${fmt(eta)} restantes.`;
  refs.eta.textContent=etaText;refs.bar.style.width=`${p}%`;refs.bar.parentElement?.setAttribute('aria-valuenow',String(p));
  refs.meta.textContent=p>=100?'Concluído':`${stage.label} • ${p}%${overdue?' • estimativa excedida':` • ~${fmt(eta)}`}`;
  const text=[...(refs.attemptLogs||[]),...(log||[])].join('\n');if(text!==refs.log.textContent){const left=refs.log.scrollLeft;refs.log.textContent=text;refs.log.scrollLeft=left;if(refs.logFollow)refs.log.scrollTop=refs.log.scrollHeight}
  const titleStatus=p>=100?'Concluído':overdue?'Processando…':`~${fmt(eta)}`;if(document.hidden)setTitle(p>=100?`100% • Concluído • ${BASE_TITLE}`:`${p}% • ${titleStatus} • ${state.currentJob?.mode==='video'?'Vídeo':'Imagem'} IA`,false);else setTitle(BASE_TITLE,false)
}
function stopProgress(){state.progressEpoch++;clearInterval(state.progressTimer);state.progressTimer=null;if(!state.titleAlert)setTitle(BASE_TITLE,false)}
async function saveResult(d,job={},retryInfo={}){const sourceFiles=[...(job.files||[])];const jobSettings={quality:job.quality,width:job.width,height:job.height,temperature:job.temperature,memoryRetry:job.memoryRetry||'auto',videoEngine:job.videoEngine,duration:job.duration,fps:job.fps,motion:job.motion};const rec={createdAt:Date.now(),type:d.type,mode:d.mode,prompt:d.prompt||'',seed:d.seed,width:d.width,height:d.height,duration:d.duration||null,fps:d.fps||null,filename:d.filename,sourceCount:sourceFiles.length,jobSettings,retryInfo};try{rec.id=await dbAdd(rec,sourceFiles)}catch(e){if(!sourceFiles.length)throw e;console.warn('Não foi possível persistir as referências; salvando apenas a geração:',e);rec.sourceCount=0;rec.sourcePersistenceWarning=true;rec.id=await dbAdd(rec,[])}return await dbGet(rec.id)||rec}
function fallbackResultRecord(d,job={},retryInfo={}){return {id:-Date.now(),createdAt:Date.now(),type:d.type,mode:d.mode,prompt:d.prompt||'',seed:d.seed,width:d.width,height:d.height,duration:d.duration||null,fps:d.fps||null,filename:d.filename,sourceCount:0,jobSettings:{quality:job.quality,width:job.width,height:job.height,temperature:job.temperature,memoryRetry:job.memoryRetry||'auto',videoEngine:job.videoEngine,duration:job.duration,fps:job.fps,motion:job.motion},retryInfo,storageWarning:true}}

// ---------- gallery ----------
function clearGalleryUrls(){for(const url of state.galleryUrls.splice(0))try{URL.revokeObjectURL(url)}catch{}}
async function renderGallery({append=false}={}){
  if(state.galleryLoading)return;state.galleryLoading=true;
  try{
    if(!append){clearGalleryUrls();state.galleryOffset=0;els.galleryGrid.innerHTML=''}
    const q=els.gallerySearch.value.trim(),type=els.galleryFilter.value;
    const {rows,hasMore}=await dbGalleryPage({offset:state.galleryOffset,limit:36,q,type});
    if(!append&&!rows.length){els.galleryGrid.innerHTML='<div class="bubble">Nada salvo ainda.</div>';els.galleryMore.hidden=true;return}
    for(const r of rows){
      const card=document.createElement('article');card.className='gallery-card';
      const thumb=document.createElement('div');thumb.className='gallery-thumb';
      const m=document.createElement(r.type==='video'?'video':'img');
      const direct=outputMediaUrl(r);if(direct)m.src=direct;else if(r.blob instanceof Blob){const url=URL.createObjectURL(r.blob);state.galleryUrls.push(url);m.src=url}
      if(r.type==='video'){m.muted=true;m.preload='metadata'}else{m.loading='lazy';m.decoding='async';m.alt=r.prompt||'Imagem gerada'}
      thumb.appendChild(m);
      const info=document.createElement('div');info.className='gallery-info';
      const title=document.createElement('strong');title.textContent=r.prompt||'Sem prompt';
      const meta=document.createElement('small');meta.textContent=mediaMeta(r);
      const acts=document.createElement('div');acts.className='gallery-actions';
      acts.append(actionButton('Usar',()=>{reuseRecord(r);els.gallery.close()}),actionButton('Excluir',()=>deleteRecord(r,null),'danger'));
      info.append(title,meta,acts);card.append(thumb,info);els.galleryGrid.appendChild(card)
    }
    state.galleryOffset+=rows.length;els.galleryMore.hidden=!hasMore;
  }catch(e){console.warn('Falha ao abrir a Galeria:',e);if(!append){els.galleryGrid.innerHTML=`<div class="bubble">Não foi possível ler a Galeria local. ${escapeHtml(e.message||'Verifique o armazenamento do navegador.')}</div>`;els.galleryMore.hidden=true}}finally{state.galleryLoading=false}
}

function validatedIncomingImages(files){
  const accepted=[],problems=[];
  const allowed=new Set(['image/png','image/jpeg','image/webp','image/gif','image/bmp']);
  for(const f of files||[]){
    if(!allowed.has(String(f.type||'').toLowerCase())){problems.push(`${f.name||'Arquivo'}: formato não aceito. Use PNG, JPEG, WebP, GIF ou BMP.`);continue}
    if(Number(f.size||0)>60*1024*1024){problems.push(`${f.name||'Imagem'}: ultrapassa o limite de 60 MB.`);continue}
    accepted.push(f)
  }
  if(problems.length)addTextMessage('assistant',problems.join('\n'),{persist:false});
  return accepted;
}

// Mantém a última mensagem visível quando anexos/avisos aumentam a altura do composer.
function syncComposerSafeSpace(){
  const h=Math.ceil(els.composerAnchor?.getBoundingClientRect().height||0);
  if(h>0)document.documentElement.style.setProperty('--composer-safe-space',`${h+36}px`);
}
if('ResizeObserver' in window&&els.composerAnchor){new ResizeObserver(syncComposerSafeSpace).observe(els.composerAnchor)}
window.addEventListener('resize',syncComposerSafeSpace,{passive:true});
$$('dialog.modal').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()}));

async function openResourcesPanel(){
  openDialog(els.resourcesDialog);
  els.resourcesDialog.setAttribute('aria-busy','true');
  if(!els.resourceGrid.children.length)els.resourceGrid.innerHTML='<div class="bubble">Carregando Recursos IA…</div>';
  const data=await refreshResources(true);
  els.resourcesDialog.setAttribute('aria-busy','false');
  if(!data&&els.resourcesDialog.open)els.resourceGrid.innerHTML='<div class="bubble">Não foi possível consultar os Recursos IA. Verifique se o ABRIR.bat continua aberto.</div>';
}
async function openGalleryPanel(){
  openDialog(els.gallery);
  els.gallery.setAttribute('aria-busy','true');
  clearGalleryUrls();state.galleryOffset=0;els.galleryGrid.innerHTML='<div class="bubble">Carregando galeria…</div>';els.galleryMore.hidden=true;
  try{await reconcileMediaStorage();await renderGallery()}finally{els.gallery.setAttribute('aria-busy','false')}
}

// ---------- events ----------
els.composer.addEventListener('submit',e=>{e.preventDefault();const j=snapshotJob(),err=validateJob(j);if(err){addTextMessage('assistant',err,{persist:false});return}state.running?enqueue(j):executeJob(j)});
els.prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();els.composer.requestSubmit()}});
els.mode.onchange=setMode;els.videoEngine.onchange=()=>{updateAvailability();applyPreset();savePrefs()};els.optionsBtn.onclick=()=>openDialog(els.options);
els.file.onchange=()=>{const incoming=validatedIncomingImages([...els.file.files]);const limit=els.mode.value==='merge'?8:1,total=[...state.attachments,...incoming];if(total.length>limit)addTextMessage('assistant',`Este modo aceita até ${limit} ${limit===1?'imagem':'imagens'} por vez. As demais foram ignoradas.`,{persist:false});state.attachments=total.slice(0,limit);renderAttachments();els.file.value=''};
window.addEventListener('paste',e=>{if(!modes[els.mode.value].upload)return;const incoming=validatedIncomingImages([...(e.clipboardData?.files||[])]);if(!incoming.length)return;const limit=els.mode.value==='merge'?8:1,total=[...state.attachments,...incoming];if(total.length>limit)addTextMessage('assistant',`Este modo aceita até ${limit} ${limit===1?'imagem':'imagens'} por vez. As demais foram ignoradas.`,{persist:false});state.attachments=total.slice(0,limit);renderAttachments()});
els.resourcesBtn.onclick=openResourcesPanel;els.lockedAction.onclick=openResourcesPanel;els.galleryBtn.onclick=openGalleryPanel;els.queueBtn.onclick=()=>{renderQueue();openDialog(els.queueDialog)};els.promptBtn.onclick=()=>openDialog(els.promptDialog);els.newChat.onclick=()=>{if(state.running||state.queue.length){alert('Conclua ou cancele a operação atual e esvazie a fila antes de limpar a conversa.');return}if(confirm('Limpar somente esta conversa? A galeria será preservada.')){clearConversationHistory().finally(()=>{hydrateThread();els.heroNote.hidden=false})}};
$$('[data-start-mode]').forEach(b=>b.onclick=()=>{const mode=b.dataset.startMode;if(!modes[mode])return;const opt=[...els.mode.options].find(o=>o.value===mode);if(opt?.disabled){openResourcesPanel();return}els.mode.value=mode;setMode();scrollToComposer();els.prompt.focus()});
if(els.installerDismiss)els.installerDismiss.onclick=()=>{els.installerBox.hidden=true;els.installerLog.hidden=true;els.installerToggle.textContent='Mostrar log'};
if(els.installerCancel)els.installerCancel.onclick=async()=>{if(!state.installerRunning)return;els.installerCancel.disabled=true;els.installerCancel.textContent='Cancelando…';try{const {response:r,data:d}=await fetchJson('/api/resources/cancel',{method:'POST'},'instalador');if(!r.ok)throw new Error(d.error||'Falha ao cancelar a instalação.')}catch(e){alert(e.message);els.installerCancel.disabled=false;els.installerCancel.textContent='Cancelar'}};
$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close)?.close());
let gallerySearchTimer=0;els.gallerySearch.oninput=()=>{clearTimeout(gallerySearchTimer);gallerySearchTimer=setTimeout(()=>renderGallery(),220)};els.galleryFilter.onchange=()=>renderGallery();els.galleryMore.onclick=()=>renderGallery({append:true});els.gallery.addEventListener('close',()=>{clearGalleryUrls();els.galleryGrid.innerHTML='';state.galleryOffset=0});els.installAll.onclick=installAll;

els.reloadModels.onclick=async()=>{const catalog=await loadModelCatalog();if(!catalog){alert(state.catalogError||'modelos.json não pôde ser carregado.');return}await refreshResources();alert('modelos.json recarregado e validado.');};
els.openModels.onclick=async()=>{try{const r=await fetch('/api/open-modelos',{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível abrir modelos.json.')}catch(e){alert(e.message)}};
els.installerToggle.onclick=()=>{els.installerLog.hidden=!els.installerLog.hidden;els.installerToggle.textContent=els.installerLog.hidden?'Mostrar log':'Ocultar log';if(!els.installerLog.hidden){state.installerFollow=true;els.installerLog.scrollTop=els.installerLog.scrollHeight}};
els.installerLog.addEventListener('scroll',()=>{const near=els.installerLog.scrollHeight-els.installerLog.scrollTop-els.installerLog.clientHeight<18;state.installerFollow=near;els.installerJump.hidden=near});els.installerJump.onclick=()=>{state.installerFollow=true;els.installerLog.scrollTop=els.installerLog.scrollHeight;els.installerJump.hidden=true};
[els.quality,els.ratio].forEach(el=>el.onchange=()=>{applyPreset();savePrefs()});[els.width,els.height].forEach(el=>el.oninput=()=>{els.ratio.value='custom';savePrefs()});[els.seed,els.temperature,els.memoryRetry,els.duration,els.fps,els.motion].filter(Boolean).forEach(el=>el.onchange=savePrefs);
els.savePrompt.onclick=()=>{savePrefs();els.promptDialog.close()};
$$('[data-preset]').forEach(b=>b.onclick=()=>{const map={cinematic:'cinematic, dramatic lighting, detailed composition, strong visual storytelling',anime:'anime style, expressive lighting, dynamic composition, detailed linework',realistic:'photorealistic, natural lighting, realistic textures, fine detail',product:'professional product photography, clean studio lighting, premium commercial composition'};els.prompt.value=[els.prompt.value.trim(),map[b.dataset.preset]].filter(Boolean).join(', ');els.promptDialog.close();scrollToComposer()});
els.firstRunResources.onclick=()=>{els.firstRun.close();openResourcesPanel()};els.firstRunSkip.onclick=()=>{try{localStorage.setItem('giia-first-run','1')}catch{}els.firstRun.close()};

async function boot(){await requestPersistentStorage();await migrateLegacyStorage();loadPrefs();await loadModelCatalog();await syncHistoryFromServer();await reconcileMediaStorage();await hydrateThread();await refreshResources();if(!modeAvailable(els.mode.value)){const first=['image','video','chat','edit','merge'].find(modeAvailable);if(first)els.mode.value=first}setMode();renderQueue();syncComposerSafeSpace();scrollConversationBottom('auto');if((()=>{try{return !localStorage.getItem('giia-first-run')}catch{return true}})()&&Object.values(state.resources).every(r=>!r.installed)){openDialog(els.firstRun)}setInterval(()=>{if(!document.hidden&&!els.resourcesDialog.open&&!state.installerTimer)refreshResources(false)},60000)}
boot();
