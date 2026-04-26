import { forwardRef } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion } from "framer-motion";

const Button = forwardRef(({ className, variant = "primary", size = "md", ...props }, ref) => {
  const baseStyles = "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
  
  const variants = {
    primary: "bg-gradient-to-r from-accent to-accent-secondary text-white shadow-sm hover:shadow-accent hover:-translate-y-0.5 brightness-110",
    secondary: "border border-border bg-white text-foreground hover:bg-muted hover:border-accent/30 hover:shadow-sm hover:-translate-y-0.5",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  };

  const sizes = {
    sm: "h-9 px-4 text-sm",
    md: "h-12 px-6 text-base",
    lg: "h-14 px-8 text-lg",
  };

  return (
    <motion.button
      ref={ref}
      className={twMerge(baseStyles, variants[variant], sizes[size], className)}
      whileTap={{ scale: 0.98 }}
      {...props}
    />
  );
});

Button.displayName = "Button";

export { Button };
