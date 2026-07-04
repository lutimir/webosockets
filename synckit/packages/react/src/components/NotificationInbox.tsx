import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { useNotifications } from "../hooks.js";
import { relativeTime } from "../store.js";

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 8px)",
  width: 320,
  maxHeight: 400,
  overflowY: "auto",
  background: "var(--synckit-surface, #fff)",
  color: "var(--synckit-text, #18181b)",
  border: "var(--synckit-border, 1px solid #e4e4e7)",
  borderRadius: "var(--synckit-radius, 8px)",
  boxShadow: "var(--synckit-shadow, 0 8px 24px rgb(0 0 0 / 0.12))",
  padding: 8,
  font: "var(--synckit-font, 400 14px system-ui, sans-serif)",
  zIndex: 1_000,
};

/** Bell button with unread badge and a dropdown inbox (Escape / outside-click
 *  to close, mark-all-read). */
export function NotificationInbox() {
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={() => setOpen((current) => !current)}
        style={{
          position: "relative",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontSize: 20,
          padding: 6,
          lineHeight: 1,
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "var(--synckit-danger, #dc2626)",
              color: "#fff",
              borderRadius: 999,
              font: "var(--synckit-font, 700 10px system-ui, sans-serif)",
              minWidth: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} role="region" aria-label="Notifications" style={panelStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "4px 8px",
            }}
          >
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--synckit-accent, #4f46e5)",
                  cursor: "pointer",
                  font: "var(--synckit-font, 500 12px system-ui, sans-serif)",
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p style={{ color: "var(--synckit-muted, #71717a)", padding: "4px 8px" }}>
              Nothing here yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => markRead([notification.id])}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background:
                        notification.readAt === null
                          ? "var(--synckit-unread-bg, #eef2ff)"
                          : "transparent",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 8px",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <span style={{ fontWeight: notification.readAt === null ? 600 : 400 }}>
                      {notification.type}
                    </span>
                    <time
                      dateTime={notification.createdAt}
                      style={{
                        display: "block",
                        color: "var(--synckit-muted, #71717a)",
                        fontSize: 12,
                      }}
                    >
                      {relativeTime(notification.createdAt)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
