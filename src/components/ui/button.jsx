import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-t-action-primary text-t-text-on-accent hover:bg-t-action-primary-hover active:bg-t-action-primary-pressed",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-t-border-strong bg-transparent text-t-text-primary hover:bg-t-action-secondary",
        secondary:
          "bg-t-action-secondary text-t-text-primary hover:bg-t-action-secondary-hover",
        ghost: "text-t-text-secondary hover:bg-t-action-secondary hover:text-t-text-primary",
        link: "text-t-text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-full px-3 text-xs",
        lg: "h-11 rounded-full px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * @typedef {import("class-variance-authority").VariantProps<typeof buttonVariants>} ButtonVariants
 */

/**
 * @type {React.ForwardRefRenderFunction<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariants & { asChild?: boolean }>}
 */
const ButtonRender = ({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    (<Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />)
  );
}

const Button = React.forwardRef(ButtonRender)
Button.displayName = "Button"

export { Button, buttonVariants }
