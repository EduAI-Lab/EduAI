import { useState, useEffect, useCallback, useMemo } from 'react'

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

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/disciplines')
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        if (active) setDisciplines(data.disciplines ?? [])
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to fetch disciplines')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

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

  return { disciplines, options, getLabel, loading, error }
}
