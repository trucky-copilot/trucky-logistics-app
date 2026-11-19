import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-t-bg-surface-raised text-t-text-accent",
        secondary:
          "border-transparent bg-t-action-secondary text-t-text-secondary",
        destructive:
          "border-transparent bg-t-danger-soft text-t-danger",
        outline: "border-border text-t-text-primary",
        success: "border-transparent bg-t-success-soft text-t-success",
        warning: "border-transparent bg-t-warning-soft text-t-warning",
        info: "border-transparent bg-t-info-soft text-t-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
