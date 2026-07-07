# COSC 315 — Lecture 5: File Systems and Inodes

## Learning objectives

After this lecture you should be able to:

- Explain how a file name maps to disk blocks
- Describe inode fields and direct block pointers
- Contrast file system allocation with memory paging
- Outline create, read, write, delete, and list operations on a simple UNIX-like FS

---

## 1. Files as abstraction

Applications see **named files** and byte streams. The disk stores **blocks** (fixed-size sectors). The file system bridges the gap — similar in spirit to how virtual memory maps virtual pages to frames.

---

## 2. Disk layout (simplified)

A small teaching file system might use:

- One **superblock** — metadata (size, block count)
- **Inode table** — one inode per file
- **Data blocks** — file contents and metadata blocks

Example constraints (course lab scale): 128 KB disk, 1 KB blocks, max 16 files, max 8 blocks per file.

---

## 3. What is an inode?

An **inode** stores everything about a file **except its name**:

| Field (conceptual) | Purpose |
|--------------------|---------|
| File type | regular, directory, etc. |
| Size | bytes in file |
| Direct block pointers | where data lives on disk |
| Link count | hard links |

The **directory** maps human-readable names → inode numbers.

---

## 4. Reading and writing

**Read(file, offset, length):**

1. Resolve name to inode
2. Compute which block = offset / block_size
3. Follow pointer from inode; read partial block if needed

**Write** may allocate new blocks if file grows; update inode size and pointers.

**Delete** frees inode and all data blocks for reuse.

---

## 5. Allocation and fragmentation

**Block allocation bitmap** or free list tracks unused blocks.  
**Fragmentation** — free space split into small holes; may prevent allocating large contiguous runs (less issue when files use fixed max blocks in toy FS).

---

## 6. Comparison to paging

| Memory virtualization | File system |
|-----------------------|-------------|
| Virtual page | File byte range |
| Page table / TLB | Inode + block pointers |
| Page fault | Read block from disk if not cached |
| Frame | Disk block |

---

## 7. Operations summary

| Operation | Main steps |
|-----------|------------|
| create | Allocate inode, add directory entry |
| write | Allocate blocks, update inode size |
| read | Lookup blocks via inode, bounds check |
| delete | Remove directory entry, free blocks and inode |
| ls | List directory entries with sizes |

---

## 8. Summary

Inode-based designs (ext4, UFS family) scale to directories, indirect blocks, and permissions. The simplified lab inode teaches the core idea: **metadata separate from data blocks**, names in directories, bytes addressed through block pointers.
