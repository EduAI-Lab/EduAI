# COSC 310 — Lecture 3: UML Class Diagrams and Structural Design

## Learning objectives

After this lecture you should be able to:

- Read a UML class diagram (classes, attributes, operations, associations)
- Express multiplicity and navigability on associations
- Relate use cases to candidate classes and responsibilities
- Distinguish interface, abstract class, and concrete class in UML notation

---

## 1. From behavior to structure

Use cases describe **behavior** from the outside. **Class diagrams** describe **structure**: types, fields, methods, and relationships. They guide implementation and team communication.

UML class diagrams are one category of **structure** diagrams (alongside component and deployment diagrams).

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

Visibility: `+` public, `-` private, `#` protected.

---

## 3. Relationships

| Symbol | Relationship | Meaning |
|--------|--------------|---------|
| Solid line | Association | One class knows about another |
| Open arrow (hollow triangle) | Inheritance | Subclass extends superclass |
| Dashed arrow | Implements | Class implements interface |
| Filled diamond | Composition | Strong ownership; parts die with whole |
| Open diamond | Aggregation | Weaker whole-part |

**Multiplicity** on association ends: `1`, `0..1`, `*`, `1..*`

Example: one `Order` contains many `OrderLine` items (`1` — `*`).

---

## 4. Designing from a domain

For a bookstore system, candidate classes might include:

- `Catalog`, `Book`, `Customer`, `Order`, `OrderLine`, `Payment`

Assign **responsibilities** so each class has one clear reason to change (single responsibility principle at a high level).

Use cases map to collaborations:

- “Place Order” → `Customer`, `Order`, `Payment`, `Catalog`

---

## 5. Interfaces and abstract classes in design

| Mechanism | UML | When to use |
|-----------|-----|-------------|
| Interface | `<<interface>>` stereotype | Capability contract (`Payable`, `Searchable`) |
| Abstract class | Italic name or `{abstract}` | Shared state + partial implementation |

Prefer interfaces where multiple unrelated classes share behavior; abstract classes when subclasses share substantial code.

---

## 6. Consistency with use cases

Class diagrams should support use case scenarios:

- Preconditions often imply objects that must exist (`loggedInCustomer`)
- Main scenario steps become messages between objects (sequence diagrams add timing order; class diagrams show structure)

If a use case step says “system verifies payment,” a `PaymentService` or `PaymentGateway` class is a natural home for that operation.

---

## 7. Summary

| Diagram | Shows |
|---------|-------|
| Use case | Actors and system goals |
| Class | Types, fields, methods, relationships |
| Sequence (later) | Message order for one scenario |

Class diagrams are living documents — update them when design changes, and keep them aligned with tests and code reviews.
