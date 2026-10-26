import re
from pathlib import Path
from typing import Dict, Any, Optional, List
from .workspace_coder import write_file

def clean_mermaid_code(raw_code: str) -> str:
    """Cleans up markdown code fences and whitespace from Mermaid code."""
    cleaned = raw_code.strip()
    if cleaned.startswith("```mermaid"):
        cleaned = cleaned[len("```mermaid"):].strip()
    elif cleaned.startswith("```"):
        cleaned = cleaned[len("```"):].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-len("```")].strip()
    return cleaned

def extract_mermaid_from_text(text: str) -> Optional[str]:
    """Extracts mermaid diagram from markdown text if present."""
    match = re.search(r"```mermaid\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # Check if raw text starts with graph, sequenceDiagram, classDiagram, etc.
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if lines and any(lines[0].startswith(kw) for kw in ["graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram"]):
        return "\n".join(lines)
    return None

def scaffold_project(target_dir: str, file_map: Dict[str, str]) -> Dict[str, Any]:
    """
    Scaffolds multiple files into the target repository directory.
    file_map is a dictionary of { relative_path: file_content }.
    """
    root = Path(target_dir).resolve()
    created_files = []
    total_bytes = 0

    for rel_path, content in file_map.items():
        res = write_file(rel_path, content, base_dir=str(root))
        if res.get("success"):
            created_files.append(rel_path)
            total_bytes += res.get("bytes_written", 0)

    return {
        "success": True,
        "scaffold_dir": str(root),
        "files_created": created_files,
        "count": len(created_files),
        "total_bytes": total_bytes
    }
