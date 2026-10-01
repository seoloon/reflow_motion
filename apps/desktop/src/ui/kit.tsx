/** Small design-system layer over Radix UI primitives (the accessible foundation shadcn/ui is built on). */
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
    {children}
  </Tooltip.Provider>
);

export function Hint({ label, shortcut, children, side = "bottom" }: { label: string; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
}

/** Icon-only button; the label doubles as tooltip and accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, shortcut, active, className = "", children, ...rest }, ref) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <button ref={ref} aria-label={label} className={`ibtn${active ? " active" : ""} ${className}`} {...rest}>
        {children}
      </button>
    </Hint>
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Styled select (Radix). Values must be non-empty strings. */
export function Pick<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  width,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: Option<T>[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  width?: string;
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <Select.Trigger className="pick" aria-label={ariaLabel} style={width ? { width } : undefined}>
        <Select.Value placeholder={placeholder ?? "Select…"} />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="pick-content" position="popper" sideOffset={4}>
          <Select.Viewport className="pick-viewport">
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value} className="pick-item">
                <Select.ItemText>{o.label}</Select.ItemText>
                {o.hint && <span className="pick-hint">{o.hint}</span>}
                <Select.ItemIndicator className="pick-check">
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
      {label && <span>{label}</span>}
    </label>
  );
}
