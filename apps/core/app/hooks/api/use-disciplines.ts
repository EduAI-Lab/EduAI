import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch } from '~/hooks/api/config'

/** A discipline option shaped for DepartmentCombobox / UNIT_OPTIONS call sites. */
export interface DisciplineOption {
  code: string
  label: string
}

interface DisciplineRow {
  code: string
  name: string
}

/**
 * Loads the UBCO discipline registry from GET /api/disciplines (§541) — the
 * DB-backed replacement for the old hardcoded UNIT_OPTIONS / UNIT_LABELS.
 * Exposes `options` (for the department picker) and `getLabel` (code → name).
 */
export function useDisciplines() {
  const [disciplines, setDisciplines] = useState<DisciplineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Bump reloadKey to refetch after a transient failure left the picker empty.
  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      // Retry transient failures so a momentary blip doesn't strand the picker
      // empty with no recovery (only a full reload would otherwise refetch).
      const MAX_ATTEMPTS = 3
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const data = await apiFetch<{ disciplines: DisciplineRow[] }>('/api/disciplines')
          if (active) {
            setDisciplines(data.disciplines ?? [])
            setLoading(false)
          }
          return
        } catch (e) {
          if (attempt === MAX_ATTEMPTS) {
            if (active) {
              setError(e instanceof Error ? e.message : 'Failed to fetch disciplines')
              setLoading(false)
            }
          } else {
            await new Promise((r) => setTimeout(r, 500 * attempt))
          }
        }
      }
    })()
    return () => {
      active = false
    }
  }, [reloadKey])

  const options: DisciplineOption[] = useMemo(
    () => disciplines.map((d) => ({ code: d.code, label: d.name })),
    [disciplines],
  )

  const labelByCode = useMemo(
    () => new Map(disciplines.map((d) => [d.code, d.name])),
    [disciplines],
  )

  const getLabel = useCallback(
    (code: string) => labelByCode.get(code) ?? code,
    [labelByCode],
  )

  return { disciplines, options, getLabel, loading, error, refetch }
}
