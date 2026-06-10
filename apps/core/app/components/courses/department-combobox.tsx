import { useState } from 'react'
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
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
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

  const selected = departments.find((d) => d.code === value)

  const filtered =
    search.trim() === ''
      ? departments
      : departments.filter((d) => {
          const q = search.toLowerCase()
          return d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q)
        })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
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
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search departments..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No department found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((d) => (
                <CommandItem
                  key={d.code}
                  value={d.code}
                  onSelect={(v) => {
                    onValueChange(v)
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
      </PopoverContent>
    </Popover>
  )
}
