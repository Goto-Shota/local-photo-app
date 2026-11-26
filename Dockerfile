FROM python:3.11-slim

WORKDIR /app

# 依存関係のインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# コード、HTML、サンプルデータなどをすべてコンテナ内に同梱する
COPY . /app

# PaaS側が割り当てるポートに対応できるようEXPOSEを設定
EXPOSE 8000

# 起動コマンド（PaaSによっては環境変数 PORT を使って書き換える場合もあります）
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}
