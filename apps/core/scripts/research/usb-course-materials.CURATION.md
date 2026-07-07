# USB course materials — curation review

**Goal:** RAG corpus for research prompts (`prompts.v2.jsonl`), not a full course mirror.  
**Rule:** Upload **pedagogy** (lab handouts, lecture notes, official briefs). Skip **personal solutions**, answer keys, and duplicate clones.

---

## What the draft manifest was uploading (25 files)

### COSC 121 + COSC 222 → **EduAI `COSC 121`**

| File | Type on disk | Verdict | Why |
|------|----------------|---------|-----|
| `cosc121/.../P4/README.txt` | Assignment brief | **Keep** | Spec only (~13 lines): AnimalList, Serializable, Farm load/save |
| `cosc121/.../P3/README.txt` | Assignment brief | **Keep** | Spec only: OOP farm extension |
| `cosc121/Custom classes/MyArrayList.java` | Your implementation | **Drop** | Personal solution code |
| `cosc121/Custom classes/MyLinkedList.java` | Your implementation | **Drop** | Personal solution code |
| `COSC222/.../Q1,2,3.txt` | Activity answers | **Drop** | MCQ + MST answers (1A 2A 3B…), not teachable content |
| `COSC222/.../BST.java` | Lab starter/solution | **Drop** | Code without prose; may be your completed lab |
| `COSC222/.../Graph.java` | Lab code | **Drop** | Same |
| `COSC222/.../HashTable.java` | Lab code | **Drop** | Same |
| `cosc121/class notes/week 2/lesson2.txt` | Class notes | **Optional** | Very short (~6 lines); thin for RAG |

**Gap:** No real lectures on USB for 121/222 — only assignments + one tiny note file.  
**Fix:** Add **curated concept sheets** (repo-authored, topic summaries) for DS/OOP strands used by v2 prompts.

---

### COSC 211

| File | Type | Verdict | Why |
|------|------|---------|-----|
| `A5/Q3.txt` | Your written answers | **Drop** | Binary/hex exercise answers |
| `A2/A2_Q1.txt` | Your written answers | **Drop** | MIPS tracing answers |
| `practice/*.asm`, `code/mips1.asm` | MIPS examples | **Optional** | Short assembly; little explanatory text |
| `arrays.asm` | Starter | **Drop** | Code-only |

**Gap:** No lecture PDFs/slides on USB. Existing v1/v2 arch prompts may rely on seeded EduAI content or general model knowledge until better mips notes are added.

---

### COSC 310

| File | Type | Verdict | Why |
|------|------|---------|-----|
| `Lab3/.../README.md` | Lab handout | **Keep** | Long intro to UML, use cases, Cockburn template (~80+ lines) |
| `Lab3/.../warmup/A3warmup_UseCaseDesc.txt` | Official warmup | **Keep** | ATM use-case exemplars (course-provided) |
| `Lab2/.../README.md` (one clone) | Lab handout | **Keep** | Bowling kata / TDD / red-green-refactor |
| `Lab4/.../README.md` | Lab handout | **Keep** | UML class diagrams |
| `Lab3/Q3_UseCases.md` etc. | Your group submission | **Drop** | Student bookstore use cases (quality varies) |
| `Project/.../Models-TestPlan/README.md` | Project doc | **Drop** | Weather-app specific architecture/tests |

**Note:** No `.pdf` / `.pptx` lectures found under `usb/COSC310`. “Lectures” on disk = **lab README pedagogy**.

---

### COSC 315

| File | Type | Verdict | Why |
|------|------|---------|-----|
| `lab-4-threads/README.md` | Lab handout | **Keep** | Threads, races, `clock()`, pthreads |
| `lab-5-semaphores/README.md` | Lab handout | **Keep** | Semaphores, producer-consumer |
| `lab-6-virtual-memory/README.md` | Lab handout | **Keep** | Page tables, VM concepts |
| `lab-7-tlbs/README.md` | Lab handout | **Keep** | VPN/PFN, TLB hit/miss, FIFO |
| `lab-8-inode-file-systems/README.md` | Lab handout | **Keep** | Inode layout |
| `lab-2-shell/README.md` | Lab handout | **Keep** | Shell, stdio, pipelines (grounds `ts-172`) |
| `lab-3-processes/README.md` | Lab handout | **Optional** | Processes in shell |
| `lab-1-gcc/README.md` | Lab handout | **Skip** | GCC intro; low value for v2 prompts |
| `answers.txt`, `output.txt`, `Q3.txt` | Your solutions | **Drop** | Personal answers |
| `*.c` source | Your code | **Drop** | Not needed for RAG |

**Note:** No lecture PDFs under `usb/COSC315` either — lab READMEs are the best teaching text.

---

## Recommended curated set (10 lecture notes)

All materials are **repo-authored lecture-style documents** in `curated-materials/`, synthesized from course lab handout themes (not personal assignment submissions or solution code).

| Course | Lectures |
|--------|----------|
| **COSC 121** | L1 OOP in Java; L2 Data structures & algorithms |
| **COSC 310** | L1 Requirements & use cases; L2 TDD; L3 UML class diagrams |
| **COSC 315** | L1 Processes & shell; L2 Threads; L3 Semaphores; L4 VM & TLB; L5 Inodes |

**COSC 211:** deferred until mips/arch lecture notes are available.

---

## Mapping to v2 prompt themes

| Prompt themes | Grounded by |
|---------------|-------------|
| COSC 121 OOP (`ts-127`–`132`, …) | P3/P4 briefs + OOP concept sheet |
| COSC 121 DS (`ts-133`–`139`, …) | DS concept sheet |
| COSC 310 SE (`ts-145`–`150`, …) | Lab 3 README + warmup + Lab 2 TDD |
| COSC 315 OS (`ts-151`–`156`, …) | Labs 2, 4–8 READMEs |
| COSC 211 arch | Existing course seed or defer |

---

## If you have lecture PDFs later

Place under e.g. `usb/COSC310/Lectures/` and `usb/COSC315/Lectures/`, then add 2–4 slides/PDFs per course (requirements, testing, VM/TLB weeks). EduAI embedding supports PDF.

---

## Next step

1. Review curated concept sheets in `curated-materials/cosc121/`.
2. Approve `usb-course-materials.manifest.json` (curated version).
3. Run `npm run research:ingest-usb -- --dry-run` to confirm paths.
4. Upload to dev EduAI after courses exist.
