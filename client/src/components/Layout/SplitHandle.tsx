import React, { useEffect, useRef, useState } from 'react';

export type SplitOrientation = 'vertical' | 'horizontal';

export interface SplitHandleProps {
  /** vertical = a vertical bar dragged left/right · horizontal = a horizontal bar dragged up/down. */
  orientation: SplitOrientation;
  /**
   * Called with the accumulated drag delta in px, already signed as "grow the pane":
   * vertical → positive when dragging left, horizontal → positive when dragging up.
   * Set `invert` when the pane is anchored on the left/top instead.
   */
  onDrag: (deltaPx: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Restores the default pane size (double-click / Home). */
  onReset?: () => void;
  /** Keyboard nudges (arrows). Defaults to 16px steps. */
  onStep?: (deltaPx: number) => void;
  invert?: boolean;
  label: string;
  hint?: string;
  className?: string;
}

/** Grow delta produced by a pointer position, per orientation. */
function pointerDelta(orientation: SplitOrientation, start: { x: number; y: number }, current: { x: number; y: number }): number {
  return orientation === 'vertical' ? start.x - current.x : start.y - current.y;
}

/**
 * Draggable pane divider.
 *
 * Replaces the ad-hoc window mousemove handlers that made resizing feel broken:
 *  - pointer events + `setPointerCapture` keep the drag even when the cursor leaves the window,
 *  - updates are coalesced into requestAnimationFrame so the pane follows the pointer instead of the
 *    mouse event rate (no more laggy/jumpy layout while dragging),
 *  - keyboard operable (arrows step, Home resets) with a visible grip and focus ring,
 *  - a grab cursor is applied to <body> for the whole drag so the affordance does not flicker.
 */
export const SplitHandle: React.FC<SplitHandleProps> = ({
  orientation,
  onDrag,
  onDragStart,
  onDragEnd,
  onReset,
  onStep,
  invert = false,
  label,
  hint,
  className = '',
}) => {
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef<{ pointerId: number; start: { x: number; y: number }; frame: number | null; latest: number } | null>(null);
  const dragCallbackRef = useRef(onDrag);
  useEffect(() => {
    // Keep the latest callback without writing a ref during render (React Compiler lint rule).
    dragCallbackRef.current = onDrag;
  }, [onDrag]);

  useEffect(() => {
    return () => {
      const state = stateRef.current;
      if (state?.frame != null) cancelAnimationFrame(state.frame);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const applyDelta = (deltaPx: number) => {
    const signed = invert ? -deltaPx : deltaPx;
    const state = stateRef.current;
    if (!state) return;
    state.latest = signed;
    if (state.frame != null) return;
    // Coalesce to one layout update per frame: dragging stays smooth on high-frequency pointer events.
    state.frame = requestAnimationFrame(() => {
      const active = stateRef.current;
      if (!active) return;
      active.frame = null;
      dragCallbackRef.current(active.latest);
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    stateRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, frame: null, latest: 0 };
    setDragging(true);
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    onDragStart?.();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    applyDelta(pointerDelta(orientation, state.start, { x: event.clientX, y: event.clientY }));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.frame != null) cancelAnimationFrame(state.frame);
    stateRef.current = null;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onDragEnd?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (amount: number) => {
      event.preventDefault();
      (onStep ?? dragCallbackRef.current)(amount);
    };
    if (orientation === 'vertical') {
      if (event.key === 'ArrowLeft') step(16);
      else if (event.key === 'ArrowRight') step(-16);
    } else {
      if (event.key === 'ArrowUp') step(16);
      else if (event.key === 'ArrowDown') step(-16);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      onReset?.();
    }
  };

  return (
    <div
      className={`dc-split-handle ${className}`}
      data-orientation={orientation}
      data-dragging={dragging}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      title={hint ? `${hint} · double-click to reset` : 'Drag to resize · double-click to reset'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={() => onReset?.()}
      onKeyDown={handleKeyDown}
    >
      <span className="dc-split-grip" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="dc-split-dot" />
        ))}
      </span>
    </div>
  );
};
