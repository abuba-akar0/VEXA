"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Terminal,
  Send,
  Square,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  MousePointer,
  Keyboard,
  FileCode,
  Layers,
  Copy,
  Check,
  Brain,
  Trash2,
  Maximize2,
  Minimize2,
  Clock,
  ArrowRight,
  GripHorizontal,
  Settings,
  Monitor,
  RotateCcw,
  Pencil,
  History,
  Bookmark,
  ExternalLink,
  Minus,
  Info,
  MessageSquare,
  Music,
  Code,
  Search,
  Calculator,
} from "lucide-react";
import { ExecutionStep } from "../app/page";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface CommandBarProps {
  status: string;
  message: string;
  step: number;
  maxSteps: number;
  actions?: ExecutionStep[];
  thought?: string;
  summary?: string;
  diagram?: { diagram_code: string; diagram_title?: string } | null;
  isDiagramOpen?: boolean;
  onToggleDiagram?: () => void;
  onSubmit: (prompt: string) => void;
  onAbort: () => void;
  onClear: () => void;
  isGhosting: boolean;
  isModalActive?: boolean;
  hudSize?: "compact" | "standard" | "expansive";
  onCycleHudSize?: () => void;
  onOpenSettings?: () => void;
  onTeleportNextMonitor?: () => void;
  onResetPosition?: () => void;
  onDragStateChange?: (dragging: boolean) => void;
  onBoundsChange?: () => void;
  onOpenHistory?: () => void;
  onDetachOutput?: () => void;
  onToggleBookmark?: () => void;
  isBookmarked?: boolean;
  cached?: boolean;
  cacheBackend?: string;
  onRerunWithAI?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  onOpenInfo?: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  status,
  message,
  step,
  maxSteps,
  actions = [],
  thought = "",
  summary = "",
  diagram = null,
  isDiagramOpen = false,
  onToggleDiagram,
  onSubmit,
  onAbort,
  onClear,
  isGhosting,
  isModalActive = false,
  hudSize = "standard",
  onCycleHudSize,
  onOpenSettings,
  onTeleportNextMonitor,
  onResetPosition,
  onDragStateChange,
  onBoundsChange,
  onOpenHistory,
  onDetachOutput,
  onToggleBookmark,
  isBookmarked = false,
  cached = false,
  cacheBackend = "redis",
  onRerunWithAI,
  onMinimize,
  onClose,
  onOpenInfo,
}) => {
  const [prompt, setPrompt] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showThought, setShowThought] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditingResponse, setIsEditingResponse] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });

  // Re-open response card and sync edited text when new message or actions arrive
  useEffect(() => {
    setIsDismissed(false);
    setIsEditingResponse(false);
    setEditedResponse(summary || message);
  }, [message, summary, actions.length]);

  // Handle Dragging
  const handleDragStart = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("pre") || target.closest("a") || target.closest("textarea")) {
      return;
    }
    e.preventDefault();
    const rect = pillRef.current?.getBoundingClientRect();
    if (!rect) return;
    setIsDragging(true);
    onDragStateChange?.(true);
    if (typeof window !== "undefined") {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("set_dragging_mode", { dragging: true }).catch(() => {});
      });
    }
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position ? position.x : rect.left,
      startY: position ? position.y : rect.top,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      // Multi-Monitor Support: Allow free movement across all displays
      const newX = dragStartRef.current.startX + dx;
      const newY = Math.max(10, dragStartRef.current.startY + dy);
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(false);
      onDragStateChange?.(false);
      if (typeof window !== "undefined") {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_dragging_mode", { dragging: false }).catch(() => {});
        });
      }
      onBoundsChange?.();
    };

    window.addEventListener("mousemove", handleMouseMove, { capture: true });
    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, { capture: true });
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
    };
  }, [isDragging, onDragStateChange, onBoundsChange]);

  // Send accurate bounding box coordinates to Tauri Rust backend so hover click-through works dynamically
  const reportBounds = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      const dpr = window.devicePixelRatio || 1;
      const regions: { x: number; y: number; width: number; height: number }[] = [];
      const elements = document.querySelectorAll(".interactive-hud-element");
      elements.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // 1. Raw CSS logical viewport coordinates
          regions.push({
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          });
          // 2. Physical screen coordinates (scaled by DPI)
          if (dpr !== 1) {
            regions.push({
              x: Math.round(r.left * dpr),
              y: Math.round(r.top * dpr),
              width: Math.round(r.width * dpr),
              height: Math.round(r.height * dpr),
            });
          }
        }
      });
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_interactive_regions", {
        regions,
        isTyping: false,
        isDragging,
        isModalActive,
      });
    } catch (err) {
      // Fallback for browser mode
    }
  }, [isFocused, prompt.length, isDragging, isModalActive]);

  useEffect(() => {
    reportBounds();
    const handleResize = () => reportBounds();
    window.addEventListener("resize", handleResize);
    const interval = setInterval(reportBounds, 500);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(interval);
    };
  }, [reportBounds]);

  // Trigger bound recalculation whenever height expands, collapses, or moves
  useEffect(() => {
    const timer = setTimeout(reportBounds, 120);
    return () => clearTimeout(timer);
  }, [actions.length, expandedStepId, showThought, isDismissed, position, reportBounds]);

  // Handle focus event emitted from Rust Alt+Space shortcut
  useEffect(() => {
    const handleToggleFocus = () => {
      const inputEl = document.getElementById("vexa-command-input") as HTMLInputElement;
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    };

    window.addEventListener("vexa-toggle-focus", handleToggleFocus);
    return () => window.removeEventListener("vexa-toggle-focus", handleToggleFocus);
  }, []);

  // Handle teleport event from multi-monitor switcher / settings reset
  useEffect(() => {
    const handleTeleport = (e: any) => {
      if (e.detail && typeof e.detail.x === "number" && typeof e.detail.y === "number") {
        setPosition({ x: e.detail.x, y: e.detail.y });
        setTimeout(reportBounds, 80);
      }
    };

    window.addEventListener("vexa-teleport", handleTeleport);
    return () => window.removeEventListener("vexa-teleport", handleTeleport);
  }, [reportBounds]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onSubmit(prompt);
    setPrompt("");
  };

  const handleCopyResponse = () => {
    const textToCopy = summary || message;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleStepDetails = (id: string) => {
    setExpandedStepId((prev) => (prev === id ? null : id));
  };

  const isBusy = ["observing", "planning", "executing", "verifying"].includes(status);
  const hasContent =
    !isDismissed &&
    ((actions && actions.length > 0) ||
      thought ||
      (message &&
        message !== "Ready. Press Alt+Space to activate." &&
        message !== "Ready. Press Alt+Space to focus." &&
        message !== "Connected to VEXA Engine v2.0" &&
        message !== "VEXA Engine connected"));

  // Helper for action type icon
  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case "run_command":
        return <Terminal className="w-3.5 h-3.5 text-amber-400" />;
      case "click":
      case "double_click":
      case "right_click":
        return <MousePointer className="w-3.5 h-3.5 text-cyan-400" />;
      case "type_text":
      case "press_key":
      case "hotkey":
        return <Keyboard className="w-3.5 h-3.5 text-purple-400" />;
      case "read_file":
      case "write_file":
      case "patch_file":
      case "list_dir":
        return <FileCode className="w-3.5 h-3.5 text-emerald-400" />;
      case "render_diagram":
      case "scaffold":
        return <Layers className="w-3.5 h-3.5 text-blue-400" />;
      case "done":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-cyan-400" />;
    }
  };

  return (
    <div
      ref={pillRef}
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
          : { left: "50%", transform: "translateX(-50%)", top: "16px" }
      }
      className={`fixed z-50 transition-shadow duration-300 interactive-hud-element pointer-events-auto select-none ${
        isGhosting ? "ghost-mode" : ""
      }`}
    >
      <div
        className={`glass-pill rounded-2xl shadow-2xl flex flex-col gap-2.5 border border-cyan-500/30 backdrop-blur-2xl bg-slate-950/85 transition-all duration-200 ${
          hudSize === "compact"
            ? "min-w-[540px] max-w-[620px] p-2.5 px-3.5"
            : hudSize === "expansive"
            ? "min-w-[880px] max-w-[1040px] p-4 px-5"
            : "min-w-[710px] max-w-[800px] p-3 px-4"
        }`}
      >
        {/* Top Header Row: Drag Handle, Brand, Live Activity, Utilities, Abort */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between text-xs text-slate-300 border-b border-white/10 pb-2 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span
              className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-cyan-400 p-0.5 rounded hover:bg-white/5 transition-colors"
              title="Click and drag HUD anywhere across your displays"
            >
              <GripHorizontal className="w-4 h-4" />
            </span>
            <span className="flex items-center gap-1.5 font-bold tracking-wider text-cyan-400 shrink-0">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse-subtle" />
              VEXA v2.0
            </span>
            <span className="text-slate-500">•</span>
            <span
              className="text-slate-300 font-mono text-[11px] truncate max-w-[260px]"
              title={message}
            >
              {isBusy
                ? `Step ${step}/${maxSteps}: Executing...`
                : status === "done"
                ? "Ready • Task Complete"
                : status === "error"
                ? "Error encountered"
                : !message || message.includes("Ready") || message.includes("connected")
                ? "Ready • Press Alt+Space to focus"
                : message.replace(/^#+\s*/g, "").replace(/[\*_`]/g, "").slice(0, 48)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Step Progress Badge */}
            {isBusy && (
              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded-full font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                Step {step}/{maxSteps}
              </span>
            )}

            {status === "done" && (
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Done
              </span>
            )}

            {status === "error" && (
              <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 font-medium">
                <AlertCircle className="w-3 h-3" />
                Error
              </span>
            )}

            {/* Abort Button */}
            {isBusy && (
              <button
                onClick={onAbort}
                title="Abort current task"
                className="bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-md text-[11px] flex items-center gap-1 transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                Stop
              </button>
            )}

            {/* Clear Button */}
            {!isBusy && hasContent && (
              <button
                onClick={onClear}
                title="Clear result and history"
                className="text-slate-400 hover:text-white hover:bg-white/10 p-1 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Size Preset Cycle Button */}
            <button
              type="button"
              onClick={onCycleHudSize}
              title={`Current size: ${hudSize}. Click to cycle.`}
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors text-[10px] font-mono flex items-center gap-0.5"
            >
              <Maximize2 className="w-3 h-3" />
              <span className="uppercase">{hudSize === "compact" ? "S" : hudSize === "expansive" ? "L" : "M"}</span>
            </button>

            {/* Multi-Monitor Display Switcher */}
            <button
              type="button"
              onClick={onTeleportNextMonitor}
              title="Teleport HUD to next display"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>

            {/* Re-center HUD Position */}
            <button
              type="button"
              onClick={onResetPosition}
              title="Center HUD on current screen"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
            </button>

            {/* History Drawer Button */}
            <button
              type="button"
              onClick={onOpenHistory}
              title="Open Task History & Saved Responses (Ctrl+H)"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <History className="w-3.5 h-3.5" />
            </button>

            {/* Settings Modal Button */}
            <button
              type="button"
              onClick={onOpenSettings}
              title="Open VEXA Settings & Preferences (Ctrl+,)"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            {/* Info / User Guide Modal Button */}
            <button
              type="button"
              onClick={onOpenInfo}
              title="VEXA Guide & Shortcuts Cheat Sheet"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <Info className="w-3.5 h-3.5" />
            </button>

            <span className="text-white/10">|</span>

            {/* Minimize Button (Docks to Screen Edge Badge) */}
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize HUD to floating screen-edge badge"
              className="text-slate-400 hover:text-cyan-300 hover:bg-white/10 p-1 rounded transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              title="Close and exit VEXA (terminates application)"
              className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 p-1 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Input Bar Form */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
          <input
            id="vexa-command-input"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              reportBounds();
            }}
            onBlur={() => {
              setIsFocused(false);
              reportBounds();
            }}
            placeholder="Ask VEXA to code, click, run commands, or generate Mermaid blueprints..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none font-sans"
          />

          <button
            type="submit"
            disabled={!prompt.trim() || isBusy}
            className="p-1.5 px-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/40 disabled:opacity-30 disabled:hover:bg-cyan-500/20 transition-all flex items-center gap-1 text-xs font-medium"
          >
            <Send className="w-3 h-3" />
            Run
          </button>
        </form>

        {/* Active Architecture Blueprint Banner */}
        {diagram && (
          <div className="flex items-center justify-between p-2 px-3 rounded-xl bg-cyan-950/70 border border-cyan-400/40 text-cyan-200 text-xs shadow-[0_0_15px_rgba(6,182,212,0.2)] select-none">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="p-1 rounded bg-cyan-500/20 text-cyan-300 shrink-0">
                <Layers className="w-3.5 h-3.5" />
              </span>
              <span className="font-semibold text-cyan-100 truncate">
                Architecture Blueprint: {diagram.diagram_title || "System Architecture"}
              </span>
            </div>
            <button
              type="button"
              onClick={onToggleDiagram}
              className="px-2.5 py-1 rounded-md bg-cyan-500/30 hover:bg-cyan-500/50 text-cyan-100 font-medium text-[11px] border border-cyan-400/40 transition-all flex items-center gap-1 cursor-pointer shrink-0"
            >
              {isDiagramOpen ? "Hide Diagram" : "View Diagram"}
            </button>
          </div>
        )}

        {/* High-Frequency Everyday Reflex Action Chips */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-0.5 overflow-x-auto no-scrollbar">
          <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold shrink-0">Reflex:</span>
          {[
            { label: "💬 WhatsApp", prompt: "open whatsapp" },
            { label: "🎵 Spotify", prompt: "open spotify" },
            { label: "💻 VS Code", prompt: "open vscode" },
            { label: "🔍 Search", prompt: "search google for " },
            { label: "🔢 Calc", prompt: "open calc" },
            { label: "📊 Arch Blueprint", prompt: "draw architecture diagram of system" },
            { label: "🕒 Time", prompt: "what is the current time and date" },
            { label: "⚡ Git Status", prompt: "git status" },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                if (chip.prompt === "search google for ") {
                  setPrompt("search google for ");
                  const input = document.getElementById("vexa-command-input");
                  if (input) input.focus();
                } else {
                  onSubmit(chip.prompt);
                }
              }}
              className="hover:text-cyan-300 hover:border-cyan-500/30 bg-white/5 hover:bg-cyan-500/10 px-2 py-0.5 rounded-lg border border-white/5 transition-all whitespace-nowrap text-[11px] shrink-0"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* ========================================================================= */}
        {/* EXECUTION STEPS TIMELINE & REALISTIC DETAIL DRAWER                       */}
        {/* ========================================================================= */}
        {hasContent && (
          <div
            className={`mt-2 flex flex-col gap-2.5 overflow-y-auto select-text font-sans ${
              hudSize === "compact"
                ? "max-h-[260px]"
                : hudSize === "expansive"
                ? "max-h-[520px]"
                : "max-h-[400px]"
            }`}
          >
            {/* 1. Step-by-Step Execution Plan Timeline */}
            {actions && actions.length > 0 && (
              <div className="bg-slate-900/95 border border-cyan-500/25 rounded-xl p-3 shadow-xl flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] text-slate-300 border-b border-white/10 pb-1.5 font-mono">
                  <span className="flex items-center gap-1.5 text-cyan-300 font-semibold tracking-wider uppercase text-[10px]">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Execution Steps ({actions.filter((a) => a.status === "completed").length}/{actions.length} Completed)
                  </span>
                  <span className="text-slate-400 text-[10px]">Click any step to inspect details</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {actions.map((act, idx) => {
                    const isExpanded = expandedStepId === act.id;
                    const isRunning = act.status === "running";
                    const isCompleted = act.status === "completed";
                    const isFailed = act.status === "failed";

                    return (
                      <div
                        key={act.id || idx}
                        className={`rounded-lg border transition-all text-xs overflow-hidden ${
                          isRunning
                            ? "bg-cyan-950/40 border-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                            : isCompleted
                            ? "bg-slate-900/80 border-white/10 hover:border-cyan-500/30"
                            : isFailed
                            ? "bg-rose-950/40 border-rose-500/40"
                            : "bg-slate-950/50 border-white/5 opacity-70"
                        }`}
                      >
                        {/* Step Header Bar */}
                        <div
                          onClick={() => toggleStepDetails(act.id)}
                          className="p-2 px-3 flex items-center justify-between cursor-pointer hover:bg-white/5 select-none"
                        >
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <span className="p-1 rounded bg-slate-800/80 border border-white/10 shrink-0">
                              {getActionIcon(act.action_type)}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400 shrink-0">#{act.step_num || idx + 1}</span>
                            <span className="font-semibold text-slate-200 uppercase tracking-wider text-[10px] font-mono shrink-0">
                              {act.action_type}
                            </span>
                            <span className="text-slate-300 truncate max-w-[340px]" title={act.description}>
                              {act.description}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Execution Duration */}
                            {act.duration_ms !== undefined && act.duration_ms > 0 && (
                              <span className="text-slate-400 font-mono text-[10px] flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {act.duration_ms < 1000 ? `${act.duration_ms}ms` : `${(act.duration_ms / 1000).toFixed(1)}s`}
                              </span>
                            )}

                            {/* Status Indicator */}
                            {isRunning && (
                              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1 animate-pulse">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                Running
                              </span>
                            )}

                            {isCompleted && (
                              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Done
                              </span>
                            )}

                            {isFailed && (
                              <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" />
                                Failed
                              </span>
                            )}

                            {!isRunning && !isCompleted && !isFailed && (
                              <span className="text-slate-500 font-mono text-[10px]">Pending</span>
                            )}

                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </div>
                        </div>

                        {/* Collapsible Step Detail Body */}
                        {isExpanded && (
                          <div className="p-2.5 px-3 border-t border-white/10 bg-slate-950/80 text-[11px] font-mono text-slate-300 flex flex-col gap-2">
                            {/* Parameters */}
                            {act.params && Object.keys(act.params).length > 0 && (
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1">
                                  Action Parameters:
                                </span>
                                <pre className="bg-slate-900/90 p-2 rounded border border-white/5 overflow-x-auto text-cyan-300 leading-tight">
                                  {JSON.stringify(act.params, null, 2)}
                                </pre>
                              </div>
                            )}

                            {/* Output Result */}
                            {act.result && (
                              <div>
                                <span className="text-slate-400 text-[10px] uppercase tracking-wider block mb-1">
                                  Execution Output:
                                </span>
                                <pre className="bg-slate-900/90 p-2 rounded border border-white/5 overflow-x-auto text-emerald-300 leading-tight whitespace-pre-wrap">
                                  {typeof act.result === "string"
                                    ? act.result
                                    : act.result.stdout || act.result.message || act.result.result || JSON.stringify(act.result, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. AI Reasoning Accordion */}
            {thought && (
              <div className="bg-slate-900/80 border border-purple-500/20 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowThought(!showThought)}
                  className="w-full p-2 px-3 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-purple-300 text-xs font-mono font-medium">
                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                    AI Reasoning & Strategy
                  </span>
                  {showThought ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>
                {showThought && (
                  <div className="p-3 border-t border-purple-500/20 text-xs text-purple-200/90 bg-slate-950/60 leading-relaxed font-sans">
                    {thought}
                  </div>
                )}
              </div>
            )}

            {/* 3. Final Task Response Summary Card */}
            {(summary || message) && (
              <div className="p-3 bg-slate-900/95 border border-cyan-500/30 rounded-xl text-xs text-slate-200 shadow-2xl leading-relaxed select-text font-sans">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/10 text-[10px] font-mono">
                  <span
                    className={`font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                      status === "error"
                        ? "text-rose-400"
                        : status === "done"
                        ? "text-emerald-400"
                        : "text-cyan-400"
                    }`}
                  >
                    {status === "done" ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        Task Response
                      </>
                    ) : status === "error" ? (
                      <>
                        <AlertCircle className="w-3 h-3 text-rose-400" />
                        Execution Error
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        Live Status
                      </>
                    )}
                  </span>

                  <div className="flex items-center gap-1">
                    {/* Detach / Pop out to Floating Window */}
                    {onDetachOutput && (
                      <button
                        type="button"
                        onClick={onDetachOutput}
                        className="hover:text-white p-1 rounded hover:bg-white/10 text-slate-400 transition-colors flex items-center gap-1 text-[10px]"
                        title="Open in separate floating window (draggable to Monitor 2)"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Detach</span>
                      </button>
                    )}

                    {/* Bookmark / Save Response */}
                    {onToggleBookmark && (
                      <button
                        type="button"
                        onClick={onToggleBookmark}
                        className={`p-1 rounded transition-colors flex items-center gap-1 text-[10px] ${
                          isBookmarked
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : "hover:text-amber-400 hover:bg-white/10 text-slate-400"
                        }`}
                        title={isBookmarked ? "Saved in Bookmarks" : "Save response"}
                      >
                        <Bookmark className="w-3 h-3" fill={isBookmarked ? "currentColor" : "none"} />
                        <span>{isBookmarked ? "Saved" : "Save"}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setIsEditingResponse(!isEditingResponse)}
                      className={`p-1 rounded transition-colors flex items-center gap-1 text-[10px] ${
                        isEditingResponse
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
                          : "hover:text-white hover:bg-white/10 text-slate-400"
                      }`}
                      title={isEditingResponse ? "View formatted markdown" : "Edit response text directly"}
                    >
                      <Pencil className="w-3 h-3" />
                      {isEditingResponse ? "Preview" : "Edit"}
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyResponse}
                      className="hover:text-white p-1 rounded hover:bg-white/10 text-slate-400 transition-colors flex items-center gap-1 text-[10px]"
                      title="Copy response"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDismissed(true)}
                      className="hover:text-white p-1 rounded hover:bg-white/10 text-slate-400 transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Instant Cache Source Badge */}
                {cached && (
                  <div className="mb-2 flex items-center justify-between bg-cyan-950/40 border border-cyan-500/30 rounded-lg px-2.5 py-1 text-[11px] text-cyan-300 font-mono">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      Retrieved from {cacheBackend === "redis" ? "Redis" : "Local"} Cache (&lt;1ms)
                    </span>
                    {onRerunWithAI && (
                      <button
                        type="button"
                        onClick={onRerunWithAI}
                        className="flex items-center gap-1 text-[10px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 px-2 py-0.5 rounded border border-cyan-400/30 transition-colors font-sans"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Re-run with AI
                      </button>
                    )}
                  </div>
                )}

                {isEditingResponse ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editedResponse}
                      onChange={(e) => setEditedResponse(e.target.value)}
                      rows={6}
                      className="w-full bg-slate-950 p-2.5 rounded-lg border border-cyan-500/40 text-xs text-white focus:outline-none font-sans leading-relaxed select-text"
                      placeholder="Edit response text here..."
                    />
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Editing response locally</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingResponse(false)}
                        className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 font-medium transition-colors"
                      >
                        Done Editing
                      </button>
                    </div>
                  </div>
                ) : (
                  <MarkdownRenderer content={editedResponse || summary || message} />
                )}

                {/* AI Refinement Actions */}
                <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span className="text-slate-400 font-medium shrink-0">Refine:</span>
                  <button
                    type="button"
                    onClick={() =>
                      onSubmit(
                        `Please make this previous response much shorter, more direct, and concise:\n${
                          editedResponse || summary || message
                        }`
                      )
                    }
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/5 transition-colors"
                  >
                    ✨ Shorter
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSubmit(
                        `Extract or rewrite this previous response into clean, runnable code only:\n${
                          editedResponse || summary || message
                        }`
                      )
                    }
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/5 transition-colors"
                  >
                    📋 Code Only
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSubmit(
                        `Elaborate further on this previous response with deeper facts, background, and practical details:\n${
                          editedResponse || summary || message
                        }`
                      )
                    }
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/5 transition-colors"
                  >
                    🔍 Elaborate
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSubmit(
                        `Translate this previous response into Urdu:\n${
                          editedResponse || summary || message
                        }`
                      )
                    }
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/5 transition-colors"
                  >
                    🌐 Translate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
