FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY visual_crawler/ visual_crawler/

EXPOSE 8187

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8187/health')"

CMD ["uvicorn", "visual_crawler.server:create_app", "--factory", "--host", "0.0.0.0", "--port", "8187", "--log-level", "warning"]
