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
from ..memory.db import save_task_history, get_project_path, get_recent_tasks

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
5. APPLICATION LAUNCHING & REAL EXECUTION:
   - When the user asks to open an application (e.g. "open whatsapp", "open spotify", "launch chrome", "open notepad") or visit a website:
   - DO NOT write instructions telling the user how to open it! ACTUALLY OPEN IT!
   - Use action_type="run_command" with a Windows command like 'start whatsapp:', 'start spotify:', 'start notepad', 'start https://web.whatsapp.com', or 'start https://www.google.com/search?q=...'.
   - Then set goal_achieved=true.
6. CLOSED-LOOP VERIFICATION:
   - As soon as the user's goal is fulfilled, emit an action with action_type="done" and set goal_achieved=true.
7. SAFETY & APPROVAL:
   - For irreversible destructive actions (e.g. git reset --hard, deleting repositories or dropping databases), set action_type="require_approval" and is_destructive=true.
8. STRUCTURED JSON OUTPUT:
   - You MUST output valid JSON adhering to the VexaPlan schema:
     {
       "thought": "...",
       "observations": "...",
       "actions": [...],
       "goal_achieved": true/false,
       "summary": "..."
     }
9. FRESH CODE GENERATION IN CHAT VS WORKSPACE MODIFICATION:
   - When the user asks to write, generate, or explain code in chat (e.g. "write calculator code here in chat", "show code without saving to file", "generate python function", "give me code in response"):
     - You MUST generate fresh, complete, clean, and working code directly in your response text enclosed in markdown code fences (```python ... ```).
     - NEVER lazily call read_file on existing workspace files to re-use old code unless the user explicitly requested you to "read", "inspect", or "review" that existing file!
     - Deliver the complete code in your response using action_type="done" with text="<markdown with code blocks>", and set goal_achieved=true.
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

        prompt_lower = task_prompt.lower().strip()

        # 1. Architecture Blueprint Intent
        is_diagram_intent = any(k in prompt_lower for k in [
            "architecture diagram", "draw architecture", "architecture of",
            "mermaid diagram", "draw diagram", "render diagram", "blueprint of",
            "system architecture", "flowchart of", "sequence diagram"
        ])
        if is_diagram_intent:
            await self.emit_status("planning", "Generating Mermaid Architecture Blueprint...", step=1, max_steps=1)
            t0 = time.time()
            diagram_prompt = f"""You are a master software architect. Generate a clean, comprehensive, modern Mermaid.js diagram for: '{task_prompt}'.
Output ONLY the mermaid code block inside ```mermaid ... ``` fences, followed by a 2-sentence architectural summary.
Use modern styling (graph TD, classDef, or sequenceDiagram)."""
            diagram_res = await call_gemini_with_resilience(contents=diagram_prompt, temperature=0.2)
            code = architect.extract_mermaid_from_text(diagram_res) or architect.clean_mermaid_code(diagram_res)
            title = task_prompt.replace("draw", "").replace("architecture of", "").replace("architecture diagram of", "").strip().title() or "System Architecture"
            dur_ms = int((time.time() - t0) * 1000)
            diagram_data = {
                "diagram_code": code,
                "diagram_title": title
            }
            step_item = {
                "id": "arch-1",
                "step_num": 1,
                "action_type": "render_diagram",
                "description": f"Architecture Blueprint: {title}",
                "status": "completed",
                "params": {"diagram_title": title},
                "result": {"title": title, "code_length": len(code)},
                "duration_ms": dur_ms
            }
            save_task_history(
                task_prompt=task_prompt,
                status="done",
                summary=f"Rendered architecture blueprint: {title}",
                iterations=1,
                executed_actions=[diagram_data]
            )
            await self.emit_status(
                "done",
                f"Architecture Blueprint rendered: {title}",
                step=1,
                max_steps=1,
                actions=[step_item],
                diagram=diagram_data,
                summary=f"Architecture Blueprint successfully rendered: {title}. You can drag, zoom, inspect, or scaffold this blueprint to your repository.",
                thought="Detected architecture blueprint intent. Generated Mermaid.js diagram directly."
            )
            return {
                "status": "done",
                "iterations": 1,
                "thought": "Detected architecture blueprint intent. Generated Mermaid.js diagram directly.",
                "summary": f"Architecture Blueprint rendered: {title}",
                "actions": [step_item],
                "diagram": diagram_data
            }

        # Gather recent conversation memory for multi-turn context
        recent_tasks = get_recent_tasks(limit=4)
        recent_tasks.reverse()
        history_lines = []
        for t in recent_tasks:
            p = t.get("task_prompt", "")
            s = t.get("summary", "")
            if p and p != task_prompt:
                history_lines.append(f"User: {p}\nVEXA: {s[:250]}")
        chat_history_str = "\n".join(history_lines) if history_lines else "None"

        # Code generation in chat without file writing:
        is_chat_code_request = (
            any(k in prompt_lower for k in [
                "in chat", "here in chat", "dont write it in file", "don't write it in file",
                "dont write in file", "don't write in file", "dont write to file", "don't write to file",
                "do not save", "without saving", "show code", "give me code", "write code of",
                "write code for", "write calculator", "generate code"
            ])
            and not any(k in prompt_lower for k in ["save to", "write to file", "create file", "save into file"])
        )

        # 2. General Knowledge / Informational Intent vs Action Intent
        is_question_or_info = (
            prompt_lower.startswith((
                "what is", "what are", "what was", "who is", "who was", "why is", "why does",
                "when was", "when did", "how does", "how do", "explain", "tell me about",
                "difference between", "define", "definition of", "history of", "list the"
            ))
            or (prompt_lower.endswith("?") and not any(prompt_lower.startswith(v) for v in ["can you open", "open", "launch", "start", "run", "search", "play"]))
        )

        is_action_intent = any(prompt_lower.startswith(v) for v in [
            "open", "launch", "start", "run", "close", "kill", "stop",
            "click", "double click", "right click", "type", "press",
            "search", "google", "find", "play", "create", "make",
            "write", "edit", "patch", "delete", "remove", "install",
            "build", "test", "git", "scaffold", "refactor"
        ]) or any(k in prompt_lower for k in [
            "click on", "type into", "press key", "on screen", "open file",
            "run command", "open terminal", "open app"
        ])

        if is_chat_code_request or (is_question_or_info and not is_action_intent):
            await self.emit_status("planning", "Reasoning with VEXA Knowledge & Code Engine...", step=1, max_steps=1)
            t0 = time.time()
            knowledge_prompt = f"""The user asked or instructed: '{task_prompt}'.

RECENT CONVERSATION HISTORY:
{chat_history_str}

Provide an insightful, well-structured, authoritative, and helpful response.
Formatting Rules:
- If asked to write, provide, or generate code:
  - Generate fresh, original, complete, fully working code directly in your response text.
  - Enclose all code in markdown code fences with the language tag (e.g. ```python\\n...\\n```).
  - Include comments explaining key sections and usage instructions.
  - NEVER output instructions telling the user to read existing workspace files unless explicitly requested.
- Use clean Markdown with bold terms, bullet points for lists, and concise paragraphs.
- Avoid raw trailing commas, unclosed brackets, or loose list punctuation.
- Make the answer direct, complete, and engaging."""
            knowledge_res = await call_gemini_with_resilience(
                contents=knowledge_prompt,
                system_instruction="You are VEXA (Virtual Execution & X-Layer Architect), an advanced, intelligent AI desktop assistant. Provide direct, authoritative, clean, and helpful answers with beautiful markdown code fences.",
                temperature=0.3
            )

            # Auto-wrap unfenced raw code if Gemini omitted triple backticks
            cleaned_res = knowledge_res.strip()
            if "```" not in cleaned_res and any(cleaned_res.startswith(k) for k in ["import ", "def ", "class ", "from ", "async def ", "function ", "const "]):
                lang = "python" if not cleaned_res.startswith(("function ", "const ")) else "javascript"
                knowledge_res = f"```{lang}\n{cleaned_res}\n```"

            dur_ms = int((time.time() - t0) * 1000)
            step_item = {
                "id": "info-1",
                "step_num": 1,
                "action_type": "knowledge_response",
                "description": f"Answered: {task_prompt}",
                "status": "completed",
                "params": {"query": task_prompt},
                "result": knowledge_res,
                "duration_ms": dur_ms
            }
            save_task_history(
                task_prompt=task_prompt,
                status="done",
                summary=knowledge_res[:200],
                iterations=1,
                executed_actions=[step_item]
            )
            await self.emit_status(
                "done",
                knowledge_res[:150] + "..." if len(knowledge_res) > 150 else knowledge_res,
                step=1,
                max_steps=1,
                actions=[step_item],
                summary=knowledge_res,
                thought="Understood user intent as an informational or direct code generation query. Delivered complete response with Gemini reasoning."
            )
            return {
                "status": "done",
                "iterations": 1,
                "thought": "Understood user intent as an informational or direct code generation query. Delivered complete response with Gemini reasoning.",
                "summary": knowledge_res,
                "actions": [step_item]
            }

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
RECENT CONVERSATION HISTORY:
{chat_history_str}
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
