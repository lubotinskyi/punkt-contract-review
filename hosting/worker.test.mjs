import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const origin='https://site.example';
const request=()=>new Request(origin+'/api/gigachat/review',{method:'POST',headers:{origin},body:JSON.stringify({documents:[{id:'doc',role:'contract',clauses:[{id:'1',text:'Пример'}]}]})});
test('off blocks direct calls; parallel reviews share one 30-call allowance',async t=>{
  let calls=0;const slots=new Set();
  const env={GIGACHAT_CREDENTIALS:'test',BUCKET:{async list(){return {objects:[...slots]};},async put(k,v,options){assert.equal(options.onlyIf.etagDoesNotMatch,'*');if(slots.has(k))return null;slots.add(k);return {};}}};
  const spy=t.mock.method(globalThis,'fetch',async url=>{if(url.includes('/oauth'))return Response.json({access_token:'test',expires_at:Date.now()+300000}); calls++; return Response.json({choices:[{message:{function_call:{arguments:{summary:'ok',additional:[]}}}}]});});
  assert.equal((await worker.fetch(request(),env)).status,503); assert.equal(spy.mock.callCount(),0);
  env.GIGACHAT_ONLINE='1';const responses=await Promise.all(Array.from({length:45},()=>worker.fetch(request(),env)));
  assert.equal(responses.filter(r=>r.status===200).length,30);assert.equal(responses.filter(r=>r.status===429).length,15);assert.equal(calls,30);
});
