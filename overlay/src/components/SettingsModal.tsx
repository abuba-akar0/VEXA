"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Settings,
  Monitor,
  Maximize2,
  Sliders,
  Sparkles,
  RotateCcw,
  Trash2,
  Check,
  Eye,
  GripHorizontal,
} from "lucide-react";

export type HudSize = "compact" | "standard" | "expansive";

export interface VexaSettings {
  hudSize: HudSize;
  opacity: number; // 70 to 100
  aiModel: string;
  responseStyle: "detailed" | "concise" | "bullet_points";
  activeMonitorIndex: number;
}

interface MonitorInfo {
  index?: number;
  name: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface SettingsModalProps {
  settings: VexaSettings;
  onUpdateSettings: (newSettings: Partial<VexaSettings>) => void;
  onClose: () => void;
  onResetPosition: () => void;
  onClearHistory: () => void;
  onTeleportToMonitor?: (monitorIndex: number) => void;
  availableMonitors?: MonitorInfo[];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
  onResetPosition,
  onClearHistory,
  onTeleportToMonitor,
  availableMonitors = [{ name: "Display 1 (Primary)", x: 0, y: 0, width: 1920, height: 1080 }],
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

  // Calculate default position centered on the active display (avoiding bezel split)
  useEffect(() => {
    if (position === null) {
      const activeMon = availableMonitors[settings.activeMonitorIndex] || availableMonitors[0];
      const monX = activeMon?.x ?? 0;
      const monY = activeMon?.y ?? 0;
      const monW = activeMon?.width ?? 1920;
      const initialX = monX + Math.max(40, Math.floor((monW - 540) / 2));
      const initialY = monY + 110;
      setPosition({ x: initialX, y: initialY });
    }
  }, [availableMonitors, settings.activeMonitorIndex, position]);

  // Report modal bounds to Tauri native hit-tester
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

  const teleportToScreen = (idx: number) => {
    const targetMon = availableMonitors[idx] || availableMonitors[0];
    if (targetMon) {
      const monX = targetMon.x ?? 0;
      const monY = targetMon.y ?? 0;
      const monW = targetMon.width ?? 1920;
      const targetX = monX + Math.max(40, Math.floor((monW - 540) / 2));
      const targetY = monY + 110;
      setPosition({ x: targetX, y: targetY });
      onUpdateSettings({ activeMonitorIndex: idx });
      onTeleportToMonitor?.(idx);
    }
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
      <div className="w-[540px] max-w-[94vw] rounded-2xl bg-slate-950/95 border border-cyan-500/40 shadow-2xl p-5 flex flex-col gap-4 text-slate-200 backdrop-blur-2xl">
        {/* Header with Drag Handle & Screen Teleport Buttons */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between pb-3 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2 text-cyan-400 font-bold tracking-wider text-sm">
            <span
              className="text-slate-400 hover:text-cyan-400 p-0.5 rounded transition-colors"
              title="Drag settings window anywhere across your screens"
            >
              <GripHorizontal className="w-4 h-4" />
            </span>
            <span className="p-1 rounded-lg bg-cyan-500/20 text-cyan-300">
              <Settings className="w-4 h-4" />
            </span>
            <span>VEXA Preferences</span>
          </div>

          <div className="flex items-center gap-2">
            {/* 1-Click Screen Teleport Buttons */}
            {availableMonitors && availableMonitors.length > 1 && (
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                {availableMonitors.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => teleportToScreen(idx)}
                    title={`Snap window to ${m.name || `Display ${idx + 1}`}`}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 transition-all ${
                      settings.activeMonitorIndex === idx
                        ? "bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Monitor className="w-3 h-3" />
                    <span>Screen {idx + 1}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Close Preferences"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Settings Body */}
        <div className="flex flex-col gap-4 max-h-[460px] overflow-y-auto pr-1">
          {/* 1. HUD Size & Scale (Laptop Screen Adaptability) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
              HUD Size & Screen Adaptability
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "compact", label: "Compact", desc: "460px (Laptop friendly)", width: "460px" },
                { id: "standard", label: "Standard", desc: "640px (Default)", width: "640px" },
                { id: "expansive", label: "Expansive", desc: "820px (Ultrawide)", width: "820px" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUpdateSettings({ hudSize: s.id as HudSize })}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col gap-0.5 ${
                    settings.hudSize === s.id
                      ? "bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                      : "bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  <span className="text-xs font-bold text-cyan-300 flex items-center justify-between">
                    {s.label}
                    {settings.hudSize === s.id && <Check className="w-3 h-3 text-cyan-400" />}
                  </span>
                  <span className="text-[10px] text-slate-400">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Multi-Monitor Display Target */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-cyan-400" />
              Active Display Snap
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => teleportToScreen(0)}
                className={`flex-1 p-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                  settings.activeMonitorIndex === 0
                    ? "bg-cyan-500/20 border-cyan-400 text-white"
                    : "bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Display 1 (Primary)
              </button>
              <button
                type="button"
                onClick={() => teleportToScreen(1)}
                className={`flex-1 p-2 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                  settings.activeMonitorIndex === 1
                    ? "bg-cyan-500/20 border-cyan-400 text-white"
                    : "bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Display 2 (Secondary)
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              Tip: You can also drag the window directly across displays using the grip icon.
            </p>
          </div>

          {/* 3. Glass Transparency */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                Glass Backdrop Opacity
              </span>
              <span className="font-mono text-cyan-300">{settings.opacity}%</span>
            </div>
            <input
              type="range"
              min="65"
              max="100"
              step="5"
              value={settings.opacity}
              onChange={(e) => onUpdateSettings({ opacity: Number(e.target.value) })}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>

          {/* 4. AI Reasoning & Response Style */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Response Style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "detailed", label: "Detailed", desc: "Comprehensive answers" },
                { id: "concise", label: "Concise", desc: "Short & direct" },
                { id: "bullet_points", label: "Key Points", desc: "Fast bulleted facts" },
              ].map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ responseStyle: style.id as VexaSettings["responseStyle"] })
                  }
                  className={`p-2 rounded-xl border text-left transition-all ${
                    settings.responseStyle === style.id
                      ? "bg-cyan-500/20 border-cyan-400 text-white"
                      : "bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20"
                  }`}
                >
                  <span className="text-xs font-bold text-cyan-300 block">{style.label}</span>
                  <span className="text-[10px] text-slate-400">{style.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 5. Utility Actions: Reset Position & Clear History */}
          <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onResetPosition}
              className="flex items-center gap-1.5 text-xs text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Center HUD on Screen
            </button>

            <button
              type="button"
              onClick={onClearHistory}
              className="flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Task History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
