import os
import uvicorn

if __name__=='__main__':
    port=int(os.environ.get('PORT','8000'))
    # Access logs intentionally disabled: callback URLs contain authorization codes.
    uvicorn.run('app.main:app',host=os.environ.get('BIND_HOST','127.0.0.1'),port=port,access_log=False)
