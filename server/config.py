"""Configuration management for JT-GELFLOW."""

import json
import os
from dataclasses import dataclass, field, asdict
from typing import Literal
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "config.json"


@dataclass
class MappingConfig:
    src_field: str = "src_ip"
    src_field_display: str = "來源 IP"            # column header label for Sankey
    dst_field: str = "dst_ip"
    dst_field_display: str = "目的 IP"
    proto_field: str = "proto"
    proto_field_display: str = "協定"
    value_field: str = "bytes"
    value_default: float = 1.0
    value_transform: Literal["none", "log", "sqrt"] = "none"
    node_label_template: str = "{src_ip}"
    edge_label_template: str = "{proto|tcp}:{dst_port|0}"
    src_ptr_field: str = "source_ip_ptr"
    src_ptr_field_display: str = "來源 IP 反解"
    dst_ptr_field: str = "destination_ip_ptr"
    dst_ptr_field_display: str = "目的 IP 反解"
    # Country code GELF field names. Sankey reads the external side's country
    # code, picking src or dst based on which endpoint is internal.
    src_country_field: str = "source_ip_country_code"
    dst_country_field: str = "destination_ip_country_code"
    country_display: str = "來源國碼"


@dataclass
class CustomZone:
    name: str = "Zone"
    color: str = "#00d4ff"
    patterns: list[str] = field(default_factory=list)
    position: str = "right"  # 'left' or 'right'
    top_n: int = 0


@dataclass
class ZoneConfig:
    internal_cidrs: list[str] = field(default_factory=lambda: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"])
    external_cidrs: list[str] = field(default_factory=list)  # Empty means "everything else"
    internal_filter_ips: list[str] = field(default_factory=list)  # If set, only show these internal IPs
    internal_filter_apply_to: list[str] = field(default_factory=lambda: ["flow"])  # Which views to apply filter: flow, 2d-geo, 3d-globe
    min_traffic_threshold: float = 0  # Minimum traffic (bytes) to display a flow
    top_n_internal: int = 0  # Show only top N internal IPs (0 = all)
    top_n_internal_apply_to: list[str] = field(default_factory=lambda: ["flow"])  # Which views to apply top N internal
    top_n_external: int = 0  # Show only top N external IPs (0 = all)
    top_n_external_apply_to: list[str] = field(default_factory=lambda: ["flow"])  # Which views to apply top N external
    custom_zones: list[dict] = field(default_factory=list)  # Custom zone definitions
    show_internal_traffic: bool = False  # Show internal-to-internal connections (default: false)
    show_traffic_value: bool = False  # Show traffic value on node labels (default: false)


@dataclass
class GeoIPConfig:
    """Configuration for 3D globe visualization GeoIP fields."""
    source_field: str = "source_ip_geolocation"
    destination_field: str = "destination_ip_geolocation"
    hide_no_geo: bool = True  # Hide nodes without geolocation data
    internal_fallback_lat: float = 0.0  # Fallback latitude for internal IPs
    internal_fallback_lng: float = 0.0  # Fallback longitude for internal IPs
    auto_detect_location: bool = True  # Auto-detect location on startup
    map_brightness: int = 75  # Map/globe brightness 0-100
    show_starfield: bool = True  # Show starfield background in 3D globe
    stats_top_n: int = 15  # Top N to show in stats panel (Flow, 2D Map, 3D Globe)
    focus_zoom_level: float = 14.0  # Zoom level when focusing on a node (2D Map/3D Globe)


@dataclass
class Config:
    gelf_udp_port: int = 12201
    gelf_tcp_port: int = 12202
    http_port: int = 8099
    field_cache_ttl_seconds: int = 600
    field_cache_max_messages: int = 1000
    flow_ttl_seconds: float = 5.0  # How long flows stay visible without new traffic
    default_view: Literal["flow", "2d-geo", "3d-globe", "sankey"] = "flow"  # Default view mode on load
    # Sankey: list of optional columns to render in addition to the mandatory
    # ext_ip + int_ip. Order is fixed left-to-right (country, ext_ip,
    # ext_ip_ptr, protocol, int_ip, int_ip_ptr); the array just toggles which
    # appear. ext_ip and int_ip are added implicitly if missing.
    sankey_active_columns: list[str] = field(default_factory=lambda: [
        "country", "ext_ip", "ext_ip_ptr", "int_ip", "int_ip_ptr",
    ])
    sankey_window_seconds: int = 5  # Sankey snapshot cadence in seconds (1..30)
    # Sankey link-width metric. 'value' (default): width = sum of value_field
    # per flow — falls back to event count automatically when value_field is
    # missing on every message (because value_default=1 → value === events).
    # 'events': force width = event count regardless of any byte data.
    sankey_width_mode: Literal["value", "events"] = "value"
    # Transition effect when switching between view modes. Applies to all 4
    # views uniformly. 'warp' = scanline + zoom warp; 'matrix' = green Matrix
    # character rain canvas overlay.
    transition_effect: Literal["warp", "matrix"] = "warp"
    # NOTE: Sankey column header labels are no longer a separate config — they
    # come from MappingConfig.*_display fields, alongside the GELF field they
    # represent. country has its own country_display since the GELF country
    # code field is hardcoded.
    mapping: MappingConfig = field(default_factory=MappingConfig)
    zones: ZoneConfig = field(default_factory=ZoneConfig)
    geoip: GeoIPConfig = field(default_factory=GeoIPConfig)

    def to_dict(self) -> dict:
        return {
            "gelf_udp_port": self.gelf_udp_port,
            "gelf_tcp_port": self.gelf_tcp_port,
            "http_port": self.http_port,
            "field_cache_ttl_seconds": self.field_cache_ttl_seconds,
            "field_cache_max_messages": self.field_cache_max_messages,
            "flow_ttl_seconds": self.flow_ttl_seconds,
            "default_view": self.default_view,
            "sankey_active_columns": list(self.sankey_active_columns),
            "sankey_window_seconds": self.sankey_window_seconds,
            "sankey_width_mode": self.sankey_width_mode,
            "transition_effect": self.transition_effect,
            "mapping": asdict(self.mapping),
            "zones": asdict(self.zones),
            "geoip": asdict(self.geoip),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Config":
        # Be tolerant of unknown keys from older config.json — drop them
        # silently rather than crashing the whole load. Same for the nested
        # dataclasses below.
        def _filter(d: dict, klass) -> dict:
            valid = set(klass.__dataclass_fields__.keys())
            return {k: v for k, v in d.items() if k in valid}

        mapping_data = data.pop("mapping", {}) or {}
        zones_data = data.pop("zones", {}) or {}
        geoip_data = data.pop("geoip", {}) or {}
        mapping = MappingConfig(**_filter(mapping_data, MappingConfig))
        zones = ZoneConfig(**_filter(zones_data, ZoneConfig))
        geoip = GeoIPConfig(**_filter(geoip_data, GeoIPConfig))
        return cls(mapping=mapping, zones=zones, geoip=geoip, **_filter(data, cls))


_current_config: Config = Config()


def load_config() -> Config:
    """Load configuration from file."""
    global _current_config
    try:
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
            _current_config = Config.from_dict(data)
    except Exception as e:
        print(f"Error loading config, using defaults: {e}")
    return _current_config


def save_config(config: Config) -> Config:
    """Save configuration to file."""
    global _current_config
    _current_config = config
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(config.to_dict(), f, indent=2)
    except Exception as e:
        print(f"Error saving config: {e}")
    return _current_config


def get_config() -> Config:
    """Get current configuration."""
    return _current_config


def update_config(updates: dict) -> Config:
    """Update configuration with partial updates."""
    current = get_config().to_dict()

    # Handle nested mapping updates
    if "mapping" in updates:
        current["mapping"].update(updates.pop("mapping"))

    # Handle nested zones updates
    if "zones" in updates:
        current["zones"].update(updates.pop("zones"))

    # Handle nested geoip updates
    if "geoip" in updates:
        current["geoip"].update(updates.pop("geoip"))

    current.update(updates)
    new_config = Config.from_dict(current)
    return save_config(new_config)


def update_mapping(updates: dict) -> Config:
    """Update only the mapping configuration."""
    return update_config({"mapping": updates})


def update_zones(updates: dict) -> Config:
    """Update only the zones configuration."""
    return update_config({"zones": updates})
