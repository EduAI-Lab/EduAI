#!/usr/bin/env bash
for f in /tmp/policy-runs-p1-under-route-v3b-summary.txt /tmp/policy-runs-p1-dev-v3b-summary.txt /tmp/policy-runs-both-test-energy-v2-summary.txt; do
  echo "=== $f ==="
  head -25 "$f" 2>/dev/null || echo missing
  echo
done
echo "=== under-route tiers ==="
grep -o '"prompt_id":"[^"]*"\|"routing_tier":[0-9]*' /tmp/policy-runs-p1-under-route-v3b.jsonl | paste - - | head -12
echo "=== knn tail ==="
tail -15 /tmp/knn-loo-v3b.log 2>/dev/null || echo no knn log
echo "=== file sizes ==="
wc -l /tmp/policy-runs-p1-dev-v3b.jsonl /tmp/policy-runs-both-test-energy-v2.jsonl /tmp/policy-runs-p1-under-route-v3b.jsonl 2>/dev/null
