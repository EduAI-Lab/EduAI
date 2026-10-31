# Using EduAI's AI models through the API: a guide for students

This guide is for students and researchers an EduAI administrator has given **API access**. With it you can send your own programs' prompts to the AI models that run on UBC's campus servers. Your requests never leave UBC.

> **In short:** create a key in **Settings → API Keys**, keep it secret, and send it in the `x-api-key` header to `POST https://my.eduai.ok.ubc.ca/api/completion`. Prompt tokens plus `maxTokens` must fit the model's context window. Stay within your daily limits, and when you're told to wait, wait for the `Retry-After` seconds before trying again.

---

## 1. What you get

| | |
|---|---|
| **Endpoint** | `POST https://my.eduai.ok.ubc.ca/api/completion` (one request in, one answer out; no chat history is kept) |
| **Models** | The campus models only (names start with `vllm:`). Cloud models such as Gemini or GPT are not available with a student key. |
| **Daily limits** | Set by the admin who gave you access. The defaults are **200 requests** and **500,000 tokens**, counted over the **last 24 hours** across all your keys. |
| **At the same time** | At most **2 requests** from *all* student keys together run at once, because course chat for every EduAI student shares the same servers. |
| **Longest request** | **5 minutes.** Anything longer is stopped. |
| **Access ends** | On the end date your admin chose, or when they revoke it. Your keys stop working at that moment. |

You can't reach EduAI's other APIs (courses, users, chat history) with this key.

## 2. Create your key

1. Sign in at https://my.eduai.ok.ubc.ca.
2. Open **Account** in the left navigation bar and choose **Settings**, then the **API Keys** tab. The tab only appears while your access is active. If you were just given access, reload the page.
3. The **Your API access** card shows when your access ends and how much of today's allowance you've used.
4. Give the key a name (for example the project), choose how long it should last (it can't outlast your access; "Until access ends" is the default), and choose **Create**.
5. **Copy the key now.** It is shown once. If you lose it, delete it and create a new one.

## 3. Keep your key secret

Anyone with your key can use your allowance, and every request is recorded against **your** account.

- **Never** put the key in code you commit, a shared notebook, a screenshot, a chat message, an email or a support ticket.
- Keep it in an environment variable:

  ```bash
  # Type the key without it appearing on screen or in your shell history:
  read -rs EDUAI_API_KEY && export EDUAI_API_KEY
  ```

  or in a `.env` file that is listed in your `.gitignore`.
- In Jupyter, read it with `os.environ["EDUAI_API_KEY"]` or `getpass()`. Never print it, since cell outputs get saved in the notebook.
- If it leaks, delete it in **Settings → API Keys** straight away and create a new one.

## 4. Your first request

If the request can't connect from off campus, connect to the UBC VPN first.

**curl**

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST https://my.eduai.ok.ubc.ca/api/completion \
  -H "Content-Type: application/json" \
  -H "x-api-key: $EDUAI_API_KEY" \
  -d '{
    "model": "vllm:qwen3.5-2b-instruct",
    "apiKeys": {},
    "systemPrompt": "You are a helpful assistant.",
    "messages": [{"role": "user", "content": "Say hi in five words."}],
    "maxTokens": 64
  }'
```

A successful answer:

```json
{
  "content": "Hello! I'm ready to help.",
  "model": "vllm:qwen3.5-2b-instruct",
  "usage": { "promptTokens": 232, "completionTokens": 9, "totalTokens": 241 },
  "finishReason": "stop"
}
```

`usage.totalTokens` is what this request counted against your daily token limit. `finishReason` is `"length"` when the answer was cut off by `maxTokens`.

**Python** (with retries done properly; see section 8)

```python
import os, time, requests

URL = "https://my.eduai.ok.ubc.ca/api/completion"
HEADERS = {"x-api-key": os.environ["EDUAI_API_KEY"], "Content-Type": "application/json"}

def complete(prompt, system="You are a helpful assistant.",
             model="vllm:qwen3.5-2b-instruct", max_tokens=512, attempts=4):
    body = {
        "model": model,
        "apiKeys": {},
        "systemPrompt": system,
        "messages": [{"role": "user", "content": prompt}],
        "maxTokens": max_tokens,
    }
    for attempt in range(attempts):
        # Give the server its full 5 minutes before giving up on a long answer.
        r = requests.post(URL, headers=HEADERS, json=body, timeout=330)
        if r.status_code == 200:
            return r.json()
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        # Retry only what can succeed later: limits, busy servers, a model hiccup.
        if r.status_code in (429, 503) or data.get("retryable"):
            wait = int(r.headers.get("Retry-After", 2 ** attempt * 5))
            print(f"{r.status_code} {data.get('error') or data.get('code')}; waiting {wait}s")
            time.sleep(wait)
            continue
        # 400, 401, 403: retrying the same request won't help. Fix it first.
        raise RuntimeError(f"{r.status_code}: {data or r.text}")
    raise RuntimeError("Gave up after retries")

answer = complete("Explain recursion in one sentence.")
print(answer["content"], answer["usage"])
```

**JavaScript (Node 18+)**

```js
const res = await fetch("https://my.eduai.ok.ubc.ca/api/completion", {
  method: "POST",
  headers: { "x-api-key": process.env.EDUAI_API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "vllm:qwen3.5-2b-instruct",
    apiKeys: {},
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Say hi in five words." }],
    maxTokens: 64,
  }),
});
console.log(res.status, await res.json());
```

## 5. Request fields

| Field | Required | Notes |
|---|---|---|
| `model` | yes | A campus model id, for example `vllm:qwen3.5-2b-instruct`. See section 6. |
| `apiKeys` | yes | Always send `{}`. Leaving it out gives `400 Invalid apiKeys`. It exists for other callers; campus models need no key. |
| `messages` | yes | A list of `{"role": "user" \| "assistant", "content": "..."}`. Send the whole conversation yourself if you need follow-ups; nothing is remembered between requests. |
| `systemPrompt` | no | Instructions for the model. It counts towards the prompt's tokens. |
| `maxTokens` | no | The longest answer allowed, 1–16,384. **Default 8,192**, which is often too big: see sections 6 and 7. Set it to what you actually need. |
| `temperature` | no | 0–2. 0 gives the most consistent answers (good for grading or judging); higher is more varied. |
| `streaming` | no | `false` (the default) returns one JSON answer, which is what scripts want. `true` streams the answer as it's written, in the AI SDK data-stream format. |

## 6. Models and context windows

A model can only read and write so many tokens in one request, its **context window**. For a request to work:

**prompt tokens (system prompt + messages) + `maxTokens` ≤ the model's context window**

| Model | Context window | Runs on | Good for |
|---|---|---|---|
| `vllm:qwen3.5-2b-instruct` | **16,384 tokens** | 3 servers | Short, fast tasks; high volume |
| `vllm:qwen3.5-9b-instruct` | **16,384 tokens** | 2 servers | Better answers than the 2B at the same size limit |
| `vllm:qwen3.8-27b-instruct` | **65,536 tokens** | 1 server | Long documents and the best answers; slower, and the one server is shared with course chat |

The 2B and 9B have the **same** window, so moving from the 2B to the 9B gives better answers but no more room. For anything that doesn't fit in 16,384 tokens, use the 27B. (Measured on 2026-10-23.)

What we learned the hard way:

- **Being one token over fails.** A real request of 13,313 prompt tokens with `maxTokens` 3,072 came to 16,385, one over the 2B's limit, and was refused. The server now answers at once with `400 CONTEXT_LENGTH_EXCEEDED`. **Don't retry it unchanged**: shorten the prompt, lower `maxTokens`, or switch to the 27B.
- **Your token count won't match the server's exactly.** Different tokenizers count differently, and the model's chat format adds tokens of its own (a 5-word question above used 232 prompt tokens). **Leave at least 10% spare.**
- A rough guide: 1 token ≈ 4 characters of English. Code, other languages and maths use more tokens per character.
- For long documents, use the 27B, or split the text and send the pieces separately. `maxTokens` can't go above 16,384 on any model, even the 27B.

## 7. Limits, and how tokens are counted

- **Limits count the last 24 hours, not a calendar day.** Use frees up as your old requests pass 24 hours old, not at midnight.
- **A request is charged when it starts.** Before it reaches the model, it is charged an estimate: about one token per 4 characters of prompt, **plus all of `maxTokens`**. When the model reports the real count, that replaces the estimate. If the request is aborted or fails before the model reports, **the estimate stays**.
  - So a big `maxTokens` uses up your allowance faster when requests are cut short. With the default of 8,192, ten aborted requests can cost over 80,000 tokens. Set `maxTokens` to what you need.
- **Requests turned away don't count.** A `429` (over your limit) or `503` (busy) is recorded but isn't charged.
- **Two at a time, for everyone.** Run your requests **one after another**, or at most 2 at once. More parallel requests just get `503 API_ACCESS_BUSY` faster.
- Check your use any time on the **Your API access** card in Settings → API Keys.

## 8. Errors and what to do

| Response | Meaning | What to do |
|---|---|---|
| `200` | Success | Read `content`. Check `finishReason` (`"length"` means it was cut off). |
| `400 CONTEXT_LENGTH_EXCEEDED` | Prompt + `maxTokens` is longer than the model allows | Shorten the prompt, lower `maxTokens`, or switch to the 27B (65,536 tokens). **Never retry unchanged.** |
| `400` / `422` (other) | Something in the request is wrong: for example `apiKeys` missing (`Invalid apiKeys`), `maxTokens` above 16,384, or no `messages` | Read `error`, fix the request |
| `401 Unauthorized` | The key is wrong, deleted, expired or disabled | Check you're sending the real key, not a placeholder. Create a new key if needed |
| `403` "this account has no active API access" | Your access has ended or was revoked | Ask the admin who gave you access |
| `403 API_ACCESS_MODEL_NOT_ALLOWED` | You asked for a model that isn't a campus model | Use a `vllm:` model |
| `429 API_ACCESS_LIMIT` | You used up today's requests or tokens; `limit` says which | Wait for `Retry-After` seconds (or until older requests pass 24 hours), or ask for a higher limit |
| `429 RATE_LIMITED` | Too many requests in a short burst | Slow down; wait for `Retry-After` |
| `503 API_ACCESS_BUSY` | Two student requests are already running | Wait a few seconds (`Retry-After`) and try again |
| `503 AI_ADMISSION_TIMEOUT` | The campus models are busy with course chat | Wait for `Retry-After` and try again |
| `504` "AI request timed out" | The request ran for 5 minutes and was stopped | Ask for a shorter answer, split the task, or use a faster model |
| `5xx` with `"retryable": true` | A model or server hiccup | Retry after a short wait |

**Retry rules:**

- Retry only `429`, `503` and errors marked `"retryable": true`, and always wait at least the `Retry-After` header's seconds first.
- **Don't retry `400`, `401`, `403` or `422`.** The same request will fail the same way.
- Give up after a few attempts (3–4), and back off longer each time.
- Set your client's timeout to **at least 330 seconds**. A shorter timeout gives up on answers the server would have finished, and an aborted request is still charged its estimate.

## 9. Running a batch (experiments, grading, evaluation)

- **Test on 5–10 items first**, and check the answers and the `usage` numbers before running everything.
- **Work out the tokens per item** from `usage.totalTokens`, multiply by the number of items, and compare with your daily token limit. Spread a big run over several days, or ask your admin for a higher limit **before** you start.
- **Run one or two at a time**, never dozens in parallel.
- **Save each result as soon as it arrives** (a JSON-lines file works well), so a failure halfway through doesn't mean starting again. Skip items already done when you restart.
- **Check sizes before sending.** Long inputs: estimate the prompt's tokens and lower `maxTokens` or skip the item rather than sending something that will be refused.
- Use `temperature: 0` when you need repeatable answers.

## 10. Rules

- The key is for **you** and the purpose your access was given for. Don't share it or build a service others use through your key.
- **Don't send participant or personal data** (names, student numbers, interview transcripts, health information) unless your ethics approval covers processing it on UBC's EduAI servers.
- Every request is recorded against your account: when, which model, the outcome and how many tokens. **The text of your prompts and answers is not stored.** Administrators review use, and heavy use is flagged daily.
- Course chat comes first. If the campus models are busy, your requests wait or get `503`; that's expected.

## 11. Getting help

- When something fails, note the time, the HTTP status, the response body and the model, and send these to the admin who gave you access. **Never include your key.**
- To check whether the campus models are up, look at the status indicator in EduAI's header.
