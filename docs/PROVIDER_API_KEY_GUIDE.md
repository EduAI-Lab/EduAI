# Adding your own AI provider key to EduAI

**Most people don't need one.** EduAI's campus models run on UBC's servers and need no key. You only need your own key to use a **cloud model** (OpenAI's GPT, Google's Gemini, or DeepSeek through OpenCode Go) in course chat, or in the AI Tutor study buddy when it asks for one.

## 1. Make an account with the provider first

You need an account **with that company**, not with EduAI. Create it before you start, or you'll get stuck halfway.

| Provider | Where to get the key | Good to know |
|---|---|---|
| **Google AI (Gemini)** | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey): sign in with a Google account, then **Create API key** | The easiest to start with |
| **OpenAI (GPT)** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys): sign up, then **Create new secret key** | A ChatGPT subscription is **not** an API key. The API is billed separately, so add credit first |
| **OpenCode Go (DeepSeek)** | [opencode.ai/docs/go](https://opencode.ai/docs/go/) | Needs an OpenCode Go subscription |

**You pay the provider for what you use**, not EduAI. Set a spending limit in the provider's billing settings.

## 2. Paste it into EduAI

- **Core:** **Account → Settings → Providers**. Paste the key next to the provider and save. You can add an expiry date so EduAI reminds you before it runs out.
- **AI Tutor:** when the study buddy shows *"Connect an AI provider to start"*, choose **Add API key** and paste it.

**Where it's kept:** Core encrypts the key and keeps it on EduAI's server, so it works on any device and is never shown back to anyone. The AI Tutor keeps its copy **only in this browser**, so you'll add it again on another computer, and you should remove it on a shared one.

## 3. Keep it safe

- Treat it like a password: never post it in chat, email, a screenshot or a GitHub issue.
- If it leaks, delete it at the provider straight away, make a new one, and paste the new one into EduAI.
- When you no longer need it, choose **Remove** in Settings → Providers.

> **Not the same as an EduAI API key.** The **Settings → API Keys** tab is for students an admin has given API access, so their own programs can use EduAI's campus models. See [STUDENT_API_GUIDE.md](STUDENT_API_GUIDE.md).
