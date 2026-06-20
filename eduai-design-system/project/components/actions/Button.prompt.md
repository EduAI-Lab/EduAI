Use the Button component for any clickable action — form submissions, navigation triggers, dialog openers.

```jsx
// Primary CTA
<Button variant="primary" size="default">Start Chat</Button>

// With icon (use inline SVG or Tabler icon component)
<Button variant="outline" icon={<svg .../>} iconPosition="left">Upload Materials</Button>

// Destructive
<Button variant="destructive" size="sm">Delete Course</Button>

// Full-width form submit
<Button variant="primary" fullWidth type="submit">Sign in</Button>

// Icon-only (use size="icon")
<Button variant="ghost" size="icon" aria-label="Settings">
  <svg .../>
</Button>
```

## Variants
- `primary` — UBC Blue fill. Use for the single most important action on a page.
- `secondary` — UBC Light Blue fill. Secondary CTA, often paired with primary.
- `outline` — border only, primary text. Use for less prominent actions.
- `ghost` — no border or background. Use in dense UI (toolbars, inline controls).
- `destructive` — red fill. Use only for irreversible actions (delete, remove).
- `gold` — gold tint. Decorative only; do not use for primary actions.

## Sizes
- `sm` (32px) — compact UI, table actions, inline chips
- `default` (38px) — standard form actions
- `lg` (44px) — primary CTAs, onboarding, hero actions (meets touch target min)
- `icon` (38px square) — icon-only buttons; always include `aria-label`

## Notes
- Minimum touch target: use `size="lg"` or `size="default"` in mobile contexts.
- Hover state uses `filter: brightness(0.92)` — no separate hover color token needed.
- `disabled` prop sets `opacity: 0.5` and `cursor: not-allowed`.
