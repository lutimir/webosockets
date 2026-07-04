import { CommentsThread, useComments } from "@synckit/react";
import { useEffect, useRef, useState } from "react";

/**
 * Comment pin on a card: shows the live count for the card's anchor
 * (`{cardId}` — the same anchor shape the seed data uses) and opens the
 * threaded conversation in a popover.
 */
export function CardComments({ cardId }: { cardId: string }) {
  const anchor = { cardId };
  const { comments } = useComments({ anchor });
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unresolved = comments.filter((comment) => comment.resolvedAt === null).length;

  return (
    <div className="demo-pin-wrap" ref={popoverRef}>
      <button
        type="button"
        className={unresolved > 0 ? "demo-pin demo-pin-active" : "demo-pin"}
        aria-expanded={open}
        aria-label={`Comments (${comments.length})`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        // Keep drag & drop of the card from hijacking the click.
        draggable={false}
        onDragStart={(event) => event.stopPropagation()}
      >
        💬 {comments.length > 0 ? comments.length : ""}
      </button>
      {open && (
        <div className="demo-popover" onPointerMove={(event) => event.stopPropagation()}>
          <CommentsThread anchor={anchor} />
        </div>
      )}
    </div>
  );
}
