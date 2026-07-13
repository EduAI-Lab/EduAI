import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@eduai/ui';
import { IconCheck, IconExternalLink, IconLoader2, IconTrash } from '@tabler/icons-react';
import { useApiKeys } from '~/hooks/use-api-keys';
import { PROVIDERS, maskApiKey, type ProviderId } from '~/lib/provider-keys';

/**
 * Settings → Providers. BYOK key management, moved out of the chat's old
 * blocking setup wall into Settings where the rest of the platform keeps it
 * (Core's Providers tab). Keys live only in this browser; the chat reads them
 * via the same `useApiKeys` hook.
 */
export function ProvidersSettings() {
  const { loaded, getKey, hasKey, setKey, removeKey, validateKey } = useApiKeys();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const save = async (provider: ProviderId) => {
    const draft = (drafts[provider] ?? '').trim();
    if (!draft) return;
    setValidating(provider);
    setErrors((e) => ({ ...e, [provider]: null }));
    try {
      const result = await validateKey(provider, draft);
      if (!result.valid) {
        setErrors((e) => ({ ...e, [provider]: result.error || 'Invalid API key' }));
        return;
      }
      setKey(provider, draft);
      setDrafts((d) => ({ ...d, [provider]: '' }));
    } catch {
      setErrors((e) => ({ ...e, [provider]: 'Could not validate API key' }));
    } finally {
      setValidating(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model providers</CardTitle>
        <CardDescription>
          Add your own AI provider key to power the AI Study Buddy. Keys are stored only in this
          browser and sent directly to the model — never saved on our servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {PROVIDERS.map((p) => {
          const configured = loaded && hasKey(p.id);
          const busy = validating === p.id;
          const error = errors[p.id];
          return (
            <div key={p.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-base">{p.label}</Label>
                  {configured && (
                    <Badge variant="secondary" size="sm">
                      <IconCheck className="h-3 w-3" /> Connected
                    </Badge>
                  )}
                </div>
                <a
                  href={p.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Get a key <IconExternalLink className="h-3 w-3" />
                </a>
              </div>

              {configured ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-[var(--radius-md)] border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground">
                    {maskApiKey(getKey(p.id))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => removeKey(p.id)}>
                    <IconTrash className="h-4 w-4" /> Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={drafts[p.id] ?? ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDrafts((d) => ({ ...d, [p.id]: value }));
                        setErrors((er) => ({ ...er, [p.id]: null }));
                      }}
                      placeholder={`Enter your ${p.label} API key`}
                      className="flex-1 font-mono text-sm"
                      aria-invalid={!!error}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      onClick={() => void save(p.id)}
                      disabled={!(drafts[p.id]?.trim() && !busy)}
                    >
                      {busy ? (
                        <>
                          <IconLoader2 className="h-4 w-4 animate-spin" /> Checking…
                        </>
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                  {error && <p className="pl-1 text-xs text-destructive">{error}</p>}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
