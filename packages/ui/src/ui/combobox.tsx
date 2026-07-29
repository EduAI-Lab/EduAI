"use client"

import { useEffect, useRef, useState } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { Button } from "./button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover"
import { cn } from "../utils"

export interface ComboboxOption {
  value: string
  label: string
  description?: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered =
    search.trim() === ""
      ? options
      : options.filter((o) => {
          const q = search.toLowerCase()
          return (
            o.value.toLowerCase().includes(q) ||
            o.label.toLowerCase().includes(q) ||
            (o.description?.toLowerCase().includes(q) ?? false)
          )
        })

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue === value ? null : selectedValue)
    setOpen(false)
    setSearch("")
  }

  // Close on outside click / Escape. A plain positioned panel (not a Radix
  // Popover) is used deliberately: this combobox is rendered inside Radix
  // Dialogs, which set `pointer-events: none` on the body and swallow mouse
  // clicks/scroll on portalled popover content — leaving the list keyboard-only.
  useEffect(() => {
    if (!open) return
    const handleMouse = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch("")
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        setSearch("")
      }
    }
    document.addEventListener("mousedown", handleMouse)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleMouse)
      document.removeEventListener("keydown", handleKey)
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
        className={cn("w-full justify-between font-normal", className)}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected ? (
          <span>{selected.label}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              autoFocus
            />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    className="cursor-pointer"
                    onSelect={() => {}}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(o.value)
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 size-4",
                        value === o.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      {o.description && (
                        <span className="text-muted-foreground text-xs">
                          {o.description}
                        </span>
                      )}
                    </div>
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

export interface MultiSelectProps {
  options: ComboboxOption[]
  value: string[]
  onValueChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  /**
   * When provided, `options` is treated as server-driven (e.g. a search-select
   * backed by an API call): local filtering is skipped and the raw search text
   * is forwarded here instead so the caller can debounce/fetch. Omit for the
   * default fully-local behavior.
   */
  onSearchChange?: (query: string) => void
  /** Shows a loading indicator in place of the empty-state text. Only meaningful with `onSearchChange`. */
  loading?: boolean
}

export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select options",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  disabled = false,
  className,
  onSearchChange,
  loading = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  // When `onSearchChange` makes `options` server-driven, selected rows drop out
  // of `options` as the user types a new query. Cache labels by value so chips
  // and checkmarks stay visible until deselected.
  const selectedOptionsCache = useRef(new Map<string, ComboboxOption>())

  const filtered =
    onSearchChange || search.trim() === ""
      ? options
      : options.filter((o) => {
          const q = search.toLowerCase()
          return (
            o.value.toLowerCase().includes(q) ||
            o.label.toLowerCase().includes(q) ||
            (o.description?.toLowerCase().includes(q) ?? false)
          )
        })

  const handleSearchChange = (next: string) => {
    setSearch(next)
    onSearchChange?.(next)
  }

  const handleSelect = (selectedValue: string) => {
    const isSelected = value.includes(selectedValue)
    onValueChange(
      isSelected ? value.filter((v) => v !== selectedValue) : [...value, selectedValue]
    )
  }

  for (const o of options) {
    if (value.includes(o.value)) selectedOptionsCache.current.set(o.value, o)
  }
  for (const key of [...selectedOptionsCache.current.keys()]) {
    if (!value.includes(key)) selectedOptionsCache.current.delete(key)
  }
  const selectedOptions = value
    .map((v) => selectedOptionsCache.current.get(v))
    .filter((o): o is ComboboxOption => o != null)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSearch("")
          // Clear the server-driven search too — otherwise reopening shows the
          // previous query's results under a blank input.
          onSearchChange?.("")
        }
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-auto min-h-9 py-1.5", className)}
        >
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap gap-1 items-center">
              {selectedOptions.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-secondary text-secondary-foreground"
                >
                  {o.label}
                </span>
              ))}
            </span>
          )}
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={handleSearchChange}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>{loading ? "Searching..." : emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  className="cursor-pointer"
                  onSelect={() => handleSelect(o.value)}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 size-4",
                      value.includes(o.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{o.label}</span>
                    {o.description && (
                      <span className="text-muted-foreground text-xs">
                        {o.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
