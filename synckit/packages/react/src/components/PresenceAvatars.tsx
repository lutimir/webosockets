import { useOthers } from "../hooks.js";
import { colorFor, initialsOf } from "../store.js";

const avatarStyle = {
  width: "var(--synckit-avatar-size, 32px)",
  height: "var(--synckit-avatar-size, 32px)",
  borderRadius: "50%",
  border: "var(--synckit-avatar-border, 2px solid #fff)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  font: "var(--synckit-font, 600 12px system-ui, sans-serif)",
  color: "#fff",
  marginLeft: "calc(var(--synckit-avatar-overlap, 8px) * -1)",
  overflow: "hidden",
  flexShrink: 0,
} as const;

/** Overlapping stack of everyone else in the room, capped at `max` + "+N". */
export function PresenceAvatars({ max = 5 }: { max?: number }) {
  const others = useOthers();
  const visible = others.slice(0, max);
  const overflow = others.length - visible.length;

  return (
    <div
      role="group"
      aria-label={`${others.length} ${others.length === 1 ? "person" : "people"} online`}
      style={{ display: "inline-flex", paddingLeft: "var(--synckit-avatar-overlap, 8px)" }}
    >
      {visible.map((entry) => (
        <span
          key={entry.endUserId}
          title={entry.displayName ?? entry.endUserId}
          style={{ ...avatarStyle, background: colorFor(entry.endUserId) }}
        >
          {entry.avatarUrl ? (
            <img
              src={entry.avatarUrl}
              alt={entry.displayName ?? entry.endUserId}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            initialsOf(entry.displayName, entry.endUserId)
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          style={{ ...avatarStyle, background: "var(--synckit-avatar-overflow-bg, #52525b)" }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
