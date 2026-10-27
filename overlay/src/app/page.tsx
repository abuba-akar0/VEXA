"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { CommandBar } from "../components/CommandBar";
import { MermaidCanvas } from "../components/MermaidCanvas";
import { ApprovalToast } from "../components/ApprovalToast";
import { SettingsModal, VexaSettings, HudSize } from "../components/SettingsModal";
import { FloatingOutputWindow, DetachedOutputData } from "../components/FloatingOutputWindow";
import { HistoryDrawer, HistoryItem } from "../components/HistoryDrawer";
import { FloatingDockBadge } from "../components/FloatingDockBadge";
import { InfoModal } from "../components/InfoModal";

export interface ExecutionStep {
  id: string;
  step_num: number;
  action_type: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  params?: any;
  result?: any;
  duration_ms?: number;
}

interface StatusMessage {
  status: string;
  message: string;
  step?: number;
  max_steps?: number;
  actions?: ExecutionStep[];
  diagram?: {
    diagram_code: string;
    diagram_title?: string;
  } | null;
  approval_required?: any;
  thought?: string;
  summary?: string;
  cached?: boolean;
  cache_backend?: string;
}

export default function Home() {
  const [status, setStatus] = useState<string>("idle");
  const [message, setMessage] = useState<string>("Ready. Press Alt+Space to activate.");
  const [step, setStep] = useState<number>(0);
  const [maxSteps, setMaxSteps] = useState<number>(3);
  const [actions, setActions] = useState<ExecutionStep[]>([]);
  const [thought, setThought] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [diagram, setDiagram] = useState<{ diagram_code: string; diagram_title: string } | null>(null);
  const [savedDiagram, setSavedDiagram] = useState<{ diagram_code: string; diagram_title: string } | null>(null);
  const [approvalData, setApprovalData] = useState<any | null>(null);
  const [isGhosting, setIsGhosting] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [detachedOutput, setDetachedOutput] = useState<DetachedOutputData | null>(null);
  const [isCachedResponse, setIsCachedResponse] = useState<boolean>(false);
  const [cacheBackend, setCacheBackend] = useState<string>("redis");
  const [isBookmarked, setIsBookmarked] = useState<boolean>(false);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState<string>("");
  const [hudSize, setHudSize] = useState<HudSize>("standard");
  const [monitors, setMonitors] = useState<{ index: number; name: string; x: number; y: number; width: number; height: number }[]>([]);
  const [settings, setSettings] = useState<VexaSettings>({
    hudSize: "standard",
    opacity: 85,
    aiModel: "gemini-2.5-flash",
    responseStyle: "detailed",
    activeMonitorIndex: 0,
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set Tauri ignore cursor events helper
  const setIgnoreCursor = useCallback(async (ignore: boolean) => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        await appWindow.setIgnoreCursorEvents(ignore);
      } catch (err) {
        // Dev fallback
      }
    }
  }, []);

  // WebSocket Connection Management to Backend (ws://127.0.0.1:8765/ws/status)
  const connectWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket("ws://127.0.0.1:8765/ws/status");
      wsRef.current = ws;

      ws.onopen = () => {
        setMessage("VEXA Engine connected");
      };

      ws.onmessage = (event) => {
        try {
          const data: StatusMessage = JSON.parse(event.data);
          
          // CRITICAL REQUIREMENT 5: Pre-Click Overlay Ghosting
          if (data.status === "pre_click_hide") {
            setIsGhosting(true);
            setIgnoreCursor(true);
            setTimeout(() => {
              setIsGhosting(false);
            }, 160);
            return;
          }

          if (data.status) setStatus(data.status);
          if (data.message) setMessage(data.message);
          if (typeof data.step === "number") setStep(data.step);
          if (typeof data.max_steps === "number") setMaxSteps(data.max_steps);
          if (data.actions && Array.isArray(data.actions)) {
            setActions(data.actions);
          }
          if (data.thought) {
            setThought(data.thought);
          }
          if (data.summary) {
            setSummary(data.summary);
          }

          if (data.cached) {
            setIsCachedResponse(true);
            setCacheBackend(data.cache_backend || "redis");
          }

          if (data.diagram && data.diagram.diagram_code) {
            const diagObj = {
              diagram_code: data.diagram.diagram_code,
              diagram_title: data.diagram.diagram_title || "System Architecture",
            };
            setDiagram(diagObj);
            setSavedDiagram(diagObj);
          }

          if (data.approval_required) {
            setApprovalData(data.approval_required);
          }
        } catch (e) {
          console.error("WS Parse Error:", e);
        }
      };

      ws.onclose = () => {
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    }
  }, [setIgnoreCursor]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connectWebSocket]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes open modals or minimizes HUD
      if (e.key === "Escape") {
        if (isInfoOpen) {
          setIsInfoOpen(false);
          e.preventDefault();
        } else if (isSettingsOpen) {
          setIsSettingsOpen(false);
          e.preventDefault();
        } else if (isHistoryOpen) {
          setIsHistoryOpen(false);
          e.preventDefault();
        } else if (detachedOutput) {
          setDetachedOutput(null);
          e.preventDefault();
        } else if (!isMinimized) {
          setIsMinimized(true);
          e.preventDefault();
        }
      }
      // Ctrl+H toggles History Drawer
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setIsHistoryOpen((prev) => !prev);
      }
      // Ctrl+, toggles Settings Modal
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setIsSettingsOpen((prev) => !prev);
      }
    };

    const handleToggleFocus = () => {
      setIsMinimized(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("vexa-toggle-focus", handleToggleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("vexa-toggle-focus", handleToggleFocus);
    };
  }, [isSettingsOpen, isHistoryOpen, isInfoOpen, isMinimized, detachedOutput]);

  // Submit task prompt to backend REST endpoint
  const handleTaskSubmit = async (prompt: string, bypassCache: boolean = false) => {
    setStatus("observing");
    setMessage("Dispatching task to VEXA engine...");
    setActions([]);
    setThought("");
    setSummary("");
    setIsBookmarked(false);
    setLastSubmittedPrompt(prompt);

    try {
      const res = await fetch("http://127.0.0.1:8765/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: prompt, bypass_cache: bypassCache }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.detail || "Task execution failed.");
        if (data.actions && Array.isArray(data.actions)) {
          setActions(data.actions);
        }
        if (data.thought) {
          setThought(data.thought);
        }
        if (data.summary) {
          setSummary(data.summary);
        }
        setIsCachedResponse(false);
      } else {
        if (data.status) setStatus(data.status);
        else if (data.success) setStatus("done");

        if (data.message) setMessage(data.message);
        else if (data.summary) setMessage(data.summary.slice(0, 140));

        if (data.summary) setSummary(data.summary);
        if (data.thought) setThought(data.thought);
        if (data.actions && Array.isArray(data.actions)) {
          setActions(data.actions);
        }

        if (data.cached) {
          setIsCachedResponse(true);
          setCacheBackend(data.cache_backend || "redis");
        } else {
          setIsCachedResponse(false);
        }

        const diag = data.diagram || data.result?.diagram;
        if (diag && diag.diagram_code) {
          const diagObj = {
            diagram_code: diag.diagram_code,
            diagram_title: diag.diagram_title || "System Architecture",
          };
          setDiagram(diagObj);
          setSavedDiagram(diagObj);
        }
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(`Connection failed: ${err.message || err}`);
      setIsCachedResponse(false);
    }
  };

  // Abort active task
  const handleAbort = async () => {
    try {
      await fetch("http://127.0.0.1:8765/api/abort", { method: "POST" });
    } catch (err) {
      console.error("Failed to abort task:", err);
    }
  };

  const handleClear = () => {
    setActions([]);
    setThought("");
    setSummary("");
    setStatus("idle");
    setMessage("Ready. Press Alt+Space to activate.");
    setIsCachedResponse(false);
    setIsBookmarked(false);
  };

  // Destructive action approval
  const handleApprove = async () => {
    try {
      await fetch("http://127.0.0.1:8765/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      setApprovalData(null);
    } catch (err) {
      console.error("Approval send error:", err);
    }
  };

  const handleReject = async () => {
    try {
      await fetch("http://127.0.0.1:8765/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: false }),
      });
      setApprovalData(null);
    } catch (err) {
      console.error("Reject send error:", err);
    }
  };

  // Scaffold diagram components to repo
  const handleScaffold = (diagramCode: string) => {
    handleTaskSubmit(`Scaffold the following architecture diagram into runnable workspace code files:\n\`\`\`mermaid\n${diagramCode}\n\`\`\``);
  };

  // Load saved preferences and query monitors on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("veexa_settings");
        if (saved) {
          const parsed = JSON.parse(saved);
          setSettings(parsed);
          if (parsed.hudSize) setHudSize(parsed.hudSize);
        }
      } catch (e) {}

      // Fetch monitors from Tauri backend
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("get_available_monitors")
          .then((mons: any) => {
            if (Array.isArray(mons) && mons.length > 0) {
              setMonitors(mons);
            }
          })
          .catch(() => {});
      });
    }
  }, []);

  const handleUpdateSettings = (newSet: Partial<VexaSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSet };
      if (newSet.hudSize) setHudSize(newSet.hudSize);
      try {
        localStorage.setItem("vexa_settings", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const cycleHudSize = () => {
    const nextSize: Record<HudSize, HudSize> = {
      compact: "standard",
      standard: "expansive",
      expansive: "compact",
    };
    const next = nextSize[hudSize];
    setHudSize(next);
    handleUpdateSettings({ hudSize: next });
  };

  const handleTeleportNextMonitor = () => {
    if (monitors.length <= 1) return;
    const nextIndex = (settings.activeMonitorIndex + 1) % monitors.length;
    handleTeleportToMonitor(nextIndex);
  };

  const handleTeleportToMonitor = (monitorIndex: number) => {
    const target = monitors[monitorIndex];
    if (target) {
      const hudWidth = hudSize === "compact" ? 460 : hudSize === "expansive" ? 820 : 640;
      const targetX = target.x + Math.max(20, Math.floor((target.width - hudWidth) / 2));
      const targetY = target.y + 16;
      window.dispatchEvent(new CustomEvent("vexa-teleport", { detail: { x: targetX, y: targetY } }));
      handleUpdateSettings({ activeMonitorIndex: monitorIndex });
    }
  };

  const handleResetPosition = () => {
    const activeMon = monitors[settings.activeMonitorIndex] || { x: 0, y: 0, width: 1920 };
    const hudWidth = hudSize === "compact" ? 460 : hudSize === "expansive" ? 820 : 640;
    const centerX = activeMon.x + Math.max(20, Math.floor((activeMon.width - hudWidth) / 2));
    const centerY = activeMon.y + 16;
    window.dispatchEvent(new CustomEvent("vexa-teleport", { detail: { x: centerX, y: centerY } }));
  };

  const handleClearHistory = async () => {
    try {
      await fetch("http://127.0.0.1:8765/api/history", { method: "DELETE" });
    } catch (e) {}
    handleClear();
  };

  // Detached Floating Output Window handlers
  const handleDetachOutput = () => {
    const title = lastSubmittedPrompt || "Task Output";
    const content = summary || message || "No content generated";
    setDetachedOutput({
      title,
      content,
      thought,
      actions,
      diagram: diagram || savedDiagram,
      cached: isCachedResponse,
      cacheBackend,
      isBookmarked,
    });
  };

  // Bookmark toggle handler
  const handleToggleBookmark = async (taskId?: number | string) => {
    setIsBookmarked(!isBookmarked);
    try {
      if (taskId) {
        await fetch(`http://127.0.0.1:8765/api/history/${taskId}/bookmark`, { method: "POST" });
      } else {
        const res = await fetch("http://127.0.0.1:8765/api/history?limit=1");
        if (res.ok) {
          const data = await res.json();
          if (data.history && data.history.length > 0) {
            await fetch(`http://127.0.0.1:8765/api/history/${data.history[0].id}/bookmark`, { method: "POST" });
          }
        }
      }
    } catch (e) {}
  };

  // History Drawer handlers
  const handleLoadHistoryTask = (item: HistoryItem) => {
    setLastSubmittedPrompt(item.task_prompt);
    setMessage(item.task_prompt);
    setSummary(item.summary || "");
    setStatus(item.status || "done");
    setIsBookmarked(!!item.is_bookmarked);
    setIsCachedResponse(false);
  };

  const handleOpenHistoryDetached = (item: HistoryItem) => {
    setDetachedOutput({
      id: item.id,
      title: item.task_prompt,
      content: item.summary || item.task_prompt,
      cached: false,
      isBookmarked: !!item.is_bookmarked,
    });
  };

  const handleCloseApp = async () => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("exit_app");
        return;
      } catch (err) {
        console.error("Failed to exit via Tauri invoke:", err);
      }
    }
    // Web fallback
    setIsMinimized(true);
  };

  const handleMinimizeToTaskbar = async () => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("minimize_window");
      } catch (err) {
        console.error("Failed to minimize window:", err);
      }
    }
  };

  const isModalActive = !!diagram || !!approvalData || isSettingsOpen || isHistoryOpen || !!detachedOutput || isInfoOpen;

  // Sync modal active state to Tauri backend immediately
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("set_modal_mode", { active: isModalActive }).catch(() => {});
      });
    }
  }, [isModalActive]);

  return (
    <main className="relative w-screen h-screen bg-transparent pointer-events-none select-none">
      {/* Minimized Floating Screen-Edge Badge or Full Command Bar */}
      {isMinimized ? (
        <div className="pointer-events-auto">
          <FloatingDockBadge
            status={status}
            activeMonitor={monitors[settings.activeMonitorIndex] || monitors[0]}
            onExpand={() => {
              setIsMinimized(false);
              try {
                localStorage.setItem("vexa_is_minimized", "false");
              } catch (e) {}
            }}
            onClose={handleCloseApp}
            onMinimizeToTaskbar={handleMinimizeToTaskbar}
          />
        </div>
      ) : (
        <div className="pointer-events-auto">
          <CommandBar
            status={status}
            message={message}
            step={step}
            maxSteps={maxSteps}
            actions={actions}
            thought={thought}
            summary={summary}
            diagram={diagram || savedDiagram}
            isDiagramOpen={!!diagram}
            onToggleDiagram={() => {
              if (diagram) {
                setDiagram(null);
              } else if (savedDiagram) {
                setDiagram(savedDiagram);
              }
            }}
            hudSize={hudSize}
            onCycleHudSize={cycleHudSize}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onOpenInfo={() => setIsInfoOpen(true)}
            onMinimize={() => {
              setIsMinimized(true);
              try {
                localStorage.setItem("vexa_is_minimized", "true");
              } catch (e) {}
            }}
            onClose={handleCloseApp}
            onDetachOutput={handleDetachOutput}
            onToggleBookmark={() => handleToggleBookmark()}
            isBookmarked={isBookmarked}
            cached={isCachedResponse}
            cacheBackend={cacheBackend}
            onRerunWithAI={() => handleTaskSubmit(lastSubmittedPrompt, true)}
            onTeleportNextMonitor={handleTeleportNextMonitor}
            onResetPosition={handleResetPosition}
            onSubmit={(p) => handleTaskSubmit(p, false)}
            onAbort={handleAbort}
            onClear={handleClear}
            isGhosting={isGhosting}
            isModalActive={isModalActive}
          />
        </div>
      )}

      {/* VEXA User Guide & Cheat Sheet Modal (IO Button) */}
      {isInfoOpen && (
        <div className="pointer-events-auto">
          <InfoModal
            onClose={() => setIsInfoOpen(false)}
            availableMonitors={monitors}
          />
        </div>
      )}

      {/* Settings & Preferences Modal (Draggable & Screen-Aware) */}
      {isSettingsOpen && (
        <div className="pointer-events-auto">
          <SettingsModal
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onClose={() => setIsSettingsOpen(false)}
            onResetPosition={handleResetPosition}
            onClearHistory={handleClearHistory}
            onTeleportToMonitor={handleTeleportToMonitor}
            availableMonitors={monitors}
          />
        </div>
      )}

      {/* History & Saved Responses Drawer */}
      {isHistoryOpen && (
        <div className="pointer-events-auto">
          <HistoryDrawer
            onClose={() => setIsHistoryOpen(false)}
            onLoadTask={handleLoadHistoryTask}
            onOpenDetached={handleOpenHistoryDetached}
            onRerunTask={(p) => handleTaskSubmit(p, true)}
            availableMonitors={monitors}
          />
        </div>
      )}

      {/* Detachable Floating Output Window */}
      {detachedOutput && (
        <div className="pointer-events-auto">
          <FloatingOutputWindow
            data={detachedOutput}
            onClose={() => setDetachedOutput(null)}
            onRerunWithAI={(p) => handleTaskSubmit(p, true)}
            onRefineResponse={(refineType) => {
              const base = detachedOutput.content;
              const prompts: Record<string, string> = {
                shorter: `Make this previous response much shorter and concise:\n${base}`,
                code_only: `Extract only clean, runnable code from this response:\n${base}`,
                elaborate: `Elaborate further on this response with deep facts:\n${base}`,
                translate: `Translate this response into Urdu:\n${base}`,
              };
              handleTaskSubmit(prompts[refineType] || base, true);
            }}
            onToggleBookmark={(id) => handleToggleBookmark(id)}
            availableMonitors={monitors}
          />
        </div>
      )}

      {/* Floating Architecture Blueprint Canvas */}
      {diagram && (
        <div className="pointer-events-auto">
          <MermaidCanvas
            diagramCode={diagram.diagram_code}
            title={diagram.diagram_title}
            onClose={() => setDiagram(null)}
            onScaffold={handleScaffold}
            onDragStateChange={(dragging) => {
              if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
                import("@tauri-apps/api/core").then(({ invoke }) => {
                  invoke("set_dragging_mode", { dragging }).catch(() => {});
                });
              }
            }}
          />
        </div>
      )}

      {/* High-priority Confirmation Toast */}
      {approvalData && (
        <div className="pointer-events-auto">
          <ApprovalToast
            approvalData={approvalData}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </div>
      )}
    </main>
  );
}
