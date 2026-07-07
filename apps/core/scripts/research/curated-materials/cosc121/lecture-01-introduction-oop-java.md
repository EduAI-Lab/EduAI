# COSC 121 — Lecture 1: Introduction to Object-Oriented Programming in Java

## Learning objectives

After working through this lecture you should be able to:

- Explain why programs are organized into objects and classes
- Use encapsulation, inheritance, and polymorphism in Java programs
- Distinguish **static binding** (overloading) from **dynamic binding** (overriding)
- Use `instanceof` safely when runtime types vary
- Implement and iterate custom collections without common iterator bugs
- Save and load object state with serialization while avoiding initialization bugs

---

## Introduction

Most programs you write model things in the real world: students, courses, animals on a farm, items in a shopping cart. Early programming courses teach you to write **procedures** that operate on data. Object-oriented programming (OOP) teaches you to bundle **data and the operations on that data** into a single unit called a **class**. An **object** is one concrete instance of a class — one particular cow, one particular bank account.

Java is a class-based language. Almost everything you manipulate that is not a primitive (`int`, `double`, `boolean`) is an object. Understanding OOP is not about memorizing keywords; it is about designing programs so that each part has a clear responsibility and can evolve without breaking the rest of the system.

This lecture walks through the core ideas you will use in assignment sequences (Farm/Animal labs), custom collection implementations, and file persistence.

---

## 1. Classes and objects

Think of a class as a **blueprint** and an object as a **house built from that blueprint**. The blueprint defines what fields (data) and methods (behavior) every house of that type will have. Each actual house can have different field values (different owners, different paint colors) but shares the same structure.

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

To create an object:

```java
Animal a = new Animal("Bessie");
```

Here `a` is a **reference** to an object on the heap. The variable `a` does not contain the object itself; it points to it. Many references can point to the same object; `null` means “points to nothing.”

**Why `private` fields?** External code cannot do `a.name = "..."` directly. It must use `getName()` (and a setter if you provide one). That boundary is the heart of **encapsulation**.

---

## 2. Encapsulation: hiding representation

Encapsulation means the **internal representation** of an object is hidden behind a public interface. Callers depend on **what** the object does, not **how** it stores data.

Suppose a `Farm` class initially stores animals in a fixed-size array. Later you replace the array with a custom linked list. If outside code never touched the array directly — only called `addAnimal`, `removeAnimal`, `countAnimals` — you can change the internal structure without rewriting the rest of the program.

Encapsulation also protects **invariants** — rules that must always be true. Example: an account balance should never be negative. If all deposits and withdrawals go through methods that enforce the rule, the invariant holds. If balance were public, any class could set it to `-100`.

| Without encapsulation | With encapsulation |
|----------------------|-------------------|
| Fields are public | Fields are private |
| Any code can corrupt state | State changes through controlled methods |
| Hard to refactor internals | Implementation can change behind stable API |

---

## 3. Inheritance: sharing and specializing behavior

**Inheritance** (`extends`) lets you define a specialized class that **reuses** code from a more general parent class.

```java
public class Cow extends Animal {
    @Override
    public String speak() {
        return "moo";
    }
}
```

The subclass **inherits** fields and methods from the parent unless it overrides them. The `@Override` annotation documents that you intend to replace parent behavior; the compiler will error if the signature does not match.

**When to use inheritance:** when “is-a” holds — a `Cow` **is an** `Animal`. When the relationship is only “has-a” (a farm **has** animals), prefer **composition** (the farm contains a collection of animals) instead of making `Farm` extend `Animal`.

---

## 4. Polymorphism and dynamic binding

**Polymorphism** (“many forms”) means code can treat different concrete types through a common supertype:

```java
Animal a = new Cow("Bessie");
Animal b = new Chicken("Clucky");
System.out.println(a.speak()); // "moo"
System.out.println(b.speak()); // "cluck" (or similar)
```

The compile-time type of `a` is `Animal`, but the **runtime type** is `Cow`. When you call `speak()`, the JVM uses **dynamic binding** (also called **dynamic dispatch**): it looks up the method on the **actual object’s class**, not the reference type. That is how one loop over `Animal[]` can call the correct sound for each species.

**Static binding** applies when the compiler can resolve the call at compile time — notably **method overloading**:

```java
void print(int x) { ... }
void print(String s) { ... }
```

The compiler picks the overload from argument types. Overloading is **not** polymorphism in the OOP sense; overriding with inheritance is.

| Mechanism | Resolved when | Example |
|-----------|---------------|---------|
| Overloading | Compile time | `print(5)` vs `print("hi")` |
| Overriding | Runtime | `animal.speak()` on a `Cow` |

---

## 5. `instanceof` and safe casting

Sometimes you need to know the runtime type:

```java
if (shape instanceof Circle) {
    Circle c = (Circle) shape;
    // use circle-specific methods
}
```

`instanceof` returns true if the object is an instance of the class or any subclass. Use it before **downcasting** (casting a superclass reference to a subclass type). A bad cast throws `ClassCastException`.

In well-designed polymorphic code you need fewer `instanceof` checks — the whole point of virtual methods is that the right behavior runs without asking “what type are you?” Long chains of `if (x instanceof Cow) ... else if (x instanceof Chicken)` often signal a design that could use overriding instead.

---

## 6. Abstract classes and interfaces

Not every class should be instantiated. An **abstract class** can declare methods without bodies; subclasses must implement them:

```java
public abstract class Animal {
    public abstract String speak();
}
```

An **interface** defines a **contract** — method signatures that implementing classes must provide:

```java
public interface Serializable { }
public interface Comparable<T> {
    int compareTo(T other);
}
```

A class can `implements` multiple interfaces but `extends` only one class.

| | Abstract class | Interface |
|---|----------------|-----------|
| Fields | Can have instance state | Traditionally constants only; modern Java allows default methods |
| Implementation | Can provide partial implementation | Contract + default/static methods |
| Inheritance | Single `extends` | Multiple `implements` |
| Use when | Shared code + template for subclasses | Capability or role (“comparable”, “serializable”) |

---

## 7. Generic programming (preview)

**Generic programming** means writing code that works for **many data types** while still being type-safe. Java generics (e.g. `ArrayList<String>`) let the compiler check that you only put strings in a string list. You will see generics again when implementing your own data structures. The idea: one algorithm, many types, compile-time checking instead of casting everywhere.

---

## 8. Collections: arrays, ArrayList, and linked lists

Arrays have fixed size (once created) and offer O(1) indexed access. **`ArrayList`** wraps a dynamic array that grows as needed — amortized O(1) append at the end, O(n) insert in the middle.

A **singly linked list** stores nodes `{ data, next }`. Insert at the head is O(1); finding the i-th element requires walking i nodes (O(n)). Linked lists teach **pointer discipline**: every `next` must point to a valid node or `null`; losing a reference loses the rest of the list.

| Structure | Index access | Insert at head | Memory |
|-----------|--------------|----------------|--------|
| Array | O(1) | O(n) shift | contiguous, cache-friendly |
| ArrayList | O(1) amortized append | O(n) middle insert | contiguous backing array |
| Linked list | O(n) | O(1) | extra pointer per element |

**Iterator safety:** The enhanced for-loop (`for (Animal x : list)`) uses an iterator internally. If you remove elements with `list.remove(...)` while iterating, you get `ConcurrentModificationException`. Use `Iterator.remove()` or collect items to remove in a second pass.

---

## 9. Serialization and persistence

`java.io.Serializable` is a **marker interface** — no methods, but it tells the JVM the object may be written to a byte stream. A typical farm simulation:

1. User exits → write `Farm` and contained `Animal` objects to a file
2. User starts again → read file and reconstruct objects

**Critical detail — initialization order:**

```java
public Farm() {
    animals = new AnimalList();  // create empty structure FIRST
    load();                      // then try to read file
}
```

If `load()` runs before `animals` exists, or if you overwrite loaded data with defaults after `load()`, the farm appears empty every time. Always trace: **construct → allocate structures → load → apply defaults only if load failed**.

---

## 10. Common mistakes (and how to avoid them)

1. **Confusing overriding and overloading** — same name does not mean the same mechanism; check signatures and inheritance.
2. **Public fields** — breaks encapsulation; use getters/setters.
3. **Shallow copy on save** — if you serialize references incorrectly, you may save pointers to temporary objects; understand what the object graph includes.
4. **Modifying a list while iterating** — use iterator protocol or copy-then-remove.
5. **`instanceof` ladders** — refactor toward polymorphic methods when possible.

---

## 11. Chapter summary

Object-oriented programming organizes software around **objects** that combine state and behavior. **Encapsulation** protects invariants; **inheritance** reuses and specializes; **polymorphism** lets one interface refer to many concrete types with **dynamic binding** at runtime. Java’s type system adds **abstract classes**, **interfaces**, and **generics** for flexible, safe designs.

In this course you will apply these ideas to farm simulations, custom `AnimalList` implementations, and file persistence — each step builds on the last. Master the concepts here and the later data-structure material (Lecture 2) will fit naturally on top.

---

## Key terms

| Term | Definition |
|------|------------|
| Class | Blueprint for objects |
| Object | Instance of a class |
| Encapsulation | Hiding internal state behind methods |
| Inheritance | Subclass extends superclass |
| Polymorphism | One interface, many implementations |
| Dynamic binding | Runtime method dispatch |
| Static binding | Compile-time overload resolution |
| `instanceof` | Runtime type test |
| Serializable | Marker for object persistence |
