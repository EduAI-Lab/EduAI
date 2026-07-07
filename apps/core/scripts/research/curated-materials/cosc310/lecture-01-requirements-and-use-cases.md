# COSC 310 — Lecture 1: Requirements Engineering and UML Use Cases

## Learning objectives

After this lecture you should be able to:

- Distinguish functional requirements from non-functional requirements
- Draw and read a UML use case diagram (actors, use cases, include, extend)
- Write a structured use case description with preconditions, main scenario, and extensions
- Identify actors and prioritize use cases for an informal problem statement

---

## 1. What is requirements engineering?

Before implementation, a team must agree on **what** the system should do. Requirements engineering captures:

- **Functional requirements** — behaviors the system must provide (search catalog, place order)
- **Non-functional requirements** — quality attributes (response time, security, availability)

Use cases focus on **functional** behavior from the user’s perspective, in language stakeholders understand.

---

## 2. UML use case diagrams

The **Unified Modeling Language (UML)** includes behavioral diagrams. A **use case diagram** shows:

- **Actors** — users or external systems outside the system boundary
- **Use cases** — ovals inside the boundary; each names one goal (verb first: “Place Order”)
- **Associations** — lines linking actors to use cases they initiate

Actors are stick figures or boxes labeled `<<actor>>`. The system boundary is a rectangle around use cases.

**Rules of thumb:**

- Use case names start with a **verb** (they represent actions)
- Do not connect two use cases with a plain association line — use `<<include>>` or `<<extend>>` only

---

## 3. Include versus extend

| Relationship | Meaning | Arrow direction |
|--------------|---------|-----------------|
| **include** | Base use case always invokes included behavior (shared sub-flow) | From base to included |
| **extend** | Optional/conditional extra behavior under some condition | From extension to base |

**Example (ATM):** “Withdraw Cash” **includes** “Authenticate User” because every withdrawal needs authentication. “Apply Surcharge” might **extend** “Withdraw Cash” only for out-of-network cards.

---

## 4. Use case description template

A **fully dressed** use case (Cockburn-style, simplified for coursework) contains:

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

| Field | Purpose |
|-------|---------|
| Primary actor | Who initiates the use case |
| Pre-condition | What must be true before the scenario starts |
| Post-condition | What is true after successful completion |
| Main scenario | Happy path (3–9 steps) |
| Extensions | Alternates, errors, branches |

Good preconditions are **testable** (“user is logged in”) not vague (“system is ready”).

---

## 5. Example: ATM deposit (warmup)

**Use Case 1. Deposit Funds**  
Primary actor: Customer  
Pre-condition: User is logged in.  
Post-condition: Account balance reflects deposit.

Main scenario:

1. User selects checking or savings account.
2. User enters deposit amount.
3. System requests envelope.
4. System credits account and prints receipt.

Extensions:

- 1a. Invalid account → show error
- 3a. No envelope within timeout → abort transaction

This pattern applies to bookstore, billing, and registration systems.

---

## 6. Bookstore scenario (course assignment theme)

A catalog system might involve actors:

| Actor | Examples of goals |
|-------|-------------------|
| Customer | Search catalog, place order, cancel order, return book |
| Clerk | Enter phone/mail orders, maintain catalog |
| Publisher (external) | Fulfill orders, report pending shipments |

Use cases should be **prioritized** (must-have vs nice-to-have) and numbered for traceability to tests and design documents.

---

## 7. Risks and requirements beyond use cases

Use case models do not capture everything. Also document:

- **Performance** — e.g. search returns within 2 seconds
- **Security** — payment data handling
- **Reliability** — backup if primary system fails

Development **risks** (unclear payment API, publisher integration) should be listed early.

---

## 8. Summary

| Artifact | Answers |
|----------|---------|
| Use case diagram | Who interacts with the system and at what level of goals? |
| Use case description | Step-by-step behavior, including failures |
| Requirements doc | Priorities, risks, non-functional constraints |

Use cases bridge informal stakeholder needs and later design (UML class diagrams, test plans).
