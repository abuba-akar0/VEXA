"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Info,
  Sparkles,
  Command,
  Zap,
  Layers,
  Terminal,
  Monitor,
  GripHorizontal,
  Bookmark,
  CheckCircle2,
  Clock,
  Code2,
} from "lucide-react";

interface InfoModalProps {
  onClose: () => void;
  availableMonitors?: { name: string; x?: number; y?: number; width: number; height: number }[];
}

export const InfoModal: React.FC<InfoModalProps> = ({
  onClose,
  availableMonitors = [{ name: "Display 1", x: 0, y: 0, width: 1920, height: 1080 }],
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

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

  // Calculate default centered position on primary display
  useEffect(() => {
    if (position === null) {
      const mon = availableMonitors[0] || { x: 0, y: 0, width: 1920 };
      const initialX = (mon.x ?? 0) + Math.max(40, Math.floor(((mon.width || 1920) - 580) / 2));
      const initialY = (mon.y ?? 0) + 100;
      setPosition({ x: initialX, y: initialY });
    }
  }, [availableMonitors, position]);

  // Report bounds to Tauri native hit tester
  const reportBounds = useCallback(() => {
    if (!modalRef.current) return;
    const rect = modalRef.current.getBoundingClientRect();
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
          isDragging: dragRef.current.isDragging,
          isModalActive: true,
        }).catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    reportBounds();
  }, [position, reportBounds]);

  // Dragging handler
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
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

  return (
    <div
      ref={modalRef}
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
          : { left: "50%", transform: "translateX(-50%)", top: "100px" }
      }
      className="fixed z-50 pointer-events-auto select-none interactive-hud-element"
    >
      <div className="w-[580px] max-w-[94vw] rounded-2xl bg-slate-950/95 border border-cyan-500/40 shadow-2xl p-5 flex flex-col gap-4 text-slate-200 backdrop-blur-2xl">
        {/* Header */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between pb-3 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2 text-cyan-400 font-bold tracking-wider text-sm">
            <span
              className="text-slate-400 hover:text-cyan-400 p-0.5 rounded transition-colors"
              title="Drag info window anywhere across your screens"
            >
              <GripHorizontal className="w-4 h-4" />
            </span>
            <span className="p-1 rounded-lg bg-cyan-500/20 text-cyan-300">
              <Info className="w-4 h-4" />
            </span>
            <span>VEXA Engine v2.0 • Guide & Cheat Sheet</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close Info"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-4 max-h-[480px] overflow-y-auto pr-1 text-xs">
          {/* Overview */}
          <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-slate-300 leading-relaxed">
            <p className="font-medium text-cyan-300 mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              What is VEXA?
            </p>
            VEXA (Virtual Execution & X-Layer Architect) is your zero-latency desktop overlay agent. It can launch applications, execute terminal commands, generate architecture blueprints, search the web, and answer technical questions with persistent history and Redis caching.
          </div>

          {/* Keyboard Shortcuts */}
          <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-cyan-400">
              <Command className="w-3.5 h-3.5" />
              Essential Keyboard Shortcuts
            </h4>
            <div className="grid grid-cols-2 gap-2 font-mono">
              {[
                { key: "Alt + Space", desc: "Toggle HUD focus / Restore dock" },
                { key: "Ctrl + H", desc: "Open Task History & Saved Bookmarks" },
                { key: "Ctrl + ,", desc: "Open Preferences & Settings" },
                { key: "Escape", desc: "Close open modal or minimize" },
              ].map((sc) => (
                <div key={sc.key} className="p-2 rounded-xl bg-slate-900/70 border border-white/5 flex flex-col gap-0.5">
                  <span className="text-cyan-300 font-bold text-[11px]">{sc.key}</span>
                  <span className="text-slate-400 text-[10px]">{sc.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Example Prompts by Category */}
          <div className="flex flex-col gap-2">
            <h4 className="font-semibold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider text-[11px] text-cyan-400">
              <Zap className="w-3.5 h-3.5" />
              Example Prompts & Commands
            </h4>

            <div className="space-y-2">
              {[
                {
                  cat: "Desktop & App Actions",
                  prompts: ["open whatsapp", "open spotify", "open vscode", "open calc", "open notepad"],
                },
                {
                  cat: "Web Actions & Search",
                  prompts: ["search google for weather", "play lofi hip hop on youtube"],
                },
                {
                  cat: "Architecture Blueprints",
                  prompts: ["draw architecture diagram of microservices", "sequence diagram of login auth"],
                },
                {
                  cat: "System & Code Reflexes",
                  prompts: ["git status", "find-ports", "ram usage", "disk space", "time and date"],
                },
              ].map((item) => (
                <div key={item.cat} className="p-2.5 rounded-xl bg-slate-900/60 border border-white/5 flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold text-slate-300">{item.cat}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {item.prompts.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded-md bg-white/5 text-slate-300 font-mono text-[10px] border border-white/5"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
