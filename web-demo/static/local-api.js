/* Hosted educational edition. Documents stay in this browser, never in shared site storage. */
const enc=new TextEncoder(),dec=new TextDecoder();
let dbPromise;
function database(){return dbPromise??=new Promise((resolve,reject)=>{const q=indexedDB.open('punkt-hosted-v1',1);q.onupgradeneeded=()=>{q.result.createObjectStore('documents',{keyPath:'id'});q.result.createObjectStore('tasks',{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(Error('Не удалось открыть хранилище браузера'));});}
async function dbRequest(store,action,value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,action==='put'?'readwrite':'readonly');const req=tx.objectStore(store)[action](value);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('Не удалось сохранить данные. Проверьте место в браузере.'));tx.onabort=tx.onerror;});}
const put=(store,value)=>dbRequest(store,'put',value),get=(store,id)=>dbRequest(store,'get',id),all=store=>dbRequest(store,'getAll');
const uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const fail=message=>{throw Error(message);};
const norm=s=>String(s).replace(/\s+/g,' ').trim();
async function digest(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(JSON.stringify(data)))),n=>n.toString(16).padStart(2,'0')).join('');}
const approvalData=t=>({request:t.request,result:t.result,lawyer_note:t.lawyer_note,revision:t.revision});
async function approved(t){return Boolean(t.approval&&t.approval.revision===t.revision&&t.approval.digest===await digest(approvalData(t)));}
function checkRevision(t,b){if(t.revision!==b.revision)fail('Версия изменилась. Откройте проверку заново.');}
function checkedText(v,min,max,label){if(typeof v!=='string'||v.length<min||v.length>max)fail('Некорректное поле: '+label);return v;}
function xmlText(s){return s.replace(/<[^>]+>/g,'').replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
async function docxText(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0)fail('Повреждённый DOCX: ZIP-каталог не найден');
 let p=view.getUint32(end+16,true),total=0,xml;
 const count=view.getUint16(end+10,true);if(count>3000)fail('Слишком сложный DOCX');
 for(let i=0;i<count;i++){
  if(view.getUint32(p,true)!==0x02014b50)fail('Повреждённый каталог DOCX');
  const method=view.getUint16(p+10,true),packed=view.getUint32(p+20,true),size=view.getUint32(p+24,true),n=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),offset=view.getUint32(p+42,true),name=dec.decode(bytes.slice(p+46,p+46+n));
  total+=size;if(total>24*1024*1024)fail('Слишком большой распакованный DOCX');
  if(name==='word/document.xml'){
   const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true),data=bytes.slice(start,start+packed);
   if(method===0)xml=dec.decode(data);else if(method===8){const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const reader=stream.getReader();let chunks=[],length=0;while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>24*1024*1024){await reader.cancel();fail('DOCX превышает лимит');}chunks.push(value);}xml=await new Blob(chunks).text();}else fail('Неподдерживаемое сжатие DOCX');
  }
  p+=46+n+extra+comment;
 }
 if(!xml)fail('Текст договора не найден в DOCX');
 return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlText(x[1])).join('')).filter(s=>s.trim()).join('\n');
}
async function parseFile(file,role){
 if(!['contract','template','policy','specification','suppliers'].includes(role))fail('Неизвестный тип документа');
 if(!file||file.size>8*1024*1024)fail('Выберите файл до 8 МБ');
 const bytes=new Uint8Array(await file.arrayBuffer()),suffix=file.name.split('.').pop().toLowerCase();
 let text;if(suffix==='docx')text=await docxText(bytes);else if(['txt','md','csv','json'].includes(suffix))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);else fail('В веб-версии поддерживаются DOCX, TXT, MD, CSV и JSON. PDF доступен в локальном приложении.');
 const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(!lines.length||text.length>120000||lines.length>400)fail('Лимит документа: 120 000 символов и 400 фрагментов');
 return {id:uid(),name:file.name,role,sha256:await digest(Array.from(bytes)),format:'.'+suffix,text:lines.join('\n'),clauses:lines.map((text,i)=>({id:'p'+(i+1),text,page:null}))};
}
const citation=(d,p)=>({document_id:d.id,clause_id:p.id,quote:p.text});
const fields=[['delivery','Срок поставки',/срок\s+поставки[^\d\n]{0,45}(\d+)/i],['payment','Срок оплаты',/срок\s+оплаты[^\d\n]{0,45}(\d+)/i],['advance','Предоплата',/(?:предоплата|аванс)[^\d\n]{0,35}(\d+(?:[.,]\d+)?)\s*%/i],['warranty','Гарантия',/гаранти[яй][^\d\n]{0,35}(\d+)\s*месяц/i],['total','Сумма договора',/(?:общая\s+стоимость|сумма\s+договора|итого)[^\d\n]{0,25}([\d ]+(?:[.,]\d{1,2})?)\s*(?:руб|₽)/i]];
const decimal=s=>{const [a,b='']=s.replace(/ /g,'').replace(',','.').split('.');return BigInt(a)*100n+BigInt((b+'00').slice(0,2));};
function values(d,regex){return (d?.clauses||[]).flatMap(p=>{const m=p.text.match(regex);return m?[{value:m[1].replace(/ /g,'').replace(',','.'),source:citation(d,p)}]:[];});}
const unit=s=>/рабоч/i.test(s)?'work':/календар/i.test(s)?'calendar':null;
function numeric(contract,policy,spec){return fields.map(([field,label,regex])=>{const observed=values(contract,regex),limits=values(field==='total'&&spec?spec:policy,regex),base={field,label,observed,limits};if(observed.length!==1||limits.length!==1)return {...base,status:'unresolved',reason:'Нет однозначной пары значений'};const a=decimal(observed[0].value),b=decimal(limits[0].value),quote=limits[0].source.quote;if(['payment','delivery'].includes(field)&&(!unit(quote)||unit(quote)!==unit(observed[0].source.quote)))return {...base,status:'unresolved',reason:'Не совпадают или не указаны единицы времени'};let bad;if(field==='total')bad=a!==b;else if(field==='warranty'&&/не менее|минимум/i.test(quote))bad=a<b;else if(/не более|не дольше|максимум/i.test(quote))bad=a>b;else return {...base,status:'unresolved',reason:'Нет однозначного оператора ограничения'};return {...base,status:bad?'mismatch':'ok',category:bad&&/согласован/i.test(quote)?'на согласование':'нарушение'};});}
function innValid(s){const sum=w=>w.reduce((n,v,i)=>n+Number(s[i])*v,0)%11%10;if(s.length===10)return sum([2,4,10,3,5,9,4,6,8])===+s[9];return s.length===12&&sum([7,2,4,10,3,5,9,4,6,8])===+s[10]&&sum([3,7,2,4,10,3,5,9,4,6,8])===+s[11];}
function supplier(contract,dir){const found=values(contract,/ИНН\s*[:№]?\s*(\d{10,12})(?!\d)/i);if(found.length!==1)return {status:'unresolved',reason:'ИНН отсутствует или неоднозначен'};const inn=found[0].value,source=found[0].source;if(!innValid(inn))return {status:'invalid',source,reason:'Не прошла контрольная сумма ИНН'};if(!dir)return {status:'unresolved',reason:'Справочник не загружен'};if(!dir.clauses.some(p=>new RegExp('(?<!\\d)'+inn+'(?!\\d)').test(p.text)))return {status:'missing',source,reason:'Поставщик не найден в справочнике'};return {status:'found',inn};}
async function loadTaskDocuments(t){const docs={};for(const key of ['contract_id','template_id','policy_id','specification_id','supplier_id'])if(t.request[key]){const d=await get('documents',t.request[key]);if(!d)fail('Документ не найден');docs[d.id]=d;}return docs;}
function validate(findings,docs,contract){if(!Array.isArray(findings)||findings.length>200)fail('Некорректный список замечаний');const ids=new Set();for(const f of findings){checkedText(f.id,1,80,'id');if(ids.has(f.id))fail('Повторяется идентификатор замечания');ids.add(f.id);checkedText(f.title,3,240,'название');checkedText(f.explanation,5,4000,'объяснение');checkedText(f.suggestion,0,3000,'предложение');if(!['нарушение','на согласование','допустимо','нужны данные'].includes(f.category)||!['pending','accepted','rejected'].includes(f.decision))fail('Недопустимая категория или решение');if(!Array.isArray(f.evidence)||f.evidence.length>8)fail('Некорректные основания');if(['нарушение','на согласование'].includes(f.category)&&!f.evidence.length)fail('Для нарушения необходимо основание');if(f.contract?.document_id!==contract.id)fail('Цитата относится к другому договору');for(const c of [f.contract,...f.evidence]){checkedText(c?.quote,3,4000,'цитата');const d=docs[c.document_id],p=d?.clauses.find(p=>p.id===c.clause_id);if(!p||!norm(p.text).includes(norm(c.quote)))fail('Цитата не найдена в документе');}for(const c of f.evidence)if(docs[c.document_id].role==='contract')fail('Основание должно ссылаться на отдельный документ');}}
async function display(t){return {...t,approved:await approved(t)};}
const locks=new Map();async function locked(id,fn){const prior=locks.get(id)||Promise.resolve();const current=prior.catch(()=>{}).then(fn);locks.set(id,current);try{return await current;}finally{if(locks.get(id)===current)locks.delete(id);}}
async function localApi(url,options={}){
 const method=options.method||'GET',b=typeof options.body==='string'?JSON.parse(options.body):options.body;
 if(url==='/api/bootstrap')return {csrf:'browser-local',oauth:{connected:false},retrieval:'История сохраняется в этом браузере. В режиме GigaChat выбранные документы передаются Сберу.'};
 if(url==='/api/models'||url.startsWith('/api/oauth'))fail('Веб-версия работает без LLM. OAuth и выбор модели доступны в локальном приложении.');
 if(url==='/api/documents'){if(method==='GET')return all('documents');const d=await parseFile(b.get('file'),b.get('role'));await put('documents',d);return d;}
 if(url.startsWith('/api/documents/'))return await get('documents',url.split('/').pop())||fail('Документ не найден');
 if (url === '/api/examples') {
  const samples = await fetch('/static/examples.json').then(response => response.json());
  const documents = await all('documents');
  const selected = {};
  for (const sample of samples) {
   const parsed = await parseFile(new File([sample.text], sample.name), sample.role);
   const prior = documents.find(doc => doc.role === parsed.role && doc.sha256 === parsed.sha256);
   if (!prior) await put('documents', parsed);
   selected[parsed.role] = (prior || parsed).id;
  }
  return {ok: true, selected};
 }
 if(url==='/api/tasks'){
  if(method==='GET')return (await all('tasks')).sort((a,b)=>b.created.localeCompare(a.created));
  if(!['gigachat','demo'].includes(b.mode))fail('Неизвестный режим');checkedText(b.title,1,160,'название проверки');
  for(const [key,role] of [['contract_id','contract'],['template_id','template'],['policy_id','policy'],['specification_id','specification'],['supplier_id','suppliers']]){if(!b[key]){if(['contract','template','policy'].includes(role))fail('Выберите обязательные документы');continue;}const d=await get('documents',b[key]);if(!d||d.role!==role)fail('Некорректный тип документа');}
  const t={id:uid(),request:b,created:now(),status:'completed',steps:0,tokens:0,revision:1,approval:null,lawyer_note:'',logs:[]};const docs=await loadTaskDocuments(t),contract=docs[b.contract_id],checks=numeric(contract,docs[b.policy_id],docs[b.specification_id]),s=supplier(contract,docs[b.supplier_id]);
  const findings=checks.filter(c=>c.status==='mismatch').map(c=>({id:c.field,title:c.label+': отклонение',category:c.category,explanation:`В договоре ${c.observed[0].value}, в основании ${c.limits[0].value}. Проверьте условия применения.`,contract:c.observed[0].source,evidence:[c.limits[0].source],suggestion:'Уточнить условие по приведённому основанию.',decision:'pending'}));
  if(['missing','invalid'].includes(s.status))findings.push({id:'supplier',title:'Проверка поставщика',category:'нужны данные',explanation:s.reason,contract:s.source,evidence:[],suggestion:'Проверить реквизиты вручную.',decision:'pending'});
  t.result={summary:'Демонстрационный режим: формализованные проверки без вызова LLM.',findings,reviewed_clause_ids:[],limitations:['Смысловая проверка, поиск пропущенных условий, неустойки и событий начала срока не выполнены.','Числа распознаются только для явно подписанных полей. Таблицы DOCX читаются как текст; автоматический расчёт строк спецификации не выполняется.',...checks.filter(c=>c.status==='unresolved').map(c=>c.label+': '+c.reason),...(s.status==='unresolved'?['Поставщик: '+s.reason]:[])]};
  const initialFindings = structuredClone(findings);
  if (b.mode === 'gigachat') {
   try {
   const response = await fetch('/api/gigachat/review', {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({documents:Object.values(docs).map(({id,role,clauses})=>({id,role,clauses:clauses.map(({id,text})=>({id,text}))}))})});
   const data = await response.json();
   if (!response.ok) fail(data.detail || 'Ошибка сервиса GigaChat');
   const reference = (doc, id) => {
    const clause=doc?.clauses.find(c=>c.id===id);
    if(!clause)fail('Модель сослалась на отсутствующий пункт. Требуется ручная проверка.');
    return citation(doc,clause);
   };
   for(const f of data.answer.additional) {
    findings.push({id:uid(), title:f.title,category:f.category,explanation:f.explanation,suggestion:f.suggestion,
     decision:'pending',contract:reference(contract,f.clause),evidence:[reference(docs[f.source],f.basis)]});
   }
   t.tokens=data.tokens;t.steps=1;t.result.summary=data.answer.summary;
   t.result.limitations=t.result.limitations.slice(1);
   t.result.limitations.unshift('Смысловые замечания GigaChat и их основания требуют проверки юристом.');
   validate(findings,docs,contract);
   } catch(error) {
    t.result.findings=initialFindings;
    t.result.summary='Сохранены только результаты локальных правил.';
    t.result.limitations.unshift('Заключение GigaChat отсутствует. '+error.message);
   }
  }
  validate(t.result.findings,docs,contract);t.logs=[{at:now(),tool:'check_numbers',result:checks},{at:now(),tool:'lookup_supplier',result:s}];await put('tasks',t);return {id:t.id};
 }
 const m=url.match(/^\/api\/tasks\/([^/]+)(?:\/(.+))?$/);if(!m)fail('Неизвестная операция');const [,id,action]=m;
 return locked(id,async()=>{const t=await get('tasks',id);if(!t)fail('Проверка не найдена');if(!action)return display(t);if(action==='logs')return t.logs;
  if(action==='decisions'){checkRevision(t,b);const docs=await loadTaskDocuments(t);validate(b.findings,docs,docs[t.request.contract_id]);checkedText(b.lawyer_note,0,5000,'комментарий');t.result.findings=b.findings;t.lawyer_note=b.lawyer_note;t.revision++;t.approval=null;delete t.delivery;await put('tasks',t);return display(t);}
  if(action==='approve'){checkRevision(t,b);if(t.result.findings.some(f=>f.decision==='pending'))fail('Примите решение по каждому замечанию');t.approval={revision:t.revision,at:now(),digest:await digest(approvalData(t))};await put('tasks',t);return {ok:true};}
  if(action==='send-test'){checkRevision(t,b);if(!await approved(t))fail('Подтвердите актуальную версию');t.delivery??={id:uid(),at:now()};await put('tasks',t);return t.delivery;}
  fail('Операция недоступна в веб-версии');
 });
}
function escapeXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function zipStored(files){const chunks=[],central=[];let offset=0,count=0;for(const [name,text] of Object.entries(files)){const n=enc.encode(name),data=enc.encode(text),crc=crc32(data),header=new Uint8Array(30+n.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,n.length,true);header.set(n,30);const cent=new Uint8Array(46+n.length),v=new DataView(cent.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,n.length,true);v.setUint32(42,offset,true);cent.set(n,46);chunks.push(header,data);central.push(cent);offset+=header.length+data.length;count++;}const len=central.reduce((n,a)=>n+a.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,count,true);v.setUint16(10,count,true);v.setUint32(12,len,true);v.setUint32(16,offset,true);return new Blob([...chunks,...central,end],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}
async function exportReview(id,format){const t=await get('tasks',id);if(!t||!await approved(t))fail('Сначала подтвердите актуальную версию');if(format==='json')return new Blob([JSON.stringify({title:t.request.title,mode:t.request.mode,result:t.result,lawyer_note:t.lawyer_note,approval:t.approval},null,2)],{type:'application/json'});const docs=await loadTaskDocuments(t),lines=['Протокол разногласий',t.request.title,t.request.mode==='gigachat'?'Режим: запрос GigaChat':'Режим: демонстрационный без LLM',t.result.summary];for(const f of t.result.findings.filter(f=>f.decision==='accepted')){lines.push(f.title,'Категория: '+f.category,'Пункт '+f.contract.clause_id+': '+f.contract.quote,f.explanation,...f.evidence.map(c=>'Основание: '+docs[c.document_id].name+', '+c.clause_id+' — '+c.quote),'Предложение: '+f.suggestion);}lines.push('Ограничения проверки',...t.result.limitations,'Комментарий юриста: '+t.lawyer_note,'Версия '+t.revision+' / '+t.approval.at);const body=lines.map(s=>'<w:p><w:r><w:t xml:space="preserve">'+escapeXml(s)+'</w:t></w:r></w:p>').join('');return zipStored({'[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>'});}
