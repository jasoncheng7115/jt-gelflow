"""Main server application with REST API and WebSocket."""

import asyncio
import json
import signal
from pathlib import Path

from aiohttp import web, WSMsgType, ClientSession
import aiohttp_cors

from .config import load_config, get_config, update_config, update_mapping
from .template import render_template, validate_template
from .field_discovery import field_cache
from .flow_aggregator import flow_aggregator
from .gelf_collector import gelf_collector


# WebSocket clients
ws_clients: set[web.WebSocketResponse] = set()


# === REST API Handlers ===

async def get_config_handler(request: web.Request) -> web.Response:
    """GET /api/config - Get current configuration."""
    return web.json_response(get_config().to_dict())


async def post_config_handler(request: web.Request) -> web.Response:
    """POST /api/config - Update configuration."""
    try:
        data = await request.json()

        # Check if internal_filter_ips is changing
        old_filter_ips = set(get_config().zones.internal_filter_ips)

        updated = update_config(data)
        field_cache.update_config()

        # If internal_filter_ips changed, clear the flow graph
        new_filter_ips = set(updated.zones.internal_filter_ips)
        if old_filter_ips != new_filter_ips:
            flow_aggregator.clear()
            print(f"Internal filter IPs changed, flow graph cleared")

        return web.json_response(updated.to_dict())
    except Exception as e:
        import traceback
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"Config update error: {error_msg}")
        traceback.print_exc()
        return web.json_response({"error": error_msg}, status=400)


async def get_mapping_handler(request: web.Request) -> web.Response:
    """GET /api/mapping - Get mapping configuration (full MappingConfig)."""
    from dataclasses import asdict
    return web.json_response(asdict(get_config().mapping))


async def post_mapping_handler(request: web.Request) -> web.Response:
    """POST /api/mapping - Update mapping configuration (returns full MappingConfig)."""
    from dataclasses import asdict
    data = await request.json()
    updated = update_mapping(data)
    return web.json_response(asdict(updated.mapping))


async def get_fields_handler(request: web.Request) -> web.Response:
    """GET /api/fields - Get discovered fields."""
    return web.json_response({
        "fields": field_cache.get_fields(),
        "messageCount": field_cache.get_message_count(),
    })


async def get_graph_handler(request: web.Request) -> web.Response:
    """GET /api/graph - Get current graph data."""
    return web.json_response(flow_aggregator.get_graph())


async def get_stats_handler(request: web.Request) -> web.Response:
    """GET /api/stats - Get collector statistics."""
    return web.json_response(gelf_collector.get_stats())


async def post_template_preview_handler(request: web.Request) -> web.Response:
    """POST /api/template/preview - Preview a template."""
    data = await request.json()
    template = data.get("template", "")

    validation = validate_template(template)
    if not validation["valid"]:
        return web.json_response({"error": validation["error"], "result": ""})

    # Use composite of all fields' last values for preview
    sample_data = field_cache.get_all_fields_last_values()
    if not sample_data:
        return web.json_response({"result": template, "note": "No messages received yet"})

    result = render_template(template, sample_data)
    return web.json_response({"result": result, "sample": sample_data})


async def post_template_validate_handler(request: web.Request) -> web.Response:
    """POST /api/template/validate - Validate a template."""
    data = await request.json()
    template = data.get("template", "")
    return web.json_response(validate_template(template))


async def post_clear_handler(request: web.Request) -> web.Response:
    """POST /api/clear - Clear all data."""
    flow_aggregator.clear()
    field_cache.clear()
    return web.json_response({"success": True})


async def post_clear_fields_handler(request: web.Request) -> web.Response:
    """POST /api/fields/clear - Clear field cache only."""
    field_cache.clear()
    return web.json_response({"success": True})


async def get_detect_location_handler(request: web.Request) -> web.Response:
    """GET /api/detect-location - Auto-detect server location via external IP."""
    try:
        async with ClientSession() as session:
            # Use ip-api.com (free, no API key required)
            async with session.get("http://ip-api.com/json/", timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("status") == "success":
                        return web.json_response({
                            "success": True,
                            "lat": data.get("lat", 0),
                            "lng": data.get("lon", 0),
                            "city": data.get("city", ""),
                            "country": data.get("country", ""),
                            "ip": data.get("query", ""),
                        })
                    else:
                        return web.json_response({
                            "success": False,
                            "error": data.get("message", "Unknown error"),
                        })
                else:
                    return web.json_response({
                        "success": False,
                        "error": f"HTTP {resp.status}",
                    })
    except asyncio.TimeoutError:
        return web.json_response({
            "success": False,
            "error": "Request timeout",
        })
    except Exception as e:
        return web.json_response({
            "success": False,
            "error": str(e),
        })


# === WebSocket Handler ===

async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    """WebSocket endpoint for real-time updates."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    ws_clients.add(ws)
    print("WebSocket client connected")

    # Send initial graph data
    try:
        await ws.send_json({
            "type": "graph",
            "data": flow_aggregator.get_graph(),
        })
    except Exception as e:
        print(f"Error sending initial data: {e}")

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                # Handle any client messages if needed
                pass
            elif msg.type == WSMsgType.ERROR:
                print(f"WebSocket error: {ws.exception()}")
    finally:
        ws_clients.discard(ws)
        print("WebSocket client disconnected")

    return ws


# Cache for last broadcast to avoid redundant serialization
_last_broadcast_hash: int = 0
_last_broadcast_message: str = ""


async def _send_to_client(ws: web.WebSocketResponse, message: str) -> bool:
    """Send message to a single client with timeout. Returns False if failed."""
    try:
        if ws.closed:
            return False
        # Use timeout to prevent slow clients from blocking
        await asyncio.wait_for(ws.send_str(message), timeout=2.0)
        return True
    except (asyncio.TimeoutError, Exception):
        return False


async def broadcast_graph():
    """Broadcast graph data to all WebSocket clients."""
    global _last_broadcast_hash, _last_broadcast_message

    # Always call get_graph() to clean old flows, even without clients
    graph = flow_aggregator.get_graph()

    if not ws_clients:
        return

    # Create a hash based on actual data content
    # Include lastMessageTimestamp to detect new incoming data
    # Include node/edge structure to detect graph changes
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    last_msg_ts = graph.get("lastMessageTimestamp")
    node_ids = tuple(sorted(n.get("id", "") for n in nodes))
    edge_keys = tuple(sorted(
        (e.get("key", {}).get("src", ""), e.get("key", {}).get("dst", ""), e.get("key", {}).get("proto", ""))
        for e in edges
    ))
    graph_hash = hash((node_ids, edge_keys, len(edges), last_msg_ts))

    # Only serialize if graph changed
    if graph_hash != _last_broadcast_hash:
        _last_broadcast_message = json.dumps({"type": "graph", "data": graph})
        _last_broadcast_hash = graph_hash

    # Send to all clients concurrently with timeout
    # This prevents one slow client from blocking others
    clients = list(ws_clients)
    if not clients:
        return

    results = await asyncio.gather(
        *[_send_to_client(ws, _last_broadcast_message) for ws in clients],
        return_exceptions=True
    )

    # Remove failed clients
    dead_clients = {
        ws for ws, success in zip(clients, results)
        if success is False or isinstance(success, Exception)
    }
    ws_clients.difference_update(dead_clients)


async def broadcast_loop():
    """Periodic broadcast loop."""
    while True:
        await asyncio.sleep(0.1)  # 10 updates per second (100ms) - reduced from 50ms
        await broadcast_graph()


async def cleanup_loop():
    """Periodic cleanup loop for stale data."""
    while True:
        await asyncio.sleep(5.0)  # Run every 5 seconds
        gelf_collector.cleanup_stale_data()


async def websocket_ping_loop():
    """Periodic WebSocket ping to detect dead connections."""
    while True:
        await asyncio.sleep(15.0)  # Ping every 15 seconds
        if not ws_clients:
            continue

        dead_clients = set()
        for ws in list(ws_clients):
            try:
                if ws.closed:
                    dead_clients.add(ws)
                else:
                    # Send ping with timeout
                    await asyncio.wait_for(ws.ping(), timeout=5.0)
            except (asyncio.TimeoutError, Exception):
                dead_clients.add(ws)

        if dead_clients:
            ws_clients.difference_update(dead_clients)
            print(f"Cleaned up {len(dead_clients)} stale WebSocket connection(s)")


# === Static File Serving ===

async def index_handler(request: web.Request) -> web.Response:
    """Serve index.html for SPA with no-cache headers."""
    client_path = Path(__file__).parent.parent / "dist" / "client" / "index.html"
    if client_path.exists():
        content = client_path.read_text()
        return web.Response(
            text=content,
            content_type="text/html",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return web.Response(text="Frontend not built. Run: npm run build:client", status=404)


async def static_file_handler(request: web.Request) -> web.Response:
    """Serve static files from root (favicon, etc.)."""
    filename = request.match_info.get('filename', '')
    # Only allow specific extensions for security
    allowed_extensions = {'.png', '.ico', '.svg', '.jpg', '.jpeg', '.webp'}
    ext = Path(filename).suffix.lower()
    if ext not in allowed_extensions:
        return web.Response(status=404)

    file_path = Path(__file__).parent.parent / "dist" / "client" / filename
    if file_path.exists() and file_path.is_file():
        return web.FileResponse(file_path)
    return web.Response(status=404)


# === Application Setup ===

def create_app() -> web.Application:
    """Create the aiohttp application."""
    app = web.Application()

    # Setup CORS
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*",
        )
    })

    # API routes
    api_routes = [
        web.get("/api/config", get_config_handler),
        web.post("/api/config", post_config_handler),
        web.get("/api/mapping", get_mapping_handler),
        web.post("/api/mapping", post_mapping_handler),
        web.get("/api/fields", get_fields_handler),
        web.get("/api/graph", get_graph_handler),
        web.get("/api/stats", get_stats_handler),
        web.post("/api/template/preview", post_template_preview_handler),
        web.post("/api/template/validate", post_template_validate_handler),
        web.post("/api/clear", post_clear_handler),
        web.post("/api/fields/clear", post_clear_fields_handler),
        web.get("/api/detect-location", get_detect_location_handler),
    ]

    for route in api_routes:
        cors.add(app.router.add_route(route.method, route.path, route.handler))

    # WebSocket route
    app.router.add_get("/ws", websocket_handler)

    # Static files (production)
    client_path = Path(__file__).parent.parent / "dist" / "client"
    if client_path.exists():
        app.router.add_static("/assets", client_path / "assets")
        # Root static files (favicon, etc.) - must be before catch-all
        app.router.add_get("/{filename:[^/]+\\.(png|ico|svg|jpg|jpeg|webp)}", static_file_handler)
        app.router.add_get("/", index_handler)
        # Catch-all for SPA routing
        app.router.add_get("/{tail:.*}", index_handler)

    return app


async def start_server():
    """Start the server and all components."""
    # Load configuration
    load_config()
    config = get_config()

    # Start GELF collector
    await gelf_collector.start()

    # Create and start web app
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, "0.0.0.0", config.http_port)
    await site.start()

    print(f"\nHTTP server listening on port {config.http_port}")
    print(f"WebSocket server listening on ws://localhost:{config.http_port}/ws")
    print(f"\nGELF Collectors:")
    print(f"  UDP: {config.gelf_udp_port}")
    print(f"  TCP: {config.gelf_tcp_port}")
    print(f"\nOpen http://localhost:{config.http_port} in your browser")

    # Start broadcast loop, cleanup loop, and WebSocket ping loop
    broadcast_task = asyncio.create_task(broadcast_loop())
    cleanup_task = asyncio.create_task(cleanup_loop())
    ping_task = asyncio.create_task(websocket_ping_loop())

    # Wait for shutdown signal
    stop_event = asyncio.Event()

    def signal_handler():
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    await stop_event.wait()

    # Cleanup
    print("\nShutting down...")
    broadcast_task.cancel()
    cleanup_task.cancel()
    ping_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    try:
        await ping_task
    except asyncio.CancelledError:
        pass

    await gelf_collector.stop()
    await runner.cleanup()


def main():
    """Main entry point."""
    try:
        asyncio.run(start_server())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
