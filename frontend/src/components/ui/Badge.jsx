import { twMerge } from "tailwind-merge";

const Badge = ({ children, className, pulsing = false }) => {
  return (
    <div className={twMerge(
      "inline-flex items-center gap-3 rounded-full border border-accent/30 bg-accent/5 px-5 py-2",
      className
    )}>
      <span className={twMerge(
        "h-2 w-2 rounded-full bg-accent",
        pulsing && "animate-pulse-slow"
      )} />
      <span className="font-mono text-xs uppercase tracking-[0.15em] text-accent">
        {children}
      </span>
    </div>
  );
};

export { Badge };
