import { cn } from "@/lib/utils";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleSwitch({ checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn(
        "relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-accent" : "bg-input border border-bdr"
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-white transition-transform",
          checked ? "translate-x-3" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
