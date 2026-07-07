# COSC 315 — Lecture 5: File Systems and Inodes

## Learning objectives

After working through this lecture you should be able to:

- Explain the gap between named files and raw disk blocks
- Describe a simplified disk layout (superblock, inode table, data blocks)
- List inode fields and the role of direct block pointers
- Trace create, read, write, delete, and list on a UNIX-like teaching FS
- Contrast file system allocation with virtual memory paging
- Recognize how real systems (ext4) extend the basic inode idea

---

## Introduction

Applications think in **files and directories** — `notes.txt`, `/home/student/project/`. The disk thinks in **sectors and blocks** — fixed-size chunks with no built-in names. The **file system** is the OS subsystem that bridges that gap, much as virtual memory bridges virtual addresses to physical frames.

UNIX-family systems (Linux ext4, BSD UFS) center on the **inode** (index node): a structure holding file metadata and pointers to data blocks. Directory files are special: they map human-readable names to inode numbers. COSC 315’s inode lab implements a toy file system in memory or on a small disk image — this lecture explains the concepts that lab encodes so you can debug `create`, `read`, and `delete` with a clear mental model.

---

## 1. Files as abstraction

From the application’s view:

- Open by **path name**
- Read/write **byte offsets** in a stream
- Seek, truncate, close

From the disk’s view:

- Linear array of **blocks** (e.g. 1 KB each in lab scale)
- Read block `i`, write block `j` — no “filename”

The file system maintains **metadata** (who owns the file, how big, which blocks) separately from **data blocks** (actual content bytes).

---

## 2. Disk layout (simplified teaching FS)

A small course file system might partition a 128 KB “disk” as:

| Region | Purpose |
|--------|---------|
| **Superblock** | Global metadata: total blocks, block size, inode count |
| **Inode table** | Fixed array of inodes, one slot per possible file |
| **Data blocks** | File contents and possibly indirect blocks |
| **Free block bitmap** | Which data blocks are unused |

Example constraints (lab scale): 128 KB disk, 1 KB blocks → 128 blocks; max 16 files; max 8 data blocks per file.

Real disks add boot blocks, journal areas, and multiple block groups — same ideas at larger scale.

---

## 3. What is an inode?

An **inode** stores everything about a file **except its name**:

| Field (conceptual) | Purpose |
|--------------------|---------|
| File type | regular file, directory, symlink, etc. |
| Size | current length in bytes |
| Link count | hard links pointing to this inode |
| Owner / permissions | Unix mode bits |
| Timestamps | modify, access, change |
| Direct block pointers | indices of data blocks holding content |
| (Indirect pointers in real FS) | point to blocks of pointers for large files |

**Names live in directories.** A directory is a file whose content is a list of `(name, inode_number)` entries.

```text
Path: /home/alice/report.txt
  → directory "home" maps alice → inode 5
  → directory inode 5 maps report.txt → inode 42
  → inode 42 points to data blocks with file bytes
```

---

## 4. Reading a file — step by step

**Read(`report.txt`, offset, length):**

1. Walk path components starting at root inode (known fixed number, e.g. 1)
2. For each directory component, search directory entries for name → next inode
3. At file inode, compute **block index** = offset / block_size
4. **Byte offset within block** = offset % block_size
5. Fetch data block via direct pointer (or indirect chain in full FS)
6. Copy requested bytes; if span crosses block boundary, follow next pointer

**Bounds check:** if offset + length &gt; file size, return partial read or error per API spec.

---

## 5. Writing and growing files

**Write** may need **new blocks** if write extends past current size:

1. Locate inode (create if new file and path valid)
2. For each new block required, allocate from free bitmap
3. Update direct pointers in inode
4. Update **size** field
5. Write bytes into data blocks

**Truncate / delete** frees blocks and inode (when link count hits zero). Directory entry removed first so path no longer resolves.

**Fragmentation:** free blocks may be scattered; toy FS with small max blocks per file sidesteps huge files; real FS uses extents or indirect blocks.

---

## 6. Directory operations

| Operation | Steps |
|-----------|-------|
| **create** | Allocate inode, initialize metadata, add `(name, inode#)` to parent directory |
| **delete** | Remove directory entry, decrement link count, free blocks if zero |
| **ls** | Read directory file as list of entries; stat each inode for size/type |
| **mkdir** | Allocate inode as directory type; add `.` and `..` entries |

**`.` and `..`:** standard directory entries for self and parent — simplify path walking.

---

## 7. Comparison to virtual memory (Lecture 4)

| Memory virtualization | File system |
|-----------------------|-------------|
| Virtual page | Byte range of file |
| Page table / TLB | Inode + block pointers |
| Page fault → load from disk | Read block from disk if not in buffer cache |
| Physical frame | Disk block |
| Page table entry valid bit | Inode allocated vs free |

Both layers **indirect** — programs use logical names/addresses; OS maps to physical resources.

**Buffer cache:** OS caches disk blocks in RAM — repeated reads avoid disk I/O analogous to TLB hits.

---

## 8. Real systems beyond the lab

Production file systems add:

- **Indirect and doubly indirect blocks** — files larger than a few pointers
- **Journaling** — crash consistency (ext4 journal)
- **Permissions, ACLs, symlinks**
- **Directories as B-trees or hash tables** for large folders

The lab inode teaches the **core invariant**: metadata in inode, names in directories, bytes in data blocks. ext4 is that idea plus scale and reliability engineering.

---

## 9. Common mistakes (lab debugging)

1. **Forgetting to update size** after write — read returns wrong length
2. **Leaking blocks on delete** — free bitmap wrong, disk “fills up”
3. **Directory entry without initialized inode** — ls shows garbage
4. **Off-by-one block index** — use integer division for block number
5. **Confusing path walk with inode number** — names only in directories

---

## 10. Chapter summary

File systems turn block-oriented disks into named, byte-addressable files. **Inodes** hold metadata and block pointers; **directories** map names to inode numbers. Create, read, write, delete, and list decompose into allocation, pointer updates, and bitmap management. The model parallels virtual memory — another indirection layer the OS provides so applications can focus on data, not sectors.

---

## Key terms

| Term | Definition |
|------|------------|
| Inode | File metadata and block pointers (no name) |
| Superblock | File system global parameters |
| Directory | Maps filenames to inode numbers |
| Direct block pointer | Points to data block |
| Free bitmap | Tracks available data blocks |
| Hard link | Directory entry sharing same inode |
