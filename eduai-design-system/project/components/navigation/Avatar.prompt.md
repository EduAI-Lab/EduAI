Avatar displays a user's profile image with an auto-generated initials + color fallback.
Tabs provides horizontal content switching — used in course detail and settings pages.

```jsx
// Avatar with image
<Avatar src={user.image} name={user.name} size="default" shape="rounded" />

// Avatar initials fallback (auto-generates color from name hash)
<Avatar name="Alex Chen" size="lg" shape="circle" />

// Avatar sizes
<Avatar name="Student" size="xs" />   // 24px — compact lists
<Avatar name="Student" size="sm" />   // 32px — nav footer, table rows
<Avatar name="Student" size="default" /> // 40px — standard
<Avatar name="Student" size="lg" />   // 48px — profile headers
<Avatar name="Student" size="xl" />   // 64px — onboarding, profile page

// Tabs — course detail
<Tabs
  defaultTab="overview"
  tabs={[
    { id: "overview",     label: "Overview",     content: <Overview /> },
    { id: "materials",    label: "Materials",    badge: 12, content: <Materials /> },
    { id: "topics",       label: "Topics",       content: <Topics /> },
    { id: "enrollments",  label: "Enrollments",  content: <Enrollments /> },
    { id: "staff",        label: "Staff",        content: <Staff /> },
    { id: "embedding",    label: "Embedding",    content: <Embedding /> },
  ]}
/>
```

## Avatar Notes
- Initials are max 2 characters (first letter of each name segment).
- Fallback background hue is deterministically generated from the name string — same name always gets same color.
- Use `shape="rounded"` (8px) for the sidebar NavUser. Use `shape="circle"` for profile pages.

## Tabs Notes
- Active tab: UBC Blue bottom border + text.
- Badges (counts) inherit active color.
- `disabled` tabs are greyed out and non-interactive.
- Tab content renders in a `role="tabpanel"` div below the strip.
