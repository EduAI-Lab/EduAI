# COSC 310 — Lecture 3: UML Class Diagrams and Structural Design

## Learning objectives

After working through this lecture you should be able to:

- Explain how class diagrams complement use case diagrams
- Read and draw UML class notation (attributes, operations, visibility)
- Express associations with multiplicity and navigability
- Derive candidate classes from a domain and assign responsibilities
- Distinguish interface, abstract class, and concrete class in UML
- Keep structural design consistent with use case scenarios

---

## Introduction

Use cases (Lecture 1) describe **what happens** when a customer places an order or a clerk updates inventory — behavior from the outside. Before writing Java classes, the team needs a shared picture of **what types exist**, **what data they hold**, **what operations they expose**, and **how they relate**. **UML class diagrams** are the standard structural view for that conversation.

A class diagram is not “the code” and not “the database schema,” though it should align with both. It is a **design document**: good enough to implement from, concise enough to fit on one whiteboard. In COSC 310 you move from bookstore use cases to class models, then to tests (Lecture 2) and code. This lecture teaches notation, relationship semantics, and a practical method for going from nouns in the problem domain to a maintainable class structure.

---

## 1. From behavior to structure

Software design alternates between **behavioral** and **structural** views:

| View | Diagram | Shows |
|------|---------|-------|
| Behavioral (goals) | Use case | Actors and system capabilities |
| Behavioral (interaction) | Sequence | Message order for one scenario |
| Structural | Class | Types, fields, methods, relationships |

A use case step “Customer selects books and confirms order” implies objects like `Customer`, `Order`, `OrderLine`, and `Book` collaborating. The class diagram names those types and their relationships **without** fixing every method call order — that is the sequence diagram’s job.

**Single responsibility (high level):** Each class should have one clear reason to change. If `Order` both calculates tax and sends email receipts, two kinds of requirement changes will force edits in the same file — a smell to split responsibilities.

---

## 2. Class notation

A standard class box has three compartments:

```
+------------------+
|   Book           |
+------------------+
| - isbn: String   |
| - title: String  |
| - price: double  |
+------------------+
| + getTitle()     |
| + setPrice(p)    |
+------------------+
```

**Visibility:**

| Symbol | Meaning |
|--------|---------|
| `+` | public |
| `-` | private |
| `#` | protected |
| `~` | package |

In Java coursework, fields are usually private with public accessors. The diagram documents the **intended API**, not every helper method.

**Stereotypes** (optional labels):

- `<<interface>>` — contract only
- `<<abstract>>` — cannot instantiate directly

---

## 3. Relationships

| Notation | Name | Meaning |
|----------|------|---------|
| Solid line | Association | Classes know about each other; may hold references |
| Hollow triangle on line | Generalization | Subclass **extends** superclass |
| Dashed arrow to interface | Realization | Class **implements** interface |
| Filled diamond on whole side | Composition | Strong ownership; parts typically die with whole |
| Hollow diamond | Aggregation | Weaker whole-part; parts may outlive whole |

**Multiplicity** on association ends documents how many instances participate:

| Notation | Meaning |
|----------|---------|
| `1` | exactly one |
| `0..1` | zero or one |
| `*` | zero or more |
| `1..*` | one or more |

**Example:** One `Order` contains many `OrderLine` items — multiplicity `Order` 1 —— * `OrderLine`.

**Navigability:** Arrow on the association shows which direction is navigable in code (Order knows OrderLines; OrderLine may or may not know Order — design choice).

**Composition vs aggregation:** `Order`–`OrderLine` is often **composition** (lines do not exist without their order). `Department`–`Professor` might be **aggregation** if professors can transfer departments.

---

## 4. Designing from a domain — bookstore example

Given bookstore use cases, candidate **nouns** become candidate **classes**:

- `Catalog`, `Book`, `Customer`, `Order`, `OrderLine`, `Payment`, `Shipment`

Not every noun deserves a class — “Tuesday” is not a class. Ask: does it have **state** and **behavior** relevant to use cases?

**Responsibility assignment (informal):**

| Class | Responsibility |
|-------|----------------|
| `Book` | ISBN, title, price; maybe availability |
| `Order` | Collection of lines, total, status |
| `OrderLine` | Quantity, line subtotal for one book |
| `Catalog` | Search and retrieve books |
| `Payment` | Charge customer, record result |

Use case “Place Order” maps to collaboration: `Customer` creates `Order`, adds `OrderLine`s referencing `Book` from `Catalog`, invokes `Payment`.

---

## 5. Interfaces and abstract classes

| Mechanism | UML | When to use |
|-----------|-----|-------------|
| Interface | `<<interface>>` | Shared capability across unrelated classes (`Payable`, `Searchable`) |
| Abstract class | Italic name or `{abstract}` | Shared state + partial implementation in hierarchy |

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount);
}
```

Multiple classes can implement `PaymentGateway`; `Order` depends on the **interface**, not a specific bank API — easier testing with mocks.

**Abstract class example:** `AbstractShape` with concrete `Circle`, `Rectangle` sharing `position` field and `area()` template.

Prefer **interfaces** for capabilities; **abstract classes** when subclasses share substantial code and a clear is-a hierarchy.

---

## 6. Consistency with use cases

Every main scenario step should be **realizable** by objects on the diagram:

| Use case fragment | Design implication |
|-------------------|-------------------|
| Pre: user logged in | `Session` or `Customer` authenticated flag |
| “System verifies payment” | `PaymentService` or `PaymentGateway` |
| Post: order confirmed | `Order.status = CONFIRMED` |

If a step has no natural home, either the diagram is incomplete or the step belongs in an external actor.

**Sequence diagrams** (later) show one scenario’s message flow; **class diagrams** show the static structure those messages use. Update both when design changes — drift between diagram and code confuses reviewers.

---

## 7. Worked mini-example: library loan

**Use case:** Check out book  
**Classes:** `Patron`, `BookCopy`, `Loan`, `Catalog`

- Association: `Patron` 1 —— * `Loan`
- Association: `BookCopy` 1 —— 0..1 `Loan` (copy is either on shelf or on loan)
- `Loan` stores due date

Checking out creates a `Loan` linking patron and copy; checking in ends the loan. Multiplicity prevents one copy being on two active loans if modeled correctly.

---

## 8. Common mistakes

1. **Diagram as every field in code** — omit getters, private helpers; show design intent
2. **Missing multiplicities** — “Order has OrderLines” without 1—* confuses implementers
3. **God class** — one `System` class doing everything use cases mention
4. **Inheritance for reuse only** — subclass when is-a holds, not to copy code
5. **Stale diagrams** — diagram says `faxOrder()`; code removed fax years ago

---

## 9. Chapter summary

Class diagrams translate user-visible behavior into **maintainable structure**. Learn notation for classes, visibility, associations, inheritance, and interfaces. Derive classes from the domain, assign responsibilities, and validate against use cases. Together with tests and requirements, class diagrams are living artifacts that keep COSC 310 projects coherent from design through implementation.

---

## Key terms

| Term | Definition |
|------|------------|
| Class diagram | UML structural view of types and relations |
| Association | Relationship between classes |
| Multiplicity | How many instances at each end |
| Composition | Strong whole-part lifecycle |
| Generalization | Inheritance (is-a) |
| Realization | Interface implementation |
| Responsibility | Reason a class exists in the design |
