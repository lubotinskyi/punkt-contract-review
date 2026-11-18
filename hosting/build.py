from pathlib import Path
import json,base64
root=Path(__file__).resolve().parent
src=root.parent/'web-demo'
output=root/'dist'
mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'}
assets={}
for p in [src/'index.html',*(src/'static').rglob('*')]:
 if p.is_file():
  assets['/'+p.relative_to(src).as_posix()]={'mime':mime[p.suffix],'data':base64.b64encode(p.read_bytes()).decode()}
(output/'server').mkdir(parents=True,exist_ok=True)
(output/'server/index.js').write_text('const ASSETS='+json.dumps(assets)+';\n'+(root/'worker.mjs').read_text(encoding='utf-8-sig'),encoding='utf8')
