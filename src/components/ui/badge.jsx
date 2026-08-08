import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        brand:
          "border-transparent bg-brand-muted text-brand-muted-foreground",
        success:
          "border-transparent bg-success-muted text-success-muted-foreground",
        warning:
          "border-transparent bg-warning-muted text-warning-muted-foreground",
        info:
          "border-transparent bg-info-muted text-info-muted-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/** @param {{ className?: any, variant?: any, [key: string]: any }} props */
function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants(/** @type {any} */ ({ variant })), className)} {...props} />);
}

export { Badge, badgeVariants }
