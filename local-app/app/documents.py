import hashlib
import io
import json
import re
import uuid
import zipfile
import os
import threading
from functools import lru_cache
from pathlib import Path
from decimal import Decimal, InvalidOperation
from docx import Document
import pdfplumber
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

ROLES={'contract','template','policy','specification','suppliers'}
SEMANTIC_MODEL=os.environ.get('CONTRACT_SEMANTIC_MODEL','')
EMBED_LOCK=threading.Lock()

@lru_cache(maxsize=1)
def semantic_model():
    try:from sentence_transformers import SentenceTransformer
    except ImportError:raise ValueError('Установите requirements-semantic.txt для нейросетевого поиска')
    return SentenceTransformer(SEMANTIC_MODEL,device='cpu',trust_remote_code=False)

@lru_cache(maxsize=12)
def semantic_index(texts):
    with EMBED_LOCK:return semantic_model().encode(list(texts),normalize_embeddings=True)

def parse_document(name, data, role):
    if role not in ROLES: raise ValueError('Неизвестный тип документа')
    if len(data)>8*1024*1024: raise ValueError('Файл больше 8 МБ')
    suffix=Path(name).suffix.lower()
    blocks=[]
    if suffix in {'.txt','.md','.json','.csv'}:
        text=data.decode('utf-8-sig')
        blocks=[(p.strip(),None) for p in text.splitlines() if p.strip()]
    elif suffix=='.docx':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist())>24*1024*1024: raise ValueError('Слишком большой распакованный DOCX')
        d=Document(io.BytesIO(data))
        for block in d.iter_inner_content():
            if hasattr(block,'rows'):
                blocks.extend((' | '.join(c.text for c in row.cells),None) for row in block.rows)
            elif block.text.strip(): blocks.append((block.text.strip(),None))
    elif suffix=='.pdf':
        with pdfplumber.open(io.BytesIO(data)) as p:
            if len(p.pages)>40: raise ValueError('Лимит прототипа: 40 страниц PDF')
            for i,page in enumerate(p.pages,1):
                text=page.extract_text() or ''
                if not text.strip(): raise ValueError(f'Страница {i} без текстового слоя. Нужен OCR или текстовый документ.')
                blocks.extend((line.strip(),i) for line in text.splitlines() if line.strip())
    else: raise ValueError('Поддерживаются DOCX, текстовый PDF, TXT, MD, CSV и JSON')
    if not blocks or sum(len(t) for t,_ in blocks)>120000 or len(blocks)>400:
        raise ValueError('Документ пустой или превышает лимит 120 000 символов / 400 фрагментов')
    id=uuid.uuid4().hex
    clauses=[{'id':f'p{i}','text':text,'page':page} for i,(text,page) in enumerate(blocks,1)]
    return {'id':id,'name':Path(name).name,'role':role,'sha256':hashlib.sha256(data).hexdigest(),'clauses':clauses,'text':'\n'.join(t for t,_ in blocks),'format':suffix}

def normalized(s):
    return re.sub(r'\s+',' ',s).strip()

def verify_citation(c,docs,allowed_roles=None):
    d=docs.get(c.document_id)
    if not d or (allowed_roles and d['role'] not in allowed_roles): return False
    p=next((p for p in d['clauses'] if p['id']==c.clause_id),None)
    return bool(p and normalized(c.quote) in normalized(p['text']))

def search(document,query,k=4):
    if not isinstance(query,str) or not query.strip() or len(query)>1000: raise ValueError('Нужен поисковый запрос до 1000 символов')
    texts=[p['text'] for p in document['clauses']]
    # Character TF-IDF is an explicit offline baseline, not a neural semantic model.
    v=TfidfVectorizer(analyzer='char_wb',ngram_range=(3,5),max_features=25000)
    x=v.fit_transform(texts+[query]);scores=cosine_similarity(x[-1],x[:-1]).ravel()
    retrieval='local_char_tfidf'
    if SEMANTIC_MODEL:
        embedded=semantic_index(tuple(texts))
        with EMBED_LOCK:q=semantic_model().encode([query],normalize_embeddings=True)
        dense=cosine_similarity(q,embedded).ravel()
        scores=0.45*scores+0.55*dense
        retrieval='local_hybrid_semantic_tfidf'
    ids=sorted(range(len(texts)),key=lambda i:float(scores[i]),reverse=True)[:min(k,8)]
    return [{'document_id':document['id'],**document['clauses'][i],'score':round(float(scores[i]),4),'retrieval':retrieval} for i in ids if scores[i]>0.01]

def citation(d,p):
    return {'document_id':d['id'],'clause_id':p['id'],'quote':p['text']}

FIELDS={
 'delivery':('Срок поставки',r'срок\s+поставки[^\d\n]{0,45}(\d+)'),
 'payment':('Срок оплаты',r'срок\s+оплаты[^\d\n]{0,45}(\d+)'),
 'advance':('Предоплата',r'(?:предоплата|аванс)[^\d\n]{0,35}(\d+(?:[.,]\d+)?)\s*%'),
 'warranty':('Гарантия',r'гаранти[яй][^\d\n]{0,35}(\d+)\s*месяц'),
 'total':('Сумма договора',r'(?:общая\s+стоимость|сумма\s+договора|итого)[^\d\n]{0,25}([\d ]+(?:[.,]\d{1,2})?)\s*(?:руб|₽)'),
}

def values(d,pattern):
    out=[]
    for p in d['clauses']:
        for m in re.finditer(pattern,p['text'],re.I):
            try: out.append({'value':str(Decimal(m.group(1).replace(' ','').replace(',','.'))),'source':citation(d,p)})
            except InvalidOperation: pass
    return out

def numeric_checks(contract,policy,spec=None):
    checks=[]
    for key,(label,pattern) in FIELDS.items():
        observed=values(contract,pattern)
        limits=values(spec if key=='total' and spec else policy,pattern)
        if len(observed)!=1 or len(limits)!=1:
            checks.append({'field':key,'label':label,'status':'unresolved','reason':'Нет однозначной пары значений','observed':observed,'limits':limits});continue
        a=Decimal(observed[0]['value']);b=Decimal(limits[0]['value'])
        quote=limits[0]['source']['quote'].lower()
        if key in {'delivery','payment'}:
            def unit(s):
                s=s.lower()
                return 'work' if 'рабоч' in s else 'calendar' if 'календар' in s else None
            if unit(observed[0]['source']['quote'])!=unit(quote) or unit(quote) is None:
                checks.append({'field':key,'label':label,'status':'unresolved','reason':'Не совпадают или не указаны единицы времени','observed':observed,'limits':limits});continue
        if key=='total': bad=a!=b
        elif key=='warranty' and ('не менее' in quote or 'минимум' in quote): bad=a<b
        elif 'не более' in quote or 'не дольше' in quote or 'максимум' in quote: bad=a>b
        else:
            checks.append({'field':key,'label':label,'status':'unresolved','reason':'Нет однозначного оператора ограничения','observed':observed,'limits':limits});continue
        category='на согласование' if bad and 'согласован' in quote else 'нарушение'
        checks.append({'field':key,'label':label,'status':'mismatch' if bad else 'ok','category':category,'observed':observed,'limits':limits})
    return checks

def inn_valid(s):
    if not s.isdigit() or len(s) not in (10,12): return False
    def checksum(weights): return str(sum(int(s[i])*w for i,w in enumerate(weights))%11%10)
    if len(s)==10: return checksum([2,4,10,3,5,9,4,6,8])==s[9]
    return checksum([7,2,4,10,3,5,9,4,6,8])==s[10] and checksum([3,7,2,4,10,3,5,9,4,6,8])==s[11]

def lookup_supplier(contract,suppliers=None):
    found=[{'value':m.group(1),'source':citation(contract,p)} for p in contract['clauses'] for m in re.finditer(r'ИНН\s*[:№]?\s*(\d{10,12})(?!\d)',p['text'],re.I)]
    if len(found)!=1:return {'status':'unresolved','reason':'ИНН отсутствует или неоднозначен'}
    inn=found[0]['value']; source=found[0]['source']
    if not inn_valid(inn):return {'status':'invalid','inn':inn,'source':source,'reason':'Не прошла контрольная сумма ИНН'}
    if not suppliers:return {'status':'unresolved','inn':inn,'source':source,'reason':'Справочник не загружен'}
    match=[p for p in suppliers['clauses'] if re.search(r'(?<!\d)'+inn+r'(?!\d)',p['text'])]
    if not match:return {'status':'missing','inn':inn,'source':source,'reason':'Поставщик не найден в локальном справочнике'}
    return {'status':'found','inn':inn,'source':source,'records':[citation(suppliers,p) for p in match]}

def validate_result(result,docs,contract):
    errors=[];seen=set()
    for f in result.findings:
        if f.id in seen: errors.append(f'Повторный id {f.id}')
        seen.add(f.id)
        if f.contract.document_id!=contract['id'] or not verify_citation(f.contract,docs,{'contract'}):errors.append(f'{f.id}: нет точной цитаты договора')
        if f.category in {'нарушение','на согласование'} and not f.evidence:errors.append(f'{f.id}: нет основания')
        for e in f.evidence:
            if not verify_citation(e,docs,{'policy','template','specification','suppliers'}):errors.append(f'{f.id}: неверная ссылка или цитата основания')
    ids={p['id'] for p in contract['clauses']}
    reviewed=set(result.reviewed_clause_ids)
    if not reviewed<=ids:errors.append('Неизвестные номера проверенных пунктов')
    missing=sorted(ids-reviewed)
    return {'valid':not errors,'errors':errors,'unreviewed_clause_ids':missing}
