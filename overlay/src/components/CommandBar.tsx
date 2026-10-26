"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Send, Square, Sparkles, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface CommandBarProps {
  status: string;
  message: string;
  step: number;
  maxSteps: number;
  onSubmit: (prompt: string) => void;
  onAbort: () => void;
  isGhosting: boolean;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  status,
  message,
  step,
  maxSteps,
  onSubmit,
  onAbort,
  isGhosting,
}) => {
  const [prompt, setPrompt] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  // Send bounding box coordinates to Tauri Rust backend
  const reportBounds = useCallback(async () => {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    
    // Check if running inside Tauri
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
        // Fallback or dev mode log
      }
    }
  }, [isFocused, prompt.length]);

  useEffect(() => {
    reportBounds();
    const handleResize = () => reportBounds();
    window.addEventListener("resize", handleResize);
    const interval = setInterval(reportBounds, 1000);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearInterval(interval);
    };
  }, [reportBounds]);

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

  const isBusy = ["observing", "planning", "executing", "verifying"].includes(status);

  return (
    <div
      ref={pillRef}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-200 ${
        isGhosting ? "ghost-mode" : ""
      }`}
    >
      <div className="glass-pill rounded-2xl p-2.5 px-4 shadow-glow flex flex-col gap-2 min-w-[560px] max-w-[760px] border border-cyan-500/30">
        {/* Top Header Row: Brand, Status, Step, Abort */}
        <div className="flex items-center justify-between text-xs text-slate-300 border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-bold tracking-wider text-cyan-400">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse-subtle" />
              VEXA v2.0
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-400 font-mono text-[11px] truncate max-w-[320px]">
              {message || "Ready. Press Alt+Space to focus."}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Step Badge */}
            {isBusy && (
              <span className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono text-[11px] flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                Step {step}/{maxSteps}
              </span>
            )}

            {status === "done" && (
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[11px] flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Done
              </span>
            )}

            {status === "error" && (
              <span className="bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full text-[11px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Error
              </span>
            )}

            {/* Abort Button */}
            {isBusy && (
              <button
                onClick={onAbort}
                title="Abort current task"
                className="bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/40 p-1 rounded-md transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
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
            placeholder="Ask VEXA to code, click, inspect ports, or generate Mermaid diagrams..."
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!prompt.trim() || isBusy}
            className="p-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-500/30 disabled:opacity-30 disabled:hover:bg-cyan-500/20 transition-all"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Quick Reflex Shortcuts */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1 overflow-x-auto">
          <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold">Reflex:</span>
          <button
            type="button"
            onClick={() => onSubmit("git status")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors"
          >
            git status
          </button>
          <button
            type="button"
            onClick={() => onSubmit("active ports")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors"
          >
            find-ports
          </button>
          <button
            type="button"
            onClick={() => onSubmit("Draw architecture diagram of VEXA")}
            className="hover:text-cyan-300 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/5 transition-colors"
          >
            arch diagram
          </button>
        </div>
      </div>
    </div>
  );
};
