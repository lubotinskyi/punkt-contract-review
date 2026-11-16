import base64
import ctypes
import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode
import httpx
import jwt
from jwt import PyJWK

AUTH='https://auth.openai.com'
RESOURCE='https://api.openai.com/v1'
SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip('=')

def protect(data,decode=False):
    if os.name!='nt':return data
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_=[('cbData',wintypes.DWORD),('pbData',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=(ctypes.c_ubyte*len(data)).from_buffer_copy(data)
    src=Blob(len(data),buffer);dst=Blob()
    fn=ctypes.windll.crypt32.CryptUnprotectData if decode else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):
        raise RuntimeError('Не удалось защитить OAuth-учётные данные Windows DPAPI')
    try:return ctypes.string_at(dst.pbData,dst.cbData)
    finally:ctypes.windll.kernel32.LocalFree(dst.pbData)

class OAuth:
    def __init__(self,root,port=8000,client=None):
        self.path=Path(root)/'private';self.path.mkdir(parents=True,exist_ok=True)
        if os.name!='nt':self.path.chmod(0o700)
        self.file=self.path/'oauth.bin';self.lock=threading.RLock()
        self.http=client or httpx.Client(timeout=30,follow_redirects=False)
        self.port=port;self.pending={}
        self.config=self._load() or {'host':'urn:uuid:'+str(uuid.uuid4()),'registration':None}
        self._save()

    def _load(self):
        if not self.file.exists():return None
        return json.loads(protect(self.file.read_bytes(),decode=True))

    def _save(self):
        tmp=self.file.with_suffix('.tmp')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'wb') as f:f.write(protect(json.dumps(self.config).encode()))
        os.replace(tmp,self.file)
        if os.name!='nt':self.file.chmod(0o600)

    def status(self):
        r=self.config.get('registration') or {}
        return {'connected':bool(r.get('refresh_token') or r.get('access_token')),
                'email':r.get('email'),'scope_granted':'chatgpt.tokens.use.direct' in r.get('scope','').split()}

    def begin(self):
        with self.lock:
            state=secrets.token_urlsafe(32);nonce=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
            callback=f'http://127.0.0.1:{self.port}/auth/callback'
            self.pending={state:{'nonce':nonce,'verifier':verifier,'callback':callback,'expires':time.time()+600}}
            r=self.config.get('registration') or {}
            params={'client_id':r.get('client_id','dynamic_agent_client'),'ext_agent_host_id':self.config['host'],
                    'response_type':'code','redirect_uri':callback,'scope':SCOPES,'resource':RESOURCE,
                    'state':state,'nonce':nonce,'code_challenge_method':'S256',
                    'code_challenge':b64(hashlib.sha256(verifier.encode()).digest())}
            if r.get('client_id'):
                if r.get('id_token'):params['id_token_hint']=r['id_token']
            else:params['agent_name_hint']='Contract Review Local'
            return AUTH+'/api/accounts/authorize?'+urlencode(params)

    def _post_token(self,data):
        r=self.http.post(AUTH+'/api/accounts/oauth/token',data=data)
        if r.status_code!=200:raise ValueError(f'OAuth: обмен токена не выполнен (HTTP {r.status_code}). Повторите вход.')
        return r.json()

    def validate_identity(self,token,client_id,nonce=None):
        header=jwt.get_unverified_header(token)
        if header.get('alg')!='RS256':raise ValueError('Неподдерживаемая подпись ID token')
        response=self.http.get(AUTH+'/.well-known/jwks.json');response.raise_for_status()
        candidates=[key for key in response.json()['keys'] if key.get('kid')==header.get('kid')]
        if len(candidates)!=1:raise ValueError('Не найден ключ подписи')
        claims=jwt.decode(token,PyJWK.from_dict(candidates[0]).key,algorithms=['RS256'],audience=client_id,
                          issuer=AUTH,options={'require':['exp','iat','sub','iss','aud']},leeway=30)
        if nonce is not None and not secrets.compare_digest(str(claims.get('nonce','')),nonce):raise ValueError('Не совпал nonce')
        return claims

    def finish(self,params):
        with self.lock:
            state=params.get('state','');pending=self.pending.pop(state,None)
            if not pending or pending['expires']<time.time():raise ValueError('Вход устарел или state не совпал. Начните заново.')
            if params.get('error'):raise ValueError('Вход отменён или разрешение не предоставлено')
            previous=self.config.get('registration') or {}
            client_id=params.get('client_id') or previous.get('client_id')
            if not client_id or client_id=='dynamic_agent_client':raise ValueError('Не получен зарегистрированный client_id')
            if previous.get('client_id') and client_id!=previous['client_id']:raise ValueError('Регистрация OAuth не совпала')
            tokens=self._post_token({'grant_type':'authorization_code','client_id':client_id,'code':params.get('code',''),
                                     'code_verifier':pending['verifier'],'redirect_uri':pending['callback'],'resource':RESOURCE})
            claims=self.validate_identity(tokens['id_token'],client_id,pending['nonce'])
            if previous.get('sub') and previous['sub']!=claims['sub']:raise ValueError('Получен другой аккаунт. Регистрация не заменена.')
            if 'chatgpt.tokens.use.direct' not in tokens.get('scope','').split():raise ValueError('Не разрешено использование плана ChatGPT')
            self.config['registration']={**tokens,'client_id':client_id,'sub':claims['sub'],'email':claims.get('email'),
                                         'expires_at':time.time()+int(tokens.get('expires_in',3600))}
            self._save()

    def token(self):
        with self.lock:
            r=self.config.get('registration') or {}
            if 'chatgpt.tokens.use.direct' not in r.get('scope','').split():raise ValueError('Сначала выполните вход через ChatGPT')
            if r.get('access_token') and r.get('expires_at',0)>time.time()+90:return r['access_token']
            if not r.get('refresh_token'):raise ValueError('Нужен повторный вход через ChatGPT')
            t=self._post_token({'grant_type':'refresh_token','client_id':r['client_id'],'refresh_token':r['refresh_token'],'resource':RESOURCE})
            if t.get('id_token'):
                claims=self.validate_identity(t['id_token'],r['client_id'])
                if claims['sub']!=r['sub']:raise ValueError('Аккаунт при обновлении токена не совпал')
            if 'scope' in t and 'chatgpt.tokens.use.direct' not in t['scope'].split():raise ValueError('Разрешение использования плана отозвано')
            self.config['registration']={**r,**t,'expires_at':time.time()+int(t.get('expires_in',3600))}
            self._save();return self.config['registration']['access_token']

    def models(self):
        r=self.http.get(RESOURCE+'/models',headers={'Authorization':'Bearer '+self.token()})
        if r.status_code!=200:raise ValueError(f'Каталог моделей недоступен (HTTP {r.status_code})')
        return [{'id':m['slug'],'name':m.get('display_name',m['slug'])} for m in r.json().get('models',[]) if m.get('visibility')=='list']

    def logout(self):
        with self.lock:
            r=self.config.get('registration') or {};revoked=True
            if r.get('refresh_token'):
                try:
                    metadata=self.http.get(AUTH+'/.well-known/openid-configuration').json()
                    endpoint=metadata['revocation_endpoint']
                    if not endpoint.startswith(AUTH+'/'):raise ValueError('Неожиданный адрес отзыва')
                    response=self.http.post(endpoint,data={'token':r['refresh_token'],'token_type_hint':'refresh_token','client_id':r['client_id']})
                    revoked=response.status_code==200
                except (httpx.HTTPError,ValueError,KeyError):revoked=False
            self.config['registration']={k:v for k,v in r.items() if k in {'client_id','sub','email'}} if r else None
            self._save();return revoked

    def response(self,model,history,tools,instructions):
        payload={'model':model,'input':history,'instructions':instructions,'store':False,'stream':True,
                 'tools':[{'type':'namespace','name':'review','description':'Чтение и проверка документов закупки','tools':tools}]}
        complete=None
        with self.http.stream('POST',RESOURCE+'/responses',headers={'Authorization':'Bearer '+self.token()},json=payload,timeout=180) as stream:
            if stream.status_code!=200:raise ValueError(f'Модель недоступна (HTTP {stream.status_code}). Проверьте доступ и лимиты в ChatGPT.')
            for line in stream.iter_lines():
                if not line.startswith('data:'):continue
                data=line[5:].strip()
                if data=='[DONE]':continue
                event=json.loads(data)
                if event.get('type')=='response.completed':complete=event['response']
                elif event.get('type') in {'response.failed','response.incomplete','error'}:
                    code=(event.get('response',{}).get('error') or event.get('error') or {}).get('code','stream_failed')
                    raise ValueError('Запрос к модели не завершён: '+str(code)[:100])
        if not complete:raise ValueError('Поток оборвался без response.completed; ответ не принят')
        return complete
