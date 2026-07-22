import type { LucideIcon } from "lucide-react";

export function IconTile({
  icon: Icon,
  tone = "blue",
  size = "md",
  badge,
}: {
  icon: LucideIcon;
  tone?: "blue" | "purple" | "green" | "yellow" | "neutral";
  size?: "sm" | "md" | "lg";
  badge?: number;
}) {
  return (
    <div className={`icon-tile tone-${tone} size-${size}`}>
      <span className="icon-gloss" />
      <Icon />
      {badge ? <span className="icon-badge">{badge}</span> : null}
    </div>
  );
}
