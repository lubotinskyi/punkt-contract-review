"""Server-side GigaChat transport for the existing validated review tool loop."""
import json
import os
import ssl
import threading
import time
import uuid
from pathlib import Path

import httpx

from .oauth import protect


class GigaChat:
    def __init__(self, root, client=None):
        self.key_path = Path(root) / "private" / "gigachat.dpapi"
        context = ssl.create_default_context()
        context.load_verify_locations(cafile=Path(__file__).with_name("gigachat-root.pem"))
        self.http = client or httpx.Client(verify=context, timeout=90)
        self.lock = threading.Lock()
        self.cached_token = ""
        self.expires = 0

    def configured(self):
        return bool(os.getenv("GIGACHAT_CREDENTIALS") or self.key_path.is_file())

    def token(self):
        with self.lock:
            if time.time() + 60 < self.expires:
                return self.cached_token
            key = os.getenv("GIGACHAT_CREDENTIALS")
            if not key and os.name == "nt" and self.key_path.is_file():
                encrypted = bytes.fromhex(self.key_path.read_text().strip())
                key = protect(encrypted, decode=True).decode("utf-16-le")
            if not key:
                raise ValueError("Задайте серверный ключ GIGACHAT_CREDENTIALS")
            data = self.request("POST", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                                headers={"Authorization": "Basic " + key.strip(), "RqUID": str(uuid.uuid4())},
                                data={"scope": os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")})
            self.cached_token = data["access_token"]
            self.expires = data["expires_at"] / 1000
            return self.cached_token

    def request(self, method, url, **kwargs):
        try:
            r = self.http.request(method, url, **kwargs)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPStatusError as exc:
            raise ValueError(f"GigaChat: HTTP {exc.response.status_code} ({url.split('/')[-1]})") from None
        except httpx.RequestError as exc:
            raise ValueError(f"GigaChat: ошибка соединения ({exc})") from None

    def api(self, method, path, **kwargs):
        return self.request(method, "https://api.giga.chat/v1/" + path,
                            headers={"Authorization": "Bearer " + self.token()}, **kwargs)

    def models(self):
        return [{"id": m["id"], "name": m["id"]} for m in self.api("GET", "models")["data"] if "embedding" not in m["id"].lower()]

    def response(self, model, history, tools, instructions):
        functions = [{k: tool[k] for k in ("name", "description", "parameters")} for tool in tools]
        for function in functions:
            if function["name"] in {"finish_review", "validate_findings"}:
                function["parameters"] = {"type": "object", "properties": {
                    "result": {"type": "string", "description": "Сериализованный JSON ReviewResult по инструкции"}
                }, "required": ["result"]}
        messages = [{"role": "system", "content": instructions}]
        calls = {}
        for item in history:
            if item.get("type") == "function_call":
                call = {"name": item["name"], "arguments": json.loads(item["arguments"])}
                if isinstance(call["arguments"].get("result"), dict):
                    call["arguments"]["result"] = json.dumps(call["arguments"]["result"], ensure_ascii=False)
                calls[item["call_id"]] = call["name"]
                msg = {"role": "assistant", "content": "", "function_call": call}
                if item.get("functions_state_id"):
                    msg["functions_state_id"] = item["functions_state_id"]
                messages.append(msg)
            elif item.get("type") == "function_call_output":
                messages.append({"role": "function", "name": calls[item["call_id"]], "content": item["output"]})
            elif item.get("role"):
                messages.append({"role": item["role"], "content": item["content"]})
        data = self.api("POST", "chat/completions", json={
            "model": model, "messages": messages, "functions": functions, "function_call": "auto"})
        message = data["choices"][0]["message"]
        call = message.get("function_call")
        if call:
            if isinstance(call["arguments"].get("result"), str):
                try:
                    call["arguments"]["result"] = json.loads(call["arguments"]["result"])
                except json.JSONDecodeError:
                    pass  # The review validator will return feedback to the model.
            output = {"type": "function_call", "name": call["name"], "call_id": uuid.uuid4().hex,
                      "arguments": json.dumps(call["arguments"], ensure_ascii=False),
                      "functions_state_id": message.get("functions_state_id")}
        else:
            output = {"role": "assistant", "content": message.get("content", "")}
        return {"output": [output], "usage": data.get("usage", {})}
