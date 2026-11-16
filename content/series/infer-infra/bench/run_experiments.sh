#!/usr/bin/env bash
# 推理 Infra 课程 · 第 9 课：依次跑完所有实验，合并成 results/results.json
#
#   BASE_URL=http://localhost:8000 ./run_experiments.sh
#   BASE_URL=http://localhost:8000 BASE_URL2=http://localhost:8001 ./run_experiments.sh   # 两张卡时多跑路由实验
#
# 可选环境变量：
#   NOTE             写进结果里的备注，建议填启动命令和 GPU 型号
#   OUT              结果目录，默认 results
#   SWEEP_DURATION   并发扫描每一档的时长（秒），默认 20
#   RATE_DURATION    到达率扫描每一档的时长（秒），默认 30
#   SESSIONS         agent 实验的会话数，默认 16
#   PYTHON           Python 解释器，默认 python3
set -euo pipefail
cd "$(dirname "$0")"
BASE_URL=${BASE_URL:-http://localhost:8000}
OUT=${OUT:-results}
NOTE=${NOTE:-}
PY=${PYTHON:-python3}
SWEEP_DURATION=${SWEEP_DURATION:-20}
RATE_DURATION=${RATE_DURATION:-30}
SESSIONS=${SESSIONS:-16}
mkdir -p "$OUT"

echo "== 实验 1/5：闭环并发扫描"
$PY bench.py sweep --base-url "$BASE_URL" --out "$OUT/e1_sweep.json" --duration "$SWEEP_DURATION" --note "$NOTE"

echo "== 实验 2/5：开环到达率扫描"
$PY bench.py rate --base-url "$BASE_URL" --out "$OUT/e2_rate.json" --from-sweep "$OUT/e1_sweep.json" \
  --duration "$RATE_DURATION" --note "$NOTE"

echo "== 实验 3/5：prompt 长度扫描"
$PY bench.py prefill --base-url "$BASE_URL" --out "$OUT/e3_prefill.json" --note "$NOTE"

echo "== 实验 4/5：agent 会话回放（历史原样重发 / 开头放时间戳）"
$PY bench.py agent --base-url "$BASE_URL" --out "$OUT/e4_agent_append.json" --label append \
  --sessions "$SESSIONS" --seed 1 --note "$NOTE"
$PY bench.py agent --base-url "$BASE_URL" --out "$OUT/e4_agent_timestamp.json" --label timestamp --mode timestamp \
  --sessions "$SESSIONS" --seed 2 --note "$NOTE"

if [ -n "${BASE_URL2:-}" ]; then
  echo "== 实验 5/5：两个副本上的路由（轮询 / 按会话固定）"
  $PY bench.py agent --base-url "$BASE_URL,$BASE_URL2" --out "$OUT/e5_route_rr.json" --label rr --route rr \
    --sessions $((SESSIONS * 2)) --seed 3 --note "$NOTE"
  $PY bench.py agent --base-url "$BASE_URL,$BASE_URL2" --out "$OUT/e5_route_session.json" --label session --route session \
    --sessions $((SESSIONS * 2)) --seed 4 --note "$NOTE"
else
  echo "== 实验 5/5：跳过（没有设置 BASE_URL2）"
fi

$PY bench.py merge "$OUT"/e*.json > "$OUT/results.json"
echo "全部完成。把 $OUT/results.json 的内容贴到第 9 课页面的「看你自己的结果」里。"
