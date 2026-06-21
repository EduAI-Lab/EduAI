Use Input for all single-line text entry — login forms, search, settings fields, course creation dialogs.

```jsx
// Basic labeled input
<Input id="email" label="Email" type="email" placeholder="you@ubc.ca" required />

// With error state (from form validation)
<Input
  id="password"
  label="Password"
  type="password"
  error="Password must be at least 8 characters"
/>

// With helper text
<Input
  id="canvas-url"
  label="Canvas URL"
  placeholder="https://canvas.ubc.ca"
  helperText="Enter your institution's Canvas base URL"
  prefix="https://"
/>

// Disabled
<Input label="Student ID" value="12345678" disabled />
```

## Focus & Error States
- Focus: border becomes `--ring` (UBC Blue) with a soft blue glow shadow.
- Error: border becomes `--destructive` with a red glow; error message shown below.
- Both use CSS box-shadow transitions at 150ms.

## Prefix / Suffix
Rendered inside the input border box, separated by a divider. Use for:
- `prefix`: currency symbol (`$`), protocol (`https://`), search icon
- `suffix`: unit (`px`, `%`), clear button, eye toggle for password

## Notes
- Always provide a `label` for accessibility. If label-less, use `aria-label` on the input.
- `id` links the label's `htmlFor` — always pair `id` with `label`.
- For textarea, build a separate Textarea component — do not use Input for multiline.
