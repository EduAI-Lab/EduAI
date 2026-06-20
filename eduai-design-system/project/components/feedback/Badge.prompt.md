Use Badge for compact labels: user roles, content status, counts, and category tags.

```jsx
// Role badges (NavUser sidebar footer)
<Badge role="ADMIN">Admin</Badge>
<Badge role="INSTRUCTOR">Instructor</Badge>
<Badge role="STUDENT">Student</Badge>

// Status badges
<Badge variant="success" dot>Published</Badge>
<Badge variant="warning" dot>Pending</Badge>
<Badge variant="destructive">Inactive</Badge>

// Outline for subtle categorization
<Badge variant="outline">Canvas synced</Badge>

// Count
<Badge variant="muted" size="sm">24</Badge>
```

## Variants
- `default` — UBC Blue fill (primary emphasis)
- `secondary` — UBC Light Blue fill
- `outline` — border only, neutral
- `muted` — gray fill (secondary info)
- `success / warning / destructive` — semantic status colors; uses tinted surfaces not full fills for readability
- `gold` — decorative; avoid for semantic status

## Role prop
When `role` is set, the `variant` prop is ignored. Role colors come from `--color-role-*` tokens and are always full-fill with white text.

## Notes
- Always sentence-case label text: "Admin", "Instructor", not "ADMIN".
- For role badges in NavUser, use alongside the matching Tabler icon.
- `dot` prop adds a small indicator circle — useful for "active/inactive" status.
