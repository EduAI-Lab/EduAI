# cmps03 — heavy/background vLLM fleet host

**Hardware:** 2× NVIDIA RTX 6000 Ada (48 GB each).

**Role:** Run `gpt-oss-120b` across both GPUs for background and
instructor-heavy jobs. This host is separate from the cmps01/cmps02
interactive Qwen pool.

```text
s378 ──HTTP :8001──► nginx
                       └── LiteLLM 127.0.0.1:18091
                              └── vLLM 127.0.0.1:18001
                                      gpt-oss-120b, TP=2
```

## Deploy

```bash
cd ~/cmps03
chmod +x deploy.sh start-edge.sh
./deploy.sh
docker logs -f eduai-vllm-120b
# once the backend reports ready:
./start-edge.sh
```

Verify:

```bash
curl -s http://127.0.0.1:8001/v1/models \
  -H "Authorization: Bearer vllm-local"
```

Configure the Core deployment on s378:

```env
VLLM_FLEET_HEAVY_URL="http://cmps03.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Then run `npm run fleet:smoke` from `apps/core`.

The campus firewall must allow `s378` to reach
`cmps03.ok.ubc.ca` on TCP port `8001`.
