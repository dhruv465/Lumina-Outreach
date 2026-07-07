FROM python:3.11-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
# Pre-download VAD/turn-detector model weights into the image
RUN uv run python agent.py download-files
CMD ["uv", "run", "python", "agent.py", "start"]
