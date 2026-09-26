# --- Stage 1: build the React app (frontend/) into static files -------------
FROM node:22-alpine AS frontend
WORKDIR /frontend
# Dependency manifests first, so this layer is cached until they change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Type-checks (tsc -b) and bundles; fails the image build on a type error.
RUN npm run build

# --- Stage 2: the Python service, serving the built app ---------------------
FROM python:3.12-slim

WORKDIR /app

# Pillow needs these at runtime for JPEG support on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    && rm -rf /var/lib/apt/lists/*

# Shown in the web UI footer (compose passes APP_VERSION through).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
# config/ is a runtime volume mount (see docker-compose.yml), not baked in.
COPY schema/ schema/
# Served by app/spa.py (default location: <repo>/frontend/dist).
COPY --from=frontend /frontend/dist frontend/dist

EXPOSE 8000

# Single worker: the aggregator's poll loop and MQTT connection are
# in-process state — see app/main.py's module docstring.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
