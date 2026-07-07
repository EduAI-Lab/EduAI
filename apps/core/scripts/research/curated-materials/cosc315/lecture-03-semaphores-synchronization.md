# COSC 315 — Lecture 3: Semaphores and Synchronization

## Learning objectives

After working through this lecture you should be able to:

- Define semaphore, critical section, deadlock, and starvation
- Use semaphores for mutual exclusion and for counting resources
- Implement producer–consumer coordination with semaphores and a mutex
- Explain Coffman conditions for deadlock and one prevention strategy
- Describe fairness policies (e.g. batch limits) that avoid starvation
- Prefer blocking `wait()` over busy-waiting in user-level code

---

## Introduction

Mutexes (Lecture 2) answer: “May **only one** thread enter this region?” **Semaphores** answer a broader question: “May **up to N** threads proceed?” or “Has another thread produced data I can consume?” They model traffic lights, parking spaces, empty buffer slots, and printer pools — anywhere a **count** of permits governs progress.

Operating systems implement semaphores in the kernel so threads **block** instead of wasting CPU spinning. COSC 315 labs (intersection traffic, producer–consumer buffers) use semaphores to teach **invariants**: rules that must always hold (at most one car in the intersection, buffer size never negative). This lecture builds from critical sections through deadlock and fairness — the vocabulary you need before optimizing parallel code.

---

## 1. Why semaphores?

A **mutex** is a binary lock (0 or 1). A **semaphore** maintains a non-negative **count**:

- **`wait()`** (also called **P** or `sem_wait`) — decrement count; if count would become negative, **block** until a permit is available
- **`signal()`** (also **V** or `sem_post`) — increment count; wake a waiting thread if any

| Count semantics | Interpretation |
|-----------------|----------------|
| 1 | Mutex — at most one holder |
| N | N identical resources (N connections, N buffer slots) |
| 0 | Threads wait until someone signals |

**Binary semaphore** (0/1) can implement mutual exclusion like a mutex — but mutexes are often preferred for simple exclusion because ownership rules are clearer (only locker unlocks).

---

## 2. Critical sections

A **critical section** is code that accesses **shared state** and must not execute concurrently with other critical sections on the **same** data.

**Intersection analogy:** The intersection is the shared resource. At most one car should occupy the critical zone from one approach. A semaphore with count 1 acts as a **token** — take token before entering, return token after leaving.

```text
wait(intersection);   /* enter critical section */
  drive through;
signal(intersection); /* leave */
```

**Invariant:** number of cars inside intersection ≤ 1. Every path through the code must preserve invariants — prove correctness before tuning performance.

---

## 3. Producer–consumer pattern

Classic setup: bounded buffer, producers add items, consumers remove items.

| Semaphore | Initial value | Role |
|-----------|---------------|------|
| `empty` | buffer capacity | Producer waits for empty slot |
| `full` | 0 | Consumer waits for item |
| `mutex` | 1 | Protects buffer structure (indices, linked list) |

**Producer:**

```text
wait(empty);
wait(mutex);
  insert item;
signal(mutex);
signal(full);
```

**Consumer:**

```text
wait(full);
wait(mutex);
  remove item;
signal(mutex);
signal(empty);
```

**Why both semaphores and mutex?** Semaphores coordinate **when** threads may proceed (backpressure). Mutex protects **buffer invariants** during insert/remove. **Order matters:** wait on `empty`/`full` **before** mutex so you do not hold mutex while blocking — otherwise deadlock (hold mutex, wait forever for slot).

---

## 4. Deadlock

**Deadlock** — a set of threads each waiting for a resource held by another, so nobody progresses.

**Coffman conditions** (all four needed for deadlock):

1. **Mutual exclusion** — resource held by at most one at a time
2. **Hold and wait** — thread holds one resource while waiting for another
3. **No preemption** — resources released only voluntarily
4. **Circular wait** — cycle in wait-for graph

**Prevention example:** **Hold and wait** — never hold mutex A while blocking on semaphore B. Release A before `wait(B)`, re-acquire A if needed (careful — may introduce races; design order globally).

**Traffic lab:** Car holds road A lock, waits for intersection lock while another holds intersection and waits for road A → circular wait.

**Strategies:**

- **Prevention** — break one Coffman condition (lock ordering)
- **Avoidance** — banker's algorithm (theory)
- **Detection + recovery** — kill or rollback (rare in user apps)
- **Ignore** — hope (not acceptable in OS kernels)

---

## 5. Starvation and fairness

**Starvation** — a thread is ready indefinitely but never acquires the resource while others proceed.

**Unfair semaphore:** always wake same waiter — others starve.

**Fairness policy example (batch limit):** At an intersection, serve at most **B** cars from road A consecutively when road B has waiters, then switch. Under sustained load, both directions eventually cross — **bounded waiting**.

Fairness may reduce peak throughput; systems choose policies based on requirements (real-time vs best-effort).

---

## 6. Busy waiting versus blocking

**Busy wait (spin):** loop `while (!condition);` — burns CPU.

**Blocking wait:** `sem_wait` puts thread to sleep until `sem_post` — CPU runs other work.

User-level synchronization should **block**. Spin locks appear in kernel or very short critical sections on multicore hardware where wakeup cost exceeds spin time — not typical in coursework buffer labs.

---

## 7. Worked scenario: single-lane bridge

One-lane bridge, cars from north and south. Semaphore `bridge` initialized to 1.

- Arriving car: `wait(bridge)`, cross, `signal(bridge)`
- Invariant: at most one car on bridge

If you also count cars waiting to prevent starvation, add fairness counters or alternate direction — extension for design assignments.

---

## 8. Common mistakes

1. **Wrong initial semaphore values** — `full` should start at 0, not capacity
2. **Mutex held during `wait` on slot semaphore** — deadlock risk
3. **Signal without matching wait** — count grows unbounded; logic breaks
4. **Forgetting mutex around buffer structure** — two producers corrupt indices
5. **Busy-wait loops** — fail autograder timeout, waste CPU

---

## 9. Chapter summary

Semaphores generalize mutual exclusion to **counting resources** and **signaling** between threads. Critical sections protect shared invariants; producer–consumer splits **slot counting** from **structure locking**. Deadlock requires circular wait among held resources — prevent by lock ordering and never blocking while holding locks you do not need. Fairness policies combat starvation. Design synchronization on **invariants** first; performance second.

---

## Key terms

| Term | Definition |
|------|------------|
| Semaphore | Counting synchronization primitive |
| wait / signal | Decrement (maybe block) / increment (maybe wake) |
| Critical section | Exclusive access region for shared state |
| Deadlock | Circular waiting with held resources |
| Starvation | Indefinite denial despite readiness |
| Producer–consumer | Coordination pattern for bounded buffers |
