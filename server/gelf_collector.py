"""GELF collector for UDP and TCP input."""

import asyncio
import json
import gzip
import struct
from typing import Callable, Any

from .config import get_config
from .field_discovery import field_cache
from .flow_aggregator import flow_aggregator, FlowData


class GELFProtocol:
    """Base class for GELF message parsing."""

    def __init__(self, on_flow: Callable[[FlowData], None] | None = None):
        self.on_flow = on_flow
        self.message_count = 0
        self.chunked_messages: dict[str, dict] = {}

    def parse_gelf(self, data: bytes) -> dict | None:
        """Parse a GELF message from bytes."""
        try:
            # Check for GZIP magic bytes
            if len(data) >= 2 and data[0] == 0x1f and data[1] == 0x8b:
                data = gzip.decompress(data)

            message = json.loads(data.decode("utf-8"))

            # Normalize GELF fields (remove leading underscores for convenience)
            normalized = {}
            for key, value in message.items():
                normalized[key] = value
                # Also add without underscore for easier access
                if key.startswith("_"):
                    normalized[key[1:]] = value

            return normalized
        except Exception as e:
            print(f"GELF parse error: {e}")
            return None

    def handle_chunked(self, data: bytes) -> bytes | None:
        """Handle chunked GELF messages.

        GELF chunked format:
        - Magic bytes (2): 0x1e 0x0f
        - Message ID (8): unique id
        - Sequence number (1): chunk index
        - Sequence count (1): total chunks
        - Chunk data: rest of the message
        """
        if len(data) < 12:
            return None

        message_id = data[2:10].hex()
        seq_num = data[10]
        seq_count = data[11]
        chunk_data = data[12:]

        if message_id not in self.chunked_messages:
            self.chunked_messages[message_id] = {
                "chunks": [None] * seq_count,
                "total": seq_count,
                "timestamp": asyncio.get_event_loop().time(),
            }

        entry = self.chunked_messages[message_id]
        entry["chunks"][seq_num] = chunk_data

        # Check if complete
        if all(c is not None for c in entry["chunks"]):
            del self.chunked_messages[message_id]
            return b"".join(entry["chunks"])

        # Clean old incomplete messages (>5 seconds)
        now = asyncio.get_event_loop().time()
        expired = [
            mid for mid, e in self.chunked_messages.items()
            if now - e["timestamp"] > 5.0
        ]
        for mid in expired:
            del self.chunked_messages[mid]

        return None

    def process_message(self, data: bytes) -> None:
        """Process a GELF message."""
        # Check for chunked message
        if len(data) >= 2 and data[0] == 0x1e and data[1] == 0x0f:
            complete = self.handle_chunked(data)
            if not complete:
                return
            data = complete

        message = self.parse_gelf(data)
        if not message:
            return

        self.message_count += 1

        # Add to field discovery
        field_cache.add_message(message)

        # Add to flow aggregator
        flow = flow_aggregator.add_flow(message)
        if flow and self.on_flow:
            self.on_flow(flow)


class GELFUDPProtocol(asyncio.DatagramProtocol, GELFProtocol):
    """UDP protocol for GELF messages."""

    def __init__(self, on_flow: Callable[[FlowData], None] | None = None):
        asyncio.DatagramProtocol.__init__(self)
        GELFProtocol.__init__(self, on_flow)
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr):
        self.process_message(data)

    def error_received(self, exc):
        print(f"UDP error: {exc}")


class GELFTCPHandler(GELFProtocol):
    """TCP handler for GELF messages."""

    # Maximum buffer size per connection (1MB)
    MAX_BUFFER_SIZE = 1024 * 1024

    def __init__(self, on_flow: Callable[[FlowData], None] | None = None):
        super().__init__(on_flow)

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle a TCP client connection."""
        # Each connection gets its own buffer (fixes shared buffer bug)
        buffer = b""
        try:
            while True:
                data = await asyncio.wait_for(reader.read(65536), timeout=30.0)
                if not data:
                    break

                buffer += data

                # Prevent buffer overflow attack
                if len(buffer) > self.MAX_BUFFER_SIZE:
                    print(f"TCP buffer overflow, dropping connection")
                    break

                # GELF TCP uses null byte as delimiter
                while b"\x00" in buffer:
                    message, buffer = buffer.split(b"\x00", 1)
                    if message:
                        self.process_message(message)
        except asyncio.TimeoutError:
            pass  # Connection idle timeout
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"TCP handler error: {e}")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


class GELFCollector:
    """Main GELF collector managing UDP and TCP servers."""

    def __init__(self):
        self.udp_transport = None
        self.udp_protocol = None
        self.tcp_server = None
        self.tcp_handler = None
        self.on_flow_callbacks: list[Callable[[FlowData], None]] = []

    def on_flow(self, callback: Callable[[FlowData], None]) -> None:
        """Register a callback for new flows."""
        self.on_flow_callbacks.append(callback)

    def _notify_flow(self, flow: FlowData) -> None:
        """Notify all callbacks of a new flow."""
        for callback in self.on_flow_callbacks:
            try:
                callback(flow)
            except Exception as e:
                print(f"Flow callback error: {e}")

    async def start_udp(self, port: int) -> None:
        """Start the UDP server."""
        loop = asyncio.get_event_loop()

        self.udp_transport, self.udp_protocol = await loop.create_datagram_endpoint(
            lambda: GELFUDPProtocol(self._notify_flow),
            local_addr=("0.0.0.0", port),
        )
        print(f"GELF UDP collector listening on port {port}")

    async def start_tcp(self, port: int) -> None:
        """Start the TCP server."""
        self.tcp_handler = GELFTCPHandler(self._notify_flow)

        self.tcp_server = await asyncio.start_server(
            self.tcp_handler.handle_client,
            "0.0.0.0",
            port,
        )
        print(f"GELF TCP collector listening on port {port}")

    async def start(self) -> None:
        """Start both UDP and TCP collectors."""
        config = get_config()
        await self.start_udp(config.gelf_udp_port)
        await self.start_tcp(config.gelf_tcp_port)

    async def stop(self) -> None:
        """Stop all collectors."""
        if self.udp_transport:
            self.udp_transport.close()
            self.udp_transport = None

        if self.tcp_server:
            self.tcp_server.close()
            await self.tcp_server.wait_closed()
            self.tcp_server = None

    def get_stats(self) -> dict:
        """Get collector statistics."""
        udp_count = self.udp_protocol.message_count if self.udp_protocol else 0
        tcp_count = self.tcp_handler.message_count if self.tcp_handler else 0
        graph = flow_aggregator.get_graph()

        return {
            "messageCount": udp_count + tcp_count,
            "flowCount": len(graph["edges"]),
        }

    def cleanup_stale_data(self) -> None:
        """Clean up stale chunked messages to prevent memory leaks."""
        now = asyncio.get_event_loop().time()

        # Clean UDP protocol chunked messages
        if self.udp_protocol and self.udp_protocol.chunked_messages:
            expired = [
                mid for mid, e in self.udp_protocol.chunked_messages.items()
                if now - e["timestamp"] > 10.0  # 10 seconds timeout
            ]
            for mid in expired:
                del self.udp_protocol.chunked_messages[mid]

        # Clean TCP handler chunked messages
        if self.tcp_handler and self.tcp_handler.chunked_messages:
            expired = [
                mid for mid, e in self.tcp_handler.chunked_messages.items()
                if now - e["timestamp"] > 10.0
            ]
            for mid in expired:
                del self.tcp_handler.chunked_messages[mid]


# Global instance
gelf_collector = GELFCollector()
