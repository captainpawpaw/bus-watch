"""MCP server that connects Claude to the Claude Bridge Blender add-on.

Run by Claude Desktop or Claude Code (stdio transport). It forwards each
tool call to Blender over a local socket (default 127.0.0.1:9876).

Env vars: BLENDER_HOST (default 127.0.0.1), BLENDER_PORT (default 9876).
"""

import base64
import json
import os
import socket

try:  # MCP Python SDK 2.x
    from mcp.server.mcpserver import Image, MCPServer as FastMCP
except ImportError:  # MCP Python SDK 1.x
    from mcp.server.fastmcp import FastMCP, Image

HOST = os.environ.get("BLENDER_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENDER_PORT", "9876"))
TIMEOUT = float(os.environ.get("BLENDER_TIMEOUT", "300"))

mcp = FastMCP(
    "blender",
    instructions=(
        "Controls a running Blender instance. Start with get_scene_info. "
        "Use execute_python for anything else: it runs Python with `bpy` "
        "available, returns printed output, and returns a variable named "
        "`result` if you set one. Check your work with get_viewport_screenshot."
    ),
)


def send(command: str, params: dict | None = None) -> dict:
    try:
        with socket.create_connection((HOST, PORT), timeout=10) as s:
            s.settimeout(TIMEOUT)
            s.sendall((json.dumps({"type": command, "params": params or {}}) + "\n").encode("utf-8"))
            buf = b""
            while b"\n" not in buf:
                chunk = s.recv(1 << 20)
                if not chunk:
                    break
                buf += chunk
    except ConnectionRefusedError:
        raise RuntimeError(
            f"Blender is not listening on {HOST}:{PORT}. In Blender, press N in the 3D Viewport, "
            "open the 'Claude' tab and click 'Start Claude Bridge'."
        )
    reply = json.loads(buf.split(b"\n", 1)[0])
    if reply.get("status") != "ok":
        raise RuntimeError(f"{reply.get('message')}\n{reply.get('traceback', '')}")
    return reply["result"]


@mcp.tool()
def get_scene_info(limit: int = 200) -> str:
    """Summarise the current Blender scene: objects, materials, collections, frame range."""
    return json.dumps(send("get_scene_info", {"limit": limit}), indent=2)


@mcp.tool()
def get_object_info(name: str) -> str:
    """Detailed info about one object: transform, dimensions, modifiers, materials, mesh stats."""
    return json.dumps(send("get_object_info", {"name": name}), indent=2)


@mcp.tool()
def execute_python(code: str) -> str:
    """Run Python code inside Blender (bpy is pre-imported).

    Printed output is returned. Assign to a variable named `result` to return a value.
    Example: bpy.ops.mesh.primitive_cube_add(location=(0, 0, 1))
    """
    return json.dumps(send("execute_python", {"code": code}), indent=2)


@mcp.tool()
def get_viewport_screenshot(max_size: int = 1024) -> Image:
    """Take a screenshot of the 3D Viewport so you can see the scene."""
    r = send("get_viewport_screenshot", {"max_size": max_size})
    return Image(data=base64.b64decode(r["image_base64"]), format="png")


@mcp.tool()
def render_image() -> Image:
    """Render the scene from the active camera (may take a while) and return the image."""
    r = send("render_image")
    return Image(data=base64.b64decode(r["image_base64"]), format="png")


def main():
    mcp.run()


if __name__ == "__main__":
    main()
