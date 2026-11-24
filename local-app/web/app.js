const $=id=>document.getElementById(id);
let csrf='',documents=[],current=null,taskDocs={},poll=null,dirty=false;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notify(text){$('notice').textContent=text;}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-CSRF-Token':csrf,...options.headers}});if(!r.ok){let e;try{e=await r.json();}catch{e={detail:'Ошибка приложения: '+r.status};}throw new Error(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail));}return r.json();}
const post=(url,body={})=>api(url,{method:'POST',body:JSON.stringify(body)});
function handle(fn){return async e=>{try{await fn(e);}catch(e){notify(e.message);}};}
function setOptions(select,items,optional=false){const previous=select.value;select.replaceChildren();if(optional){const o=el('option','Не загружен');o.value='';select.append(o);}for(const item of items){const o=el('option',item.name);o.value=item.id;select.append(o);}if([...select.options].some(o=>o.value===previous))select.value=previous;}
async function bootstrap(){const info=await api('/api/bootstrap');csrf=info.csrf;$('account').textContent=info.gigachat.configured?'Ключ GigaChat настроен':'Требуется серверный ключ GigaChat';$('retrieval').textContent=info.retrieval;}
async function loadDocuments(){documents=await api('/api/documents');for(const [id,role,optional] of [['contract_id','contract',false],['template_id','template',false],['policy_id','policy',false],['specification_id','specification',true],['supplier_id','suppliers',true]])setOptions($(id),documents.filter(d=>d.role===role),optional);syncRows();}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));if(b.dataset.tab==='history')loadTasks().catch(e=>notify(e.message));});
$('models').onclick=handle(async()=>{await bootstrap();setOptions($('model'),await api('/api/models'));notify('Каталог получен. Фактический доступ проверяется при запросе к модели.');});
const documentFields = {contract:'contract_id', template:'template_id', policy:'policy_id', specification:'specification_id', suppliers:'supplier_id'};
function syncRows(){for(const b of document.querySelectorAll('.pick')){const select=$(documentFields[b.dataset.role]);const row=b.closest('.doc-row');row.querySelector('.file-name').textContent=select.value?select.selectedOptions[0].textContent:'Файл не выбран';b.textContent=select.value?'Заменить':'Добавить';b.setAttribute('aria-label',b.textContent+': '+row.querySelector('label').textContent);select.hidden=select.options.length<2;select.required=false;select.onchange=syncRows;}}
 let pickingRole;for(const b of document.querySelectorAll('.pick'))b.onclick=()=>{pickingRole=b.dataset.role;$('file').value='';$('file').click();};
 $('file').onchange=handle(async()=>{const file=$('file').files[0],role=pickingRole;if(!file)return;const data=new FormData();data.append('file',file);data.append('role',role);const added=await api('/api/documents',{method:'POST',body:data});await loadDocuments();$(documentFields[role]).value=added.id;syncRows();notify('Документ добавлен.');});
$('reviewform').onsubmit=handle(async e=>{e.preventDefault();for(const role of ['contract','template','policy'])if(!$(documentFields[role]).value){const b=document.querySelector('.pick[data-role='+role+']');b.focus();throw Error('Добавьте документ: '+b.closest('.doc-row').querySelector('label').textContent);}const body={};for(const id of ['title','mode','model','contract_id','template_id','policy_id','specification_id','supplier_id'])body[id]=$(id).value||null;body.model=$('model').value;body.max_steps=+$('max_steps').value;body.max_tokens=+$('max_tokens').value;if(body.mode==='gigachat'&&!body.model)throw new Error('Обновите каталог GigaChat и выберите модель');const submit=$('reviewform').querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
 const feedback=$('submit-progress');
 feedback.textContent='Запускаем проверку…';
 try {
  const result=await post('/api/tasks',body);
  if(await openTask(result.id))$('review').scrollIntoView({behavior:'smooth'});
 } finally {
  feedback.textContent='';
  submit.disabled=false;
 }});
const statusNames={queued:'В очереди',running:'Проверка идёт',completed:'Готово к проверке юристом',interrupted:'Нужна проверка или продолжение',failed:'Ошибка'};
async function loadTasks(){const tasks=await api('/api/tasks');$('tasklist').replaceChildren();if(!tasks.length)$('tasklist').append(el('p','Пока нет проверок.'));for(const t of tasks){const row=el('div',undefined,'taskrow');const content=el('div');content.append(el('strong',t.request.title),el('div',new Date(t.created).toLocaleString('ru-RU')+' / '+statusNames[t.status],'small'));const button=el('button','Открыть','quiet');button.onclick=handle(()=>openTask(t.id));row.append(content,button);$('tasklist').append(row);}}
$('refresh').onclick=handle(loadTasks);
async function openTask(id,force=false){if(dirty&&!force&&!confirm('Отменить несохранённые правки?'))return;clearTimeout(poll);const changed=current?.id!==id;current=await api('/api/tasks/'+id);if(changed){showReviewTab('findings');$('decision-filter').value='all';$('logs').replaceChildren();$('count-logs').textContent='…';$('supplier-status').textContent='ИНН · ожидает проверки';}taskDocs={};for(const key of ['contract_id','template_id','policy_id','specification_id','supplier_id'])if(current.request[key]){const d=await api('/api/documents/'+current.request[key]);taskDocs[d.id]=d;}dirty=false;renderTask();await loadLogs();if(['queued','running'].includes(current.status))schedulePoll(id);return true;}
function schedulePoll(id){
 poll=setTimeout(async()=>{
  try {await openTask(id,true);}
  catch {
   if(current?.id===id){
    $('analysis-progress').textContent='Не удалось обновить статус. Повторяем запрос…';
    schedulePoll(id);
   }
  }
 },2500);
}
const tones={'нарушение':'red','расхождение':'red','на согласование':'amber','нужны данные':'blue',
 'не проверено':'blue','недостаточно данных':'blue','соответствует':'green','допустимо':'green'};
const reviewTabs=['findings','rules','logs'];
function showReviewTab(key){
 for(const tab of reviewTabs){
  const active=tab===key;
  $('tab-'+tab).setAttribute('aria-selected',String(active));
  $('tab-'+tab).tabIndex=active?0:-1;
  $('panel-'+tab).hidden=!active;
 }
}
for(const key of reviewTabs){
 const tab=$('tab-'+key);
 tab.onclick=()=>showReviewTab(key);
 tab.onkeydown=e=>{
  const index=reviewTabs.indexOf(key);
  const target={ArrowLeft:reviewTabs[(index+2)%3],ArrowRight:reviewTabs[(index+1)%3],Home:'findings',End:'logs'}[e.key];
  if(!target)return;
  e.preventDefault();showReviewTab(target);$('tab-'+target).focus();
 };
}
function reviewMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
function jumpToFinding(id){
 showReviewTab('findings');
 const card=[...$('findings').children].find(item=>item.dataset.finding===id);
 if(!card)return;
 if(card.hidden){$('decision-filter').value='all';updateDecisionBar();}
 card.focus({preventScroll:true});
 card.scrollIntoView({block:'center',behavior:reviewMotion()});
}
function renderReviewOverview(findings){
 const rules=current.result?.rule_checks||[];
 $('count-findings').textContent=findings.length;
 $('count-rules').textContent=rules.length;
 const compliant=rules.filter(r=>r.status==='соответствует');
 const counts=[['нарушение','Нарушения'],['на согласование','На согласование'],['нужны данные','Нужны данные']];
 const kpis=counts.map(([category,label])=>{
  const chip=el('span',findings.filter(f=>f.category===category).length+' · '+label,'review-chip');
  chip.dataset.tone=tones[category];return chip;
 });
 const coverage=el('span',compliant.length+'/'+rules.length+' · Правила соблюдены','review-chip');
 coverage.dataset.tone='green';
 $('review-kpis').replaceChildren(...kpis,coverage);
 const selected=$('contracttext').querySelector('.selected')?.id;
 const priority=['нарушение','на согласование','нужны данные','допустимо'];
 const annotated=new Map();
 for(const finding of findings){
  const id=finding.contract.clause_id;
  const previous=annotated.get(id);
  if(!previous||priority.indexOf(finding.category)<priority.indexOf(previous.category))annotated.set(id,finding);
 }
 const byEvidence=new Set(compliant.map(r=>r.evidence?.clause_id));
 $('contracttext').replaceChildren(...taskDocs[current.request.contract_id].clauses.map(clause=>{
  const finding=annotated.get(clause.id);
  const status=finding?.category||(byEvidence.has(clause.id)?'соответствует':'');
  const row=el('div',undefined,'clause');
  row.id='clause-'+clause.id;
  row.classList.toggle('selected',row.id===selected);
  if(status)row.dataset.tone=tones[status];
  const label=paragraphName(clause.text)+(clause.page?' · стр. '+clause.page:'');
  const head=el(finding?'button':'b',label,finding?'clause-jump':undefined);
  if(status)head.append(el('span',status,'review-chip'));
  if(finding){head.onclick=()=>jumpToFinding(finding.id);row.onclick=e=>{if(!e.target.closest('button')&&!getSelection().toString())jumpToFinding(finding.id);};}
  row.append(head,el('span',clause.text));return row;
 }));
}
function renderRules(rules){
 const table=el('table');
 const header=table.createTHead().insertRow();
 for(const title of ['Статус','Требование Положения','Пункт договора','Вывод проверки']){
  const th=el('th',title);th.scope='col';header.append(th);
 }
 const body=table.createTBody();
 for(const rule of rules){
  const row=body.insertRow();
  const badge=el('span',rule.status,'review-chip');badge.dataset.tone=tones[rule.status];
  row.insertCell().append(badge);
  row.insertCell().textContent=rule.requirement;
  const source=row.insertCell();
  if(rule.evidence){const link=el('button',refName(rule.evidence)+' ↗','source-link');link.onclick=()=>highlight(rule.evidence.clause_id);source.append(link);}
  else source.textContent='—';
  row.insertCell().textContent=rule.explanation||'—';
 }
 $('rule-checks').replaceChildren(rules.length?table:el('p','В этой проверке нет матрицы правил.'));
}
function showSource(documentInfo,ref,trigger){
 const dialog=el('dialog',undefined,'source-view');
 dialog.setAttribute('aria-label',documentInfo.name);
 const close=el('button','Закрыть','quiet');close.onclick=()=>dialog.close();
 dialog.append(close,el('h3',documentInfo.name));
 let chosen;
 for(const p of documentInfo.clauses){
  const line=el('p',p.text);dialog.append(line);
  if(p.id===ref.clause_id){line.className='selected';chosen=line;}
 }
 dialog.onclose=()=>{dialog.remove();trigger.focus();};
 document.body.append(dialog);dialog.showModal();chosen?.scrollIntoView({block:'center'});
}
function renderTask(){
 $('review').classList.remove('hidden');$('reviewtitle').textContent=current.request.title;$('reviewbadge').textContent=current.request.mode==='demo'?'Правила':current.request.mode==='gigachat'?(current.request.model||'GigaChat'):'АРХИВ / CHATGPT';
 $('review-filename').textContent=taskDocs[current.request.contract_id].name;
 const waiting=current.status==='queued'||current.status==='running';
 const message=current.status==='queued'?'Проверка в очереди':
  current.request.mode==='gigachat'?'GigaChat анализирует договор. Это может занять некоторое время.':'Сверяем договор с правилами…';
 const indicator=$('analysis-progress');
 const text=waiting?message:'';
 if(indicator.textContent!==text)indicator.textContent=text;
 $('progress').textContent=statusNames[current.status]+' / шагов: '+current.steps+' / токенов: '+current.tokens+' / версия '+current.revision;
 $('manual').hidden=!(current.status==='interrupted' && current.result && current.request.mode==='gigachat');
 $('reviewerror').textContent=current.error||'';$('resume').hidden=current.status!=='interrupted';
 const result=current.result;
 $('summary').textContent=result?.summary||'Здесь появится результат после завершения проверки.';
 $('limitations').replaceChildren(...(result?.limitations||[]).map(text=>el('p',text,'limitation')));
 $('limits-title').textContent='Ограничения проверки ('+(result?.limitations?.length||0)+')';
 renderRules(result?.rule_checks||[]);
 $('findings').replaceChildren();for(const f of result?.findings||[])renderFinding(f);
 $('lawyer_note').value=current.lawyer_note||'';for(const id of ['save','approve','addfinding'])$(id).disabled=current.status!=='completed';
 updateDecisionBar();approvalUI();
}
function markDirty(){updateDecisionBar();dirty=true;current.approved=false;approvalUI();}
function approvalUI(){for(const [id,format] of [['docx','docx'],['json','json']]){const a=$(id);a.classList.toggle('disabled',!current.approved);if(current.approved)a.href='/api/tasks/'+current.id+'/export/'+format;else a.removeAttribute('href');}$('send').disabled=!current.approved;$('approvalstatus').textContent=current.approved?'✅ Версия утверждена':'🔒 Экспорт и отправка заблокированы до утверждения юристом'+(dirty?' · Есть несохранённые правки':'');}
function highlight(id){document.querySelectorAll('.clause').forEach(p=>p.classList.toggle('selected',p.id==='clause-'+id));const n=$('clause-'+id);if(n){n.tabIndex=-1;n.focus({preventScroll:true});n.scrollIntoView({block:'center',behavior:reviewMotion()});}}
function editField(box,label,value,update,multiline=false){const wrap=el('label',label);const input=el(multiline?'textarea':'input');input.value=value;if(multiline)input.rows=3;input.oninput=()=>{update(input.value);markDirty();};wrap.append(input);box.append(wrap);return input;}
function paragraphName(text){const n=(text||'').match(/^\s*(?:(?:§|п(?:ункт)?\.?)\s*)?(\d+(?:\.\d+)*)(?:[.)]|\s+(?=\S))/i);return n?'§ '+n[1]:'Фрагмент';}
function refName(ref){const clause=taskDocs[ref.document_id]?.clauses.find(p=>p.id===ref.clause_id);return [paragraphName(clause?.text),clause?.page && 'стр. '+clause.page,clause?.location].filter(Boolean).join(' · ');}
function renderFinding(f){
 const box=el('article',undefined,'finding');
 box.dataset.finding=f.id;
 box.tabIndex=-1;
 const tag=el('span',f.category,'review-chip');
 tag.dataset.tone=tones[f.category];
 const focus=el('button','Перейти к '+refName(f.contract)+' ↗','source-link');
 focus.onclick=()=>highlight(f.contract.clause_id);
 const bar=el('div',undefined,'finding-top');
 bar.append(tag,focus);
 const heading=el('h4',f.title.replace(/: отклонение$/i,''));
 box.append(bar,heading);
 const compare=el('div',undefined,'comparison');
 const contractQuote=el('div');
 contractQuote.append(el('small','В проекте договора'),el('blockquote',f.contract.quote));
 const norms=el('div');
 norms.append(el('small','Норма Положения / Шаблона'));
 for(const ref of f.evidence){
  const d=taskDocs[ref.document_id];
  norms.append(el('blockquote',ref.quote));
  const source=el('button',(d?.name||'Основание')+' · '+refName(ref),'source-link');
  if(d){source.onclick=()=>showSource(d,ref,source);norms.append(source);}
 }
 if(!f.evidence.length)norms.append(el('p','Пункт основания не указан'));
 compare.append(contractQuote,norms);
 const explain=el('p',f.explanation,'explain');
 const suggestion=el('div',undefined,'review-suggestion');
 const wording=el('p',f.suggestion);
 suggestion.append(el('strong','Предлагаемая формулировка'),wording);
 suggestion.hidden=!f.suggestion;
 box.append(compare,explain,suggestion);
 const decisions=el('div',undefined,'finding-decisions');
 for(const [value,label] of [['accepted','✓ Включить в протокол'],['rejected','✕ Отклонить']]){
  const button=el('button',label,'quiet');
  button.dataset.decisionChoice=value;
  button.disabled=current.status!=='completed';
  button.onclick=()=>{f.decision=f.decision===value?'pending':value;markDirty();};
  decisions.append(button);
 }
 box.append(decisions);
 const edit=el('details');edit.className='editing';edit.append(el('summary','Редактировать замечание'));box.append(edit);
 editField(edit,'Замечание',f.title,v=>{f.title=v;heading.textContent=v;});
 const cs=el('select');cs.setAttribute('aria-label','Пункт договора');const contract=taskDocs[current.request.contract_id];setOptions(cs,contract.clauses.map(p=>({id:p.id,name:paragraphName(p.text)+' — '+p.text.slice(0,85)})));cs.value=f.contract.clause_id;cs.onchange=()=>{const p=contract.clauses.find(c=>c.id===cs.value);f.contract={document_id:contract.id,clause_id:p.id,quote:p.text};markDirty();renderFindings();};edit.append(cs);
 const cat=el('select');cat.setAttribute('aria-label','Категория замечания');for(const c of ['нарушение','на согласование','допустимо','нужны данные'])cat.append(el('option',c));cat.value=f.category;cat.onchange=()=>{f.category=cat.value;tag.textContent=f.category;tag.dataset.tone=tones[f.category];markDirty();};edit.append(cat);
 editField(edit,'Объяснение',f.explanation,v=>{f.explanation=v;explain.textContent=v;},true);editField(edit,'Предложение для протокола',f.suggestion,v=>{f.suggestion=v;wording.textContent=v;suggestion.hidden=!v;},true);
 const ds=el('select'),ps=el('select');ds.setAttribute('aria-label','Документ-основание');ps.setAttribute('aria-label','Пункт основания');setOptions(ds,Object.values(taskDocs).filter(d=>d.role!=='contract'));function clauses(){setOptions(ps,(taskDocs[ds.value]?.clauses||[]).map(p=>({id:p.id,name:paragraphName(p.text)+' — '+p.text.slice(0,100)})));}ds.onchange=clauses;clauses();const add=el('button','Заменить основания','quiet');add.onclick=()=>{const d=taskDocs[ds.value],p=d?.clauses.find(p=>p.id===ps.value);if(!p)return;f.evidence=[{document_id:d.id,clause_id:p.id,quote:p.text}];markDirty();renderFindings();};edit.append(ds,ps,add);$('findings').append(box);
}
function renderFindings(){$('findings').replaceChildren();current.result.findings.forEach(renderFinding);updateDecisionBar();}
$('lawyer_note').oninput=()=>{if(current)markDirty();};
$('addfinding').onclick=()=>{const p=taskDocs[current.request.contract_id].clauses[0];current.result.findings.push({id:crypto.randomUUID(),title:'Замечание юриста',category:'нужны данные',explanation:'Требуется дополнительная проверка.',contract:{document_id:current.request.contract_id,clause_id:p.id,quote:p.text},evidence:[],suggestion:'',decision:'pending'});markDirty();renderFindings();};
$('save').onclick=handle(async()=>{await post('/api/tasks/'+current.id+'/decisions',{revision:current.revision,findings:current.result.findings,lawyer_note:$('lawyer_note').value});dirty=false;await openTask(current.id,true);notify('Правки сохранены. Предыдущее одобрение сброшено.');});
$('approve').onclick=handle(async()=>{if(dirty)throw new Error('Сначала сохраните правки');if(!confirm('Подтверждаете точную версию протокола и ознакомление с ограничениями проверки?'))return;await post('/api/tasks/'+current.id+'/approve',{revision:current.revision});await openTask(current.id,true);notify('Версия протокола подтверждена.');});
$('send').onclick=handle(async()=>{const result=await post('/api/tasks/'+current.id+'/send-test',{revision:current.revision});notify('Сохранено в локальный тестовый ящик. Реальное письмо не отправлялось. Номер: '+result.id.slice(0,12));});
$('resume').onclick=handle(async()=>{await post('/api/tasks/'+current.id+'/resume');await openTask(current.id,true);});
async function loadLogs(){
 const id=current.id;
 let logs;
 try{logs=await api('/api/tasks/'+id+'/logs');}
 catch{if(current?.id===id){$('logs').replaceChildren(el('p','Журнал шагов недоступен'));$('count-logs').textContent='—';$('supplier-status').textContent='ИНН · статус недоступен';}return;}
 if(current?.id!==id)return;
 $('count-logs').textContent=logs.length;
 $('logs').replaceChildren();
 if(!logs.length)$('logs').append(el('p','Шаги пока не записаны.'));
 const supplier=logs.findLast(step=>step.tool==='lookup_supplier'&&step.result?.status)?.result;
 const supplierLabels={found:'найден в справочнике',missing:'запись не найдена',invalid:'не прошёл проверку',unresolved:'требуется уточнение'};
 $('supplier-status').textContent='ИНН '+(supplier?.inn||'')+' · '+(supplierLabels[supplier?.status]||'нет результата проверки');
 for(const step of logs){
  const card=el('details',undefined,'review-log');
  const header=el('summary');
  header.append(el('code',step.tool),el('span',(step.elapsed_ms??0)+' мс · '+(step.tokens??0)+' токенов'));
  card.append(header,el('h4','Аргументы'),el('pre',JSON.stringify(step.arguments,null,2)),
   el('h4','Результат'),el('pre',JSON.stringify(step.result,null,2)));
  $('logs').append(card);
 }
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
bootstrap().then(loadDocuments).then(syncMode).catch(e=>notify(e.message));

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
  for(const button of card.querySelectorAll('[data-decision-choice]'))
   button.setAttribute('aria-pressed',String(button.dataset.decisionChoice===finding.decision));
  card.hidden = filter !== 'all' && finding.decision !== filter;
  if (!card.hidden) visible++;
 }
 renderReviewOverview(findings);
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
