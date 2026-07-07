# COSC 310 — Lecture 2: Test-Driven Development and Unit Testing

## Learning objectives

After this lecture you should be able to:

- Describe the red–green–refactor cycle
- Explain why tests are written before production code in TDD
- Identify good unit test granularity (one behavior per test)
- Relate a test plan to requirements and use cases

---

## 1. Why test?

Software **verification** asks: does the implementation match the specification? **Validation** asks: did we build the right thing? Testing supports both.

Without automated tests, every change risks regressions. **Unit tests** check small pieces (one class or method) in isolation.

---

## 2. Test-Driven Development (TDD)

TDD inverts the usual order:

1. **Red** — write a failing test for the next small behavior
2. **Green** — write the minimum code to pass
3. **Refactor** — improve design without changing behavior; tests stay green

```
        +------------------+
        |  Write test      |
        +--------+---------+
                 v
        +--------+---------+
        |  Run test (fail) |
        +--------+---------+
                 v
        +--------+---------+
        |  Write code      |
        +--------+---------+
                 v
        +--------+---------+
        |  Run test (pass) |
        +--------+---------+
                 v
        +--------+---------+
        |  Refactor        |
        +--------+---------+
                 |
                 +----> next feature
```

Benefits:

- Forces **incremental** design — avoids over-engineering
- Produces a **regression suite** as you go
- Documents expected behavior in executable form

---

## 3. Bowling game kata (course example)

The **bowling game** is a classic kata: score ten frames with strikes, spares, and open frames.

TDD approach:

| Step | Test idea | Minimal implementation |
|------|-----------|------------------------|
| 1 | gutter game (all zeros) → score 0 | return 0 |
| 2 | all ones → score 20 | sum pins |
| 3 | one spare | bonus from next roll |
| 4 | strike | bonus from next two rolls |
| 5 | tenth frame edge cases | special frame rules |

Each test should assert **one** concept. Start with the simplest case (can you construct the game object?) before complex scoring.

---

## 4. Unit tests in Java (JUnit)

A typical JUnit test:

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

**Arrange – Act – Assert:** set up, invoke, check.

Tests should be **deterministic** (no reliance on wall-clock time or random order without seeding).

---

## 5. Test plan versus requirements

| Document | Focus |
|----------|-------|
| Requirements / use cases | What the system must do for users |
| Test plan | How quality will be verified (scope, types of tests, responsibilities) |

A test plan lists:

- Features or use cases covered
- Test levels (unit, integration, system)
- Pass/fail criteria
- Environment and data needs

Requirements say *what*; tests provide evidence the implementation satisfies them.

---

## 6. Process and version control

Team workflows often require:

- One feature per branch
- Tests committed before implementation
- Peer review before merge

Process matters as much as final code — traceability from issue → test → implementation.

---

## 7. Summary

| Term | Definition |
|------|------------|
| Unit test | Verifies one unit of behavior |
| TDD | Test first, then code, then refactor |
| Red–green–refactor | Core TDD loop |
| Test plan | Strategy for verification across the project |

TDD does not replace requirements or design; it tightens the link between specification and code.
