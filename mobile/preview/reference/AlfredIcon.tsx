/**
 * Reference web AlfredIcon (lucide-react). RN port: mobile/src/components/AlfredIcon.tsx
 * Fidelity source for CSS classnames — see alfred-icons.css.
 */
import type { LucideIcon } from "lucide-react";
import "./alfred-icons.css";

export type AlfredIconVariant =
  | "dimensional"
  | "minimal"
  | "assistant"
  | "dark";

interface AlfredIconProps {
  icon: LucideIcon;
  variant?: AlfredIconVariant;
  size?: "small" | "medium" | "large";
  notification?: number;
  active?: boolean;
  label?: string;
  onClick?: () => void;
}

export default function AlfredIcon({
  icon: Icon,
  variant = "dimensional",
  size = "medium",
  notification,
  active = false,
  label,
  onClick,
}: AlfredIconProps) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      className={[
        "alfred-icon",
        `alfred-icon--${variant}`,
        `alfred-icon--${size}`,
        active ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      aria-label={label}
      type={onClick ? "button" : undefined}
    >
      <span className="alfred-icon__highlight" />

      <Icon
        className="alfred-icon__symbol"
        strokeWidth={variant === "minimal" ? 1.8 : 2}
      />

      {typeof notification === "number" && notification > 0 && (
        <span className="alfred-icon__notification">
          {notification > 99 ? "99+" : notification}
        </span>
      )}
    </Component>
  );
}
