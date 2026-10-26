from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

ActionType = Literal[
    "click",
    "double_click",
    "right_click",
    "type_text",
    "press_key",
    "hotkey",
    "scroll",
    "drag",
    "wait",
    "read_file",
    "write_file",
    "patch_file",
    "list_dir",
    "run_command",
    "render_diagram",
    "scaffold",
    "done",
    "ask_user",
    "require_approval"
]

class VexaAction(BaseModel):
    action_type: ActionType = Field(..., description="Action to perform")
    target_x: Optional[int] = Field(None, description="Normalized X coordinate (0-1000)")
    target_y: Optional[int] = Field(None, description="Normalized Y coordinate (0-1000)")
    text: Optional[str] = Field(None, description="Text to type or message to convey")
    key: Optional[str] = Field(None, description="Key or shortcut string (e.g. 'enter', 'ctrl+s')")
    keys: Optional[List[str]] = Field(None, description="Key combination list (e.g. ['ctrl', 'shift', 'p'])")
    scroll_amount: Optional[int] = Field(None, description="Vertical scroll clicks (positive=up, negative=down)")
    path: Optional[str] = Field(None, description="Relative or absolute file/directory path")
    content: Optional[str] = Field(None, description="File content to write or patch")
    search_text: Optional[str] = Field(None, description="Search text to replace for patch_file")
    command: Optional[str] = Field(None, description="Terminal command to execute")
    diagram_code: Optional[str] = Field(None, description="Mermaid.js diagram syntax string")
    diagram_title: Optional[str] = Field(None, description="Title for the rendered diagram")
    files: Optional[Dict[str, str]] = Field(None, description="File dictionary for project scaffolding: {path: content}")
    reasoning: Optional[str] = Field(None, description="Explanation or chain of thought for this step")
    goal_achieved: Optional[bool] = Field(None, description="Whether the entire user goal is satisfied")
    is_destructive: Optional[bool] = Field(False, description="True if action requires explicit user approval before execution")

class VexaPlan(BaseModel):
    thought: str = Field(..., description="Observations and step-by-step reasoning")
    observations: str = Field(..., description="Current visual or workspace state observation")
    actions: List[VexaAction] = Field(default_factory=list, description="Batch of 1 to 5 sequential actions")
    goal_achieved: bool = Field(False, description="True if task is completed")
    summary: str = Field(..., description="Short user-facing summary of actions performed or planned")

class TaskRequest(BaseModel):
    task: str
    workspace_path: Optional[str] = None
    allow_gui: bool = True
    allow_terminal: bool = True

class TaskStatusUpdate(BaseModel):
    status: Literal["idle", "observing", "planning", "executing", "pre_click_hide", "verifying", "awaiting_approval", "done", "error"]
    message: str
    step: int = 0
    max_steps: int = 3
    actions: Optional[List[VexaAction]] = None
    diagram: Optional[Dict[str, Any]] = None
    approval_required: Optional[Dict[str, Any]] = None

class MacroRecord(BaseModel):
    id: Optional[int] = None
    name: str
    trigger_keyword: str
    description: str = ""
    action_sequence: List[Dict[str, Any]]

class ProjectPathRecord(BaseModel):
    id: Optional[int] = None
    project_name: str
    project_path: str
    created_at: Optional[str] = None
