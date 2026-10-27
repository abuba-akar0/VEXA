"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  History,
  Bookmark,
  Search,
  ExternalLink,
  RotateCcw,
  Trash2,
  Sparkles,
  Monitor,
  GripHorizontal,
  Clock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export interface HistoryItem {
  id: number;
  task_prompt: string;
  status: string;
  summary?: string;
  iterations?: number;
  is_bookmarked?: number | boolean;
  created_at?: string;
}

interface HistoryDrawerProps {
  onClose: () => void;
  onLoadTask: (item: HistoryItem) => void;
  onOpenDetached: (item: HistoryItem) => void;
  onRerunTask: (prompt: string) => void;
  availableMonitors?: { name: string; x?: number; y?: number; width: number; height: number }[];
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  onClose,
  onLoadTask,
  onOpenDetached,
  onRerunTask,
  availableMonitors = [{ name: "Display 1", x: 0, y: 0, width: 1920, height: 1080 }],
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "saved">("recent");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [savedItems, setSavedItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
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

  // Calculate default position centered on display
  useEffect(() => {
    if (position === null) {
      const mon = availableMonitors[0] || { x: 0, y: 0, width: 1920 };
      const initialX = (mon.x ?? 0) + Math.max(40, Math.floor(((mon.width || 1920) - 520) / 2));
      const initialY = (mon.y ?? 0) + 110;
      setPosition({ x: initialX, y: initialY });
    }
  }, [availableMonitors, position]);

  // Fetch recent and saved history
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [histRes, savedRes] = await Promise.all([
        fetch("http://127.0.0.1:8765/api/history?limit=30").catch(() => null),
        fetch("http://127.0.0.1:8765/api/history/saved").catch(() => null),
      ]);

      if (histRes && histRes.ok) {
        const data = await histRes.json();
        setHistoryItems(data.history || []);
      }
      if (savedRes && savedRes.ok) {
        const data = await savedRes.json();
        setSavedItems(data.saved || []);
      }
    } catch (err) {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Report bounds to Tauri native hit tester
  const reportBounds = useCallback(() => {
    if (!drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
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

  // Multi-Monitor Dragging Handler
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

  const handleToggleBookmark = async (item: HistoryItem) => {
    try {
      const res = await fetch(`http://127.0.0.1:8765/api/history/${item.id}/bookmark`, { method: "POST" });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {}
  };

  const handleDeleteItem = async (id: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8765/api/history/item/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {}
  };

  const teleportToScreen = (idx: number) => {
    const targetMon = availableMonitors[idx] || availableMonitors[0];
    if (targetMon) {
      const monX = targetMon.x ?? 0;
      const monY = targetMon.y ?? 0;
      const monW = targetMon.width ?? 1920;
      const targetX = monX + Math.max(40, Math.floor((monW - 520) / 2));
      const targetY = monY + 110;
      setPosition({ x: targetX, y: targetY });
    }
  };

  const currentList = activeTab === "saved" ? savedItems : historyItems;
  const filteredItems = currentList.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.task_prompt.toLowerCase().includes(q) ||
      (item.summary && item.summary.toLowerCase().includes(q))
    );
  });

  return (
    <div
      ref={drawerRef}
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
          : { left: "50%", transform: "translateX(-50%)", top: "110px" }
      }
      className="fixed z-50 pointer-events-auto select-none interactive-hud-element"
    >
      <div className="w-[520px] max-w-[94vw] rounded-2xl bg-slate-950/95 border border-cyan-500/40 shadow-2xl backdrop-blur-2xl p-5 flex flex-col gap-3.5 text-slate-200">
        {/* Header with Drag Handle & Teleport Buttons */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between pb-2.5 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2 text-cyan-400 font-bold tracking-wider text-sm">
            <span
              className="text-slate-400 hover:text-cyan-400 p-0.5 rounded transition-colors"
              title="Drag history window anywhere across your screens"
            >
              <GripHorizontal className="w-4 h-4" />
            </span>
            <span className="p-1 rounded-lg bg-cyan-500/20 text-cyan-300">
              <History className="w-4 h-4" />
            </span>
            <span>Task History & Saved Responses</span>
          </div>

          <div className="flex items-center gap-2">
            {availableMonitors && availableMonitors.length > 1 && (
              <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded border border-white/10">
                {availableMonitors.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => teleportToScreen(idx)}
                    title={`Snap to ${m.name || `Display ${idx + 1}`}`}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Monitor className="w-2.5 h-2.5 inline mr-0.5" />
                    S{idx + 1}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Close History"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Controls & Search Bar */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("recent")}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "recent"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Recent Tasks ({historyItems.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("saved")}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                activeTab === "saved"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-400/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" fill={activeTab === "saved" ? "currentColor" : "none"} />
              Saved Responses ({savedItems.length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab === "saved" ? "saved bookmarks" : "recent history"}...`}
              className="w-full bg-slate-900/80 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-400/50"
            />
          </div>
        </div>

        {/* Items List */}
        <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-slate-400">Loading history...</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              {searchQuery ? "No matching tasks found." : activeTab === "saved" ? "No saved responses yet. Click the bookmark icon on any response to save it." : "No tasks in history."}
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-slate-900/60 border border-white/10 hover:border-cyan-500/30 transition-all flex flex-col gap-1.5 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="p-1 rounded bg-white/5 text-cyan-400 shrink-0">
                      <Sparkles className="w-3 h-3" />
                    </span>
                    <span className="text-xs font-semibold text-slate-200 truncate" title={item.task_prompt}>
                      {item.task_prompt}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Bookmark Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleBookmark(item)}
                      title={item.is_bookmarked ? "Unbookmark" : "Save to Bookmarks"}
                      className={`p-1 rounded transition-colors ${
                        item.is_bookmarked
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-slate-500 hover:text-amber-400"
                      }`}
                    >
                      <Bookmark className="w-3.5 h-3.5" fill={item.is_bookmarked ? "currentColor" : "none"} />
                    </button>

                    {/* Delete Item */}
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      title="Delete from history"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Summary Snippet */}
                {item.summary && (
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed font-mono">
                    {item.summary}
                  </p>
                )}

                {/* Footer Actions */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-slate-500">
                  <span>{item.created_at || "Recent"}</span>

                  <div className="flex items-center gap-1.5">
                    {/* Load to HUD */}
                    <button
                      type="button"
                      onClick={() => {
                        onLoadTask(item);
                        onClose();
                      }}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 bg-cyan-500/10 hover:bg-cyan-500/20 px-2 py-0.5 rounded transition-colors"
                    >
                      <span>Load to HUD</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                    </button>

                    {/* Open in Separate Window */}
                    <button
                      type="button"
                      onClick={() => {
                        onOpenDetached(item);
                        onClose();
                      }}
                      title="Open in separate window"
                      className="text-slate-400 hover:text-white flex items-center gap-0.5 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded transition-colors"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>Detach</span>
                    </button>

                    {/* Re-run */}
                    <button
                      type="button"
                      onClick={() => {
                        onRerunTask(item.task_prompt);
                        onClose();
                      }}
                      title="Re-run task fresh with AI"
                      className="text-slate-400 hover:text-cyan-300 p-0.5 rounded transition-colors"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
