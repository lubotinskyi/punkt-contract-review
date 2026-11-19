import re
import io
import json
import os
import secrets
import threading
from pathlib import Path
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from docx import Document
from .storage import Store
from .giga import GigaChat
from .documents import parse_document, validate_result
from .documents import SEMANTIC_MODEL
from .models import StartReview, Decisions, ReviewResult, Revision
from .agent import run_review, Toolkit

ROOT=Path(__file__).resolve().parent.parent

def create_app(data_dir=None,oauth_client=None):
    app=FastAPI(title='Пункт — проверка договоров',docs_url=None,redoc_url=None)
    store=Store(data_dir);oauth=GigaChat(store.root,oauth_client)
    csrf=secrets.token_urlsafe(40)
    app.state.store=store;app.state.oauth=oauth;app.state.csrf=csrf

    @app.middleware('http')
    async def local_only(request,call_next):
        host=request.headers.get('host','').split(':')[0]
        if host not in {'127.0.0.1','localhost','testserver'}:return JSONResponse({'detail':'Разрешён только локальный доступ'},400)
        if request.method not in {'GET','HEAD','OPTIONS'}:
            if not secrets.compare_digest(request.headers.get('x-csrf-token',''),csrf):return JSONResponse({'detail':'Обновите страницу: неверный CSRF token'},403)
            origin=request.headers.get('origin')
            if origin and origin not in {f'http://{request.headers.get("host")}'}:return JSONResponse({'detail':'Другой origin не разрешён'},403)
        response=await call_next(request)
        response.headers.update({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
                                 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        return response

    @app.exception_handler(ValueError)
    async def invalid(request,e):return JSONResponse({'detail':str(e)},400)

    @app.get('/')
    def home():return FileResponse(ROOT/'web/index.html')

    app.mount('/static',StaticFiles(directory=ROOT/'web'),name='static')

    @app.get('/api/bootstrap')
    def bootstrap():return {'csrf':csrf,'gigachat':{'configured':oauth.configured()},'retrieval':('Локальный семантический поиск + TF-IDF: '+SEMANTIC_MODEL) if SEMANTIC_MODEL else 'Локальный поиск по символьным TF-IDF векторам (без нейросетевой модели)','version':'1.0.0'}

    @app.get('/api/models')
    def models():return oauth.models()

    @app.get('/api/documents')
    def documents():return [{'id':d['id'],'name':d['name'],'role':d['role'],'sha256':d['sha256'],'count':len(d['clauses'])} for d in store.documents()]

    @app.get('/api/documents/{id}')
    def document(id:str):return store.document(id)

    @app.post('/api/documents')
    async def upload(file:UploadFile=File(...),role:str=Form(...)):
        data=await file.read(8*1024*1024+1)
        try:d=parse_document(file.filename or 'document.txt',data,role)
        except (UnicodeError,KeyError):raise ValueError('Не удалось прочитать файл. Проверьте формат и кодировку UTF-8.')
        return store.put_document(d)

    @app.post('/api/examples')
    def examples():
        manifest=json.loads((ROOT/'examples/manifest.json').read_text(encoding='utf-8'))
        existing = {(d['role'], d['sha256']): d for d in store.documents()}
        selected = {}
        for entry in manifest:
            path = ROOT / 'examples' / entry['file']
            sample = parse_document(path.name, path.read_bytes(), entry['role'])
            document = existing.get((sample['role'], sample['sha256'])) or store.put_document(sample)
            selected[sample['role']] = document['id']
        return {'ok': True, 'selected': selected}

    @app.get('/api/tasks')
    def tasks():return [{k:t[k] for k in ['id','created','request','status','revision','error']} for t in store.tasks()]

    @app.get('/api/tasks/{id}')
    def task(id:str):
        t=store.task(id);t.pop('history',None);t['approved']=store.approved(t);return t

    @app.post('/api/tasks')
    def start(body:StartReview):
        r=body.model_dump()
        for key,role in [('contract_id','contract'),('template_id','template'),('policy_id','policy'),('specification_id','specification'),('supplier_id','suppliers')]:
            if r.get(key) and store.document(r[key])['role']!=role:raise ValueError('Неверная роль документа: '+role)
        if body.mode=='gigachat':
            if body.model not in {m['id'] for m in oauth.models()}:raise ValueError('Выберите доступную модель')
        t=store.create(r)
        threading.Thread(target=run_review,args=(store,oauth,t['id']),daemon=True).start()
        return {'id':t['id']}

    @app.post('/api/tasks/{id}/resume')
    def resume(id:str):
        t=store.task(id)
        if t['request']['mode']=='oauth':raise ValueError('Создайте новую проверку с GigaChat')
        if t['status'] not in {'interrupted','failed'}:raise ValueError('Эту проверку нельзя продолжить')
        if t['steps']>=t['request']['max_steps'] or t['tokens']>=t['request']['max_tokens']:
            raise ValueError('Лимит исчерпан. Создайте новую проверку с большим бюджетом.')
        threading.Thread(target=run_review,args=(store,oauth,id),daemon=True).start();return {'ok':True}

    @app.get('/api/tasks/{id}/logs')
    def logs(id:str):store.task(id);return store.logs(id)

    @app.post('/api/tasks/{id}/manual')
    def manual_review(id: str, body: Revision):
        def release(task, _connection):
            if (task['status'] != 'interrupted' or task['revision'] != body.revision
                    or task['request']['mode'] != 'gigachat' or not task.get('result')):
                raise ValueError('Откройте прерванную проверку с сохранённым результатом')
            task['status'] = 'completed'
            task['result']['summary'] = 'Юрист продолжил проверку по результатам локальных правил.'
            task['result']['limitations'].append('Заключение GigaChat отсутствует. Требуется ручной анализ условий.')
            task['error'] = None
            task['approval'] = None
            task['revision'] += 1
        store.mutate(id, release)
        return {'ok': True}

    @app.post('/api/tasks/{id}/decisions')
    def decisions(id:str,body:Decisions):
        def change(t,c):
            if t['status']!='completed' or not t['result']:raise ValueError('Проверка ещё не завершена')
            if body.revision!=t['revision']:raise ValueError('Версия изменилась. Обновите страницу.')
            result=ReviewResult.model_validate({**t['result'],'findings':[f.model_dump() for f in body.findings]})
            kit=Toolkit(store,t['request']);validation=validate_result(result,kit.docs,kit.contract)
            if not validation['valid']:raise ValueError('; '.join(validation['errors']))
            t['result']=result.model_dump();t['lawyer_note']=body.lawyer_note;t['revision']+=1;t['approval']=None;t.pop('delivery',None)
        updated=store.mutate(id,change);updated.pop('history',None);return updated

    @app.post('/api/tasks/{id}/approve')
    def approve(id:str,body:Revision):
        t=store.approve(id,body.revision);store.log(id,'human_approval',{'revision':body.revision},{'digest':t['approval']['digest']});return {'ok':True}

    @app.post('/api/tasks/{id}/send-test')
    def send(id:str,body:Revision):
        t=store.send_test(id,body.revision);store.log(id,'test_delivery',{},t['delivery']);return t['delivery']

    @app.get('/api/tasks/{id}/export/{format}')
    def export(id:str,format:str):
        t=store.task(id)
        if not store.approved(t):raise HTTPException(403,'Сначала подтвердите актуальную версию')
        if format=='json':
            payload={'title':t['request']['title'],'mode':t['request']['mode'],'result':t['result'],'lawyer_note':t['lawyer_note'],'approval':t['approval']}
            return Response(json.dumps(payload,ensure_ascii=False,indent=2),media_type='application/json',headers={'Content-Disposition':'attachment; filename="review.json"'})
        if format!='docx':raise ValueError('Неизвестный формат')
        d=Document();d.add_heading('Протокол разногласий',0)
        d.add_paragraph(t['request']['title']);d.add_paragraph('Режим: '+('проверка по правилам' if t['request']['mode']=='demo' else ('GigaChat' if t['request']['mode']=='gigachat' else 'ChatGPT OAuth')))
        d.add_paragraph(t['result']['summary'])
        def source_label(ref):
            document = store.document(ref['document_id'])
            clause = next((c for c in document['clauses'] if c['id'] == ref['clause_id']), {})
            number = re.match(r'^\s*(\d+(?:\.\d+)*)[.)]\s', clause.get('text', ''))
            parts = [document['name'], '§ '+number[1] if number else ref['clause_id']]
            if clause.get('page'):
                parts.append(f"стр. {clause['page']}")
            if clause.get('location'):
                parts.append(clause['location'])
            return ', '.join(parts)
        for f in t['result']['findings']:
            if f['decision']!='accepted':continue
            d.add_heading(f['title'],2);d.add_paragraph('Категория: '+f['category'])
            d.add_paragraph(source_label(f['contract'])+': '+f['contract']['quote'])
            d.add_paragraph(f['explanation'])
            for ref in f['evidence']:
                d.add_paragraph('Основание: '+source_label(ref)+' — '+ref['quote'])
            if f['suggestion']:d.add_paragraph('Предложение: '+f['suggestion'])
        if t['result'].get('rule_checks'):
            d.add_heading('Проверка по правилам',2)
            for rule in t['result']['rule_checks']:
                d.add_paragraph(rule['status']+' — '+rule['requirement'])
                if rule['explanation']:d.add_paragraph(rule['explanation'])
        d.add_heading('Ограничения проверки',2)
        for item in t['result']['limitations']:d.add_paragraph(item)
        if t['lawyer_note']:d.add_paragraph('Комментарий юриста: '+t['lawyer_note'])
        d.add_paragraph('Подтверждённая версия: '+str(t['revision'])+' / '+t['approval']['at'])
        out=io.BytesIO();d.save(out)
        return Response(out.getvalue(),media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',headers={'Content-Disposition':'attachment; filename="protocol.docx"'})

    return app

app=create_app()
