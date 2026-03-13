import type { FormEvent } from "react"
import { Loader2, Plus } from "lucide-react"

import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"

export type SisterAppFormState = {
  name: string
  appSlug: string
  homeUrl: string
  redirectUris: string
  logoUrl: string
  contacts: string
  policyUrl: string
  termsUrl: string
}

export type ValidationErrors = Partial<Record<keyof SisterAppFormState, string>>

export const EMPTY_FORM: SisterAppFormState = {
  name: "",
  appSlug: "",
  homeUrl: "",
  redirectUris: "",
  logoUrl: "",
  contacts: "",
  policyUrl: "",
  termsUrl: "",
}

function FieldError({ error }: { error?: string }) {
  if (!error) {
    return null
  }

  return <p className="text-xs text-destructive">{error}</p>
}

type SisterAppFormProps = {
  form: SisterAppFormState
  errors: ValidationErrors
  submitting: boolean
  submitLabel: string
  onChange: (field: keyof SisterAppFormState, value: string) => void
  onSubmit: (event: FormEvent) => void
  onCancel?: () => void
}

export function SisterAppForm({
  form,
  errors,
  submitting,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: SisterAppFormProps) {
  const isCreate = submitLabel === "Create App"

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="app-name">App Name</Label>
            <Input id="app-name" value={form.name} onChange={(event) => onChange("name", event.target.value)} placeholder="QA" />
            <FieldError error={errors.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app-slug">App Slug</Label>
            <Input id="app-slug" value={form.appSlug} onChange={(event) => onChange("appSlug", event.target.value)} placeholder="qa" />
            <p className="text-xs text-muted-foreground">Optional. Lowercase kebab-case is recommended.</p>
            <FieldError error={errors.appSlug} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="home-url">Home URL</Label>
            <Input
              id="home-url"
              value={form.homeUrl}
              onChange={(event) => onChange("homeUrl", event.target.value)}
              placeholder="https://qa.ok.ubc.ca"
            />
            <FieldError error={errors.homeUrl} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-url">Logo URL</Label>
            <Input
              id="logo-url"
              value={form.logoUrl}
              onChange={(event) => onChange("logoUrl", event.target.value)}
              placeholder="https://qa.ok.ubc.ca/logo.png"
            />
            <FieldError error={errors.logoUrl} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="redirect-uris">Redirect URI(s)</Label>
          <Textarea
            id="redirect-uris"
            value={form.redirectUris}
            onChange={(event) => onChange("redirectUris", event.target.value)}
            placeholder={"https://qa.ok.ubc.ca/api/auth/oauth2/callback/eduai"}
            className="min-h-28"
          />
          <p className="text-xs text-muted-foreground">Enter one redirect URI per line.</p>
          <FieldError error={errors.redirectUris} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contacts">Contacts</Label>
          <Textarea
            id="contacts"
            value={form.contacts}
            onChange={(event) => onChange("contacts", event.target.value)}
            placeholder="admin@example.com, support@example.com"
            className="min-h-20"
          />
          <p className="text-xs text-muted-foreground">Optional. Separate values with commas or new lines.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="policy-url">Privacy Policy URL</Label>
            <Input
              id="policy-url"
              value={form.policyUrl}
              onChange={(event) => onChange("policyUrl", event.target.value)}
              placeholder="https://qa.ok.ubc.ca/privacy"
            />
            <FieldError error={errors.policyUrl} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="terms-url">Terms of Service URL</Label>
            <Input
              id="terms-url"
              value={form.termsUrl}
              onChange={(event) => onChange("termsUrl", event.target.value)}
              placeholder="https://qa.ok.ubc.ca/terms"
            />
            <FieldError error={errors.termsUrl} />
          </div>
        </div>
      </div>

      <div className={`flex ${onCancel ? "justify-end gap-2" : "justify-end"}`}>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isCreate ? <Plus className="h-4 w-4" /> : null}
          <span className={submitting || isCreate ? "ml-2" : ""}>{submitLabel}</span>
        </Button>
      </div>
    </form>
  )
}
