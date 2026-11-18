const $=id=>document.getElementById(id);
let csrf='',documents=[],current=null,taskDocs={},poll=null,dirty=false;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notify(text){$('notice').textContent=text;}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-CSRF-Token':csrf,...options.headers}});if(!r.ok){let e;try{e=await r.json();}catch{e={detail:'Ошибка приложения: '+r.status};}throw new Error(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail));}return r.json();}
const post=(url,body={})=>api(url,{method:'POST',body:JSON.stringify(body)});
function handle(fn){return async e=>{try{await fn(e);}catch(e){notify(e.message);}};}
function setOptions(select,items,optional=false){const previous=select.value;select.replaceChildren();if(optional){const o=el('option','Не загружен');o.value='';select.append(o);}for(const item of items){const o=el('option',item.name);o.value=item.id;select.append(o);}if([...select.options].some(o=>o.value===previous))select.value=previous;}
async function bootstrap(){const info=await api('/api/bootstrap');csrf=info.csrf;$('account').textContent=info.gigachat.configured?'Ключ GigaChat настроен':'Требуется серверный ключ GigaChat';$('retrieval').textContent=info.retrieval;}
async function loadDocuments(){documents=await api('/api/documents');for(const [id,role,optional] of [['contract_id','contract',false],['template_id','template',false],['policy_id','policy',false],['specification_id','specification',true],['supplier_id','suppliers',true]])setOptions($(id),documents.filter(d=>d.role===role),optional);}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));if(b.dataset.tab==='history')loadTasks().catch(e=>notify(e.message));});
$('models').onclick=handle(async()=>{await bootstrap();setOptions($('model'),await api('/api/models'));notify('Каталог получен. Фактический доступ проверяется при запросе к модели.');});
const documentFields = {contract:'contract_id', template:'template_id', policy:'policy_id', specification:'specification_id', suppliers:'supplier_id'};
$('examples').onclick = handle(async () => {
 const example = await post('/api/examples');
 await loadDocuments();
 for (const [role, id] of Object.entries(example.selected)) $(documentFields[role]).value = id;
 $('mode').value = 'demo';
 $('mode').dispatchEvent(new Event('change'));
 notify('Учебный комплект выбран. Можно начинать проверку.');
});
$('upload').onclick=handle(async()=>{const file=$('file').files[0];if(!file)throw new Error('Выберите файл');const data=new FormData();data.append('file',file);data.append('role',$('role').value);const added=await api('/api/documents',{method:'POST',body:data});await loadDocuments();$(documentFields[added.role]).value=added.id;$('file').value='';notify('Документ добавлен. Новая загрузка хранится как отдельная версия.');});
$('reviewform').onsubmit=handle(async e=>{e.preventDefault();const body={};for(const id of ['title','mode','model','contract_id','template_id','policy_id','specification_id','supplier_id'])body[id]=$(id).value||null;body.model=$('model').value;body.max_steps=+$('max_steps').value;body.max_tokens=+$('max_tokens').value;if(body.mode==='gigachat'&&!body.model)throw new Error('Обновите каталог GigaChat и выберите модель');const submit=$('reviewform').querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;let result;try{result=await post('/api/tasks',body);}finally{submit.disabled=false;}await openTask(result.id);$('review').scrollIntoView({behavior:'smooth'});});
const statusNames={queued:'В очереди',running:'Агент работает',completed:'Готово к проверке юристом',interrupted:'Нужна проверка или продолжение',failed:'Ошибка'};
async function loadTasks(){const tasks=await api('/api/tasks');$('tasklist').replaceChildren();if(!tasks.length)$('tasklist').append(el('p','Пока нет проверок.'));for(const t of tasks){const row=el('div',undefined,'taskrow');const content=el('div');content.append(el('strong',t.request.title),el('div',new Date(t.created).toLocaleString('ru-RU')+' / '+statusNames[t.status],'small'));const button=el('button','Открыть','quiet');button.onclick=handle(()=>openTask(t.id));row.append(content,button);$('tasklist').append(row);}}
$('refresh').onclick=handle(loadTasks);
async function openTask(id,force=false){if(dirty&&!force&&!confirm('Отменить несохранённые правки?'))return;clearTimeout(poll);current=await api('/api/tasks/'+id);taskDocs={};for(const key of ['contract_id','template_id','policy_id','specification_id','supplier_id'])if(current.request[key]){const d=await api('/api/documents/'+current.request[key]);taskDocs[d.id]=d;}dirty=false;renderTask();await loadLogs();if(['queued','running'].includes(current.status))poll=setTimeout(()=>openTask(id,true).catch(e=>notify(e.message)),2500);}
function renderTask(){
 $('review').classList.remove('hidden');$('reviewtitle').textContent=current.request.title;$('reviewbadge').textContent=current.request.mode==='demo'?'ДЕМОНСТРАЦИЯ БЕЗ LLM':current.request.mode==='gigachat'?'GIGACHAT':'АРХИВ / CHATGPT';
 $('progress').textContent=statusNames[current.status]+' / шагов: '+current.steps+' / токенов: '+current.tokens+' / версия '+current.revision;
 $('manual').hidden=!(current.status==='interrupted' && current.result && current.request.mode==='gigachat');
 $('reviewerror').textContent=current.error||'';$('resume').hidden=current.status!=='interrupted';
 const d=taskDocs[current.request.contract_id];$('contracttext').replaceChildren();for(const clause of d.clauses){const p=el('div',undefined,'clause');p.id='clause-'+clause.id;p.append(el('b',clause.id+(clause.page?' / стр. '+clause.page:'')),el('span',clause.text));$('contracttext').append(p);}
 const result=current.result;$('summary').textContent=result?.summary||'Здесь появится результат после завершения проверки.';$('limitations').replaceChildren();for(const l of result?.limitations||[])$('limitations').append(el('div',l,'limitation'));
 $('findings').replaceChildren();for(const f of result?.findings||[])renderFinding(f);
 $('lawyer_note').value=current.lawyer_note||'';for(const id of ['save','approve','addfinding'])$(id).disabled=current.status!=='completed';
 updateDecisionBar();approvalUI();
}
function markDirty(){updateDecisionBar();dirty=true;current.approved=false;approvalUI();}
function approvalUI(){for(const [id,format] of [['docx','docx'],['json','json']]){const a=$(id);a.classList.toggle('disabled',!current.approved);if(current.approved)a.href='/api/tasks/'+current.id+'/export/'+format;else a.removeAttribute('href');}$('send').disabled=!current.approved;$('approvalstatus').textContent=dirty?'Есть несохранённые правки. Подтверждение потребуется заново.':current.approved?'Точная версия протокола подтверждена. Доступны выгрузка и тестовая отправка.':'Предпросмотр: проверьте замечания, сохраните правки и подтвердите протокол.';}
function highlight(id){document.querySelectorAll('.clause').forEach(p=>p.classList.toggle('selected',p.id==='clause-'+id));$('clause-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest'});}
function editField(box,label,value,update,multiline=false){const wrap=el('label',label);const input=el(multiline?'textarea':'input');input.value=value;if(multiline)input.rows=3;input.oninput=()=>{update(input.value);markDirty();};wrap.append(input);box.append(wrap);return input;}
function renderFinding(f){
 const box=el('article',undefined,'finding');box.dataset.finding=f.id;box.append(el('div',f.category,'category'));editField(box,'Замечание',f.title,v=>f.title=v);
 const focus=el('button','Показать пункт '+f.contract.clause_id,'quiet');focus.onclick=()=>highlight(f.contract.clause_id);box.append(focus,el('blockquote',f.contract.quote));
 const contractSelect=el('select');setOptions(contractSelect,taskDocs[current.request.contract_id].clauses.map(p=>({id:p.id,name:p.id+' — '+p.text.slice(0,85)})));contractSelect.setAttribute('aria-label','Пункт договора');contractSelect.value=f.contract.clause_id;contractSelect.onchange=()=>{const p=taskDocs[current.request.contract_id].clauses.find(p=>p.id===contractSelect.value);f.contract={document_id:current.request.contract_id,clause_id:p.id,quote:p.text};markDirty();renderFindings();};box.append(contractSelect);
 const category=el('select');for(const name of ['нарушение','на согласование','допустимо','нужны данные']){const o=el('option',name);o.value=name;category.append(o);}category.setAttribute('aria-label','Категория замечания');category.value=f.category;category.onchange=()=>{f.category=category.value;box.querySelector('.category').textContent=f.category;markDirty();};box.append(category);
 editField(box,'Объяснение',f.explanation,v=>f.explanation=v,true);editField(box,'Предложение для протокола',f.suggestion,v=>f.suggestion=v,true);
 for(const ref of f.evidence){const d=taskDocs[ref.document_id];box.append(el('div',(d?.name||'Документ')+' / '+ref.clause_id,'small'),el('blockquote',ref.quote));}
 const details=el('details');details.append(el('summary','Выбрать основание вручную'));const ds=el('select'),ps=el('select');setOptions(ds,Object.values(taskDocs).filter(d=>d.role!=='contract'));function clauses(){setOptions(ps,(taskDocs[ds.value]?.clauses||[]).map(p=>({id:p.id,name:p.id+' — '+p.text.slice(0,100)})));}ds.onchange=clauses;clauses();const add=el('button','Заменить основания','quiet');add.onclick=()=>{const d=taskDocs[ds.value],p=d?.clauses.find(p=>p.id===ps.value);if(!p)return;f.evidence=[{document_id:d.id,clause_id:p.id,quote:p.text}];markDirty();renderFindings();};details.append(ds,ps,add);box.append(details);
 const decision=el('select');for(const [v,t] of [['pending','Решение не принято'],['accepted','Принять замечание'],['rejected','Отклонить замечание']]){const o=el('option',t);o.value=v;decision.append(o);}decision.setAttribute('aria-label','Решение юриста');decision.value=f.decision;decision.onchange=()=>{f.decision=decision.value;markDirty();};box.append(decision);$('findings').append(box);
}
function renderFindings(){$('findings').replaceChildren();current.result.findings.forEach(renderFinding);updateDecisionBar();}
$('lawyer_note').oninput=()=>{if(current)markDirty();};
$('addfinding').onclick=()=>{const p=taskDocs[current.request.contract_id].clauses[0];current.result.findings.push({id:crypto.randomUUID(),title:'Замечание юриста',category:'нужны данные',explanation:'Требуется дополнительная проверка.',contract:{document_id:current.request.contract_id,clause_id:p.id,quote:p.text},evidence:[],suggestion:'',decision:'pending'});markDirty();renderFindings();};
$('save').onclick=handle(async()=>{await post('/api/tasks/'+current.id+'/decisions',{revision:current.revision,findings:current.result.findings,lawyer_note:$('lawyer_note').value});dirty=false;await openTask(current.id,true);notify('Правки сохранены. Предыдущее одобрение сброшено.');});
$('approve').onclick=handle(async()=>{if(dirty)throw new Error('Сначала сохраните правки');if(!confirm('Подтверждаете точную версию протокола и ознакомление с ограничениями проверки?'))return;await post('/api/tasks/'+current.id+'/approve',{revision:current.revision});await openTask(current.id,true);notify('Версия протокола подтверждена.');});
$('send').onclick=handle(async()=>{const result=await post('/api/tasks/'+current.id+'/send-test',{revision:current.revision});notify('Сохранено в локальный тестовый ящик. Реальное письмо не отправлялось. Номер: '+result.id.slice(0,12));});
$('resume').onclick=handle(async()=>{await post('/api/tasks/'+current.id+'/resume');await openTask(current.id,true);});
async function loadLogs(){$('logs').textContent=JSON.stringify(await api('/api/tasks/'+current.id+'/logs'),null,2);}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
bootstrap().then(loadDocuments).then(syncMode).catch(e=>notify(e.message));

$("hero-demo").onclick=()=>{document.querySelector("[data-tab=workspace]").click();$("examples").click();$("app-area").scrollIntoView({behavior:"smooth"});};
$("header-history").onclick=e=>{e.preventDefault();document.querySelector(".workspace-tabs [data-tab=history]").click();$("app-area").scrollIntoView({behavior:"smooth"});};

function updateDecisionBar() {
 const findings = current?.result?.findings || [];
 const pending = findings.filter(finding => finding.decision === 'pending').length;
 $('decision-count').textContent = 'Рассмотрено ' + (findings.length - pending) + ' из ' + findings.length;
 const filter = $('decision-filter').value;
 const byId = new Map(findings.map(finding => [finding.id, finding]));
 let visible = 0;
 for (const card of $('findings').children) {
  const finding = byId.get(card.dataset.finding);
  if (!finding) continue;
  card.dataset.decision = finding.decision;
  card.hidden = filter !== 'all' && finding.decision !== filter;
  if (!card.hidden) visible++;
 }
 $('empty-findings').hidden = visible > 0 || current?.status !== 'completed';
 $('empty-findings').textContent = findings.length ? 'Для выбранного фильтра замечаний нет.' : 'Замечаний по выполненным проверкам нет.';
}
$('decision-filter').onchange = updateDecisionBar;
document.querySelectorAll('a[href="#app-area"]:not(#header-history)').forEach(link => {
 link.addEventListener('click', () => document.querySelector('[data-tab=workspace]').click());
});

async function syncMode() {
 const live = $('mode').value === 'gigachat';
 $('model').closest('label').hidden = !live;
 $('max_tokens').closest('label').hidden = !live;
 $('models').hidden = !live;
 if (live && !$('model').value) {
  try { setOptions($('model'), await api('/api/models')); }
  catch (error) { notify(error.message); }
 }
}
$('mode').onchange = syncMode;

$('manual').onclick = handle(async () => {
 await post('/api/tasks/'+current.id+'/manual',{revision:current.revision});
 await openTask(current.id,true);
});
