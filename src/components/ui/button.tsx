import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e5b8c2] disabled:pointer-events-none disabled:opacity-45', {
  variants: { variant: { default: 'bg-[#c58d9b] text-[#2c1c24] hover:bg-[#e5b8c2]', secondary: 'border border-[#694d5b] bg-[#4a3542] text-[#efcbd3] hover:bg-[#5a4050]', ghost: 'bg-transparent text-[#c5b4bc] hover:bg-[#493a45]' }, size: { default: 'min-h-10 px-4 py-2 text-xs', sm: 'min-h-8 px-3 text-xs', icon: 'size-8' } },
  defaultVariants: { variant: 'default', size: 'default' },
});
type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}/>;
}
export { Button };
