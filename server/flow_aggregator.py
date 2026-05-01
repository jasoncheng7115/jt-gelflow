"""Flow aggregation for network traffic visualization."""

import time
import math
import ipaddress
from dataclasses import dataclass, field
from typing import Any, Literal

from .config import get_config
from .template import render_template


# Zone types
ZoneType = Literal["internal", "external", "inbound", "outbound"]


def is_ip_in_cidrs(ip_str: str, cidrs: list[str]) -> bool:
    """Check if an IP address is in any of the given CIDR ranges."""
    try:
        ip = ipaddress.ip_address(ip_str)
        for cidr in cidrs:
            try:
                network = ipaddress.ip_network(cidr, strict=False)
                if ip in network:
                    return True
            except ValueError:
                continue
    except ValueError:
        return False
    return False


def classify_zone(src: str, dst: str, internal_cidrs: list[str]) -> ZoneType:
    """Classify a flow based on source and destination IPs."""
    src_internal = is_ip_in_cidrs(src, internal_cidrs)
    dst_internal = is_ip_in_cidrs(dst, internal_cidrs)

    if src_internal and dst_internal:
        return "internal"
    elif not src_internal and not dst_internal:
        return "external"
    elif not src_internal and dst_internal:
        return "inbound"
    else:  # src_internal and not dst_internal
        return "outbound"


@dataclass
class FlowKey:
    src: str
    dst: str
    proto: str

    def to_dict(self) -> dict:
        return {"src": self.src, "dst": self.dst, "proto": self.proto}

    def __hash__(self):
        return hash((self.src, self.dst, self.proto))

    def __eq__(self, other):
        if not isinstance(other, FlowKey):
            return False
        return self.src == other.src and self.dst == other.dst and self.proto == other.proto


@dataclass
class FlowData:
    key: FlowKey
    src_label: str
    dst_label: str
    edge_label: str
    value: float
    count: int
    last_update: float
    zone: ZoneType = "external"
    fields: dict = field(default_factory=dict)  # Original message fields for filtering

    def to_dict(self) -> dict:
        return {
            "key": self.key.to_dict(),
            "srcLabel": self.src_label,
            "dstLabel": self.dst_label,
            "edgeLabel": self.edge_label,
            "value": self.value,
            "count": self.count,
            "lastUpdate": self.last_update * 1000,  # Convert to ms for JS
            "zone": self.zone,
            "fields": self.fields,
        }


@dataclass
class NodeData:
    id: str
    label: str
    total_in: float = 0.0
    total_out: float = 0.0
    connections: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "totalIn": self.total_in,
            "totalOut": self.total_out,
            "connections": self.connections,
        }


class FlowAggregator:
    """Aggregates flow data for visualization."""

    def __init__(self, window_seconds: float = 5.0):
        self.flows: dict[FlowKey, FlowData] = {}
        self.window_seconds = window_seconds
        self.last_message_timestamp: float | None = None  # Timestamp from the last GELF message

    def get_window_seconds(self) -> float:
        """Get window seconds from config or use instance default."""
        config = get_config()
        return config.flow_ttl_seconds if config.flow_ttl_seconds > 0 else self.window_seconds

    def add_flow(self, message: dict) -> FlowData | None:
        """Add a flow from a GELF message."""
        config = get_config()
        mapping = config.mapping

        # Extract src/dst
        src = str(message.get(mapping.src_field, "unknown"))
        dst = str(message.get(mapping.dst_field, "unknown"))
        proto = str(message.get(mapping.proto_field, "unknown"))

        # Skip flows with unknown src or dst
        if src == "unknown" or dst == "unknown":
            return None

        # Extract value
        value = mapping.value_default
        raw_value = message.get(mapping.value_field)
        if raw_value is not None:
            try:
                value = float(raw_value)
            except (ValueError, TypeError):
                pass

        # Apply transform
        if mapping.value_transform == "log":
            value = math.log10(value + 1) if value > 0 else 0
        elif mapping.value_transform == "sqrt":
            value = math.sqrt(abs(value))

        # Generate labels
        # For source node: use source_* fields directly
        src_label = render_template(mapping.node_label_template, {**message, "_node": "src"})

        # For destination node: create a mapped version where source_* -> destination_*
        dst_message = dict(message)
        # Auto-map destination fields to source field names for dst label template
        # This allows template like {source_ip_ptr||source_ip} to work for both src and dst
        field_mappings = [
            ("source_ip", "destination_ip"),
            ("source_port", "destination_port"),
            ("source_ip_ptr", "destination_ip_ptr"),
            ("source_ip_location", "destination_ip_location"),
            ("source_ip_country_code", "destination_ip_country_code"),
            ("source_ip_city_name", "destination_ip_city_name"),
            ("source_ip_geolocation", "destination_ip_geolocation"),
            ("source_ip_reserved_ip", "destination_ip_reserved_ip"),
        ]
        for src_field, dst_field in field_mappings:
            # Map both with and without underscore prefix
            for prefix in ["", "_"]:
                src_key = prefix + src_field
                dst_key = prefix + dst_field
                if dst_key in message:
                    # Map destination field to source field name
                    dst_message[src_key] = message[dst_key]
                elif src_key in dst_message:
                    # Remove source field if destination doesn't exist
                    # This prevents showing source PTR on destination node
                    del dst_message[src_key]

        dst_label = render_template(mapping.node_label_template, {**dst_message, "_node": "dst"})
        edge_label = render_template(mapping.edge_label_template, message)

        # Auto-append IP to label if they're different (helps identify nodes)
        if src_label and src_label != src and not src_label.endswith(f"\n({src})"):
            src_label = f"{src_label}\n({src})"
        if dst_label and dst_label != dst and not dst_label.endswith(f"\n({dst})"):
            dst_label = f"{dst_label}\n({dst})"

        # Classify zone
        zone = classify_zone(src, dst, config.zones.internal_cidrs)

        # Extract common fields for filtering (keep only string/number values)
        filter_fields = {}
        common_field_names = [
            "source_ip", "destination_ip", "source_port", "destination_port",
            "protocol_name", "protocol", "source_ip_ptr", "destination_ip_ptr",
            "application_name", "action", "network_bytes", "network_bytes_out",
            "network_bytes_in", "source_ip_country_code", "destination_ip_country_code",
            "source_ip_city_name", "destination_ip_city_name",
            "source_ip_geolocation", "destination_ip_geolocation",
        ]
        for fname in common_field_names:
            if fname in message:
                val = message[fname]
                if isinstance(val, (str, int, float)):
                    filter_fields[fname] = val
        # Also pull in PTR fields under whatever names the user configured
        # (defaults already covered above; this picks up custom names too).
        for fname in (mapping.src_ptr_field, mapping.dst_ptr_field):
            if fname and fname in message and fname not in filter_fields:
                val = message[fname]
                if isinstance(val, (str, int, float)):
                    filter_fields[fname] = val
        # Also include the mapped src/dst/proto
        filter_fields["src"] = src
        filter_fields["dst"] = dst
        filter_fields["proto"] = proto

        key = FlowKey(src=src, dst=dst, proto=proto)
        now = time.time()

        # Extract and track the message timestamp
        # Try common timestamp field names (GELF standard is 'timestamp' in seconds)
        msg_timestamp = None
        for ts_field in ["timestamp", "_timestamp", "time", "_time", "@timestamp"]:
            if ts_field in message:
                try:
                    ts_val = message[ts_field]
                    # Handle string timestamps (ISO format)
                    if isinstance(ts_val, str):
                        # Try parsing ISO format like "2024-01-09T12:34:56.789Z"
                        from datetime import datetime
                        try:
                            dt = datetime.fromisoformat(ts_val.replace('Z', '+00:00'))
                            msg_timestamp = dt.timestamp()
                        except ValueError:
                            continue
                    else:
                        msg_timestamp = float(ts_val)
                    break
                except (ValueError, TypeError):
                    continue

        # Update the last message timestamp (use current time if no timestamp in message)
        if msg_timestamp is not None:
            self.last_message_timestamp = msg_timestamp
        else:
            self.last_message_timestamp = now

        if key in self.flows:
            flow = self.flows[key]
            flow.value += value
            flow.count += 1
            flow.last_update = now
            flow.edge_label = edge_label  # Update to latest
            flow.zone = zone  # Update zone in case config changed
            flow.fields = filter_fields  # Update to latest fields
            return flow

        flow = FlowData(
            key=key,
            src_label=src_label,
            dst_label=dst_label,
            edge_label=edge_label,
            value=value,
            count=1,
            last_update=now,
            zone=zone,
            fields=filter_fields,
        )
        self.flows[key] = flow
        return flow

    def get_graph(self) -> dict:
        """Get the current graph data with zone classification."""
        now = time.time()
        cutoff = now - self.get_window_seconds()

        # Clean old flows
        self.flows = {k: v for k, v in self.flows.items() if v.last_update >= cutoff}

        config = get_config()
        internal_cidrs = config.zones.internal_cidrs

        # Cache for IP classification to avoid repeated CIDR checks
        ip_internal_cache: dict[str, bool] = {}

        def is_internal_cached(node_id: str) -> bool:
            if node_id not in ip_internal_cache:
                ip_internal_cache[node_id] = is_ip_in_cidrs(node_id, internal_cidrs)
            return ip_internal_cache[node_id]

        # Build global nodes and edges per zone
        all_nodes: dict[str, NodeData] = {}
        zones_edges: dict[str, list] = {
            "internal": [],
            "external": [],
            "inbound": [],
            "outbound": [],
        }

        def get_or_create_node(node_id: str, label: str) -> NodeData:
            if node_id not in all_nodes:
                all_nodes[node_id] = NodeData(id=node_id, label=label)
            return all_nodes[node_id]

        # Pre-convert flows to dicts to avoid repeated conversion
        for flow in self.flows.values():
            zone = flow.zone

            # Use proper labels for src and dst
            src_node = get_or_create_node(flow.key.src, flow.src_label)
            dst_node = get_or_create_node(flow.key.dst, flow.dst_label)
            # Update labels in case template changed
            src_node.label = flow.src_label
            dst_node.label = flow.dst_label

            src_node.total_out += flow.value
            src_node.connections += 1
            dst_node.total_in += flow.value
            dst_node.connections += 1

            zones_edges[zone].append(flow.to_dict())

        # Classify nodes by zone using cached lookups
        internal_node_ids = [nid for nid in all_nodes.keys() if is_internal_cached(nid)]
        external_node_ids = [nid for nid in all_nodes.keys() if not is_internal_cached(nid)]

        # Format output - nodes are shared, edges are per zone
        result = {
            "timestamp": now * 1000,
            "lastMessageTimestamp": (self.last_message_timestamp * 1000) if self.last_message_timestamp else None,
            "zones": {
                "internal": {
                    "nodes": [all_nodes[nid].to_dict() for nid in internal_node_ids],
                    "edges": zones_edges["internal"],
                },
                "external": {
                    "nodes": [all_nodes[nid].to_dict() for nid in external_node_ids],
                    "edges": zones_edges["external"] + zones_edges["inbound"] + zones_edges["outbound"],
                },
                "inbound": {
                    "nodes": [],
                    "edges": zones_edges["inbound"],
                },
                "outbound": {
                    "nodes": [],
                    "edges": zones_edges["outbound"],
                },
            },
            "nodes": [n.to_dict() for n in all_nodes.values()],
            "edges": [e for edges in zones_edges.values() for e in edges],
        }

        return result

    def set_window(self, seconds: float) -> None:
        """Set the aggregation window."""
        self.window_seconds = seconds

    def clear(self) -> None:
        """Clear all flow data."""
        self.flows.clear()
        self.last_message_timestamp = None


# Global instance
flow_aggregator = FlowAggregator()
