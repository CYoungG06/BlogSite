# 第 9 课压测脚本

对一个 OpenAI 兼容的推理服务端（vLLM 或 SGLang）跑五组实验，得到一个 `results.json`，
贴进第 9 课页面的「看你自己的结果」里就能画出曲线。

脚本只在一个假服务端（`mock_server.py`）上测通过，没有在真实 GPU 上跑过。
第一次在真引擎上跑，遇到报错请把报错原文发回来。

## 文件

| 文件 | 作用 |
| --- | --- |
| `bench.py` | 压测脚本，子命令 `sweep` / `rate` / `prefill` / `agent` / `merge` |
| `run_experiments.sh` | 按顺序跑完所有实验并合并结果 |
| `mock_server.py` | 假服务端，按课程的成本模型模拟引擎，用来在没有 GPU 的机器上自测 |

## 1. 准备

压测机上只需要 Python 3.9+ 和 aiohttp：

```bash
pip install aiohttp
```

压测脚本和服务端放在同一台机器上跑即可。脚本是单进程的，吞吐很高时（每秒上万个输出 token）
它自己可能成为瓶颈，这时结果里的吞吐会偏低。

## 2. 启动服务端

模型建议用不需要申请权限的 `Qwen/Qwen2.5-7B-Instruct`。想和课程里的数字对上，可以换成
`meta-llama/Llama-3.1-8B-Instruct`（需要先在 Hugging Face 上申请）。

两个引擎各有一个开关让响应里带上缓存命中的 token 数，实验 3、4、5 要用到，务必加上。
两个引擎依赖的 PyTorch 版本可能不同，请装在各自独立的虚拟环境里。安装命令以两个项目当前的官方文档为准。

**vLLM**

```bash
uv pip install vllm --torch-backend=auto     # 官方文档推荐的装法；没有 uv 先 pip install uv
vllm serve Qwen/Qwen2.5-7B-Instruct \
  --port 8000 \
  --max-model-len 32768 \
  --enable-prompt-tokens-details
```

**SGLang**

```bash
uv pip install --prerelease=allow sglang      # 官方文档推荐的装法
python -m sglang.launch_server \
  --model-path Qwen/Qwen2.5-7B-Instruct \
  --port 8000 \
  --context-length 32768 \
  --enable-cache-report
```

等日志里出现服务就绪的提示后，确认一下：

```bash
curl http://localhost:8000/v1/models
```

vLLM 启动日志里有两行值得记下来，对应第 7 课图 1 算的数：

```
GPU KV cache size: ... tokens
Maximum concurrency for ... tokens per request: ...
```

## 3. 跑实验

**一张卡**（约 15 到 20 分钟）：

```bash
NOTE="vLLM, Qwen2.5-7B, 1x A100-80G" BASE_URL=http://localhost:8000 ./run_experiments.sh
```

**两张卡**：每张卡各起一个服务端，再多跑一组路由实验。

```bash
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000 --max-model-len 32768 --enable-prompt-tokens-details &
CUDA_VISIBLE_DEVICES=1 vllm serve Qwen/Qwen2.5-7B-Instruct --port 8001 --max-model-len 32768 --enable-prompt-tokens-details &

NOTE="vLLM, Qwen2.5-7B, 2x A100-80G" BASE_URL=http://localhost:8000 BASE_URL2=http://localhost:8001 ./run_experiments.sh
```

跑完后结果在 `results/results.json`。运行过程中每一档的数字会打印在终端上。

想对比两个引擎，就各跑一遍，用 `OUT=results_vllm`、`OUT=results_sglang` 分开存。

## 4. 五组实验分别在测什么

| 实验 | 命令 | 做法 | 对应哪一课 |
| --- | --- | --- | --- |
| 1 并发扫描 | `sweep` | 固定 1、2、4 … 256 个并发，每个并发不停地发 512 token 的 prompt、要 128 个输出 | 第 1 课：batch 越大吞吐越高、每个 token 越慢 |
| 2 到达率扫描 | `rate` | 按泊松过程以固定速率发请求，速率取实验 1 测到的最高吞吐的 20% 到 110% | 第 1 课：接近饱和时排队延迟怎么涨 |
| 3 prompt 长度扫描 | `prefill` | 一次一个请求，prompt 从 1K 到 24K；每个长度再把同一个 prompt 发第二遍 | 第 1、3 课：prefill 每个 token 多少毫秒；缓存命中后 TTFT 降多少 |
| 4 agent 回放 | `agent` | 16 个会话各 12 步，系统提示 4K，每步新增 1.5K、输出 150，步间等 2 秒。跑两遍：历史原样重发；每步在最开头放一个时间戳 | 第 3、8 课：前缀稳定与否对任务耗时和重算量的影响 |
| 5 路由 | `agent --route` | 两个服务端，32 个会话。跑两遍：轮询；同一个会话固定发给同一个服务端 | 第 7 课：缓存感知路由 |

所有 prompt 都是随机英文单词拼的。脚本开头会发两个请求校准「一个词是几个 token」，
所以不同模型的分词器不影响 prompt 长度的准确性。输出长度用 `max_tokens` 加 `ignore_eos` 固定住。

## 5. 单独跑某一个实验

```bash
python bench.py sweep   --base-url http://localhost:8000 --out results/e1_sweep.json --concurrency 1 8 64
python bench.py rate    --base-url http://localhost:8000 --out results/e2_rate.json --rates 2 4 8
python bench.py prefill --base-url http://localhost:8000 --out results/e3_prefill.json --lengths 2000 8000
python bench.py agent   --base-url http://localhost:8000 --out results/e4_x.json --label my-run --sessions 32 --gap 10
python bench.py merge results/e*.json > results/results.json
```

`agent` 还有几个可以自己玩的参数：

- `--gap 30 --bg-rate 2`：工具耗时调到 30 秒，同时每秒发 2 个一次性的 6K 请求去挤缓存。对应第 8 课图 2。
- `--send-session-id`：在请求里带 `session_id`。配合 SGLang 的 `--enable-session-radix-cache` 用。
- `--seed`：换一个值就换一套文本。同一个服务端上连续跑两次 agent 实验时要用不同的 seed，
  否则第二次会命中第一次留下的缓存。`run_experiments.sh` 里已经处理了。

每个子命令的完整参数用 `python bench.py <子命令> --help` 查看。

## 6. 没有 GPU 时自测

```bash
python mock_server.py --port 8000 &
BASE_URL=http://localhost:8000 SWEEP_DURATION=10 RATE_DURATION=12 SESSIONS=8 ./run_experiments.sh
```

假服务端的每轮耗时是 20 ms + 每个 decode 序列 0.4 ms + 每个 prefill token 0.1 ms，
所以跑出来的曲线就是课程里那个成本模型的样子。页面上默认显示的示例数据就是这么来的。
