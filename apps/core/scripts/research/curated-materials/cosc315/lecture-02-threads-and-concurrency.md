# COSC 315 — Lecture 2: Threads and Concurrent Execution

## Learning objectives

After this lecture you should be able to:

- Contrast processes and threads
- Create POSIX threads (`pthread_create`, `pthread_join`)
- Explain race conditions on shared memory
- Interpret CPU time versus wall-clock time in multi-threaded programs

---

## 1. Processes versus threads

| | Process | Thread |
|---|---------|--------|
| Address space | Own virtual memory | Shares parent’s address space |
| Creation cost | Higher (fork) | Lower |
| Communication | IPC (pipes, sockets) | Shared variables (needs care) |
| Failure isolation | Strong | One thread crash can take down process |

**Threads** enable parallelism within one program — all threads see the same global variables and heap.

---

## 2. POSIX threads

Basic pattern:

```c
void *worker(void *arg) {
    /* thread entry */
    return NULL;
}

pthread_t t;
pthread_create(&t, NULL, worker, NULL);
pthread_join(t, NULL);  /* wait for completion */
```

Compile with `-lpthread`.

---

## 3. Race conditions

A **race condition** occurs when correctness depends on scheduling order.

Classic example — two threads increment a shared counter:

```c
// unsafe
count = count + 1;  // load, add, store — not atomic
```

Interleaved loads and stores produce lost updates. **Fixes:**

- **Mutex** (`pthread_mutex_t`) around critical section
- **Atomic** operations where available
- **Redesign** to avoid shared mutable state (per-thread accumulators, then merge)

---

## 4. Thread-safe random numbers

`rand()` uses hidden global state — unsafe across threads. Use **`rand_r(unsigned *seed)`** with a per-thread seed.

---

## 5. Measuring performance

`clock()` returns **process CPU time** (sum across threads), not wall time:

- Parallel threads on multiple cores can accumulate CPU time faster than elapsed wall time
- Compare threaded vs serial on the **same machine** for relative speedup
- **Correctness first** — faster wrong answers are worthless

Place timing around the full parallel region in the parent after join, unless measuring per-thread work explicitly.

---

## 6. When threading helps

Threading helps **CPU-bound** work that decomposes cleanly (array chunks). It may **hurt** when:

- Synchronization overhead dominates
- Work is I/O-bound and threads mostly wait
- False sharing or lock contention serializes execution

---

## 7. Summary

| Topic | Key idea |
|-------|----------|
| Thread | Lightweight execution within a process |
| Race | Shared mutable state without synchronization |
| Mutex | Mutual exclusion for critical sections |
| pthread | Standard Unix threading API |

Concurrency correctness depends on **what** runs and **when** — not just the final values in the happy path.
