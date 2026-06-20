Card is the primary container pattern in EduAI — used for dashboard quick-actions, course listings, stat summaries, settings sections, and data panels.

```jsx
// Basic card
<Card>
  <CardHeader>
    <CardTitle>CPSC 110</CardTitle>
    <CardDescription>Computation, Programs, and Programming</CardDescription>
  </CardHeader>
  <CardContent>
    <p>42 students enrolled · 3 materials uploaded</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">View Course</Button>
  </CardFooter>
</Card>

// Hoverable (clickable card)
<Card hoverable onClick={() => navigate(`/courses/${id}`)}>
  ...
</Card>

// Stat card (dashboard)
<StatCard label="Active Students" value="4,532" trend={12.5} trendLabel="vs last month" />
```

## Anatomy
- `CardHeader` — padding 20px top, 20px sides. Holds title + description + optional action.
- `CardTitle` — 18px semibold
- `CardDescription` — 14px muted text
- `CardContent` — 16px padding on all sides. Main content area.
- `CardFooter` — top border, 14px padding. Holds actions.

## Variants
- Default: white bg, 1px `--border`, 8px radius, `shadow-2xs`.
- Hoverable: on hover adds `shadow-sm` + 1px upward translate.
- StatCard: subtle `primary/5` top gradient, badge-style trend indicator.

## Notes
- Cards use border, NOT shadow, as the primary definition element.
- Never nest Card inside Card without a clear hierarchy reason.
- For data tables, use the `<table>` pattern — do not wrap rows in Cards.
