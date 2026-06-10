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

  const selected = departments.find((d) => d.code === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const dept = departments.find((d) => d.code === itemValue)
            if (!dept) return 0
            const q = search.toLowerCase()
            return dept.code.toLowerCase().includes(q) || dept.label.toLowerCase().includes(q)
              ? 1
              : 0
          }}
        >
          <CommandInput placeholder="Search departments..." />
          <CommandList>
            <CommandEmpty>No department found.</CommandEmpty>
            <CommandGroup>
              {departments.map((d) => (
                <CommandItem
                  key={d.code}
                  value={d.code}
                  onSelect={(v) => {
                    onValueChange(v)
                    setOpen(false)
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
