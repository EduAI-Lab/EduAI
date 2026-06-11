import { useState, useRef, useEffect } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { cn } from '~/lib/utils'

interface Department {
  code: string
  label: string
}

interface DepartmentComboboxProps {
  departments: Department[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

export function DepartmentCombobox({
  departments,
  value,
  onValueChange,
  disabled,
  placeholder = 'Select department',
}: DepartmentComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = departments.find((d) => d.code === value)

  const filtered =
    search.trim() === ''
      ? departments
      : departments.filter((d) => {
          const q = search.toLowerCase()
          return d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q)
        })

  useEffect(() => {
    if (!open) return
    const handleMouse = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className="w-full justify-between font-normal"
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected ? (
          <span>
            {selected.label}{' '}
            <span className="font-mono text-muted-foreground">({selected.code})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search departments..."
              value={search}
              onValueChange={setSearch}
              autoFocus
            />
            <CommandList>
              <CommandEmpty>No department found.</CommandEmpty>
              <CommandGroup>
                {filtered.map((d) => (
                  <CommandItem
                    key={d.code}
                    value={d.code}
                    className="cursor-pointer"
                    onSelect={(val) => {
                      onValueChange(val)
                      setOpen(false)
                      setSearch('')
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onValueChange(d.code)
                      setOpen(false)
                      setSearch('')
                    }}
                  >
                    <CheckIcon
                      className={cn('mr-2 size-4', value === d.code ? 'opacity-100' : 'opacity-0')}
                    />
                    {d.label}{' '}
                    <span className="ml-1 font-mono text-muted-foreground">({d.code})</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
