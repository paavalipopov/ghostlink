import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps, JSX } from 'react'
import { cn } from '@renderer/lib/utils'

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>): JSX.Element {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  )
}

export { Label }
