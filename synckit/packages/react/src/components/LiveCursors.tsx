import { type PresenceEntry } from "@synckit/client";
import { useEffect, useRef } from "react";

import { useOthers } from "../hooks.js";
import { colorFor } from "../store.js";

interface CursorPosition {
  x: number;
  y: number;
}

function cursorOf(entry: PresenceEntry): CursorPosition | undefined {
  const data = entry.data as { cursor?: { x?: unknown; y?: unknown } | null } | null;
  const cursor = data?.cursor;
  if (!cursor || typeof cursor.x !== "number" || typeof cursor.y !== "number") return undefined;
  return { x: cursor.x, y: cursor.y };
}

/**
 * Renders every other member's cursor (from presence data `{cursor:{x,y}}`)
 * with the user's name. Positions are interpolated with requestAnimationFrame
 * — DOM transforms are written directly, so a moving cursor never re-renders
 * the React tree. Theme via --synckit-cursor-label-* variables.
 */
export function LiveCursors() {
  const others = useOthers();
  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2_147_483_000 }}
    >
      {others.map((entry) => {
        const target = cursorOf(entry);
        if (!target) return null;
        return <Cursor key={entry.endUserId} entry={entry} target={target} />;
      })}
    </div>
  );
}

function Cursor({ entry, target }: { entry: PresenceEntry; target: CursorPosition }) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<CursorPosition>(target);
  const targetRef = useRef<CursorPosition>(target);
  targetRef.current = target;

  useEffect(() => {
    let frame: number;
    const step = () => {
      const position = positionRef.current;
      const goal = targetRef.current;
      // Exponential smoothing toward the target.
      position.x += (goal.x - position.x) * 0.35;
      position.y += (goal.y - position.y) * 0.35;
      if (elementRef.current) {
        elementRef.current.style.transform = `translate(${position.x}px, ${position.y}px)`;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  const color = colorFor(entry.endUserId);
  return (
    <div
      ref={elementRef}
      data-testid={`cursor-${entry.endUserId}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `translate(${target.x}px, ${target.y}px)`,
        willChange: "transform",
      }}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" style={{ display: "block" }}>
        <path d="M0 0 L16 12 L8.5 12.8 L5 20 Z" fill={color} />
      </svg>
      <span
        style={{
          background: color,
          color: "var(--synckit-cursor-label-color, #fff)",
          borderRadius: "var(--synckit-cursor-label-radius, 4px)",
          font: "var(--synckit-font, 500 12px system-ui, sans-serif)",
          padding: "2px 6px",
          marginLeft: 10,
          whiteSpace: "nowrap",
          display: "inline-block",
        }}
      >
        {entry.displayName ?? entry.endUserId}
      </span>
    </div>
  );
}
