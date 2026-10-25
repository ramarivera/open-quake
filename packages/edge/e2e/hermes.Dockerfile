# Minimal test runtime, not the user's gateway or a messaging installation.
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie@sha256:b3c543b6c4f23a5f2df22866bd7857e5d304b67a564f4feab6ac22044dde719b
WORKDIR /app
COPY . .
# The upstream messaging extra owns aiohttp, also required by the HTTP API server.
# No messaging platform is configured by the fixture.
RUN uv sync --frozen --no-dev --extra messaging --python /usr/local/bin/python3.13
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH=/app
