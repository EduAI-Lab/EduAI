# COSC 121 — Lecture 1: Introduction to Object-Oriented Programming in Java

## Learning objectives

After this lecture you should be able to:

- Explain encapsulation, inheritance, and polymorphism in Java
- Distinguish method overloading from method overriding
- Describe when to use abstract classes versus interfaces
- Recognize common bugs in object construction, persistence, and collection iteration

---

## 1. Why objects?

Programs model **entities** (students, animals, bank accounts) and **operations** on those entities. Object-oriented programming (OOP) groups data and behavior into **classes** so that:

- Internal representation can change without breaking callers (encapsulation)
- Specialized types reuse shared code (inheritance)
- Code can work with a family of types through a common interface (polymorphism)

Java is a class-based, statically typed language: every value (except primitives) is an object with a runtime type.

---

## 2. Classes, objects, and encapsulation

A **class** is a blueprint; an **object** is an instance created with `new`.

```java
public class Animal {
    private String name;

    public Animal(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }
}
```

**Encapsulation** means fields are usually `private` and accessed through methods. Benefits:

- **Invariants** — e.g. a balance cannot go negative if all updates go through `deposit`/`withdraw`
- **Stable API** — internal arrays can become linked lists without changing public methods

---

## 3. Inheritance and polymorphism

**Inheritance** (`extends`) lets a subclass reuse and specialize parent behavior:

```java
public class Cow extends Animal {
    @Override
    public String speak() {
        return "moo";
    }
}
```

**Polymorphism:** a reference typed as `Animal` may hold a `Cow`, `Chicken`, or `Llama`. The JVM calls the **runtime type’s** overridden method:

```java
Animal a = new Cow("Bessie");
System.out.println(a.speak()); // "moo" — dynamic dispatch
```

**Overloading** (same method name, different parameter lists) is resolved at **compile time**. **Overriding** (same signature in subclass) is resolved at **runtime**.

---

## 4. Abstract classes and interfaces

| Feature | Abstract class | Interface |
|---------|----------------|-----------|
| State (fields) | Yes | Only constants (traditionally) |
| Partial implementation | Yes | Methods default/static in modern Java |
| Multiple inheritance | No (single extends) | Yes (multiple implements) |
| Use when | Shared base + default behavior | Contract / capability (`Serializable`, `Comparable`) |

`instanceof` checks runtime type before casting. Prefer polymorphic calls over long `instanceof` chains when design allows.

---

## 5. Collections and custom ADTs

Intro courses often progress from arrays to **ArrayList** (dynamic array) or a **custom linked list**:

| Structure | Random access | Insert at head | Memory |
|-----------|---------------|----------------|--------|
| Array / ArrayList | O(1) | O(n) shift | contiguous |
| Singly linked list | O(n) | O(1) with head pointer | extra pointer per node |

When implementing your own list:

- Keep **node invariants** clear (head, tail, size)
- Use an **iterator** for safe traversal; removing during enhanced-for without `Iterator.remove()` causes `ConcurrentModificationException`

---

## 6. Persistence and initialization order

Implementing `java.io.Serializable` allows writing object graphs to disk. A typical pattern:

1. On shutdown, serialize the farm and animals to a file
2. On startup, **load** saved state in the constructor or a dedicated `load()` method

**Common bug:** calling `load()` before data structures exist, or overwriting loaded data with empty defaults afterward. Initialization order matters: create containers, then load, then apply defaults only if no file exists.

---

## 7. Summary

| Concept | One-line takeaway |
|---------|-------------------|
| Encapsulation | Hide fields; expose behavior |
| Inheritance | Reuse and specialize |
| Polymorphism | One interface, many implementations |
| Overloading vs overriding | Compile-time vs runtime |
| Custom ADTs | Practice pointers, iterators, invariants |
| Serialization | Mind constructor/load order |

---

## Further reading (course themes)

- Farm/animal assignment sequence: polymorphism → custom collections → save/load
- Exercises on file I/O, generics, and iterators build on these ideas
