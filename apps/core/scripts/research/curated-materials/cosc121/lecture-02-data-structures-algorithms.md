# COSC 121 — Lecture 2: Data Structures and Algorithm Analysis

## Learning objectives

After working through this lecture you should be able to:

- Explain what an abstract data type (ADT) is and why it matters for program design
- Compare stacks, queues, lists, trees, heaps, graphs, and hash tables for typical operations
- Use Big-O notation to reason about growth as input size increases
- Walk through BST search, insert, and two-child deletion step by step
- Choose BFS versus DFS for a given graph problem
- Connect lab topics (stacks, BSTs, heaps, graphs, hashing) to the underlying theory

---

## Introduction

In Lecture 1 you learned to organize code with classes and objects. In practice, almost every interesting program also needs to **store and retrieve data efficiently**. Should you use an array, a linked list, a tree, or a hash table? The answer depends on which operations you perform most often — search, insert at the front, find the minimum, traverse neighbors in a network.

This lecture is the conceptual backbone for COSC 121’s data-structures strand (including material from COSC 222 labs): stacks and queues, binary search trees, priority queues, graphs, and hash tables. We focus on **what each structure guarantees** and **how expensive common operations are** as the amount of data grows. That analysis — asymptotic complexity — is how engineers compare designs without benchmarking every possible input size on every machine.

---

## 1. Abstract data types (ADTs)

An **abstract data type** separates **what operations mean** from **how they are implemented**. You can define a `Stack` by its behavior:

- `push(x)` — add x on top
- `pop()` — remove and return the top element
- `peek()` — view the top without removing

Whether the stack is backed by an array or a linked list is an **implementation detail**. Callers who only use `push` and `pop` should not care — until performance matters.

| ADT | Core operations | Typical uses |
|-----|-----------------|--------------|
| Stack | push, pop, peek | Undo stacks, DFS, parsing expressions |
| Queue | enqueue, dequeue | BFS, job scheduling, buffering |
| List | insert, remove, get at index | General sequences |
| Map / Set | put, get, contains | Fast lookup, deduplication |
| Priority queue | insert, extract-min/max | Dijkstra, event simulation |

**Choosing a structure** is a trade-off among **time complexity**, **space**, and **implementation complexity**. There is no universal “best” structure — only best for a given workload.

---

## 2. Asymptotic analysis (Big-O)

When we say an algorithm is “O(n),” we mean: as input size n grows large, the number of basic steps grows **at most proportionally to n** (up to constant factors). We ignore small inputs and constant overhead because they do not predict behavior at scale.

| Notation | Intuition | Example |
|----------|-----------|---------|
| O(1) | Constant time | Array index `a[i]` |
| O(log n) | Halve problem each step | Balanced BST search |
| O(n) | Scan all elements once | Find max in unsorted array |
| O(n log n) | Divide and combine | Merge sort, heap sort |
| O(n²) | Nested loops over n | Naive bubble sort, naive matrix multiply |

**Important nuance:** Big-O describes **upper-bound growth**, not exact running time. Two O(n) algorithms can differ by large constants; for small n, a simple O(n²) algorithm may be faster. Still, for large n, O(n log n) sorting beats O(n²) sorting reliably.

### Sorting algorithms (course context)

**Quicksort** picks a pivot, partitions, recurses. Average case O(n log n); worst case O(n²) if pivots are always min or max (e.g. already-sorted input with naive pivot choice). In practice, quicksort is often very fast due to good cache behavior.

**Mergesort** divides in half, sorts each half, merges. Always O(n log n), **stable** (preserves relative order of equal keys), but needs O(n) extra space for the merge buffer.

**When to care:** For coursework, you implement these to learn recursion and analysis. In production Java, you usually call `Arrays.sort` or `Collections.sort` — but you still need to know **when** sorting is the bottleneck and **which** properties (stability) matter.

---

## 3. Linked structures

### Singly linked list

Each **node** stores `data` and a `next` pointer. The list head points to the first node; the last node’s `next` is `null`.

- Insert at **head**: O(1) — update head pointer
- Insert at **tail** (without tail pointer): O(n) — walk to end
- Access i-th element: O(n) — walk i steps

**Pointer discipline:** If you lose the reference to a node, you lose everything after it in the list. When deleting, always update the predecessor’s `next` before discarding the node.

### Doubly linked list

Adds `prev` pointer. Removal given a **reference to the node** is O(1) because you can unlink without scanning from the head. Trade-off: extra memory per node and more pointer updates on insert.

### Binary search tree (BST)

For every node: all keys in the **left subtree** are less than the node’s key; all keys in the **right subtree** are greater (assuming no duplicates, or a consistent duplicate policy).

- **Search:** start at root; go left or right — O(h) where h = height
- **Insert:** search for position, attach new leaf — O(h)
- **Inorder traversal:** visit left, node, right — yields **sorted order**

**Balanced** BST (AVL, red-black): h = O(log n). **Skewed** BST (insert sorted sequence into naive BST): h = O(n) — degrades to a linked list.

---

## 4. BST deletion (two children) — worked example

Deleting a node with **two children** is the subtle case. You cannot simply remove the node without breaking the BST property.

**Strategy:** Replace the node’s key with the **inorder successor** (smallest key in the right subtree) or **inorder predecessor** (largest in left subtree), then delete the successor/predecessor node (which has at most one child).

**Example:** Delete key **50** from:

```
        50
       /  \
     30    70
         /
       55
```

1. Inorder successor of 50 = leftmost in right subtree = **55**
2. Copy 55’s value into node 50 (now the tree “looks” like 55 is at the root position logically)
3. Delete the original 55 node from the right subtree — now a 0- or 1-child delete

**Why successor works:** The successor has no left child (it is the minimum of the right side), so deleting it does not leave a hole that violates BST order.

**Common mistake:** Deleting by “finding max of left subtree” works too, but students mix up successor vs predecessor and delete the wrong node, leaving duplicates or broken order.

---

## 5. Heaps and priority queues

A **binary min-heap** stored in an array satisfies the **heap property:** each parent’s value ≤ both children’s values (for min-heap). The minimum is always at index 0.

For node at index `i`:

- Parent: `(i - 1) / 2`
- Left child: `2i + 1`
- Right child: `2i + 2`

| Operation | Algorithm | Time |
|-----------|-----------|------|
| insert | Add at end, **sift up** | O(log n) |
| extract-min | Swap root with last, shrink, **sift down** | O(log n) |
| peek-min | Read index 0 | O(1) |

**Use cases:** Dijkstra’s shortest path (always process closest unvisited vertex), discrete event simulation, “process highest-priority job next.” A heap is **not** a sorted array — it only guarantees the root is minimal; extracting all elements in order is equivalent to heap sort.

---

## 6. Graphs

A **graph** G = (V, E) has vertices V and edges E. Edges may be **directed** (one-way) or **undirected**.

### Representations

| Representation | Space | Edge lookup | Iterate neighbors |
|----------------|-------|-------------|-------------------|
| Adjacency list | O(V + E) | O(degree) | O(degree) — good for sparse graphs |
| Adjacency matrix | O(V²) | O(1) | O(V) |

**Sparse** graphs (few edges relative to V²) favor adjacency lists. **Dense** graphs may justify a matrix.

### BFS — breadth-first search

Uses a **queue**. Explore the start vertex, then all vertices one edge away, then two edges away, and so on — **layer by layer**.

**Properties:**

- Finds **shortest path in unweighted** graphs (fewest edges)
- Useful for “closest,” “minimum hops,” level-order traversal

### DFS — depth-first search

Uses a **stack** (explicit or recursion). Go as deep as possible along one path before backtracking.

**Properties:**

- Useful for connectivity, cycle detection, topological sort
- Does **not** guarantee shortest path in unweighted graphs

**Choosing:** Need fewest edges? BFS. Need to explore structure, detect cycles, or order dependencies? DFS.

### Minimum spanning tree (MST)

Connect all vertices with minimum total edge weight. **Kruskal:** sort edges by weight, add if it does not form a cycle (union-find). **Prim:** grow tree from a start vertex, always add cheapest edge to a new vertex. Both are greedy; both yield optimal MST for connected graphs with unique weights (ties need tie-breaking rules).

---

## 7. Hash tables

A **hash function** maps keys to bucket indices. **Collisions** (two keys → same bucket) are inevitable; we handle them:

- **Chaining:** each bucket is a list of entries — simple, works well with resizing
- **Open addressing:** probe for next free slot (linear probing, quadratic probing)

**Load factor** α = number of entries / number of buckets. When α exceeds a threshold (often ~0.75), **resize** and rehash to keep average chain length small.

Average-case search/insert/delete: **O(1)** with a good hash and resizing. Worst case: **O(n)** if all keys collide.

**Hash tables do not keep sorted order.** If you need sorted traversal, use a BST or sort after collecting keys.

---

## 8. Putting it together — summary table

| Structure | Search | Insert | Delete | Notes |
|-----------|--------|--------|--------|-------|
| Unsorted array | O(n) | O(1) amortized append | O(n) | Simple, cache-friendly |
| BST (balanced) | O(log n) | O(log n) | O(log n) | Ordered traversal |
| Hash table | O(1) avg | O(1) avg | O(1) avg | Not ordered |
| Binary heap | — | O(log n) | O(log n) min | Priority queue only |
| Stack / queue | — | O(1) at designated end | O(1) | Restricted access |

---

## 9. How this connects to your labs

| Lab theme | Structures involved | Skills practiced |
|-----------|---------------------|------------------|
| Stack applications | Stack ADT | LIFO reasoning, DFS |
| BST | Tree nodes, recursion | Insert/search/delete, inorder |
| Priority queue / heap | Array heap | Sift up/down |
| Graphs | Adjacency list, BFS/DFS | Shortest path vs exploration |
| Hash table | Buckets, chaining | Hash function, collision handling |
| Sorting | Arrays, recursion | Merge sort, quicksort analysis |

When debugging lab code, ask: **Which operation is in the hot path?** If you search often, O(n) list scan hurts. If you only append at the end and rarely search, an array or ArrayList may be ideal.

---

## 10. Chapter summary

Data structures are the vocabulary of efficient programs. **ADTs** define behavior; **implementations** trade time and space. **Big-O** lets you compare designs as data grows. **Trees** give ordered search; **heaps** give fast min/max; **graphs** model relationships; **hash tables** give fast average lookup. Mastering BST deletion, BFS vs DFS, and heap operations prepares you for both exams and implementation assignments.

---

## Key terms

| Term | Definition |
|------|------------|
| ADT | Operations defined independently of implementation |
| Big-O | Asymptotic upper bound on growth |
| BST | Binary tree with ordered keys |
| Inorder successor | Smallest key larger than a given node |
| Heap | Tree with heap-order property, often array-backed |
| BFS / DFS | Layer-by-layer vs depth-first graph traversal |
| MST | Minimum-weight spanning tree |
| Load factor | Entries per bucket in a hash table |
