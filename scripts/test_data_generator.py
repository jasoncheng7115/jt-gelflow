#!/usr/bin/env python3
"""Test data generator for JT-GELFLOW.

Generates sample GELF messages to test the visualization.
"""

import asyncio
import json
import random
import signal
import socket
import time
from dataclasses import dataclass


@dataclass
class NetworkNode:
    ip: str
    name: str
    node_type: str


NODES = [
    NetworkNode("192.168.1.1", "Gateway", "firewall"),
    NetworkNode("192.168.1.10", "Web-Server-1", "server"),
    NetworkNode("192.168.1.11", "Web-Server-2", "server"),
    NetworkNode("192.168.1.20", "API-Server", "server"),
    NetworkNode("192.168.1.30", "Database", "database"),
    NetworkNode("10.0.0.50", "Client-A", "client"),
    NetworkNode("10.0.0.51", "Client-B", "client"),
    NetworkNode("10.0.0.52", "Client-C", "client"),
]

PROTOCOLS = ["TCP", "UDP", "HTTP", "HTTPS"]
PORTS = [80, 443, 3306, 8080, 5432, 6379]


def generate_gelf_message() -> dict:
    """Generate a random GELF message."""
    src = random.choice(NODES)
    dst = random.choice([n for n in NODES if n != src])

    proto = random.choice(PROTOCOLS)
    port = random.choice(PORTS)
    bytes_count = random.randint(100, 100000)
    packets = (bytes_count + 1499) // 1500

    return {
        "version": "1.1",
        "host": src.name,
        "short_message": f"{proto} traffic from {src.name} to {dst.name}",
        "timestamp": time.time(),
        "level": 6,
        "_src_ip": src.ip,
        "_dst_ip": dst.ip,
        "_src_name": src.name,
        "_dst_name": dst.name,
        "_proto": proto,
        "_dst_port": port,
        "_bytes": bytes_count,
        "_packets": packets,
        "_src_type": src.node_type,
        "_dst_type": dst.node_type,
        "_session_id": f"sess_{random.randint(1000, 9999)}",
    }


class GELFSender:
    """Sends GELF messages via UDP."""

    def __init__(self, host: str = "localhost", port: int = 12201):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.message_count = 0

    def send(self, message: dict) -> bool:
        """Send a GELF message."""
        try:
            data = json.dumps(message).encode("utf-8")
            self.sock.sendto(data, (self.host, self.port))
            self.message_count += 1
            return True
        except Exception as e:
            print(f"Send error: {e}")
            return False

    def close(self):
        """Close the socket."""
        self.sock.close()


async def main():
    """Main entry point."""
    sender = GELFSender()

    print("Starting GELF test data generator...")
    print(f"Sending to {sender.host}:{sender.port}")
    print("Press Ctrl+C to stop\n")

    stop_event = asyncio.Event()

    def signal_handler():
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    try:
        while not stop_event.is_set():
            # Random burst of 1-10 messages
            burst_size = random.randint(1, 10)
            for _ in range(burst_size):
                message = generate_gelf_message()
                sender.send(message)

            if sender.message_count % 100 == 0:
                print(f"Sent {sender.message_count} messages...")

            await asyncio.sleep(0.1)
    finally:
        print(f"\nStopping... Total messages sent: {sender.message_count}")
        sender.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
