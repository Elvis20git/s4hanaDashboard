FROM python:3.13-slim

WORKDIR /app

# System deps needed to compile psycopg at build time
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user (entrypoint drops to appuser via gosu after fixing volume ownership)
RUN adduser --disabled-password --uid 1000 appuser \
    && chown -R appuser:appuser /app \
    && chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
