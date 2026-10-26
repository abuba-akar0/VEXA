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
  ArrowRight
} from "lucide-react";
import { ExecutionStep } from "../app/page";

interface CommandBarProps {
  status: string;
  message: string;
  step: number;
  maxSteps: number;
  actions?: ExecutionStep[];
  thought?: string;
  summary?: string;
  onSubmit: (prompt: string) => void;
  onAbort: () => void;
  onClear: () => void;
  isGhosting: boolean;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  status,
  message,
  step,
  maxSteps,
  actions = [],
  thought = "",
  summary = "",
  onSubmit,
  onAbort,
  onClear,
  isGhosting,
}) => {
  const [prompt, setPrompt] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showThought, setShowThought] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  // Re-open response card when new message or actions arrive
  useEffect(() => {
    setIsDismissed(false);
  }, [message, actions.length]);

  // Expand the active running step automatically
  useEffect(() => {
    const runningStep = actions.find((a) => a.status === "running");
    if (runningStep) {
      setExpandedStepId(runningStep.id);
    }
  }, [actions]);

  // Send accurate bounding box coordinates to Tauri Rust backend so hover click-through works dynamically
  const reportBounds = useCallback(async () => {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();

    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_hud_bounds", {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          isTyping: isFocused || prompt.length > 0,
        });
      } catch (err) {
        // Fallback for browser mode
      }
    }
  }, [isFocused, prompt.length]);

  useEffect(() => {
    reportBounds();
    const handleResize = () => reportBounds();
    window.addEventListener("resize", handleResize);
    const interval = setInterval(reportBounds, 800);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(interval);
    };
  }, [reportBounds]);

  // Trigger bound recalculation whenever height expands or collapses
  useEffect(() => {
    const timer = setTimeout(reportBounds, 150);
    return () => clearTimeout(timer);
  }, [actions.length, expandedStepId, showThought, isDismissed, reportBounds]);

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
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        isGhosting ? "ghost-mode" : ""
      }`}
    >
      <div className="glass-pill rounded-2xl p-3 px-4 shadow-2xl flex flex-col gap-2.5 min-w-[620px] max-w-[820px] border border-cyan-500/30 backdrop-blur-2xl bg-slate-950/85">
        {/* Top Header Row: Brand, Live Activity, Step Badge, Abort */}
        <div className="flex items-center justify-between text-xs text-slate-300 border-b border-white/10 pb-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="flex items-center gap-1.5 font-bold tracking-wider text-cyan-400 shrink-0">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse-subtle" />
              VEXA v2.0
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-300 font-mono text-[11px] truncate max-w-[380px]" title={message}>
              {message || "Ready. Press Alt+Space to focus."}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Step Progress Badge */}
            {isBusy && (
              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded-full font-mono text-[11px] flex items-center gap-1.5 animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                Step {step}/{maxSteps}
              </span>
            )}

            {status === "done" && (
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-[11px] flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3 h-3" />
                Done
              </span>
            )}

            {status === "error" && (
              <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2.5 py-0.5 rounded-full text-[11px] flex items-center gap-1 font-medium">
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

        {/* Quick Reflex Shortcuts Chips */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-0.5 overflow-x-auto">
          <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Reflex:</span>
          <button
            type="button"
            onClick={() => onSubmit("what is time today")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors whitespace-nowrap"
          >
            time
          </button>
          <button
            type="button"
            onClick={() => onSubmit("what can you do")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors whitespace-nowrap"
          >
            features
          </button>
          <button
            type="button"
            onClick={() => onSubmit("git status")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors whitespace-nowrap"
          >
            git status
          </button>
          <button
            type="button"
            onClick={() => onSubmit("active ports")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors whitespace-nowrap"
          >
            find-ports
          </button>
          <button
            type="button"
            onClick={() => onSubmit("Draw architecture diagram of VEXA")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors whitespace-nowrap"
          >
            arch diagram
          </button>
        </div>

        {/* ========================================================================= */}
        {/* EXECUTION STEPS TIMELINE & REALISTIC DETAIL DRAWER                       */}
        {/* ========================================================================= */}
        {hasContent && (
          <div className="mt-2 flex flex-col gap-2.5 max-h-[460px] overflow-y-auto select-text font-sans">
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
                                <pre className="bg-slate-900/90 p-2 rounded border border-white/5 overflow-x-auto text-emerald-300 leading-tight">
                                  {JSON.stringify(act.result, null, 2)}
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

                <div className="text-slate-100 whitespace-pre-wrap">{summary || message}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
