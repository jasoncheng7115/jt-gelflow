"""Field discovery cache for runtime field detection."""

import time
from dataclasses import dataclass, field
from typing import Any
from collections import deque

from .config import get_config


@dataclass
class FieldInfo:
    name: str
    count: int = 0
    last_seen: float = 0.0
    types: set = field(default_factory=set)
    samples: list = field(default_factory=list)
    last_value: Any = None  # Most recent value for this field


@dataclass
class MessageSample:
    data: dict
    timestamp: float


class FieldDiscoveryCache:
    """Cache for discovering fields from incoming messages."""

    def __init__(self, max_messages: int = 1000, ttl_seconds: int = 300):
        self.fields: dict[str, FieldInfo] = {}
        self.messages: deque[MessageSample] = deque(maxlen=max_messages)
        self.max_messages = max_messages
        self.ttl_seconds = ttl_seconds

    def update_config(self):
        """Update cache settings from config."""
        config = get_config()
        self.ttl_seconds = config.field_cache_ttl_seconds
        # Note: changing max_messages requires recreating the deque
        if config.field_cache_max_messages != self.max_messages:
            self.max_messages = config.field_cache_max_messages
            old_messages = list(self.messages)
            self.messages = deque(old_messages, maxlen=self.max_messages)

    def add_message(self, data: dict) -> None:
        """Add a message to the cache and update field statistics."""
        now = time.time()

        # Add to message samples
        self.messages.append(MessageSample(data=data, timestamp=now))

        # Update field info
        for key, value in data.items():
            value_type = type(value).__name__

            if key in self.fields:
                info = self.fields[key]
                info.count += 1
                info.last_seen = now
                info.types.add(value_type)
                info.last_value = value  # Always update to latest
                if len(info.samples) < 5:
                    info.samples.append(value)
            else:
                self.fields[key] = FieldInfo(
                    name=key,
                    count=1,
                    last_seen=now,
                    types={value_type},
                    samples=[value],
                    last_value=value,
                )

        # Clean up old fields
        cutoff = now - self.ttl_seconds
        expired = [k for k, v in self.fields.items() if v.last_seen < cutoff]
        for key in expired:
            del self.fields[key]

    def get_fields(self) -> list[dict]:
        """Get list of discovered fields, sorted by count."""
        result = []

        for info in self.fields.values():
            # Infer primary type
            if "int" in info.types or "float" in info.types:
                inferred_type = "number"
            elif "bool" in info.types:
                inferred_type = "boolean"
            else:
                inferred_type = "string"

            result.append({
                "name": info.name,
                "count": info.count,
                "lastSeen": info.last_seen * 1000,  # Convert to ms for JS
                "inferredType": inferred_type,
                "samples": info.samples[:5],
            })

        # Sort by count (most common first)
        result.sort(key=lambda x: x["count"], reverse=True)
        return result

    def get_latest_message(self) -> dict | None:
        """Get the most recent message."""
        if not self.messages:
            return None
        return self.messages[-1].data

    def get_all_fields_last_values(self) -> dict:
        """Get a composite dict of all fields with their last known values.

        This is useful for template preview - combines the last value from
        each field even if they came from different messages.
        """
        return {info.name: info.last_value for info in self.fields.values()}

    def get_message_count(self) -> int:
        """Get number of messages in cache."""
        return len(self.messages)

    def clear(self) -> None:
        """Clear all cached data."""
        self.fields.clear()
        self.messages.clear()


# Global instance
field_cache = FieldDiscoveryCache()
