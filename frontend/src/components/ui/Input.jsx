import { forwardRef } from "react";
import { twMerge } from "tailwind-merge";

const Input = forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={twMerge(
        "flex h-12 w-full rounded-xl border border-border bg-transparent px-4 py-2 text-base transition-all placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
