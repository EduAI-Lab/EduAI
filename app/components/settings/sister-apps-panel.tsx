import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  Shield,
  Trash2,
} from "lucide-react"

import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { EMPTY_FORM, SisterAppForm, type SisterAppFormState, type ValidationErrors } from "~/components/settings/sister-app-form"

type SisterAppClient = {
  clientId: string
  name: string | null
  uri: string | null
  logoUri: string | null
  redirectUris: string[]
  contacts: string[]
  policy: string | null
  tos: string | null
  metadata: Record<string, unknown> | null
  createdAt?: string
  updatedAt?: string
  appSlug?: string
  displayName?: string
  homeUrl?: string
  logoUrl?: string
}

type SecretReveal = {
  clientId: string
  clientSecret: string
  source: "created" | "rotated"
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function normalizeArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

function normalizeArrayFrom(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeArray(value)
    if (normalized.length > 0) {
      return normalized
    }
  }

  return []
}

function normalizeMetadata(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function getStringMetadata(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function normalizeClient(raw: Record<string, unknown>): SisterAppClient {
  const metadata = normalizeMetadata(raw.metadata)

  return {
    clientId:
      (typeof raw.clientId === "string" && raw.clientId) ||
      (typeof raw.client_id === "string" && raw.client_id) ||
      "",
    name: normalizeString(raw.client_name) ?? normalizeString(raw.name),
    uri: normalizeString(raw.client_uri) ?? normalizeString(raw.uri),
    logoUri: normalizeString(raw.logo_uri) ?? normalizeString(raw.logoUri) ?? normalizeString(raw.icon),
    redirectUris: normalizeArrayFrom(raw.redirect_uris, raw.redirectUris),
    contacts: normalizeArray(raw.contacts),
    policy: normalizeString(raw.policy_uri) ?? normalizeString(raw.policy),
    tos: normalizeString(raw.tos_uri) ?? normalizeString(raw.tos),
    metadata,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    appSlug: getStringMetadata(metadata, "appSlug"),
    displayName: getStringMetadata(metadata, "displayName"),
    homeUrl: getStringMetadata(metadata, "homeUrl"),
    logoUrl: getStringMetadata(metadata, "logoUrl"),
  }
}

function normalizeClients(payload: unknown) {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map(normalizeClient)
    .filter((client) => client.clientId.length > 0)
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: text }
  }
}

function isValidUrl(value: string) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function splitCommaOrLine(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function validateForm(form: SisterAppFormState) {
  const errors: ValidationErrors = {}
  const redirectUris = splitLines(form.redirectUris)

  if (!form.name.trim()) {
    errors.name = "App name is required."
  }

  if (redirectUris.length === 0) {
    errors.redirectUris = "Add at least one redirect URI."
  } else if (redirectUris.some((uri) => !isValidUrl(uri))) {
    errors.redirectUris = "Each redirect URI must be a valid URL."
  }

  if (form.homeUrl.trim() && !isValidUrl(form.homeUrl.trim())) {
    errors.homeUrl = "Home URL must be a valid URL."
  }

  if (form.logoUrl.trim() && !isValidUrl(form.logoUrl.trim())) {
    errors.logoUrl = "Logo URL must be a valid URL."
  }

  if (form.policyUrl.trim() && !isValidUrl(form.policyUrl.trim())) {
    errors.policyUrl = "Privacy policy URL must be a valid URL."
  }

  if (form.termsUrl.trim() && !isValidUrl(form.termsUrl.trim())) {
    errors.termsUrl = "Terms URL must be a valid URL."
  }

  if (form.appSlug.trim() && !/^[a-z0-9-]+$/.test(form.appSlug.trim())) {
    errors.appSlug = "Use lowercase kebab-case with letters, numbers, and hyphens only."
  }

  return errors
}

function buildPayload(form: SisterAppFormState) {
  const redirectUris = splitLines(form.redirectUris)
  const contacts = splitCommaOrLine(form.contacts)
  const homeUrl = form.homeUrl.trim()
  const logoUrl = form.logoUrl.trim()

  return {
    client_name: form.name.trim(),
    client_uri: homeUrl || undefined,
    logo_uri: logoUrl || undefined,
    redirect_uris: redirectUris,
    contacts: contacts.length > 0 ? contacts : undefined,
    policy_uri: form.policyUrl.trim() || undefined,
    tos_uri: form.termsUrl.trim() || undefined,
    metadata: {
      appSlug: form.appSlug.trim() || undefined,
      displayName: form.name.trim() || undefined,
      homeUrl: homeUrl || undefined,
      logoUrl: logoUrl || undefined,
    },
  }
}

function formFromClient(client: SisterAppClient): SisterAppFormState {
  return {
    name: client.name ?? client.displayName ?? "",
    appSlug: client.appSlug ?? "",
    homeUrl: client.uri ?? client.homeUrl ?? "",
    redirectUris: client.redirectUris.join("\n"),
    logoUrl: client.logoUri ?? client.logoUrl ?? "",
    contacts: client.contacts.join(", "),
    policyUrl: client.policy ?? "",
    termsUrl: client.tos ?? "",
  }
}

function formatDate(value?: string) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString()
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback
  }

  if (typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error
  }

  return fallback
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-2">{copied ? "Copied" : label}</span>
    </Button>
  )
}

export function SisterAppsPanel() {
  const [apps, setApps] = useState<SisterAppClient[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [rotatingClientId, setRotatingClientId] = useState<string | null>(null)
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<SisterAppFormState>(EMPTY_FORM)
  const [createErrors, setCreateErrors] = useState<ValidationErrors>({})
  const [editForm, setEditForm] = useState<SisterAppFormState>(EMPTY_FORM)
  const [editErrors, setEditErrors] = useState<ValidationErrors>({})
  const [editingApp, setEditingApp] = useState<SisterAppClient | null>(null)
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null)
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const loadApps = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/admin/oauth-clients")
      const payload = await parseJsonResponse(response)

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Failed to load registered apps."))
      }

      setApps(normalizeClients(payload))
    } catch (error) {
      setBanner({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load registered apps.",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadApps()
  }, [])

  const updateCreateForm = (field: keyof SisterAppFormState, value: string) => {
    setCreateForm((current) => ({ ...current, [field]: value }))
    setCreateErrors((current) => ({ ...current, [field]: undefined }))
  }

  const updateEditForm = (field: keyof SisterAppFormState, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }))
    setEditErrors((current) => ({ ...current, [field]: undefined }))
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    const errors = validateForm(createForm)
    setCreateErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    setSubmitting(true)
    setBanner(null)

    try {
      const response = await fetch("/api/admin/oauth-clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(createForm)),
      })
      const payload = await parseJsonResponse(response)

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Failed to create app."))
      }

      const createdClient = normalizeClient((payload ?? {}) as Record<string, unknown>)
      const clientSecret = typeof (payload as { client_secret?: unknown })?.client_secret === "string"
        ? ((payload as { client_secret: string }).client_secret)
        : typeof (payload as { clientSecret?: unknown })?.clientSecret === "string"
          ? ((payload as { clientSecret: string }).clientSecret)
          : null

      await loadApps()
      setCreateForm(EMPTY_FORM)
      setBanner({ type: "success", message: `Created ${createdClient.name ?? "new app"} successfully.` })

      if (clientSecret) {
        setSecretReveal({
          clientId: createdClient.clientId,
          clientSecret,
          source: "created",
        })
      }
    } catch (error) {
      setBanner({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create app.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const openEditor = (client: SisterAppClient) => {
    setEditingApp(client)
    setEditForm(formFromClient(client))
    setEditErrors({})
  }

  const handleEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingApp) {
      return
    }

    const errors = validateForm(editForm)
    setEditErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    setSubmitting(true)
    setBanner(null)

    try {
      const response = await fetch(`/api/admin/oauth-clients/${editingApp.clientId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(editForm)),
      })
      const payload = await parseJsonResponse(response)

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Failed to update app."))
      }

      await loadApps()
      setEditingApp(null)
      setBanner({ type: "success", message: "App details updated." })
    } catch (error) {
      setBanner({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update app.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const rotateSecret = async (client: SisterAppClient) => {
    setRotatingClientId(client.clientId)
    setBanner(null)

    try {
      const response = await fetch(`/api/admin/oauth-clients/${client.clientId}/rotate-secret`, {
        method: "POST",
      })
      const payload = await parseJsonResponse(response)

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Failed to rotate client secret."))
      }

      const clientSecret = typeof (payload as { client_secret?: unknown })?.client_secret === "string"
        ? ((payload as { client_secret: string }).client_secret)
        : typeof (payload as { clientSecret?: unknown })?.clientSecret === "string"
          ? ((payload as { clientSecret: string }).clientSecret)
          : null

      await loadApps()
      setBanner({ type: "success", message: `Rotated secret for ${client.name ?? client.clientId}.` })
      if (clientSecret) {
        setSecretReveal({
          clientId: client.clientId,
          clientSecret,
          source: "rotated",
        })
      }
    } catch (error) {
      setBanner({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rotate client secret.",
      })
    } finally {
      setRotatingClientId(null)
    }
  }

  const deleteApp = async (client: SisterAppClient) => {
    setDeletingClientId(client.clientId)
    setBanner(null)

    try {
      const response = await fetch(`/api/admin/oauth-clients/${client.clientId}`, {
        method: "DELETE",
      })
      const payload = await parseJsonResponse(response)

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Failed to delete app."))
      }

      setApps((current) => current.filter((entry) => entry.clientId !== client.clientId))
      setBanner({ type: "success", message: `Deleted ${client.name ?? client.clientId}.` })
      if (editingApp?.clientId === client.clientId) {
        setEditingApp(null)
      }
    } catch (error) {
      setBanner({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to delete app.",
      })
    } finally {
      setDeletingClientId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Apps</CardTitle>
          <CardDescription>Register and manage sister apps that use EduAI for sign-in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Trusted origins are still environment-managed.</p>
                <p>
                  If this app lives on a new domain, add that origin to <span className="font-mono">BETTER_AUTH_TRUSTED_ORIGINS</span> in EduAI server configuration.
                </p>
                <p>
                  Example: register <span className="font-mono">https://qa.ok.ubc.ca/api/auth/oauth2/callback/eduai</span> here, then add <span className="font-mono">https://qa.ok.ubc.ca</span> to trusted origins and redeploy EduAI if needed.
                </p>
              </div>
            </div>
          </div>

          {banner && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                banner.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-destructive/20 bg-destructive/5 text-destructive"
              }`}
            >
              {banner.message}
            </div>
          )}

          {secretReveal && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-emerald-950">
                      {secretReveal.source === "created" ? "App created" : "Secret rotated"}
                    </p>
                    <p className="text-sm text-emerald-900">Copy this secret now. It will not be shown again.</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-emerald-800">Client ID</p>
                      <p className="font-mono break-all text-emerald-950">{secretReveal.clientId}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-emerald-800">Client Secret</p>
                      <p className="font-mono break-all text-emerald-950">{secretReveal.clientSecret}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={secretReveal.clientId} label="Copy client ID" />
                  <CopyButton value={secretReveal.clientSecret} label="Copy secret" />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create New App</CardTitle>
          <CardDescription>Each app gets its own client ID, client secret, and redirect URI configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <SisterAppForm
            form={createForm}
            errors={createErrors}
            submitting={submitting}
            submitLabel="Create App"
            onChange={updateCreateForm}
            onSubmit={handleCreate}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered Apps</CardTitle>
          <CardDescription>Manage first-party sister apps backed by the existing admin OAuth client endpoints.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading registered apps...
            </div>
          ) : apps.length === 0 ? (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center">
              <p className="font-medium">No sister apps yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Create your first app above to issue a client ID and secret.</p>
            </div>
          ) : (
            apps.map((app) => (
              <div key={app.clientId} className="rounded-lg border p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{app.name ?? app.displayName ?? "Unnamed app"}</h3>
                      <Badge variant="secondary">
                        <Shield className="mr-1 h-3 w-3" />
                        Sister app
                      </Badge>
                      {app.appSlug && <Badge variant="outline">{app.appSlug}</Badge>}
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Client ID</p>
                        <p className="font-mono break-all">{app.clientId}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Home URL</p>
                        {app.uri ? (
                          <a href={app.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                            {app.uri}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <p className="text-muted-foreground">Not set</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                        <p>{formatDate(app.createdAt) ?? "Unknown"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Updated</p>
                        <p>{formatDate(app.updatedAt) ?? "Unknown"}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Redirect URIs</p>
                      <div className="mt-2 space-y-2">
                        {app.redirectUris.length > 0 ? (
                          app.redirectUris.map((uri) => (
                            <div key={uri} className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs break-all">
                              {uri}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No redirect URIs configured.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEditor(app)}>
                      <Pencil className="h-4 w-4" />
                      <span className="ml-2">Edit</span>
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" disabled={rotatingClientId === app.clientId}>
                          {rotatingClientId === app.clientId ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                          <span className="ml-2">Rotate Secret</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Rotate client secret?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Rotating the secret invalidates the existing client secret immediately. Store the new secret right away because it will only be shown once.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => rotateSecret(app)}>Rotate Secret</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="text-red-600 hover:text-red-700" disabled={deletingClientId === app.clientId}>
                          {deletingClientId === app.clientId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          <span className="ml-2">Delete</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete app?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Deleting this app immediately disables sign-in for that sister app. This will immediately stop OAuth sign-in for the app.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteApp(app)}>Delete App</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingApp)} onOpenChange={(open) => !open && setEditingApp(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit App</DialogTitle>
            <DialogDescription>Update metadata, redirect URIs, and endpoints for this sister app.</DialogDescription>
          </DialogHeader>

          <SisterAppForm
            form={editForm}
            errors={editErrors}
            submitting={submitting}
            submitLabel="Save Changes"
            onChange={updateEditForm}
            onSubmit={handleEdit}
            onCancel={() => setEditingApp(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
