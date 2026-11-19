const $=id=>document.getElementById(id);
let csrf='',documents=[],current=null,taskDocs={},poll=null,dirty=false;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notify(text){$('notice').textContent=text;}
async function api(url,options={}){return localApi(url,options);}
const post=(url,body={})=>api(url,{method:'POST',body:JSON.stringify(body)});
function handle(fn){return async e=>{try{await fn(e);}catch(e){notify(e.message);}};}
function setOptions(select,items,optional=false){const previous=select.value;select.replaceChildren();if(optional){const o=el('option','Не загружен');o.value='';select.append(o);}for(const item of items){const o=el('option',item.name);o.value=item.id;select.append(o);}if([...select.options].some(o=>o.value===previous))select.value=previous;}
async function bootstrap(){const info=await api('/api/bootstrap');csrf=info.csrf;$('account').textContent=info.oauth.connected?'ChatGPT: '+(info.oauth.email||'вход выполнен'):'Автономная проверка без LLM';$('logout').hidden=!info.oauth.connected;$('retrieval').textContent=info.retrieval;}
async function loadDocuments(){documents=await api('/api/documents');for(const [id,role,optional] of [['contract_id','contract',false],['template_id','template',false],['policy_id','policy',false],['specification_id','specification',true],['supplier_id','suppliers',true]])setOptions($(id),documents.filter(d=>d.role===role),optional);syncRows();}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));if(b.dataset.tab==='history')loadTasks().catch(e=>notify(e.message));});
$('login').onclick=handle(async()=>{const {url}=await post('/api/oauth/start');window.open(url,'_blank','noopener');notify('Завершите вход в открывшемся окне, затем обновите каталог моделей.');});
$('logout').onclick=handle(async()=>{const result=await post('/api/oauth/logout');await bootstrap();$('model').replaceChildren();notify(result.revoked?'Вы вышли из ChatGPT.':'Вы вышли локально. Отзыв сессии не подтверждён; отключить приложение можно в настройках ChatGPT.');});
$('models').onclick=handle(async()=>{await bootstrap();setOptions($('model'),await api('/api/models'));notify('Каталог получен. Фактический доступ проверяется при запросе к модели.');});
const documentFields = {contract:'contract_id', template:'template_id', policy:'policy_id', specification:'specification_id', suppliers:'supplier_id'};
function syncRows(){for(const b of document.querySelectorAll('.pick')){const select=$(documentFields[b.dataset.role]);const row=b.closest('.doc-row');row.querySelector('.file-name').textContent=select.value?select.selectedOptions[0].textContent:'Файл не выбран';b.textContent=select.value?'Заменить':'Добавить';b.setAttribute('aria-label',b.textContent+': '+row.querySelector('label').textContent);select.hidden=select.options.length<2;select.required=false;select.onchange=syncRows;}}
 let pickingRole;for(const b of document.querySelectorAll('.pick'))b.onclick=()=>{pickingRole=b.dataset.role;$('file').value='';$('file').click();};
 $('file').onchange=handle(async()=>{const file=$('file').files[0],role=pickingRole;if(!file)return;const data=new FormData();data.append('file',file);data.append('role',role);const added=await api('/api/documents',{method:'POST',body:data});await loadDocuments();$(documentFields[role]).value=added.id;syncRows();notify('Документ добавлен.');});
$('reviewform').onsubmit=handle(async e=>{e.preventDefault();for(const role of ['contract','template','policy'])if(!$(documentFields[role]).value){const b=document.querySelector('.pick[data-role='+role+']');b.focus();throw Error('Добавьте документ: '+b.closest('.doc-row').querySelector('label').textContent);}const body={};for(const id of ['title','mode','model','contract_id','template_id','policy_id','specification_id','supplier_id'])body[id]=$(id).value||null;body.model=$('model').value;body.max_steps=+$('max_steps').value;body.max_tokens=+$('max_tokens').value;if(body.mode==='oauth'&&!body.model)throw new Error('Войдите через ChatGPT и выберите модель');const submit=$('reviewform').querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;let result;try{result=await post('/api/tasks',body);}finally{submit.disabled=false;}await openTask(result.id);$('review').scrollIntoView({behavior:'smooth'});});
const statusNames={queued:'В очереди',running:'Агент работает',completed:'Готово к проверке юристом',interrupted:'Нужна проверка или продолжение',failed:'Ошибка'};
async function loadTasks(){const tasks=await api('/api/tasks');$('tasklist').replaceChildren();if(!tasks.length)$('tasklist').append(el('p','Пока нет проверок.'));for(const t of tasks){const row=el('div',undefined,'taskrow');const content=el('div');content.append(el('strong',t.request.title),el('div',new Date(t.created).toLocaleString('ru-RU')+' / '+statusNames[t.status],'small'));const button=el('button','Открыть','quiet');button.onclick=handle(()=>openTask(t.id));row.append(content,button);$('tasklist').append(row);}}
$('refresh').onclick=handle(loadTasks);
async function openTask(id,force=false){if(dirty&&!force&&!confirm('Отменить несохранённые правки?'))return;clearTimeout(poll);current=await api('/api/tasks/'+id);taskDocs={};for(const key of ['contract_id','template_id','policy_id','specification_id','supplier_id'])if(current.request[key]){const d=await api('/api/documents/'+current.request[key]);taskDocs[d.id]=d;}dirty=false;renderTask();await loadLogs();if(['queued','running'].includes(current.status))poll=setTimeout(()=>openTask(id,true).catch(e=>notify(e.message)),2500);}
function renderTask(){
 $('review').classList.remove('hidden');$('reviewtitle').textContent=current.request.title;$('reviewbadge').textContent=current.request.mode==='demo'?'ПРОВЕРКА ПО ПРАВИЛАМ':'GigaChat';
 $('progress').textContent=statusNames[current.status]+' / шагов: '+current.steps+' / токенов: '+current.tokens+' / версия '+current.revision;
 $('reviewerror').textContent=current.error||'';$('resume').hidden=current.status!=='interrupted';
 const d=taskDocs[current.request.contract_id];$('contracttext').replaceChildren();for(const clause of d.clauses){const p=el('div',undefined,'clause');p.id='clause-'+clause.id;p.append(el('b',paragraphName(clause.text)+(clause.page?' / стр. '+clause.page:'')),el('span',clause.text));$('contracttext').append(p);}
 const result=current.result;$('summary').textContent=result?.summary||'Здесь появится результат после завершения проверки.';$('limitations').replaceChildren();for(const l of result?.limitations||[])$('limitations').append(el('div',l,'limitation'));
 $('findings').replaceChildren();for(const f of result?.findings||[])renderFinding(f);
 $('lawyer_note').value=current.lawyer_note||'';for(const id of ['save','approve','addfinding'])$(id).disabled=current.status!=='completed';
 updateDecisionBar();approvalUI();
}
function markDirty(){updateDecisionBar();dirty=true;current.approved=false;approvalUI();}
function approvalUI(){for(const [id,format] of [['docx','docx'],['json','json']]){const a=$(id);a.classList.toggle('disabled',!current.approved);if(current.approved){a.href='#';a.onclick=handle(async e=>{e.preventDefault();if(dirty)throw Error('Сохраните и подтвердите правки');const blob=await exportReview(current.id,format);const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download=format==='docx'?'protocol.docx':'review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);});}else{a.removeAttribute('href');a.onclick=null;}}$('send').disabled=!current.approved;$('approvalstatus').textContent=dirty?'Есть несохранённые правки. Подтверждение потребуется заново.':current.approved?'Точная версия протокола подтверждена. Доступны выгрузка и тестовая отправка.':'Предпросмотр: проверьте замечания, сохраните правки и подтвердите протокол.';}
function highlight(id){document.querySelectorAll('.clause').forEach(p=>p.classList.toggle('selected',p.id==='clause-'+id));const n=$('clause-'+id);if(n){n.tabIndex=-1;n.focus({preventScroll:true});n.scrollIntoView({block:'center'});}}
function editField(box,label,value,update,multiline=false){const wrap=el('label',label);const input=el(multiline?'textarea':'input');input.value=value;if(multiline)input.rows=3;input.oninput=()=>{update(input.value);markDirty();};wrap.append(input);box.append(wrap);return input;}
function paragraphName(text){const n=(text||'').match(/^\s*(?:§\s*)?(\d+(?:\.\d+)*)(?:[.)]|\s+(?=\S))/);return n?'§ '+n[1]:'Фрагмент';}
function refName(ref){const clause=taskDocs[ref.document_id]?.clauses.find(p=>p.id===ref.clause_id);return paragraphName(clause?.text);}
function compactValue(text,id){
 const units={delivery:/\d+\s+(?:календарн\S*|рабоч\S*)\s+(?:дней|дня|день)/i,payment:/\d+\s+(?:календарн\S*|рабоч\S*)\s+(?:дней|дня|день)/i,warranty:/\d+\s+месяц\S*/i,advance:/\d+(?:[.,]\d+)?\s*%/,total:/\d[\d \u00a0]*(?:[.,]\d+)?\s*(?:руб\.?|₽)/i};
 const match=units[id]?.exec(text||'');if(!match)return '';const pre=text.slice(0,match.index);return (/не более|не дольше|максимум/i.test(pre)?'до ':/не менее|минимум/i.test(pre)?'от ':'')+match[0].trim();
}
function renderFinding(f){
 const box=el('article',undefined,'finding');box.dataset.finding=f.id;
 const bar=el('div',undefined,'finding-top'),tag=el('span',f.category,'category'),status=el('select');status.setAttribute('aria-label','Решение юриста');
 for(const [v,t] of [['pending','Без решения'],['accepted','Принято'],['rejected','Отклонено']]){const o=el('option',t);o.value=v;status.append(o);}status.value=f.decision;status.onchange=()=>{f.decision=status.value;markDirty();};
 const control=el('label','Решение юриста');control.append(status);bar.append(tag,control);
 const heading=el('h4',f.title.replace(/: отклонение$/i,''));box.append(bar,heading);
 const compare=el('div',undefined,'comparison');
 const cell=(label,value)=>{const n=el('div');n.append(el('small',label),el('strong',value));compare.append(n);};
 cell('В договоре',compactValue(f.contract.quote,f.id)||f.contract.quote||'Не указан пункт договора');
 for(const ref of f.evidence){const role=taskDocs[ref.document_id]?.role;cell(({policy:'По положению',template:'По типовой форме',specification:'По спецификации',suppliers:'По справочнику'})[role]||'По основанию',compactValue(ref.quote,f.id)||ref.quote||'Нет текста основания');}
 if(!f.evidence.length)cell('Для сравнения','Не указан пункт документа-основания');
 box.append(compare);const explain=el('p',f.explanation,'explain');box.append(explain);
 const cite=el('div',undefined,'citations');const focus=el('button','Договор · '+refName(f.contract),'source-link');focus.onclick=()=>highlight(f.contract.clause_id);cite.append(focus,el('blockquote',f.contract.quote));
 for(const ref of f.evidence){const source=el('details');source.className='source-detail';const d=taskDocs[ref.document_id];source.append(el('summary',(d?.name||'Основание')+' · '+refName(ref)),el('blockquote',ref.quote));if(d){const open=el('button','Открыть источник','source-link');open.onclick=()=>{const dialog=el('dialog');dialog.className='source-view';dialog.setAttribute('aria-label',d.name);const close=el('button','Закрыть','quiet');close.onclick=()=>dialog.close();dialog.append(close,el('h3',d.name));let chosen;for(const p of d.clauses){const line=el('p',p.text);dialog.append(line);if(p.id===ref.clause_id){line.className='selected';chosen=line;}}dialog.onclose=()=>{dialog.remove();open.focus();};document.body.append(dialog);dialog.showModal();chosen?.scrollIntoView({block:'center'});};source.append(open);}cite.append(source);}box.append(cite);
 const edit=el('details');edit.className='editing';edit.append(el('summary','Редактировать замечание'));box.append(edit);
 editField(edit,'Замечание',f.title,v=>{f.title=v;heading.textContent=v;});
 const cs=el('select');cs.setAttribute('aria-label','Пункт договора');const contract=taskDocs[current.request.contract_id];setOptions(cs,contract.clauses.map(p=>({id:p.id,name:paragraphName(p.text)+' — '+p.text.slice(0,85)})));cs.value=f.contract.clause_id;cs.onchange=()=>{const p=contract.clauses.find(c=>c.id===cs.value);f.contract={document_id:contract.id,clause_id:p.id,quote:p.text};markDirty();renderFindings();};edit.append(cs);
 const cat=el('select');cat.setAttribute('aria-label','Категория замечания');for(const c of ['нарушение','на согласование','допустимо','нужны данные'])cat.append(el('option',c));cat.value=f.category;cat.onchange=()=>{f.category=cat.value;tag.textContent=f.category;markDirty();};edit.append(cat);
 editField(edit,'Объяснение',f.explanation,v=>{f.explanation=v;explain.textContent=v;},true);editField(edit,'Предложение для протокола',f.suggestion,v=>f.suggestion=v,true);
 const ds=el('select'),ps=el('select');ds.setAttribute('aria-label','Документ-основание');ps.setAttribute('aria-label','Пункт основания');setOptions(ds,Object.values(taskDocs).filter(d=>d.role!=='contract'));function clauses(){setOptions(ps,(taskDocs[ds.value]?.clauses||[]).map(p=>({id:p.id,name:paragraphName(p.text)+' — '+p.text.slice(0,100)})));}ds.onchange=clauses;clauses();const add=el('button','Заменить основания','quiet');add.onclick=()=>{const d=taskDocs[ds.value],p=d?.clauses.find(p=>p.id===ps.value);if(!p)return;f.evidence=[{document_id:d.id,clause_id:p.id,quote:p.text}];markDirty();renderFindings();};edit.append(ds,ps,add);$('findings').append(box);
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
bootstrap().then(loadDocuments).catch(e=>notify(e.message));

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

async function showOnlineAvailability() {
 const option = $('mode').querySelector('[value=gigachat]');
 if (!option) return;
 option.disabled = true;
 try {
  const response = await fetch('/api/gigachat/status');
  const status = await response.json();
  option.disabled = !status.enabled;
 } catch { option.disabled = true; }
 if (option.disabled) {
  option.textContent = 'GigaChat временно недоступен';
  $('account').textContent = 'Доступна проверка по правилам. Онлайн-анализ временно недоступен.';
 }
}
showOnlineAvailability();
