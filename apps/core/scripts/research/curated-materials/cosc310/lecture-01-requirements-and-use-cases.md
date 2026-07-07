# COSC 310 — Lecture 1: Requirements Engineering and UML Use Cases

## Learning objectives

After working through this lecture you should be able to:

- Explain why requirements come before design and implementation
- Distinguish functional from non-functional requirements with examples
- Draw and read a UML use case diagram (actors, use cases, include, extend)
- Write a structured use case description with preconditions, main scenario, and extensions
- Identify actors from an informal problem statement and prioritize use cases
- Recognize what use cases do **not** capture (performance, security, risks)

---

## Introduction

Software projects fail more often from **building the wrong thing** than from writing buggy code. A team can implement a flawless payment module that nobody asked for, or miss a critical security requirement until production. **Requirements engineering** is the discipline of discovering, documenting, and agreeing on what the system must do — and what quality attributes it must meet — before significant design and coding begin.

In COSC 310 you practice this through bookstore scenarios, ATM warmups, and project assignments. **Use cases** are one of the most accessible techniques: they describe system behavior from the **user’s perspective** in plain language, then connect to tests, class diagrams, and implementation plans. This lecture explains how to read and write them well enough that a teammate (or an AI tutor grounded in your course materials) can tell whether a design satisfies the stated goals.

---

## 1. What is requirements engineering?

Requirements engineering spans:

1. **Elicitation** — interviews, workshops, reading existing documents
2. **Analysis** — resolve conflicts, find gaps, prioritize
3. **Specification** — write clear, testable statements
4. **Validation** — confirm with stakeholders that you understood correctly

Two categories matter throughout the course:

| Type | Question it answers | Examples |
|------|---------------------|----------|
| **Functional** | What behaviors must the system provide? | Search catalog, place order, cancel order |
| **Non-functional** | How well must it behave? | Response time &lt; 2 s, 99.9% uptime, encrypt payment data |

Use cases focus on **functional** behavior visible to users. Non-functional requirements often appear in a separate section of the requirements document — but they still constrain design (a “search catalog” use case that must return in 2 seconds affects indexing and caching decisions).

---

## 2. Why use cases?

Before UML use cases, teams often wrote long narrative requirements that were hard to trace to tests. A **use case** names one **goal** an actor wants to achieve with the system: “Place Order,” “Withdraw Cash,” “Register for Course.”

Benefits:

- **Stakeholder-readable** — verbs and actors, not class names
- **Scope boundaries** — what is inside the system vs external
- **Testability** — each use case suggests acceptance tests
- **Traceability** — link use case → design classes → test cases

Use cases are **not** a complete specification. They do not replace data models, UI mockups, or detailed APIs — they complement them.

---

## 3. UML use case diagrams

The **Unified Modeling Language (UML)** includes diagrams for structure and behavior. A **use case diagram** is a high-level behavioral view:

- **System boundary** — rectangle around use cases; inside = software you build
- **Actors** — stick figures or `<<actor>>` boxes **outside** the boundary
- **Use cases** — ovals **inside** the boundary; name = user goal (verb first)
- **Associations** — lines from actor to use cases they **initiate**

```
+---------------------------+
|   Bookstore System        |
|  (Search Catalog)         |
|  (Place Order)            |
|  (Cancel Order)           |
+---------------------------+
        ^           ^
        |           |
   Customer      Clerk
```

**Rules of thumb:**

- Use case names start with a **verb** — they represent actions, not nouns
- Do **not** connect two use cases with a plain line — only `<<include>>` or `<<extend>>`
- One actor can participate in many use cases; one use case can have several actors

**Actor vs user:** An actor is a **role**, not necessarily one person. “Customer” might be thousands of people. “Payment Gateway” can be an **external system** actor.

---

## 4. Include versus extend

These relationships reuse behavior between use cases:

| Relationship | Meaning | Arrow |
|--------------|---------|-------|
| **include** | Base use case **always** invokes included behavior (mandatory sub-flow) | Dashed arrow labeled `<<include>>` from base **to** included |
| **extend** | Extension adds **optional** behavior under a condition | Dashed arrow labeled `<<extend>>` from extension **to** base |

**ATM example:**

- “Withdraw Cash” **includes** “Authenticate User” — every withdrawal must authenticate first
- “Apply Surcharge” might **extend** “Withdraw Cash” only when the card is out-of-network

**Common mistake:** Using `include` for optional steps. If the sub-flow is conditional, consider `extend` or a separate use case with explicit branching in the text description.

---

## 5. Use case description template

Diagrams show **who** and **what** at a glance. A **fully dressed** use case (Cockburn-style, simplified for coursework) adds step-by-step detail:

```
Use Case <id>. <name>
Primary actor:
Description:
Pre-condition:
Post-condition:

Main scenario:
  1. ...
  2. ...

Extensions:
  3a. If payment fails, ...
```

| Field | Purpose | Good vs weak |
|-------|---------|--------------|
| Primary actor | Who starts the use case | “Customer” not “anyone” |
| Pre-condition | Must be true before step 1 | “User is logged in” not “system ready” |
| Post-condition | True after success | “Order status is Confirmed” |
| Main scenario | Happy path, 3–9 steps | Numbered, one action per step |
| Extensions | Errors, branches | Reference step numbers (4a, 4b) |

**Testable preconditions** can be checked in a test setup: create a logged-in user, then run the scenario. Vague preconditions (“system is operational”) cannot be verified.

---

## 6. Worked example: ATM deposit

**Use Case 1. Deposit Funds**  
Primary actor: Customer  
Description: Customer deposits cash or check into an account.  
Pre-condition: User is authenticated and session is active.  
Post-condition: Account balance reflects deposit; receipt printed.

**Main scenario:**

1. Customer selects checking or savings account.
2. Customer enters deposit amount.
3. System prompts for envelope insertion.
4. Customer inserts envelope; system acknowledges.
5. System credits account and prints receipt.

**Extensions:**

- 2a. Invalid amount (zero, negative, over limit) → display error; return to step 2
- 3a. No envelope within timeout → abort transaction; post-condition: balance unchanged
- 4a. System cannot read deposit → reverse pending credit; notify customer

Notice extensions preserve **traceability**: each branch ties to a main step. Test plans map one test per extension where feasible.

---

## 7. Bookstore scenario (course assignment theme)

A catalog system for a campus bookstore might involve:

| Actor | Goals (candidate use cases) |
|-------|----------------------------|
| Customer | Search catalog, view details, place order, cancel order, return book |
| Clerk | Enter phone/mail orders, update inventory, process returns |
| Publisher (external) | Receive orders, report shipment status |

**Prioritization** matters in real projects:

- **Must-have:** search, place order, payment
- **Should-have:** order history, cancel before ship
- **Nice-to-have:** recommendations, reviews

Number use cases (UC-01, UC-02) for traceability to design documents and test plans. When two use case descriptions differ only in wording, compare **preconditions** and **postconditions** — clearer preconditions usually mean clearer tests.

---

## 8. What use cases do not capture

Document these separately:

| Concern | Example | Where it lives |
|---------|---------|----------------|
| Performance | Search returns within 2 seconds | Non-functional requirements |
| Security | PCI compliance for card data | Security requirements |
| Reliability | Failover if DB unavailable | Architecture / ops |
| Development risks | Publisher API undocumented | Risk register |

**Risks** should be listed early: unclear payment integration, unknown publisher response times, legal constraints on returns. Requirements engineering is iterative — discovering a risk may add a new use case or change priority.

---

## 9. From use cases to the rest of the lifecycle

| Artifact | Role |
|----------|------|
| Use case diagram | Big-picture actors and goals |
| Use case description | Detailed behavior and failures |
| Requirements doc | Priorities, NFRs, risks |
| UML class diagram (Lecture 3) | Structural design supporting scenarios |
| Test plan (Lecture 2) | Evidence that implementation meets requirements |

A use case step like “system verifies payment” suggests a `PaymentService` or collaboration between `Order` and `PaymentGateway` classes. Sequence diagrams (later in the course) show **message order** for one scenario; class diagrams show **structure**.

---

## 10. Common mistakes

1. **Noun-based use cases** — “Order” instead of “Place Order”
2. **Implementation in requirements** — “Store order in SQL table Orders” belongs in design, not “Customer places order”
3. **Missing failure paths** — only happy path documented; production breaks on first declined card
4. **God use case** — one giant “Use System” oval; split by distinct user goals
5. **Confusing include and extend** — remember: include = always; extend = sometimes

---

## 11. Chapter summary

Requirements engineering aligns the team on **what** to build. **Functional requirements** describe behavior; **non-functional** requirements describe quality. **Use case diagrams** show actors and goals; **use case descriptions** add preconditions, steps, and extensions. Together they bridge informal stakeholder needs and rigorous design and testing — the foundation of software engineering practice in COSC 310.

---

## Key terms

| Term | Definition |
|------|------------|
| Functional requirement | Required system behavior |
| Non-functional requirement | Quality attribute (performance, security) |
| Actor | Role or external system interacting with the system |
| Use case | One goal-level interaction scenario |
| include | Mandatory shared sub-behavior |
| extend | Optional conditional extension |
| Pre/post-condition | State before/after successful use case |
