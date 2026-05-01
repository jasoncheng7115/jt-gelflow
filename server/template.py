"""Template engine for label templates.

Supports: {field} and {field|default} syntax.
"""

import re
from typing import Any


def get_nested_value(obj: dict, path: str) -> Any:
    """Get a value from a nested dict using dot notation."""
    keys = path.split(".")
    current = obj

    for key in keys:
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None

    return current


def render_template(template: str, data: dict) -> str:
    """Render a template string with data.

    Supports:
    - {field} - replaced with data[field]
    - {field|default} - replaced with data[field] or static default if missing
    - {field1||field2} - use field1 if exists, otherwise use field2
    - {field1||field2|default} - use field1, fallback to field2, then static default
    - {field1||field2||field3|default} - multiple fallback fields supported
    """
    def replace_match(match: re.Match) -> str:
        content = match.group(1)

        # Split by | but handle || (field fallback) specially
        # First, extract the static default (last part after single |)
        parts = content.split("|")

        # Reconstruct: find field fallbacks (||) vs static default (single |)
        fields = []
        default_value = ""
        i = 0
        while i < len(parts):
            part = parts[i].strip()
            if part == "" and i + 1 < len(parts):
                # This is || (empty part between two |), so next part is a fallback field
                i += 1
                if i < len(parts):
                    fields.append(parts[i].strip())
            elif part != "":
                fields.append(part)
            i += 1

        # Check if the last "field" is actually a static default (no || before it)
        # by checking the original pattern
        if len(fields) > 1 and not content.endswith("||" + fields[-1]):
            # Check if there's a single | before the last part
            last_field = fields[-1]
            before_last = content.rsplit("|", 1)[0]
            if not before_last.endswith("|"):
                # Last part is a static default, not a field
                default_value = fields.pop()

        # Try each field in order
        for field_name in fields:
            value = get_nested_value(data, field_name)
            if value is not None and value != "":
                return str(value)

        return default_value

    return re.sub(r"\{([^}]+)\}", replace_match, template)


def extract_template_fields(template: str) -> list[str]:
    """Extract all field names from a template."""
    fields = []
    for match in re.finditer(r"\{([^|}]+)", template):
        fields.append(match.group(1).strip())
    return list(set(fields))


def validate_template(template: str) -> dict:
    """Validate a template string.

    Returns: {"valid": bool, "error": str | None}
    """
    try:
        # Check for balanced braces
        depth = 0
        for char in template:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            if depth < 0:
                return {"valid": False, "error": "Unbalanced braces: extra }"}

        if depth != 0:
            return {"valid": False, "error": "Unbalanced braces: missing }"}

        # Try rendering with empty data
        render_template(template, {})

        return {"valid": True, "error": None}
    except Exception as e:
        return {"valid": False, "error": str(e)}
