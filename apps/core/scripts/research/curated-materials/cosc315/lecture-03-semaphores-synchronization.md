# COSC 315 — Lecture 3: Semaphores and Synchronization

## Learning objectives

After this lecture you should be able to:

- Define semaphore, critical section, deadlock, and starvation
- Use semaphores for mutual exclusion and signaling
- Explain why holding a lock while waiting on another resource risks deadlock
- Describe fairness mechanisms (e.g. batch limits) in resource allocation

---

## 1. Why semaphores?

**Mutexes** enforce mutual exclusion (one thread in critical section). **Semaphores** generalize to counting resources: N identical slots, producer-consumer buffers, traffic lights.

A semaphore maintains a non-negative count:

- **`wait()`** (P) — decrement; block if zero
- **`signal()`** (V) — increment; wake a waiter

Binary semaphore (0/1) behaves like a mutex when used correctly.

---

## 2. Critical sections

A **critical section** is code accessing shared state that must not run concurrently with other critical sections on the same data.

Example: one car at a time in an intersection — intersection = critical section; at most one “token” holder.

---

## 3. Deadlock

**Deadlock** requires (Coffman conditions):

1. Mutual exclusion
2. Hold and wait
3. No preemption
4. Circular wait

**Prevention example:** never hold mutex A while blocking on semaphore B — release A before waiting, then re-acquire if needed.

---

## 4. Starvation and fairness

**Starvation** — a thread never acquires a resource while others proceed.

**Fairness policy example:** serve at most **B** cars from road A in a row when road B has waiters, then switch green to B. Ensures both directions eventually cross under sustained load.

---

## 5. Producer–consumer pattern

| Role | Semaphore usage |
|------|-----------------|
| Empty slots | Producer waits, consumer signals |
| Full slots | Consumer waits, producer signals |
| Mutex | Protect buffer structure |

Semaphores coordinate **when** threads may proceed; mutex protects **buffer invariants**.

---

## 6. Busy waiting

Good solutions **block** in `wait()` instead of spinning. Spin locks are for very short kernel paths; user-level coordination should sleep when resources unavailable.

---

## 7. Summary

| Term | Meaning |
|------|---------|
| Semaphore | Counting synchronization primitive |
| Deadlock | Circular waiting with held resources |
| Starvation | Indefinite denial of service |
| Fairness | Policy so all contenders make progress |

Design synchronization before optimizing performance — correctness proofs start with invariants, not timings.
