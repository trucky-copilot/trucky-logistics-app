"use client";
import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

/** @type {React.Context<import("class-variance-authority").VariantProps<typeof toggleVariants>>} */
const ToggleGroupContext = React.createContext({
  size: "default",
  variant: "default",
})

/**
 * @type {React.ForwardRefRenderFunction<HTMLDivElement, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & import("class-variance-authority").VariantProps<typeof toggleVariants>>}
 */
const ToggleGroupRender = ({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}>
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
)

const ToggleGroup = React.forwardRef(ToggleGroupRender)


ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

/**
 * @type {React.ForwardRefRenderFunction<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & import("class-variance-authority").VariantProps<typeof toggleVariants>>}
 */
const ToggleGroupItemRender = ({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(toggleVariants({
        variant: context.variant || variant,
        size: context.size || size,
      }), className)}
      {...props}>
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

const ToggleGroupItem = React.forwardRef(ToggleGroupItemRender)

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }
