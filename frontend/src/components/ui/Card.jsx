import { forwardRef } from "react";
import { twMerge } from "tailwind-merge";

const Card = forwardRef(({ className, children, elevated = false, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={twMerge(
        "rounded-2xl border border-border bg-card p-6 transition-all duration-300",
        elevated ? "shadow-lg" : "shadow-md hover:shadow-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});

Card.displayName = "Card";

export { Card };
