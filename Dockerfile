FROM mcr.microsoft.com/playwright/python:v1.59.0-noble

WORKDIR /app

# Update system packages to fix CVEs
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    git \
    gpg \
    gpgconf \
    gpgv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY visual_crawler/ visual_crawler/

# Capture build/deploy timestamp
ARG DEPLOY_TIME
ARG DEPLOY_DATE
ENV DEPLOY_TIME=${DEPLOY_TIME}
ENV DEPLOY_DATE=${DEPLOY_DATE}

EXPOSE 8187

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8187/health')"

CMD ["uvicorn", "visual_crawler.server:create_app", "--factory", "--host", "0.0.0.0", "--port", "8187", "--log-level", "info"]
