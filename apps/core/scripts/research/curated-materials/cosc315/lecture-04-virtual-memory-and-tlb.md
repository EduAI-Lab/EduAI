# COSC 315 — Lecture 4: Virtual Memory, Paging, and the TLB

## Learning objectives

After working through this lecture you should be able to:

- Explain why processes use virtual addresses instead of physical addresses directly
- Split a virtual address into VPN and offset (or segment and offset)
- Translate VPN to PFN using a page table
- Describe page faults and when the OS intervenes
- Explain the TLB’s role and the difference between TLB hit and miss
- Apply FIFO replacement when the TLB is full
- Work a numeric address-translation example by hand

---

## Introduction

Each process in a modern OS believes it owns a large, contiguous address space starting near zero. In reality, dozens of processes share **physical RAM**; their virtual pages map to **physical frames** scattered across memory — or sit on disk when not in use. **Virtual memory** provides **isolation** (one buggy program cannot read another’s passwords), **flexibility** (allocate more virtual space than physical RAM), and **sharing** (same library code mapped read-only into many processes).

Hardware and the OS cooperate: the CPU’s **MMU** translates every memory access. The **page table** is the authoritative map; the **TLB** (translation lookaside buffer) caches recent translations so common accesses avoid extra memory reads. COSC 315 labs implement simplified pagers and TLB simulators — this lecture gives the conceptual model and walk-through arithmetic you need for exams and assignments.

---

## 1. Virtual memory motivation

Without virtual memory, a program might use **physical addresses** directly — fragile and insecure:

| Problem | How VM helps |
|---------|--------------|
| Process A reads Process B’s memory | Each process has separate page tables |
| Program needs more RAM than installed | Pages can live on disk; load on demand |
| External fragmentation of RAM | Fixed-size pages map to any free frames |
| Sharing one copy of libc | Same physical frame mapped into many address spaces |

Every load/store uses a **virtual address**. The MMU translates to **physical** before hitting RAM.

---

## 2. Paging mechanics

Physical and virtual memory are divided into fixed-size **pages** (frames in physical memory). Typical page size: 4 KB = 2¹² bytes.

A virtual address splits into:

```text
|  VPN (virtual page number)  |  offset within page  |
```

- **Offset bits** = log₂(page size). For 4 KB, 12 offset bits.
- **VPN bits** = remaining address bits.

**Page table:** data structure mapping VPN → **PFN** (physical frame number). Stored in memory; OS sets pointer on context switch.

**Physical address** = (PFN × page size) + offset, equivalently `(PFN << offset_bits) | offset`.

**Valid / present bit:** if page not in RAM, entry marked invalid → **page fault** trap to OS.

---

## 3. Segmentation (brief contrast)

**Segmentation** uses variable-size **segments** (code, stack, heap) with **base + limit** registers. Logical for humans (“stack segment”), but external fragmentation hurts.

Modern x86-64 uses paging dominantly; segmentation exists in limited form. Course labs may implement **segment + offset** or **VPN + offset** modes to practice bit masks — same skill: extract fields, index table, combine.

---

## 4. Page faults

If VPN is **not present** in RAM or access violates permissions (write to read-only):

1. CPU traps to OS **page fault handler**
2. OS may load page from **swap/disk**, allocate frame, update page table
3. OS resumes faulting instruction

**Major fault** — disk I/O (milliseconds). **Minor fault** — page already in memory but not mapped (cheaper).

This is how total virtual memory can exceed physical RAM — inactive pages on disk.

---

## 5. Translation Lookaside Buffer (TLB)

Page table lives in **main memory**. A single load might need **multiple** memory accesses if every translation walked the full multi-level page table. The **TLB** is a small, fast, fully associative or set-associative **cache of translations** (VPN → PFN + permissions).

```text
Virtual Address
      |
  +---+---+---+
  | VPN | off |
  +---+---+---+
      |
   +--+--+
   | TLB |
   +--+--+
      |
  HIT | MISS
      |    +--> page table walk in memory
      |         insert mapping into TLB (evict if full)
      v
   PFN + offset --> Physical Address
```

| Event | What happens |
|-------|--------------|
| **TLB hit** | Translation without page table memory access |
| **TLB miss** | Hardware or OS consults page table, fills TLB entry |

**TLB miss** is not the same as **page fault** — miss still may find page present in RAM.

---

## 6. TLB replacement — FIFO

TLB capacity is small (dozens to hundreds of entries). On miss when TLB is **full**, evict one entry.

**FIFO (first-in, first-out):** remove the **oldest** inserted entry. Simple for coursework; not optimal (may evict hot entry), but easy to simulate in labs.

Other policies (LRU, random) appear in architecture courses; FIFO suffices for understanding **why** replacement exists.

---

## 7. Worked example

**Given:** 32-bit virtual addresses, page size 4 KB = 2¹² bytes → **12 offset bits**.

Virtual address `0x4F2A` (hex):

1. **Offset** = `0x4F2A & 0xFFF` = `0xF2A` (low 12 bits)
2. **VPN** = `0x4F2A >> 12` = `0x4` 

Suppose page table maps VPN 4 → PFN 9. TLB currently empty → **TLB miss**, load entry (4 → 9).

**Physical address** = `(9 << 12) | 0xF2A` = `0x9000 + 0xF2A` = `0x9F2A`

**Second access** to another byte in same page (same VPN): likely **TLB hit** — no page table walk.

**Practice variation:** If valid bit clear → page fault before TLB install.

---

## 8. Connection to security and performance

Later topics build on paging:

- **W^X (DEP):** pages marked executable or writable, not both — mitigates buffer overflows
- **ASLR:** randomize virtual base addresses — harder to exploit
- **Cache effects:** page table walks and TLB misses add latency; OS **huge pages** reduce TLB pressure

Understanding translation is prerequisite for reasoning about **why** a memory-heavy workload slows down beyond raw capacity.

---

## 9. Common mistakes

1. **Confusing TLB miss with page fault** — different events
2. **Wrong number of offset bits** — always log₂(page size)
3. **Forgetting permission bits** — valid PFN but write to read-only still faults
4. **FIFO eviction order** — evict oldest **TLB entry**, not oldest page in memory
5. **Mixing hex and decimal** in hand calculations — stay consistent

---

## 10. Chapter summary

Virtual memory decouples program addresses from physical RAM. **Paging** splits addresses into VPN and offset; the **page table** maps VPN to PFN; **page faults** let the OS load or protect pages. The **TLB** caches translations for speed; on a full TLB, **FIFO** (or other policies) evicts entries. Hand translation exercises in labs mirror what the MMU does in hardware — master the bit operations and the story hangs together.

---

## Key terms

| Term | Definition |
|------|------------|
| Virtual address | Address used by program |
| Physical address | Address in RAM |
| VPN / PFN | Virtual page number / physical frame number |
| Page table | Maps VPN to frame and metadata |
| Page fault | Trap when page missing or access illegal |
| TLB | Cache of recent translations |
| FIFO | Evict oldest TLB entry when full |
