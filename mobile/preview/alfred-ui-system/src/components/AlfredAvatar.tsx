import { motion } from "framer-motion";

/** Tuxedo robot mascot — wechat-reply-workflow `alfred-mascot.png`. */
const MASCOT_SRC = "/alfred-mascot.png";

export default function AlfredAvatar({
  size = 84,
  compact = false,
}: {
  size?: number;
  compact?: boolean;
}) {
  return (
    <motion.div
      className={`alfred-avatar png ${compact ? "compact" : ""}`}
      style={{ width: size, height: size }}
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      aria-label="Alfred avatar"
    >
      <img
        src={MASCOT_SRC}
        alt="Alfred"
        width={size}
        height={size}
        draggable={false}
      />
    </motion.div>
  );
}
