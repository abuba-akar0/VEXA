import json
import time
import asyncio
from typing import Dict, Any, Optional, Callable, List
from google.genai import types

from ..config import (
    call_gemini_with_resilience,
    DEFAULT_WORKSPACE_PATH,
    PRIMARY_MODEL
)
from ..schemas import VexaPlan, VexaAction, TaskStatusUpdate
from ..perception.vision import capture_screen
from ..perception.context import gather_full_context
from ..tools import gui_control, workspace_coder, architect
from ..memory.db import save_task_history, get_project_path

SYSTEM_INSTRUCTION = """You are VEXA (Virtual Execution & X-Layer Architect), an ultra-lightweight autonomous screen-overlay agent for Windows.
You observe the user's desktop, workspace files, and active terminal, and execute actions with extreme precision.

CRITICAL OPERATIONAL RULES:
1. GREETINGS & QUESTIONS:
   - If the user asks a question, greets you ("hello", "hi", "help"), or requests information, provide a helpful, friendly response.
   - Emit an action with action_type="done", text="your answer here", and set goal_achieved=true.
2. ARCHITECT & BLUEPRINTS:
   - If asked for system architecture, sequence diagrams, or component blueprints, output action_type="render_diagram" with clean Mermaid.js diagram_code (e.g. graph TD or sequenceDiagram) and a clear diagram_title, and set goal_achieved=true.
3. CODING & WORKSPACE:
   - For file modifications, prefer write_file, patch_file, or read_file.
   - For terminal commands (git, npm, python, tests), use run_command.
4. COORDINATE SYSTEM & GUI AUTOMATION:
   - The desktop screenshot has a normalized grid from 0 to 1000 on both X and Y axes (0,0 is top-left, 1000,1000 is bottom-right).
   - When specifying target_x and target_y for click, double_click, right_click, supply integers in the 0-1000 range.
   - You can plan a batch of 1 to 5 sequential actions per step.
5. CLOSED-LOOP VERIFICATION:
   - As soon as the user's goal is fulfilled, emit an action with action_type="done" and set goal_achieved=true.
6. SAFETY & APPROVAL:
   - For irreversible destructive actions (e.g. git reset --hard, deleting repositories or dropping databases), set action_type="require_approval" and is_destructive=true.
7. STRUCTURED JSON OUTPUT:
   - You MUST output valid JSON adhering to the VexaPlan schema:
     {
       "thought": "...",
       "observations": "...",
       "actions": [...],
       "goal_achieved": true/false,
       "summary": "..."
     }
"""

class Orchestrator:
    def __init__(self, broadcast_callback: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.broadcast_callback = broadcast_callback
        self.pending_approval: Optional[asyncio.Event] = None
        self.approval_result: bool = False
        self.current_task_abort: bool = False

    async def emit_status(
        self,
        status: str,
        message: str,
        step: int = 0,
        max_steps: int = 3,
        actions: Optional[List[Any]] = None,
        diagram: Optional[Dict[str, Any]] = None,
        approval_required: Optional[Dict[str, Any]] = None,
        thought: Optional[str] = None,
        summary: Optional[str] = None
    ):
        """Broadcasts status update to connected WebSocket clients."""
        payload = {
            "status": status,
            "message": message,
            "step": step,
            "max_steps": max_steps,
            "actions": [a.model_dump() if hasattr(a, "model_dump") else a for a in (actions or [])],
            "diagram": diagram,
            "approval_required": approval_required,
            "thought": thought,
            "summary": summary
        }
        if self.broadcast_callback:
            try:
                res = self.broadcast_callback(payload)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                print(f"[VEXA Orchestrator] Status broadcast error: {e}")

    def abort_current_task(self):
        """Signals the active orchestrator loop to abort immediately."""
        self.current_task_abort = True

    def resolve_approval(self, approved: bool):
        """Resolves a pending destructive action approval."""
        self.approval_result = approved
        if self.pending_approval and not self.pending_approval.is_set():
            self.pending_approval.set()

    async def pre_click_ghost_hook(self):
        """CRITICAL REQUIREMENT 5: Broadcasts pre_click_hide before PyAutoGUI clicks."""
        await self.emit_status("pre_click_hide", "Overlay ghosting for physical click...", step=0)

    async def execute_action(self, action: VexaAction, workspace_dir: str) -> Dict[str, Any]:
        """Executes a single VexaAction across GUI, workspace, or system tools."""
        act_type = action.action_type
        result: Dict[str, Any] = {"action_type": act_type, "success": True}

        # 1. Destructive action approval check
        if action.is_destructive or act_type == "require_approval":
            await self.emit_status(
                "awaiting_approval",
                f"Action requires confirmation: {action.reasoning or act_type}",
                approval_required={"action": action.model_dump()}
            )
            self.pending_approval = asyncio.Event()
            await self.pending_approval.wait()
            if not self.approval_result:
                return {"action_type": act_type, "success": False, "aborted_by_user": True}

        # 2. GUI Actions
        if act_type == "click":
            x = action.target_x if action.target_x is not None else 500
            y = action.target_y if action.target_y is not None else 500
            px, py = await gui_control.click(x, y, pre_click_hook=self.pre_click_ghost_hook)
            result["pixel"] = {"x": px, "y": py}

        elif act_type == "double_click":
            x = action.target_x if action.target_x is not None else 500
            y = action.target_y if action.target_y is not None else 500
            px, py = await gui_control.double_click(x, y, pre_click_hook=self.pre_click_ghost_hook)
            result["pixel"] = {"x": px, "y": py}

        elif act_type == "right_click":
            x = action.target_x if action.target_x is not None else 500
            y = action.target_y if action.target_y is not None else 500
            px, py = await gui_control.right_click(x, y, pre_click_hook=self.pre_click_ghost_hook)
            result["pixel"] = {"x": px, "y": py}

        elif act_type == "type_text":
            text = action.text or ""
            gui_control.type_text(text)
            result["typed_length"] = len(text)

        elif act_type == "press_key":
            key = action.key or "enter"
            gui_control.press_key(key)
            result["key"] = key

        elif act_type == "hotkey":
            keys = action.keys or ([action.key] if action.key else ["ctrl", "c"])
            gui_control.hotkey(keys)
            result["keys"] = keys

        elif act_type == "scroll":
            amt = action.scroll_amount if action.scroll_amount is not None else -200
            gui_control.scroll(amt)
            result["scroll_amount"] = amt

        elif act_type == "wait":
            sec = float(action.text) if action.text and action.text.replace('.', '', 1).isdigit() else 1.0
            await gui_control.wait_seconds(sec)
            result["waited"] = sec

        # 3. Workspace File & Code Actions
        elif act_type == "read_file":
            res = workspace_coder.read_file(action.path or "", base_dir=workspace_dir)
            result.update(res)

        elif act_type == "write_file":
            res = workspace_coder.write_file(action.path or "", action.content or "", base_dir=workspace_dir)
            result.update(res)

        elif act_type == "patch_file":
            res = workspace_coder.patch_file(
                action.path or "",
                action.search_text or "",
                action.content or "",
                base_dir=workspace_dir
            )
            result.update(res)

        elif act_type == "list_dir":
            res = workspace_coder.list_directory(action.path or ".", base_dir=workspace_dir)
            result.update(res)

        elif act_type == "run_command":
            res = await workspace_coder.run_terminal_command(action.command or "", cwd=workspace_dir)
            result.update(res)

        # 4. Architect Actions
        elif act_type == "render_diagram":
            code = architect.clean_mermaid_code(action.diagram_code or action.content or "")
            diagram_data = {
                "diagram_code": code,
                "diagram_title": action.diagram_title or "System Architecture"
            }
            await self.emit_status("executing", f"Rendering Architecture: {diagram_data['diagram_title']}", diagram=diagram_data)
            result["diagram"] = diagram_data

        elif act_type == "scaffold":
            files = action.files or {}
            res = architect.scaffold_project(action.path or workspace_dir, files)
            result.update(res)

        elif act_type == "done":
            result["message"] = action.text or "Task marked as completed."

        return result

    async def run_task(self, task_prompt: str, workspace_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes the closed-loop Observe -> Plan -> Execute -> Verify loop (max 3 iterations).
        Stops early as soon as goal_achieved is true or action_type == 'done'.
        """
        self.current_task_abort = False
        target_workspace = workspace_path or DEFAULT_WORKSPACE_PATH
        
        # Check if project name was given instead of raw path (from SQLite memory)
        saved_path = get_project_path(target_workspace)
        if saved_path:
            target_workspace = saved_path

        max_iterations = 3
        executed_history: List[Dict[str, Any]] = []
        all_executed_steps: List[Dict[str, Any]] = []
        final_summary = ""
        last_thought = ""
        overall_status = "done"

        try:
            for iteration in range(1, max_iterations + 1):
                if self.current_task_abort:
                    overall_status = "aborted"
                    await self.emit_status("done", "Task aborted by user request.", step=iteration, max_steps=max_iterations, actions=all_executed_steps)
                    break

                # 1. OBSERVE
                await self.emit_status("observing", f"Capturing visual and workspace context (Step {iteration}/{max_iterations})...", step=iteration, max_steps=max_iterations, actions=all_executed_steps)
                
                # Capture screen with normalized 10x10 guide grid
                screen_info = capture_screen(draw_grid=True)
                context_info = gather_full_context(target_workspace)

                # 2. PLAN
                await self.emit_status("planning", f"Reasoning with Gemini ({PRIMARY_MODEL})...", step=iteration, max_steps=max_iterations, actions=all_executed_steps)

                # Construct multimodal payload
                user_content_parts = [
                    types.Part.from_bytes(
                        data=screen_info["image_bytes"],
                        mime_type=screen_info["mime_type"]
                    ),
                    f"""USER GOAL: {task_prompt}
CURRENT ITERATION: {iteration} of {max_iterations}
WORKSPACE DIRECTORY: {target_workspace}
ACTIVE WINDOW: {context_info['active_window']}
CLIPBOARD: {context_info['clipboard'][:300] if context_info['clipboard'] else 'None'}
GIT STATUS: {context_info['workspace'].get('git_status', 'N/A')}

PREVIOUS ACTIONS EXECUTED:
{json.dumps(executed_history, indent=2) if executed_history else 'None'}

Examine the screenshot and workspace state. If the goal is satisfied, set goal_achieved=true and emit action_type='done'.
Otherwise, plan 1 to 5 sequential actions to progress towards the goal. Output strict JSON adhering to VexaPlan schema."""
                ]

                # Call Gemini with FreeTierRateLimiter and automatic fallback
                raw_response = await call_gemini_with_resilience(
                    contents=user_content_parts,
                    system_instruction=SYSTEM_INSTRUCTION,
                    response_schema=VexaPlan,
                    temperature=0.2
                )

                # Parse JSON plan
                try:
                    plan_data = json.loads(raw_response)
                    plan = VexaPlan(**plan_data)
                except Exception as e:
                    # Clean markdown code fences if model returned json block
                    cleaned = raw_response.strip()
                    if cleaned.startswith("```json"):
                        cleaned = cleaned[len("```json"):].strip()
                    if cleaned.endswith("```"):
                        cleaned = cleaned[:-len("```")].strip()
                    plan_data = json.loads(cleaned)
                    plan = VexaPlan(**plan_data)

                last_thought = plan.thought
                final_summary = plan.summary

                # Build step items for UI visualization
                current_steps: List[Dict[str, Any]] = []
                for i, act in enumerate(plan.actions):
                    desc = act.reasoning or act.command or act.path or (f"Click ({act.target_x}, {act.target_y})" if act.target_x is not None else act.action_type)
                    if act.action_type == "done" and act.text:
                        desc = act.text
                    current_steps.append({
                        "id": f"step-{iteration}-{i+1}",
                        "step_num": len(all_executed_steps) + i + 1,
                        "action_type": act.action_type,
                        "description": desc,
                        "status": "pending",
                        "params": act.model_dump(),
                        "result": None,
                        "duration_ms": 0
                    })

                await self.emit_status(
                    "executing",
                    f"Executing: {plan.summary}",
                    step=iteration,
                    max_steps=max_iterations,
                    actions=all_executed_steps + current_steps,
                    thought=plan.thought,
                    summary=plan.summary
                )

                # 3. EXECUTE
                iteration_results = []
                stop_early = plan.goal_achieved

                for i, act in enumerate(plan.actions):
                    if self.current_task_abort:
                        stop_early = True
                        break

                    current_steps[i]["status"] = "running"
                    await self.emit_status(
                        "executing",
                        f"Step {current_steps[i]['step_num']}: {current_steps[i]['description']}",
                        step=iteration,
                        max_steps=max_iterations,
                        actions=all_executed_steps + current_steps,
                        thought=plan.thought,
                        summary=plan.summary
                    )

                    t0 = time.time()
                    act_res = await self.execute_action(act, target_workspace)
                    dur_ms = int((time.time() - t0) * 1000)

                    current_steps[i]["duration_ms"] = dur_ms
                    current_steps[i]["result"] = act_res
                    current_steps[i]["status"] = "completed" if act_res.get("success", True) else "failed"
                    iteration_results.append(act_res)

                    await self.emit_status(
                        "executing",
                        f"Finished step {current_steps[i]['step_num']}",
                        step=iteration,
                        max_steps=max_iterations,
                        actions=all_executed_steps + current_steps,
                        thought=plan.thought,
                        summary=plan.summary
                    )

                    if act.action_type == "done" or act.goal_achieved:
                        stop_early = True
                        break

                all_executed_steps.extend(current_steps)

                executed_history.append({
                    "iteration": iteration,
                    "thought": plan.thought,
                    "actions": [a.model_dump() for a in plan.actions],
                    "results": iteration_results
                })

                # 4. VERIFY / EARLY STOP
                if stop_early or iteration == max_iterations:
                    done_text = plan.summary
                    for r in iteration_results:
                        if r.get("action_type") == "done" and r.get("message"):
                            done_text = r.get("message")
                    final_summary = done_text
                    await self.emit_status(
                        "done",
                        f"{done_text}",
                        step=iteration,
                        max_steps=max_iterations,
                        actions=all_executed_steps,
                        thought=last_thought,
                        summary=done_text
                    )
                    break
                else:
                    await self.emit_status(
                        "verifying",
                        f"Verifying step {iteration} outcome...",
                        step=iteration,
                        max_steps=max_iterations,
                        actions=all_executed_steps,
                        thought=last_thought,
                        summary=plan.summary
                    )
                    # Short pause for UI stabilization before next loop's screenshot
                    await asyncio.sleep(0.5)

        except Exception as e:
            overall_status = "error"
            final_summary = f"Execution error: {str(e)}"
            await self.emit_status("error", final_summary, step=0, actions=all_executed_steps)

        # Persist task to SQLite memory
        save_task_history(
            task_prompt=task_prompt,
            status=overall_status,
            summary=final_summary,
            iterations=len(executed_history),
            executed_actions=executed_history
        )

        return {
            "status": overall_status,
            "summary": final_summary,
            "thought": last_thought,
            "actions": all_executed_steps,
            "iterations": len(executed_history),
            "history": executed_history
        }
