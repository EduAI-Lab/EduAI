# Why EduAI uses a two-model interactive fleet

EduAI's interactive chat uses two Qwen3.5 models with different jobs:

- **Qwen3.5 2B** handles short, straightforward requests with the lowest
  latency and energy cost.
- **Qwen3.5 9B** handles questions that need more reasoning or a stronger
  explanation.

The router chooses between these models. The benefit comes from the pairing
and the routing decision together; installing two model files without routing
would not produce the measured savings.

## What the measurements say

On a 200-question evaluation, the 9B model answered correctly **97.0%** of
the time. That was close to the top-of-line 27B model (**98.0%**) and ahead of
the 4B (**96.0%**) and 2B (**90.5%**) models.

The 2B model is the smallest model that cleared the reliability bar used for
the interactive tier. The 9B model was selected as the larger tier because
the 2B and 4B results were too close to justify maintaining both as separate
tiers.

The 9B model used about **49% less energy per request** than the next larger
tier in the hardware comparison. In a live 570-request test, routing between
2B and 9B instead of always using the large model reduced response time by
about **47%** and total energy by about **51%**, with zero request errors.

## How this repository applies the split

Core seeds and synchronizes the Qwen3.5 2B/9B catalog entries and assigns
them to the interactive routing tiers. The cmps01 deployment template serves
both models, while the separately retained Qwen2.5 32B endpoint is used only
for Assist Auto until that dependency is retired.

Question Maker uses 2B as its offline probe fallback and 9B as its generation
fallback. Explicit model selections remain authoritative; fallback values are
only used when the live Core catalog cannot be read.

This document describes the model choice and the application-side changes in
this PR. A deployment-wide replacement on every campus inference host,
including cmps02 and cmps03, remains a separate operational rollout.
