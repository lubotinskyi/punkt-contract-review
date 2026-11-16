import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

class Store:
    def __init__(self, root=None):
        self.root = Path(root or os.environ.get('CONTRACT_DATA_DIR', 'data')).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / 'project.sqlite3'
        with self.connect() as c:
            c.executescript('''
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS logs(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, payload TEXT);
              CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, task_id TEXT, payload TEXT);
            ''')
            for row in c.execute('SELECT id,payload FROM tasks').fetchall():
                t=json.loads(row['payload'])
                if t['status']=='running':
                    t['status']='interrupted'
                    t['error']='Приложение перезапущено. Проверку можно продолжить.'
                    c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(t,ensure_ascii=False),t['id']))

    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.db, timeout=20)
        c.row_factory=sqlite3.Row
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()

    def put_document(self, d):
        with self.connect() as c:
            c.execute('INSERT INTO documents VALUES(?,?)',(d['id'],json.dumps(d,ensure_ascii=False)))
        return d

    def documents(self):
        with self.connect() as c:
            return [json.loads(r['payload']) for r in c.execute('SELECT payload FROM documents ORDER BY rowid DESC')]

    def document(self,id):
        with self.connect() as c:
            r=c.execute('SELECT payload FROM documents WHERE id=?',(id,)).fetchone()
        if not r: raise ValueError('Документ не найден')
        return json.loads(r['payload'])

    def task(self,id):
        with self.connect() as c:
            r=c.execute('SELECT payload FROM tasks WHERE id=?',(id,)).fetchone()
        if not r: raise ValueError('Проверка не найдена')
        return json.loads(r['payload'])

    def tasks(self):
        with self.connect() as c:
            return [json.loads(r['payload']) for r in c.execute('SELECT payload FROM tasks ORDER BY rowid DESC')]

    def create(self,request):
        t={'id':uuid.uuid4().hex, 'created':now(),'request':request,'status':'queued','revision':0,
           'result':None,'approval':None,'history':[], 'steps':0,'tokens':0,'error':None,'lawyer_note':''}
        with self.connect() as c:
            c.execute('INSERT INTO tasks VALUES(?,?)',(t['id'],json.dumps(t,ensure_ascii=False)))
        return t

    def update(self,t):
        with self.connect() as c:
            c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(t,ensure_ascii=False),t['id']))

    def log(self,id,tool,args,result,elapsed=0,tokens=0):
        payload={'at':now(),'tool':tool,'arguments':args,'result':result,'elapsed_ms':round(elapsed*1000),'tokens':tokens}
        with self.connect() as c:
            c.execute('INSERT INTO logs(task_id,payload) VALUES(?,?)',(id,json.dumps(payload,ensure_ascii=False)))

    def logs(self,id):
        with self.connect() as c:
            return [json.loads(r['payload']) for r in c.execute('SELECT payload FROM logs WHERE task_id=? ORDER BY seq',(id,))]

    def mutate(self,id,fn):
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            r=c.execute('SELECT payload FROM tasks WHERE id=?',(id,)).fetchone()
            if not r: raise ValueError('Проверка не найдена')
            t=json.loads(r['payload']);fn(t,c)
            c.execute('UPDATE tasks SET payload=? WHERE id=?',(json.dumps(t,ensure_ascii=False),id))
            return t

    def approve(self,id,revision):
        def action(t,c):
            if t['status']!='completed' or not t['result']: raise ValueError('Проверка не завершена')
            if revision!=t['revision']: raise ValueError('Версия изменилась. Обновите страницу.')
            if any(f['decision']=='pending' for f in t['result']['findings']):
                raise ValueError('Примите или отклоните каждое замечание')
            t['approval']={'revision':revision,'digest':self.fingerprint(t),'at':now()}
        return self.mutate(id,action)

    @staticmethod
    def fingerprint(t):
        return digest({'result':t['result'],'note':t['lawyer_note'],'request':t['request'],'revision':t['revision']})

    def approved(self,t):
        a=t.get('approval')
        return bool(a and a['revision']==t['revision'] and a['digest']==self.fingerprint(t))

    def send_test(self,id,revision):
        def action(t,c):
            if revision!=t['revision'] or not self.approved(t): raise ValueError('Нужно подтвердить актуальную версию протокола')
            key=digest([id,self.fingerprint(t)])
            payload={'id':key,'task_id':id,'at':now(),'destination':'Локальный тестовый ящик','result':t['result'],'lawyer_note':t['lawyer_note']}
            c.execute('INSERT OR IGNORE INTO outbox VALUES(?,?,?)',(key,id,json.dumps(payload,ensure_ascii=False)))
            t['delivery']={'id':key,'destination':'Локальный тестовый ящик'}
        return self.mutate(id,action)
