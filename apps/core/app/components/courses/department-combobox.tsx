import { Combobox, type ComboboxOption } from '@eduai/ui'

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
  const options: ComboboxOption[] = departments.map((d) => ({
    value: d.code,
    label: d.label,
    description: `(${d.code})`,
  }))

  return (
    <Combobox
      options={options}
      value={value || null}
      onValueChange={(selectedValue) => {
        if (selectedValue !== null) {
          onValueChange(selectedValue)
        }
      }}
      placeholder={placeholder}
      searchPlaceholder="Search departments..."
      emptyText="No department found."
      disabled={disabled}
    />
  )
}
