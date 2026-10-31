FROM python:3.13-slim
WORKDIR /app
COPY services-requirements.txt ./
RUN pip install --no-cache-dir -r services-requirements.txt
COPY services/sidecar.py ./sidecar.py
EXPOSE 8100
CMD ["python", "sidecar.py", "8100"]
