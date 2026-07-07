# Backend: FastAPI + pipeline. Python 3.12 (stable ML wheels for the per-project
# experiment venvs the runner creates at runtime).
FROM python:3.12-slim

# gcc for the rare source-only wheel; git for dataset loaders; a minimal TeX Live
# so the backend can compile the generated paper.tex to PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ git curl \
    texlive-latex-base texlive-latex-recommended texlive-fonts-recommended \
    texlive-latex-extra texlive-bibtex-extra \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Experiment repos + SQLite live on mounted volumes (see docker-compose).
ENV WORKSPACE_DIR=/workspace \
    PYTHONUNBUFFERED=1
RUN mkdir -p /workspace /app/data

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
