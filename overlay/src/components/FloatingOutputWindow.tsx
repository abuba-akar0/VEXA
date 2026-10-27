"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  GripHorizontal,
  Copy,
  Check,
  Bookmark,
  Sparkles,
  Monitor,
  ExternalLink,
  RotateCcw,
  Code2,
  FileText,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Edit3,
} from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ExecutionStep } from "../app/page";

export interface DetachedOutputData {
  id?: number | string;
  title: string;
  content: string;
  thought?: string;
  actions?: ExecutionStep[];
  diagram?: { diagram_code: string; diagram_title?: string } | null;
  cached?: boolean;
  cacheBackend?: string;
  isBookmarked?: boolean;
}

interface FloatingOutputWindowProps {
  data: DetachedOutputData;
  onClose: () => void;
  onRerunWithAI?: (prompt: string) => void;
  onRefineResponse?: (refinementType: string) => void;
  onToggleBookmark?: (id: number | string) => void;
  availableMonitors?: { name: string; x?: number; y?: number; width: number; height: number }[];
}

export const FloatingOutputWindow: React.FC<FloatingOutputWindowProps> = ({
  data,
  onClose,
  onRerunWithAI,
  onRefineResponse,
  onToggleBookmark,
  availableMonitors = [{ name: "Display 1", x: 0, y: 0, width: 1920, height: 1080 }],
}) => {
  const windowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 680, height: 520 });
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editableContent, setEditableContent] = useState<string>(data.content);
  const [showThought, setShowThought] = useState<boolean>(false);
  const [isBookmarked, setIsBookmarked] = useState<boolean>(!!data.isBookmarked);

  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const resizeRef = useRef<{
    isResizing: boolean;
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
  }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    initialWidth: 0,
    initialHeight: 0,
  });

  // Default positioning on secondary display if available, else offset from center
  useEffect(() => {
    if (position === null) {
      if (availableMonitors.length > 1) {
        // Place on monitor 2 by default
        const mon2 = availableMonitors[1];
        const initialX = (mon2.x ?? 1920) + Math.max(40, Math.floor(((mon2.width || 1920) - size.width) / 2));
        const initialY = (mon2.y ?? 0) + 120;
        setPosition({ x: initialX, y: initialY });
      } else {
        const mon1 = availableMonitors[0];
        const initialX = (mon1?.x ?? 0) + Math.max(40, Math.floor(((mon1?.width || 1920) - size.width) / 2));
        const initialY = (mon1?.y ?? 0) + 140;
        setPosition({ x: initialX, y: initialY });
      }
    }
  }, [availableMonitors, position, size.width]);

  // Sync content when prop changes
  useEffect(() => {
    setEditableContent(data.content);
    setIsBookmarked(!!data.isBookmarked);
  }, [data.content, data.isBookmarked]);

  // Report bounds to Tauri native hit tester
  const reportBounds = useCallback(() => {
    if (!windowRef.current) return;
    const rect = windowRef.current.getBoundingClientRect();
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
          isTyping: isEditing,
          isDragging: dragRef.current.isDragging || resizeRef.current.isResizing,
          isModalActive: true,
        }).catch(() => {});
      });
    }
  }, [isEditing]);

  useEffect(() => {
    reportBounds();
  }, [position, size, reportBounds]);

  // Multi-Monitor Dragging Handler (No boundary clamping)
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, textarea")) return;
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position?.x ?? 200,
      initialY: position?.y ?? 100,
    };

    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("set_dragging_mode", { dragging: true }).catch(() => {});
      });
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy,
      });
    };

    const onMouseUp = () => {
      dragRef.current.isDragging = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_dragging_mode", { dragging: false }).catch(() => {});
        });
      }
      setTimeout(reportBounds, 50);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Resizing Handler
  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    resizeRef.current = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      initialWidth: size.width,
      initialHeight: size.height,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeRef.current.isResizing) return;
      const dx = moveEvent.clientX - resizeRef.current.startX;
      const dy = moveEvent.clientY - resizeRef.current.startY;
      setSize({
        width: Math.max(440, resizeRef.current.initialWidth + dx),
        height: Math.max(340, resizeRef.current.initialHeight + dy),
      });
    };

    const onMouseUp = () => {
      resizeRef.current.isResizing = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setTimeout(reportBounds, 50);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editableContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const toggleBookmark = () => {
    const nextState = !isBookmarked;
    setIsBookmarked(nextState);
    if (data.id && onToggleBookmark) {
      onToggleBookmark(data.id);
    }
  };

  const teleportToScreen = (idx: number) => {
    const targetMon = availableMonitors[idx] || availableMonitors[0];
    if (targetMon) {
      const monX = targetMon.x ?? 0;
      const monY = targetMon.y ?? 0;
      const monW = targetMon.width ?? 1920;
      const targetX = monX + Math.max(40, Math.floor((monW - size.width) / 2));
      const targetY = monY + 120;
      setPosition({ x: targetX, y: targetY });
    }
  };

  return (
    <div
      ref={windowRef}
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
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: `${size.width}px`,
              height: `${size.height}px`,
            }
          : {
              left: "50%",
              transform: "translateX(-50%)",
              top: "120px",
              width: `${size.width}px`,
              height: `${size.height}px`,
            }
      }
      className="fixed z-50 pointer-events-auto select-none interactive-hud-element rounded-2xl bg-slate-950/95 border border-cyan-500/40 shadow-2xl backdrop-blur-2xl flex flex-col text-slate-200 overflow-hidden"
    >
      {/* Title Bar / Drag Header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className="text-slate-400 hover:text-cyan-400 p-0.5 rounded transition-colors"
            title="Drag window anywhere across your screens"
          >
            <GripHorizontal className="w-4 h-4" />
          </span>
          <span className="p-1 rounded bg-cyan-500/20 text-cyan-300">
            <ExternalLink className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-bold text-cyan-300 truncate max-w-[280px]" title={data.title}>
            {data.title || "Output Window"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Multi-Monitor Teleport */}
          {availableMonitors && availableMonitors.length > 1 && (
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded border border-white/10">
              {availableMonitors.map((m, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => teleportToScreen(idx)}
                  title={`Teleport output window to ${m.name || `Display ${idx + 1}`}`}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Monitor className="w-2.5 h-2.5 inline mr-0.5" />
                  S{idx + 1}
                </button>
              ))}
            </div>
          )}

          {/* Bookmark Button */}
          <button
            type="button"
            onClick={toggleBookmark}
            title={isBookmarked ? "Saved in Bookmarks" : "Save to Bookmarks"}
            className={`p-1.5 rounded transition-colors ${
              isBookmarked
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" fill={isBookmarked ? "currentColor" : "none"} />
          </button>

          {/* Edit Toggle */}
          <button
            type="button"
            onClick={() => setIsEditing(!isEditing)}
            title={isEditing ? "View formatted markdown" : "Edit response text"}
            className={`p-1.5 rounded transition-colors ${
              isEditing
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-slate-400 hover:text-white hover:bg-white/10"
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>

          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy content"
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Close Window */}
          <button
            type="button"
            onClick={onClose}
            title="Close Window"
            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Cache Source Alert Banner */}
        {data.cached && (
          <div className="flex items-center justify-between bg-cyan-950/40 border border-cyan-500/30 rounded-xl px-3 py-1.5 text-xs text-cyan-300">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Retrieved instantaneously from {data.cacheBackend === "redis" ? "Redis" : "Local"} Cache (&lt;1ms)
            </span>
            {onRerunWithAI && (
              <button
                type="button"
                onClick={() => onRerunWithAI(data.title)}
                className="flex items-center gap-1 text-[11px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 px-2 py-0.5 rounded-lg border border-cyan-400/30 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Re-run with AI
              </button>
            )}
          </div>
        )}

        {/* Expandable Thought Section */}
        {data.thought && (
          <div className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowThought(!showThought)}
              className="w-full flex items-center justify-between p-2.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                AI Reasoning & Thought Chain
              </span>
              {showThought ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showThought && (
              <div className="p-3 pt-0 text-xs text-slate-300 border-t border-white/5 font-mono whitespace-pre-wrap">
                {data.thought}
              </div>
            )}
          </div>
        )}

        {/* Content View / Editor */}
        {isEditing ? (
          <div className="flex flex-col gap-2 h-[calc(100%-80px)]">
            <textarea
              value={editableContent}
              onChange={(e) => setEditableContent(e.target.value)}
              className="w-full flex-1 min-h-[240px] bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400 resize-none select-text"
              placeholder="Edit response markdown..."
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-medium hover:bg-cyan-500/30 transition-colors"
              >
                Save & Preview
              </button>
            </div>
          </div>
        ) : (
          <div className="select-text prose prose-invert max-w-none text-xs leading-relaxed text-slate-200">
            <MarkdownRenderer content={editableContent} />
          </div>
        )}
      </div>

      {/* Footer: Quick AI Refinements & Resize Grip */}
      <div className="px-4 py-2 bg-slate-900/90 border-t border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Refine:</span>
          {[
            { id: "shorter", label: "✨ Shorter" },
            { id: "code_only", label: "📋 Code Only" },
            { id: "elaborate", label: "🔍 Elaborate" },
            { id: "translate", label: "🌐 Translate" },
          ].map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onRefineResponse?.(chip.id)}
              className="text-[11px] bg-white/5 hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-white/10 rounded-lg px-2 py-0.5 text-slate-300 transition-colors shrink-0"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Resizer handle corner */}
        <div
          onMouseDown={handleResizeStart}
          className="cursor-nwse-resize p-1 text-slate-500 hover:text-cyan-400 transition-colors select-none shrink-0"
          title="Drag to resize window"
        >
          <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-current" />
        </div>
      </div>
    </div>
  );
};
