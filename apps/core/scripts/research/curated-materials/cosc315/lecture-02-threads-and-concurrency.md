# COSC 315 — Lecture 2: Threads and Concurrent Execution

## Learning objectives

After working through this lecture you should be able to:

- Contrast processes and threads and explain when each is appropriate
- Create POSIX threads with `pthread_create` and `pthread_join`
- Identify race conditions on shared mutable memory
- Apply mutexes or redesign to avoid lost updates
- Use `rand_r` instead of `rand` in multi-threaded C programs
- Interpret CPU time versus wall-clock time when measuring parallel code

---

## Introduction

A web server handling thousands of connections, a game rendering graphics while simulating physics, a lab program summing array chunks in parallel — all need **more than one flow of execution** inside a program. **Processes** provide strong isolation but expensive creation and awkward shared-memory communication. **Threads** are lighter-weight execution units that share one process’s address space, making parallel work on shared data possible — and **race conditions** almost inevitable if you are careless.

Lecture 1 showed how the shell creates **processes**. This lecture zooms **inside** one process to **threads**, the POSIX `pthread` API, and the first synchronization primitives you will extend in Lecture 3 (semaphores). The theme throughout COSC 315 concurrency labs: **correctness depends on scheduling order**, not just the result you see when you run once on your laptop.

---

## 1. Processes versus threads

| | Process | Thread |
|---|---------|--------|
| Address space | Separate virtual memory | Shares parent’s code, heap, globals |
| Creation | `fork` — relatively costly | `pthread_create` — lighter |
| Communication | Pipes, sockets, shared memory (explicit) | Direct read/write of shared variables |
| Crash isolation | One process death does not kill unrelated processes | One fatal error in a thread can terminate whole process |
| Scheduling unit | Process and threads within it | Thread is schedulable |

**Analogy:** A process is a building with its own address; threads are coworkers in the same building sharing a whiteboard (global variables, heap). Coworkers can collaborate faster than mailing letters (IPC), but they can also overwrite each other’s notes without rules.

**When to use threads:** CPU-bound work that splits cleanly (array chunks, independent tasks with periodic sync). **When to hesitate:** heavy sharing, fine-grained locking, or I/O-bound work where threads mostly wait — sometimes async I/O or multiple processes simplify reasoning.

---

## 2. POSIX threads basics

```c
#include <pthread.h>

void *worker(void *arg) {
    int id = *(int *)arg;
    /* thread work */
    return NULL;
}

int main(void) {
    pthread_t t;
    int id = 1;
    pthread_create(&t, NULL, worker, &id);
    pthread_join(t, NULL);  /* wait until worker finishes */
    return 0;
}
```

Compile: `gcc -o prog prog.c -lpthread`

| Function | Role |
|----------|------|
| `pthread_create` | Start thread at `worker` with argument `arg` |
| `pthread_join` | Block until thread exits; optional retval |
| `pthread_exit` | End calling thread |

**Argument lifetime:** Passing pointer to stack variable `id` is unsafe if `main` returns before thread reads it — use heap allocation or join before stack frame disappears.

---

## 3. Race conditions — the core problem

A **race condition** occurs when program correctness depends on the **interleaving** of operations by threads. The classic counter example:

```c
/* UNSAFE — two threads, shared int count */
void *increment(void *arg) {
    for (int i = 0; i < 1000000; i++)
        count = count + 1;  /* load, add, store — not atomic */
    return NULL;
}
```

Each `count + 1` compiles to roughly: load from memory → add in register → store back. Thread A and B can both load the same value, both add 1, both store — **one increment lost**.

**Symptom:** Final count &lt; expected; result **varies** between runs.

**Fixes:**

1. **Mutex** (`pthread_mutex_t`) — only one thread in critical section at a time
2. **Atomics** (`stdatomic` in C11, or platform atomics) — hardware guarantees on single variable
3. **Redesign** — per-thread partial sums, merge after `join` (often best for summation labs)

Correctness first; a fast wrong answer is worthless.

---

## 4. Mutex pattern

```c
pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

void *safe_increment(void *arg) {
    for (int i = 0; i < N; i++) {
        pthread_mutex_lock(&lock);
        count++;
        pthread_mutex_unlock(&lock);
    }
    return NULL;
}
```

**Critical section** — code between lock and unlock that touches shared state.

**Rules:**

- Lock before accessing shared mutable data
- Unlock on all paths (including errors — consider careful structure)
- Hold locks **briefly** — long critical sections limit parallelism

Lecture 3 generalizes mutual exclusion with **semaphores** and discusses deadlock when multiple locks interact.

---

## 5. Thread-safe random numbers

`rand()` uses hidden global state. Two threads calling `rand()` concurrently corrupt internal state.

**Use `rand_r(unsigned *seed)`** with a **per-thread seed**:

```c
unsigned seed = (unsigned)pthread_self() ^ (unsigned)time(NULL);
int r = rand_r(&seed);
```

Each thread maintains its own seed — no shared mutable generator state.

---

## 6. Measuring performance

`clock()` in C measures **approximate process CPU time** (aggregated across threads in many implementations), not wall-clock elapsed time.

| Metric | Measures |
|--------|----------|
| Wall time (`time()`, `clock_gettime`) | Real-world elapsed seconds |
| CPU time (`clock()`) | Time charged to process on CPU |

On a 4-core machine, four threads each busy for 1 second of CPU may finish in ~1 second wall time — CPU time sums toward 4 seconds.

**Lab guidance:**

- Place timing around the full parallel region in parent **after** all `join`s
- Compare threaded vs serial on the **same machine** for speedup estimates
- Report both correctness and timing — speedup &lt; 1 means overhead dominated

**Amdahl’s law (intuition):** If 10% of work is serial, infinite cores give at most 10× speedup. Identify serial bottlenecks (locks, join, single-thread setup).

---

## 7. When threading helps and hurts

**Helps:**

- Large independent array partitions (sum, map, matrix blocks)
- Multiple CPU-bound tasks with rare synchronization

**Hurts or breaks even:**

- Lock contention serializes threads
- Work too small — thread creation overhead exceeds savings
- **False sharing** — threads on different cores modify variables on same cache line, causing cache coherence traffic

**I/O-bound:** Threads block waiting on disk or network; more threads may improve throughput but not CPU parallelism.

---

## 8. Common mistakes

1. **Data race on shared globals** — “it worked once” is not proof
2. **Returning pointer to stack from thread** — undefined behavior
3. **Joining wrong thread or not joining** — leaks or zombie threads
4. **Using `rand()` across threads** — subtle corruption
5. **Timing inside worker without aggregation** — misleading per-thread numbers

---

## 9. Chapter summary

Threads share a process’s memory, enabling efficient parallel work at the cost of careful synchronization. POSIX `pthread` provides create/join; **mutexes** protect critical sections; **per-thread state** avoids hidden globals like `rand()`. Measure wall vs CPU time honestly. Master races and locks here — Lecture 3 extends to semaphores, deadlock, and fairness policies in traffic-style labs.

---

## Key terms

| Term | Definition |
|------|------------|
| Thread | Execution stream within a process |
| Race condition | Outcome depends on scheduling interleaving |
| Critical section | Code accessing shared state exclusively |
| Mutex | Mutual exclusion lock |
| pthread_join | Wait for thread termination |
| rand_r | Reentrant random with per-thread seed |
