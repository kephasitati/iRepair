import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Apple-style pill buttons. `default` uses the shop's brand colour (Apple blue if none); `mpesa` is for every payment.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[980px] border border-transparent bg-clip-padding font-normal whitespace-nowrap transition-[background,color,transform,box-shadow,opacity] duration-200 outline-none select-none focus-visible:ring-4 focus-visible:ring-blue/35 active:not-aria-[haspopup]:scale-[.98] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary),white_10%)]",
        mpesa: "bg-mpesa text-white hover:bg-mpesa-d",
        outline: "border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground",
        secondary: "bg-fill text-ink hover:bg-[#dcdce1]",
        ghost: "text-ink-2 hover:bg-black/[.04] hover:text-ink",
        destructive: "bg-alert/10 text-alert hover:bg-alert/15",
        link: "rounded-none border-0 px-0 text-link hover:underline",
      },
      size: {
        default: "h-12 gap-2 px-6 text-[17px]",
        xs: "h-7 gap-1 px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-4 text-[14px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-14 gap-2 px-8 text-[17px]",
        icon: "size-11",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
