FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY web ./web
COPY examples ./examples
COPY run.py ./
ENV CONTRACT_DATA_DIR=/app/data BIND_HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["python", "run.py"]
