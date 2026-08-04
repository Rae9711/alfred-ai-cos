/**
 * Reference web IconLabel. RN port: mobile/src/components/IconLabel.tsx
 */
import type { LucideIcon } from "lucide-react";
import AlfredIcon, { type AlfredIconVariant } from "./AlfredIcon";
import "./icon-label.css";

interface IconLabelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  variant?: AlfredIconVariant;
  active?: boolean;
  onClick?: () => void;
}

export default function IconLabel({
  icon,
  title,
  description,
  variant = "dimensional",
  active = false,
  onClick,
}: IconLabelProps) {
  return (
    <button
      type="button"
      className={`icon-label ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      <AlfredIcon
        icon={icon}
        variant={variant}
        size="medium"
        active={active}
      />

      <span className="icon-label__copy">
        <strong>{title}</strong>

        {description && <span>{description}</span>}
      </span>
    </button>
  );
}
