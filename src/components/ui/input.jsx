import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(/** @param {React.InputHTMLAttributes<HTMLInputElement>} props */({ className, type, ...props }, ref) => {
  return (
    (<input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-surface/60 px-3.5 py-2 text-base shadow-sm transition-[border-color,box-shadow,background-color] duration-200 ease-out-expo file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Input.displayName = "Input"

export { Input }
