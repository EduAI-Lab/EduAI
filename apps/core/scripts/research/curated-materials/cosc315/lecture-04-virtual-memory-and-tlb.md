# COSC 315 — Lecture 4: Virtual Memory, Paging, and the TLB

## Learning objectives

After this lecture you should be able to:

- Split a virtual address into VPN and offset (or segment and offset)
- Translate VPN to PFN using a page table
- Explain page faults and why the TLB exists
- Describe TLB hit/miss handling and FIFO replacement

---

## 1. Virtual memory motivation

Programs use **virtual addresses**; hardware maps them to **physical addresses** in RAM. Benefits:

- **Isolation** — processes cannot access each other’s memory
- **Larger address space** — not all pages need be in RAM at once
- **Sharing** — same physical page mapped into multiple address spaces

---

## 2. Paging

Memory is divided into fixed-size **pages** (e.g. 4 KB). Virtual address:

```
|  VPN (virtual page number)  |  offset within page  |
```

Number of offset bits = log₂(page size). VPN bits = remaining address bits.

**Page table:** array or structure mapping VPN → PFN (physical frame number).  
**Physical address** = PFN concatenated with offset (frame size equals page size).

---

## 3. Segmentation (brief)

An alternative view uses **segment number + offset** with a **base and bounds** per segment. Paging is dominant in modern OSes; segmentation appears in hybrid or historical designs. Labs may implement both modes to practice bit masks and shifts.

---

## 4. Page faults

If VPN is not present or not allowed:

- CPU traps to OS **page fault** handler
- OS may load page from disk, update page table, resume

This is why virtual memory can exceed physical RAM — inactive pages live on disk.

---

## 5. Translation Lookaside Buffer (TLB)

Page table lives in **main memory** — each access would cost extra loads. The **TLB** is a small hardware cache of recent VPN → PFN translations.

```
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
      |    +--> page table lookup, then insert in TLB
      v
   PFN + offset --> Physical Address
```

**TLB hit:** translation without page table memory access.  
**TLB miss:** consult page table, insert mapping.

---

## 6. TLB replacement (FIFO)

TLB has fixed capacity (e.g. 8–64 entries). On miss when full, **evict** one entry. **FIFO** removes the oldest inserted entry — simple, not optimal but easy to reason about for coursework.

---

## 7. Worked example

Page size = 4 KB = 2¹² bytes → 12 offset bits.

Virtual address `0x4F2A`:

- Offset = `0x4F2A & 0xFFF` = `0xF2A`
- VPN = `0x4F2A >> 12` = `0x4`

If TLB maps VPN 4 → PFN 9, physical address = `(9 << 12) | 0xF2A`.

---

## 8. Summary

| Component | Role |
|-----------|------|
| Page table | Authoritative VPN → PFN map |
| TLB | Fast cache of translations |
| Page fault | OS handles missing/invalid page |
| FIFO | Eviction policy when TLB is full |

Understanding address translation is prerequisite for reasoning about cache performance, OS scheduling, and security (W^X, ASLR build on these ideas).
