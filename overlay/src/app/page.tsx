"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { CommandBar } from "../components/CommandBar";
import { MermaidCanvas } from "../components/MermaidCanvas";
import { ApprovalToast } from "../components/ApprovalToast";

interface StatusMessage {
  status: string;
  message: string;
  step?: number;
  max_steps?: number;
  actions?: any[];
  diagram?: {
    diagram_code: string;
    diagram_title?: string;
  } | null;
  approval_required?: any;
}

export default function Home() {
  const [status, setStatus] = useState<string>("idle");
  const [message, setMessage] = useState<string>("Ready. Press Alt+Space to activate.");
  const [step, setStep] = useState<number>(0);
  const [maxSteps, setMaxSteps] = useState<number>(3);
  const [diagram, setDiagram] = useState<{ diagram_code: string; diagram_title: string } | null>(null);
  const [approvalData, setApprovalData] = useState<any | null>(null);
  const [isGhosting, setIsGhosting] = useState<boolean>(false);
  
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

          if (data.diagram && data.diagram.diagram_code) {
            setDiagram({
              diagram_code: data.diagram.diagram_code,
              diagram_title: data.diagram.diagram_title || "System Architecture",
            });
          }

          if (data.approval_required) {
            setApprovalData(data.approval_required);
          } else if (data.status !== "awaiting_approval") {
            setApprovalData(null);
          }
        } catch (e) {
          console.error("Failed to parse status message", e);
        }
      };

      ws.onclose = () => {
        setStatus("idle");
        setMessage("Backend disconnected. Reconnecting in 3s...");
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (err) {
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    }
  }, [setIgnoreCursor]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connectWebSocket]);

  // Submit task prompt to backend REST endpoint
  const handleTaskSubmit = async (prompt: string) => {
    setStatus("observing");
    setMessage("Dispatching task to VEXA engine...");
    try {
      const res = await fetch("http://127.0.0.1:8765/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.detail || "Task execution failed.");
      }
    } catch (err: any) {
      setStatus("error");
      setMessage(`Connection failed: ${err.message || err}`);
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

  return (
    <main className="relative w-screen h-screen bg-transparent pointer-events-none select-none">
      {/* Interactive Command Bar (Pill pointer events are enabled) */}
      <div className="pointer-events-auto">
        <CommandBar
          status={status}
          message={message}
          step={step}
          maxSteps={maxSteps}
          onSubmit={handleTaskSubmit}
          onAbort={handleAbort}
          isGhosting={isGhosting}
        />
      </div>

      {/* Floating Architecture Blueprint Canvas */}
      {diagram && (
        <div className="pointer-events-auto">
          <MermaidCanvas
            diagramCode={diagram.diagram_code}
            title={diagram.diagram_title}
            onClose={() => setDiagram(null)}
            onScaffold={handleScaffold}
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
