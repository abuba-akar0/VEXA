"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, GripVertical, Maximize2, Loader2, Minus, X } from "lucide-react";

interface FloatingDockBadgeProps {
  status: string;
  onExpand: () => void;
  onClose?: () => void;
  onMinimizeToTaskbar?: () => void;
  activeMonitor?: { x: number; y: number; width: number; height: number };
}

export const FloatingDockBadge: React.FC<FloatingDockBadgeProps> = ({
  status,
  onExpand,
  onClose,
  onMinimizeToTaskbar,
  activeMonitor,
}) => {
  const badgeRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number }>({
    startX: 0,
    startY: 0,
    initX: 0,
    initY: 0,
  });

  // Calculate safe default position anchored to current active monitor
  useEffect(() => {
    const screenX = activeMonitor?.x ?? 0;
    const screenY = activeMonitor?.y ?? 0;
    const screenW = activeMonitor?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1920);

    try {
      const saved = localStorage.getItem("vexa_dock_badge_pos");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          // Clamp to visible viewport so it never spawns offscreen or disappears
          const safeX = Math.max(screenX + 20, Math.min(parsed.x, screenX + screenW - 200));
          const safeY = Math.max(screenY + 16, Math.min(parsed.y, screenY + 800));
          setPosition({ x: safeX, y: safeY });
          return;
        }
      }
    } catch (e) {}

    // Default: Top-center of active monitor
    const defaultX = Math.round(screenX + (screenW / 2) - 100);
    const defaultY = Math.round(screenY + 20);
    setPosition({ x: defaultX, y: defaultY });
  }, [activeMonitor]);

  // Report bounding box to Tauri native hit tester
  const reportBounds = useCallback(() => {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("update_interactive_regions", {
          regions: [
            {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          ],
          isTyping: false,
          isDragging: isDraggingRef.current,
          isModalActive: false,
        }).catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    reportBounds();
  }, [position, reportBounds]);

  // Dragging handler
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position?.x ?? 40,
      initY: position?.y ?? 20,
    };

    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("set_dragging_mode", { dragging: true }).catch(() => {});
      });
    }

    let hasMoved = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      hasMoved = true;
      const dx = moveEvent.clientX - dragStartRef.current.startX;
      const dy = moveEvent.clientY - dragStartRef.current.startY;
      const nextX = Math.max(10, dragStartRef.current.initX + dx);
      const nextY = Math.max(10, dragStartRef.current.initY + dy);
      setPosition({ x: nextX, y: nextY });
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_dragging_mode", { dragging: false }).catch(() => {});
        });
      }
      setTimeout(reportBounds, 50);

      // Save position if dragged
      if (hasMoved && position) {
        try {
          localStorage.setItem("vexa_dock_badge_pos", JSON.stringify(position));
        } catch (e) {}
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const isBusy = ["observing", "planning", "executing", "verifying"].includes(status);

  return (
    <div
      ref={badgeRef}
      onMouseEnter={() => {
        if (typeof window !== "undefined") {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("set_hover_mode", { hovered: true }).catch(() => {});
          });
        }
      }}
      onMouseLeave={() => {
        if (typeof window !== "undefined") {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("set_hover_mode", { hovered: false }).catch(() => {});
          });
        }
      }}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : { left: "50%", transform: "translateX(-50%)", top: "20px" }
      }
      className="fixed z-50 pointer-events-auto select-none interactive-hud-element group"
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-950/95 border border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:shadow-[0_0_25px_rgba(6,182,212,0.55)] hover:border-cyan-400 backdrop-blur-2xl transition-all text-slate-200">
        {/* Grip handle for dragging */}
        <span
          onMouseDown={handleMouseDown}
          className="cursor-grab active:cursor-grabbing text-slate-400 group-hover:text-cyan-400 p-0.5 rounded transition-colors -ml-1"
          title="Drag VEXA dock badge anywhere along screen edges"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>

        {/* Brand & Click-to-Expand Area */}
        <div
          onClick={onExpand}
          className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors"
          title="VEXA Minimized • Click to restore HUD (or press Alt+Space)"
        >
          <span className="flex items-center gap-1 font-bold text-xs tracking-wider text-cyan-400">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse-subtle" />
            <span>VEXA</span>
          </span>

          {/* Status Indicator */}
          {isBusy ? (
            <span className="flex items-center gap-1 text-[10px] text-cyan-300 font-mono">
              <Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-400" />
              <span>Busy</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse" />
              <span>Ready</span>
            </span>
          )}

          {/* Expand / Restore Icon */}
          <Maximize2 className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform ml-0.5" />
        </div>

        {/* Separator */}
        <span className="text-white/20 text-xs">|</span>

        {/* Minimize to Windows Taskbar Button */}
        {onMinimizeToTaskbar && (
          <button
            type="button"
            onClick={onMinimizeToTaskbar}
            title="Minimize to Windows taskbar"
            className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
        )}

        {/* Complete App Exit Button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close VEXA completely"
            className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 p-1 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
