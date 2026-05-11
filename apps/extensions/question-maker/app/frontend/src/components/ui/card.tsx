/**
 * Shadcn card primitives for layout containers with header/content/footer.
 */
import * as React from "react"
import { useTheme } from "@/components/theme-provider"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { theme } = useTheme()
    return (
      <div 
        ref={ref} 
        className={`rounded-lg border ${
          theme === 'light' 
            ? 'bg-white text-gray-900 border-gray-200' 
            : 'bg-gray-800 text-white border-gray-700'
        } shadow-sm ${className}`} 
        {...props} 
      />
    )
  }
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    const { theme } = useTheme()
    return (
      <h3 
        ref={ref} 
        className={`text-2xl font-semibold leading-none tracking-tight ${
          theme === 'light' ? 'text-gray-900' : 'text-white'
        } ${className}`} 
        {...props} 
      />
    )
  }
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => {
    const { theme } = useTheme()
    return (
      <p 
        ref={ref} 
        className={`text-sm ${
          theme === 'light' ? 'text-gray-500' : 'text-gray-300'
        } ${className}`} 
        {...props} 
      />
    )
  }
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { theme } = useTheme()
    return (
      <div 
        ref={ref} 
        className={`p-6 pt-0 ${
          theme === 'light' ? 'text-gray-900' : 'text-white'
        } ${className}`} 
        {...props} 
      />
    )
  }
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={`flex items-center p-6 pt-0 ${className}`} {...props} />
  )
)
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent
} 
