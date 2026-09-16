#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
task_venv="$HOME/.local/share/robinhood-swebench/venv"
uv_bin="${UV_BIN:-$HOME/.local/bin/uv}"
"$uv_bin" venv --allow-existing --python 3.11 "$task_venv"
"$uv_bin" pip install --python "$task_venv/bin/python" 'swebench @ git+https://github.com/SWE-bench/SWE-bench.git@3f01bd622c0a22c00406139f69a234ef08225f22'
docker build -f benchmarks/swebench/Dockerfile -t robinhood-swebench-runtime:prepared .
"$task_venv/bin/python" benchmarks/swebench/bench.py prepare
