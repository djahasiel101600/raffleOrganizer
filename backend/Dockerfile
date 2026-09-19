FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first so Docker layer caching skips reinstalls on code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

# Any HTTP response (even 401/403) proves daphne is serving; see
# docker-healthcheck.py.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD ["python", "/app/docker-healthcheck.py"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]