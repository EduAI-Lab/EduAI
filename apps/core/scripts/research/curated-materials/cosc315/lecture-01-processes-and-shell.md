# COSC 315 — Lecture 1: Processes, the Shell, and Standard I/O

## Learning objectives

After this lecture you should be able to:

- Explain how a shell launches and manages child processes
- Describe standard input, standard output, and standard error
- Explain how a pipeline connects commands with pipes
- Outline how `fork` and `exec` cooperate to run a new program

---

## 1. Operating system roles

The OS provides:

- **Process management** — isolated execution contexts with their own virtual address spaces
- **File and I/O abstraction** — uniform read/write interface to terminals, files, pipes
- **Scheduling** — which process or thread runs on the CPU

This lecture connects user-facing shells to kernel mechanisms introduced in later labs.

---

## 2. What is a process?

A **process** is a running program: code, data, heap, stack, and OS bookkeeping (PID, file descriptors, environment).

Creating a new process on Unix typically uses:

1. **`fork()`** — child receives a copy of parent’s address space (copy-on-write optimization)
2. **`exec()`** — child replaces its image with a new program

The shell is a long-lived parent that repeatedly reads commands and spawns children.

---

## 3. Standard I/O streams

Every process starts with three open file descriptors:

| FD | Stream | Default |
|----|--------|---------|
| 0 | stdin | keyboard |
| 1 | stdout | terminal |
| 2 | stderr | terminal |

Redirects (`>`, `<`, `2>`) and pipes change where these point before `exec`.

---

## 4. Shell pipelines

A **pipeline** such as `cmd1 | cmd2` connects cmd1’s stdout to cmd2’s stdin via a **pipe** (kernel buffer).

The shell:

1. Creates a pipe
2. Forks children
3. In child 1: dup2 pipe write end → stdout; exec cmd1
4. In child 2: dup2 pipe read end → stdin; exec cmd2
5. Closes unused pipe ends in parent and children

Only the writer’s stdout and reader’s stdin need rewiring; stderr may stay on the terminal unless redirected.

---

## 5. Why this matters for systems programming

Later labs assume you can:

- Compile with `gcc` and link libraries (`-lpthread` for threads)
- Reason about **which process** owns file descriptors after fork
- Debug I/O by separating stdout and stderr

---

## 6. Summary

| Concept | Takeaway |
|---------|----------|
| Process | Running program + OS state |
| fork / exec | Standard way to run commands |
| stdin / stdout / stderr | Default I/O channels |
| Pipe | Connect output of one program to input of another |

The shell is a thin orchestration layer over process creation and file descriptor manipulation.
