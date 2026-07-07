# COSC 310 — Lecture 2: Test-Driven Development and Unit Testing

## Learning objectives

After working through this lecture you should be able to:

- Distinguish verification from validation in software quality
- Describe the red–green–refactor cycle and why tests precede code in TDD
- Write focused unit tests (one behavior per test) using Arrange–Act–Assert
- Apply TDD incrementally using the bowling game kata as a model
- Relate a test plan to requirements and use cases
- Explain how TDD fits team process (branches, reviews, traceability)

---

## Introduction

Imagine changing one line in a 5,000-line program and having no idea whether anything else broke. Manual clicking through the UI might miss edge cases; delaying tests until the night before submission guarantees stress. **Automated testing** runs checks in seconds every time code changes. **Test-Driven Development (TDD)** goes further: you write the test **before** the production code, letting tests drive design in small, safe steps.

COSC 310 connects testing to requirements (Lecture 1) and design (Lecture 3). The **bowling game kata** is the canonical classroom example: scoring rules are familiar enough to focus on process, rich enough to expose incremental design. This lecture explains **why** TDD works, **how** to practice it, and **where** it sits in a larger test strategy — not as a replacement for requirements, but as a tight link between specification and code.

---

## 1. Why test?

**Verification** asks: *Does the implementation match the specification?*  
**Validation** asks: *Did we build the right thing for the user?*

Tests primarily support verification — but well-chosen tests derived from use cases also guard against building the wrong behavior (validation gaps show up when stakeholders reject “passing” tests that miss real goals).

| Without automated tests | With automated tests |
|-------------------------|----------------------|
| Fear of refactoring | Refactor with confidence |
| Regressions discovered late | Failures caught on commit |
| Informal “it worked once” | Repeatable evidence |

**Unit tests** exercise a **small unit** — typically one class or method — in **isolation** from databases, networks, and UI when possible. Fast unit tests run hundreds of times per day; slow integration tests run less often.

---

## 2. Test-Driven Development (TDD)

Traditional order: design → code → (maybe) test.  
TDD order:

1. **Red** — write a failing test for the **next smallest** behavior
2. **Green** — write the **minimum** code to pass
3. **Refactor** — improve structure without changing behavior; tests stay green

```
        +------------------+
        |  Write test      |
        +--------+---------+
                 v
        +--------+---------+
        |  Run test (FAIL) |
        +--------+---------+
                 v
        +--------+---------+
        |  Write code      |
        +--------+---------+
                 v
        +--------+---------+
        |  Run test (PASS) |
        +--------+---------+
                 v
        +--------+---------+
        |  Refactor        |
        +--------+---------+
                 |
                 +----> next behavior
```

### Why write tests first?

- **Forces incremental scope** — you cannot test “entire bowling game” before “gutter game scores zero”
- **Defines “done”** — passing test is an objective criterion
- **Documents behavior** — tests are executable examples for future readers
- **Reduces over-engineering** — you only write code demanded by a failing test

TDD is a **design discipline**, not a magic quality guarantee. You can write bad tests first. The skill is choosing the **next** test that teaches you something about the design.

---

## 3. Bowling game kata — incremental TDD walkthrough

Ten-pin bowling: ten frames, two rolls per frame (except tenth frame bonuses). Scoring includes open frames, spares (+ next roll), and strikes (+ next two rolls).

| Step | Test (idea) | Minimal implementation insight |
|------|-------------|--------------------------------|
| 0 | Can construct `Game`, call `roll` | Empty class, no-op methods |
| 1 | Gutter game (all 0) → score 0 | `return 0` |
| 2 | All ones (20 rolls of 1) → 20 | Sum pins |
| 3 | One spare (e.g. 5+5 then 3) → 16 | Bonus from next roll |
| 4 | One strike | Bonus from next two rolls |
| 5 | Tenth frame with strike/spare | Special frame rules |
| 6 | Perfect game (300) | All strikes |

**One concept per test.** A test named `oneSpare` should not also assert strike behavior.

**Example (JUnit 5 style):**

```java
@Test
void gutterGameScoresZero() {
    Game g = new Game();
    for (int i = 0; i < 20; i++) {
        g.roll(0);
    }
    assertEquals(0, g.score());
}
```

After this passes, the next test might be `allOnesScoresTwenty`. Resist implementing full scoring until a test requires it — that is the “minimum code” rule.

---

## 4. Arrange – Act – Assert

Structure every unit test in three phases:

1. **Arrange** — set up objects and inputs (`new Game()`, rolls)
2. **Act** — invoke the behavior under test (`g.score()`)
3. **Assert** — check outcome (`assertEquals(0, ...)`)

**Determinism:** Tests must not depend on wall-clock time, randomness without fixed seeds, or execution order unless explicitly testing concurrency. Flaky tests erode trust.

**Independence:** Each test should set up its own state. Sharing mutable static state between tests causes order-dependent failures.

---

## 5. Test plan versus requirements

| Document | Answers |
|----------|---------|
| Requirements / use cases | What the system must do for users |
| Test plan | How the team will verify quality |

A **test plan** typically includes:

- Scope (features, use cases covered)
- Test levels: unit, integration, system, acceptance
- Roles (who writes/runs tests)
- Pass/fail criteria and environment needs
- Traceability matrix: requirement ID → test case ID

Requirements say *what*; tests provide *evidence*. In coursework, your README or report should show that UC-03 “Place Order” maps to tests X, Y, Z.

TDD generates **unit** tests during development; the test plan still describes **integration** tests (database + API) and **acceptance** tests (stakeholder scenarios).

---

## 6. Process and version control

Team workflows in COSC 310 often require:

- Feature branch per issue
- Tests visible in pull requests **before** merge
- Peer review of both tests and implementation

**Traceability chain:** issue → use case → test → code. When a bug is reported, add a failing test that reproduces it, then fix — the test prevents regression.

TDD does not eliminate need for code review or manual exploratory testing. It makes the **core logic** safer to change.

---

## 7. When TDD helps and when to adapt

**Helps most:**

- Pure logic (scoring, pricing rules, parsers)
- APIs with clear inputs/outputs
- Bug fixes (test first, then patch)

**Harder:**

- UI layout and aesthetics
- Exploratory prototypes where requirements are unknown
- Heavy external dependencies — use **test doubles** (mocks/stubs) or integration tests

For UI-heavy features, combine unit tests on view-models or controllers with fewer end-to-end tests.

---

## 8. Common mistakes

1. **Testing implementation details** — asserting private fields instead of public behavior
2. **Oversized tests** — one test checks ten behaviors; failure message unclear
3. **Skipping red** — writing test and code together without seeing failure first
4. **No refactor step** — green tests with duplicated logic accumulate debt
5. **Confusing TDD with “tests exist”** — tests written after code help, but do not provide the same design pressure

---

## 9. Chapter summary

Testing proves that software meets its specification. **Unit tests** check small pieces quickly. **TDD** cycles red–green–refactor to drive incremental design, as in the bowling kata. **Test plans** sit above unit tests, organizing verification across the project and linking back to requirements and use cases. Used with discipline, TDD turns quality from a phase at the end into a continuous practice throughout COSC 310 projects.

---

## Key terms

| Term | Definition |
|------|------------|
| Verification | Implementation matches spec |
| Validation | Right product for user needs |
| Unit test | Tests one unit in isolation |
| TDD | Test first, then code, then refactor |
| Red–green–refactor | Core TDD loop |
| Arrange–Act–Assert | Standard test structure |
| Test plan | Project-level verification strategy |
