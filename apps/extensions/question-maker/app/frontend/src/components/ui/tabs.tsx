/**
 * Shadcn tabs components for switching between grouped content.
 */
import * as React from "react"

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}

interface TabsContextValue {
  value: string | undefined
  onValueChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined)

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className = "", defaultValue, value: controlledValue, onValueChange, children, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState<string | undefined>(defaultValue)
    const value = controlledValue ?? uncontrolledValue
    
    const handleValueChange = React.useCallback((newValue: string) => {
      setUncontrolledValue(newValue)
      onValueChange?.(newValue)
    }, [onValueChange])

    return (
      <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
        <div ref={ref} className={`${className}`} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={`inline-flex h-10 items-center justify-center rounded-md bg-gray-700 p-1 text-white ${className}`}
    {...props}
  />
))
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className = "", value, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) {
      throw new Error("TabsTrigger must be used within a Tabs component")
    }

    const { value: selectedValue, onValueChange } = context
    const isSelected = selectedValue === value

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-gray-800 data-[state=active]:text-white data-[state=active]:shadow-sm text-gray-200 ${
          isSelected ? "bg-gray-800 text-white" : "hover:bg-gray-600"
        } ${className}`}
        onClick={() => onValueChange(value)}
        {...props}
      />
    )
  }
)
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className = "", value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) {
      throw new Error("TabsContent must be used within a Tabs component")
    }

    const isSelected = context.value === value

    if (!isSelected) {
      return null
    }

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={`mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent } 
