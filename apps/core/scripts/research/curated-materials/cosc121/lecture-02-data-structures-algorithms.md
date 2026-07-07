# COSC 121 — Lecture 2: Data Structures and Algorithm Analysis

## Learning objectives

After this lecture you should be able to:

- Compare stacks, queues, lists, trees, heaps, graphs, and hash tables
- State time complexity for common operations using Big-O notation
- Explain BST search, insert, and two-child deletion
- Describe when BFS versus DFS is appropriate on a graph

---

## 1. Abstract data types (ADTs)

An **ADT** separates **what** operations mean from **how** they are implemented.

| ADT | Operations | Typical uses |
|-----|------------|--------------|
| Stack | push, pop, peek | DFS, undo, parsing |
| Queue | enqueue, dequeue | BFS, scheduling |
| List | insert, remove, get | Sequences, iteration |
| Map / Set | put, get, contains | Lookup, deduplication |

Choosing a structure affects **time**, **space**, and **code complexity**.

---

## 2. Asymptotic analysis (Big-O)

We describe growth as input size \(n\) increases:

| Notation | Meaning |
|----------|---------|
| O(1) | Constant time |
| O(log n) | Halve problem each step (balanced tree search) |
| O(n) | Linear scan |
| O(n log n) | Efficient sorting (merge sort, heap sort) |
| O(n²) | Nested loops (naive matrix multiply, bubble sort) |

**Quicksort:** O(n log n) average, O(n²) worst with bad pivot choice.  
**Mergesort:** O(n log n) always, stable, needs O(n) extra space.

---

## 3. Linked structures

**Singly linked list:** each node stores `data` and `next`.  
**Doubly linked list:** adds `prev` for O(1) removal given a node reference.

**BST (binary search tree):** for each node, left subtree keys < node < right subtree keys.

- Search / insert: O(h) where h = height
- Balanced BST: h = O(log n)
- Skewed BST: h = O(n) — degrades to linked list

**Delete with two children:** replace node with **inorder successor** (minimum of right subtree) or **predecessor** (maximum of left), then delete the leaf duplicate case.

---

## 4. Heaps and priority queues

A **binary min-heap** stored in an array satisfies: parent ≤ both children. Index relations for node i:

- Parent: `(i - 1) / 2`
- Left child: `2i + 1`
- Right child: `2i + 2`

| Operation | Steps |
|-----------|-------|
| insert | Add at end, sift-up |
| extract-min | Swap root with last, shrink, sift-down |

Used for Dijkstra’s algorithm, event simulation, and “always process smallest” tasks.

---

## 5. Graphs

**Representations:**

- **Adjacency list** — space O(V + E); good for sparse graphs
- **Adjacency matrix** — O(1) edge lookup; space O(V²)

**BFS (breadth-first search):** queue-based; explores layer by layer. Finds **shortest path in unweighted** graphs.

**DFS (depth-first search):** stack or recursion; useful for connectivity, cycle detection, topological sort.

**Minimum spanning tree (MST):** connect all vertices with minimum total edge weight (Kruskal sorts edges + union-find; Prim grows tree from a start vertex).

---

## 6. Hash tables

Map keys to buckets with a **hash function**. Collisions handled by:

- **Chaining** — bucket holds a list of entries
- **Open addressing** — probe for next free slot

**Load factor** α = entries / buckets. Resize when α exceeds a threshold (e.g. 0.75) to keep average chain length small. Average search/insert: O(1) with a good hash and resizing policy.

---

## 7. Worked example: BST delete (two children)

To delete key 50 from:

```
        50
       /  \
     30    70
```

1. Find inorder successor in right subtree → 70’s leftmost (e.g. 55)
2. Copy 55’s value into node 50
3. Delete 55 from right subtree (now a 0- or 1-child case)

---

## 8. Summary table

| Structure | Search | Insert | Delete | Notes |
|-----------|--------|--------|--------|-------|
| Unsorted array | O(n) | O(1) amortized | O(n) | Simple |
| BST (balanced) | O(log n) | O(log n) | O(log n) | Ordered traversal |
| Hash table | O(1) avg | O(1) avg | O(1) avg | Not ordered |
| Binary heap | — | O(log n) | O(log n) min | Priority queue |

These topics support labs on stacks, BSTs, graphs, hashing, and sorting.
