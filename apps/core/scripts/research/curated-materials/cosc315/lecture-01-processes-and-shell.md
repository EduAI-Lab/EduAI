# COSC 315 — Lecture 1: Processes, the Shell, and Standard I/O

## Learning objectives

After working through this lecture you should be able to:

- Describe the main responsibilities of an operating system
- Explain what a process is and how it differs from a program on disk
- Trace how a shell uses `fork` and `exec` to run a command
- Explain standard input, standard output, and standard error
- Describe how a shell builds a pipeline with pipes and `dup2`
- Connect these ideas to later labs (threads, synchronization, VM)

---

## Introduction

When you type `ls | grep foo` in a terminal, you are not talking to the CPU directly. You are speaking to a **shell** — a program whose job is to read your commands, create **processes**, wire their input and output together, and wait for them to finish. Underneath, the **operating system kernel** schedules those processes, isolates their memory, and implements **pipes** as kernel buffers.

COSC 315 builds from this user-visible layer down to threads, semaphores, virtual memory, and file systems. Understanding **processes** and **file descriptors** is prerequisite for everything else: a thread is an execution stream *inside* a process; virtual memory gives each process its own address space; file systems turn named files into disk blocks. This lecture explains the shell as a case study in how Unix-style systems create and connect processes.

---

## 1. Operating system roles

The OS is the layer between hardware and applications. For this course, four roles matter most:

| Role | What it means for you |
|------|------------------------|
| **Process management** | Each running program gets isolated memory and a schedule slice |
| **File and I/O abstraction** | Terminals, files, sockets, pipes look like byte streams |
| **Scheduling** | Which process/thread runs on which CPU core at each moment |
| **Protection** | Processes cannot read each other’s memory without explicit IPC |

Application programmers rarely syscall directly into the kernel for process creation — they invoke the shell or libraries (`system`, `posix_spawn`). Systems programmers and OS coursework peel back that abstraction.

---

## 2. Program versus process

A **program** is a file on disk: instructions and static data. A **process** is a **running instance** of that program plus dynamic state:

- Code and data segments
- Heap (dynamic allocation)
- Stack (function calls, local variables)
- OS bookkeeping: **PID** (process ID), open **file descriptors**, environment variables, current working directory

You can run two terminals with `vim` twice — one program, **two processes**, two PIDs, two independent memory spaces.

---

## 3. Creating processes: `fork` and `exec`

Unix tradition separates **creating a new process** from **loading a new program**:

1. **`fork()`** — child process is created as a near-copy of parent (copy-on-write makes this efficient)
2. **`exec()` family** — child replaces its memory image with a new program (same PID in the child after fork, new code)

The **shell** loop (simplified):

```
while (true) {
    read command line;
    fork();
    if (child) {
        setup redirects and pipes;
        exec(command);
    } else {
        wait for child;
    }
}
```

**Why two steps?** Between `fork` and `exec`, the child can rearrange file descriptors — that is how redirection and pipes work **before** the target program starts.

**Common mistake:** Thinking `exec` creates a process. `exec` **replaces** the current process image; you need `fork` (or `posix_spawn`) to get a new process running a new program while the shell survives.

---

## 4. Standard I/O streams

Every process starts with three open file descriptors:

| FD | Name | Default connection |
|----|------|------------------|
| 0 | stdin | keyboard / terminal input |
| 1 | stdout | terminal output |
| 2 | stderr | terminal output (errors) |

Programs conventionally read user input from stdin and write normal output to stdout. **Diagnostics and errors** go to stderr so you can redirect stdout to a file while still seeing errors on the terminal:

```bash
./program > out.txt    # stdout → file; stderr still on terminal
./program 2> err.txt   # stderr → file
```

The shell sets up these descriptors **before** `exec` using `dup2(oldfd, newfd)` to copy a pipe end or file onto fd 0, 1, or 2.

---

## 5. Shell pipelines — step by step

Command: `cmd1 | cmd2`

Goal: stdout of `cmd1` becomes stdin of `cmd2`.

**Kernel provides a pipe** — a small buffer with read end and write end.

**Shell actions:**

1. `pipe(fd)` — create `fd[0]` read, `fd[1]` write
2. `fork()` — **child 1**
   - `dup2(fd[1], STDOUT_FILENO)` — stdout → pipe write
   - close unused pipe ends
   - `exec(cmd1)`
3. `fork()` — **child 2**
   - `dup2(fd[0], STDIN_FILENO)` — stdin ← pipe read
   - close unused pipe ends
   - `exec(cmd2)`
4. Parent closes both pipe ends (important — otherwise `cmd2` never sees EOF)
5. Parent `wait`s for children

Only the writer’s stdout and reader’s stdin are rewired; stderr often stays on the terminal unless `2>` is used.

**Why close unused ends?** A pipe does not signal EOF on the read side until **all** write ends are closed. If the parent keeps the write end open, `cmd2` may hang reading forever.

---

## 6. Redirection without pipes

`cmd > file.txt` — shell opens `file.txt`, `dup2` onto stdout, then `exec(cmd)`.  
`cmd < input.txt` — `dup2` file onto stdin.

Redirection and pipes compose: `cmd1 < in.txt | cmd2 > out.txt`

---

## 7. Why this matters for systems programming

Later labs assume you can:

- Compile with `gcc` and link libraries (`-lpthread` for threads)
- Reason about **which process owns** each file descriptor after `fork`
- Debug I/O by separating stdout and stderr
- Understand that **each process** has its own descriptor table — `dup2` in the child does not change the parent’s table

When a lab says “implement a shell that supports pipelines,” you are implementing the orchestration described above — not reimplementing the kernel pipe.

---

## 8. Common mistakes

1. **Forgetting to close pipe fds in parent** — hung pipeline
2. **Confusing shell builtins with external programs** — `cd` is often builtin (cannot `exec`); `ls` is external
3. **Assuming child inherits redirect setup after failed exec** — always check `exec` return (-1); only successful exec does not return
4. **Mixing buffered C library I/O with pipe timing** — flush stdout before relying on pipe data in simple C programs

---

## 9. Chapter summary

Processes are running programs with isolated state. The shell repeatedly **forks**, **rewires** stdin/stdout/stderr with **dup2** and **pipes**, and **execs** user commands. Standard streams unify terminals, files, and pipes as file descriptors — the same abstraction the kernel uses for I/O throughout COSC 315.

---

## Key terms

| Term | Definition |
|------|------------|
| Process | Running program instance with OS state |
| PID | Process identifier |
| fork | Create child copy of process |
| exec | Replace process image with new program |
| stdin / stdout / stderr | Standard I/O file descriptors 0, 1, 2 |
| Pipe | Kernel buffer connecting writer to reader |
| dup2 | Duplicate fd onto another fd number |
