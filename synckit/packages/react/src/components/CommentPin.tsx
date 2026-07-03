import { useEffect, useState } from "react";

import { useComments } from "../hooks.js";

import { CommentsThread } from "./CommentsThread.js";

/**
 * Floating pin attached to the element carrying
 * `data-synckit-anchor="<anchor>"`; clicking it opens the comment thread for
 * that anchor. Repositions on scroll and resize.
 */
export function CommentPin({ anchor }: { anchor: string }) {
  const anchorValue = { el: anchor };
  const { comments } = useComments({ anchor: anchorValue });
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const element = document.querySelector(`[data-synckit-anchor="${anchor}"]`);
    if (!element) {
      setPosition(null);
      return;
    }
    const reposition = () => {
      const rect = element.getBoundingClientRect();
      setPosition({ top: rect.top - 10, left: rect.right - 10 });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(element);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchor]);

  if (!position) return null;

  return (
    <div style={{ position: "fixed", top: position.top, left: position.left, zIndex: 1_000 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Comments for ${anchor} (${comments.length})`}
        onClick={() => setOpen((current) => !current)}
        style={{
          width: 24,
          height: 24,
          borderRadius: "12px 12px 12px 2px",
          background: "var(--synckit-accent, #4f46e5)",
          color: "#fff",
          border: "2px solid #fff",
          boxShadow: "var(--synckit-shadow, 0 2px 8px rgb(0 0 0 / 0.25))",
          cursor: "pointer",
          font: "var(--synckit-font, 700 11px system-ui, sans-serif)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        {comments.length > 0 ? comments.length : "+"}
      </button>
      {open && (
        <div style={{ position: "absolute", top: 28, right: 0 }}>
          <CommentsThread anchor={anchorValue} />
        </div>
      )}
    </div>
  );
}
