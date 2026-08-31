# cmps02 — Qwen3.8-27B deployment

cmps02 is a two-GPU live-chat host. GPU 0 remains on the small Qwen3.5
service; GPU 1 serves the large tool-capable model through the existing
LiteLLM/nginx proxy on port `8001`.

```text
dev (s378) ──HTTP :8001──► cmps02 edge proxy
                              ├── GPU 0: qwen3.5-2b-instruct
                              └── GPU 1: qwen3.8-27b-instruct (FP8)
```

The GPU 1 service uses `Qwen/Qwen3.8-27B-FP8`, exposed as
`qwen3.8-27b-instruct`. The deployment uses a 64K context and conservative
concurrency for this 48 GB GPU, which leaves enough room for Admin Chat’s
large tool registry.

## Deploy

```bash
cd ~/cmps02
chmod +x migrate-qwen38.sh
./migrate-qwen38.sh
```

The script prefetches the model before stopping the old GPU 1 container,
backs up `litellm-config.yaml`, updates only the large-model id, and force-
recreates LiteLLM so the bind-mounted config is reloaded. GPU 0 is left
running.

Verify on cmps02:

```bash
curl -s http://127.0.0.1:8001/v1/models \
  -H "Authorization: Bearer vllm-local" | jq -r '.data[].id'
```

Expected large-model id: `qwen3.8-27b-instruct`.
