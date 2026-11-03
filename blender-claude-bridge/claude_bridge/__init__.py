"""Claude Bridge - lets Claude control Blender through a local socket.

The add-on runs a small TCP server on 127.0.0.1 (localhost only). Each
request is one line of JSON: {"type": "<command>", "params": {...}}.
Each response is one line of JSON: {"status": "ok"|"error", ...}.

Network I/O happens on a background thread; every bpy call happens on
Blender's main thread through bpy.app.timers, because bpy is not thread-safe.
"""

bl_info = {
    "name": "Claude Bridge",
    "author": "Claude Bridge",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D Viewport > Sidebar (N) > Claude",
    "description": "Lets Claude talk to Blender over a local socket (use with the Claude Bridge MCP server)",
    "category": "Interface",
}

import base64
import contextlib
import io
import json
import os
import queue
import socket
import tempfile
import threading
import traceback

import bpy

# --------------------------------------------------------------------------
# Command handlers (always run on the main thread)
# --------------------------------------------------------------------------


def _vec(v):
    return [round(float(x), 4) for x in v]


def cmd_ping(params):
    return {"blender_version": bpy.app.version_string, "file": bpy.data.filepath or "(unsaved)"}


def cmd_get_scene_info(params):
    scene = bpy.context.scene
    limit = int(params.get("limit", 200))
    objects = []
    for obj in list(scene.objects)[:limit]:
        objects.append({
            "name": obj.name,
            "type": obj.type,
            "location": _vec(obj.location),
            "visible": obj.visible_get(),
            "selected": obj.select_get(),
        })
    return {
        "scene": scene.name,
        "frame_current": scene.frame_current,
        "frame_range": [scene.frame_start, scene.frame_end],
        "render_engine": scene.render.engine,
        "object_count": len(scene.objects),
        "objects": objects,
        "active_object": bpy.context.view_layer.objects.active.name
        if bpy.context.view_layer.objects.active else None,
        "materials": [m.name for m in bpy.data.materials],
        "collections": [c.name for c in bpy.data.collections],
    }


def cmd_get_object_info(params):
    name = params.get("name")
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise ValueError(f"No object named {name!r}")
    info = {
        "name": obj.name,
        "type": obj.type,
        "location": _vec(obj.location),
        "rotation_euler": _vec(obj.rotation_euler),
        "scale": _vec(obj.scale),
        "dimensions": _vec(obj.dimensions),
        "parent": obj.parent.name if obj.parent else None,
        "collections": [c.name for c in obj.users_collection],
        "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        "materials": [s.material.name for s in obj.material_slots if s.material],
    }
    if obj.type == "MESH":
        me = obj.data
        info["mesh"] = {"vertices": len(me.vertices), "edges": len(me.edges), "polygons": len(me.polygons)}
    return info


def cmd_execute_python(params):
    """Run arbitrary Python inside Blender and return what it printed."""
    code = params.get("code", "")
    out = io.StringIO()
    namespace = {"bpy": bpy, "__name__": "__claude__"}
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        exec(compile(code, "<claude>", "exec"), namespace)
    result = {"output": out.getvalue()}
    if "result" in namespace:
        try:
            json.dumps(namespace["result"])
            result["result"] = namespace["result"]
        except TypeError:
            result["result"] = repr(namespace["result"])
    return result


def _find_view3d():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                return window, area
    return None, None


def cmd_get_viewport_screenshot(params):
    max_size = int(params.get("max_size", 1024))
    window, area = _find_view3d()
    if area is None:
        raise RuntimeError("No 3D Viewport is open")
    path = os.path.join(tempfile.gettempdir(), "claude_bridge_viewport.png")
    with bpy.context.temp_override(window=window, area=area, screen=window.screen):
        bpy.ops.screen.screenshot_area(filepath=path)
    img = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = img.size
        if max(w, h) > max_size:
            scale = max_size / max(w, h)
            img.scale(max(1, int(w * scale)), max(1, int(h * scale)))
            img.save()
        size = list(img.size)
    finally:
        bpy.data.images.remove(img)
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    os.remove(path)
    return {"format": "png", "width": size[0], "height": size[1], "image_base64": data}


def cmd_render_image(params):
    """Render the active camera and return the image (can be slow)."""
    scene = bpy.context.scene
    if scene.camera is None:
        raise RuntimeError("Scene has no active camera")
    path = params.get("filepath") or os.path.join(tempfile.gettempdir(), "claude_bridge_render.png")
    old_path, old_fmt = scene.render.filepath, scene.render.image_settings.file_format
    try:
        scene.render.filepath = path
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
    finally:
        scene.render.filepath, scene.render.image_settings.file_format = old_path, old_fmt
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return {"format": "png", "filepath": path, "image_base64": data}


COMMANDS = {
    "ping": cmd_ping,
    "get_scene_info": cmd_get_scene_info,
    "get_object_info": cmd_get_object_info,
    "execute_python": cmd_execute_python,
    "get_viewport_screenshot": cmd_get_viewport_screenshot,
    "render_image": cmd_render_image,
}


# --------------------------------------------------------------------------
# Server: socket thread + main-thread job queue
# --------------------------------------------------------------------------

_jobs = queue.Queue()  # (request_dict, reply_holder, done_event)


class _Server:
    def __init__(self):
        self.sock = None
        self.thread = None
        self.running = False
        self.port = None

    def start(self, port):
        if self.running:
            return
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))  # localhost only, never 0.0.0.0
        self.sock.listen(5)
        self.sock.settimeout(1.0)
        self.port = port
        self.running = True
        self.thread = threading.Thread(target=self._accept_loop, daemon=True)
        self.thread.start()
        if not bpy.app.timers.is_registered(_process_jobs):
            bpy.app.timers.register(_process_jobs, persistent=True)
        print(f"[Claude Bridge] Listening on 127.0.0.1:{port}")

    def stop(self):
        self.running = False
        if self.sock:
            with contextlib.suppress(OSError):
                self.sock.close()
        self.sock = None
        if self.thread:
            self.thread.join(timeout=2)
        self.thread = None
        if bpy.app.timers.is_registered(_process_jobs):
            bpy.app.timers.unregister(_process_jobs)
        print("[Claude Bridge] Stopped")

    def _accept_loop(self):
        while self.running:
            try:
                conn, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle_client, args=(conn,), daemon=True).start()

    def _handle_client(self, conn):
        buf = b""
        conn.settimeout(None)
        with conn:
            while self.running:
                try:
                    chunk = conn.recv(65536)
                except OSError:
                    return
                if not chunk:
                    return
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    try:
                        request = json.loads(line)
                    except json.JSONDecodeError as e:
                        reply = {"status": "error", "message": f"Bad JSON: {e}"}
                    else:
                        holder, done = {}, threading.Event()
                        _jobs.put((request, holder, done))
                        done.wait()
                        reply = holder["reply"]
                    try:
                        conn.sendall((json.dumps(reply) + "\n").encode("utf-8"))
                    except OSError:
                        return


def _process_jobs():
    while True:
        try:
            request, holder, done = _jobs.get_nowait()
        except queue.Empty:
            break
        try:
            handler = COMMANDS.get(request.get("type"))
            if handler is None:
                raise ValueError(f"Unknown command {request.get('type')!r}. Known: {sorted(COMMANDS)}")
            holder["reply"] = {"status": "ok", "result": handler(request.get("params") or {})}
        except Exception as e:  # report every failure back to Claude
            holder["reply"] = {"status": "error", "message": str(e), "traceback": traceback.format_exc()}
        finally:
            done.set()
    return 0.05  # poll again in 50 ms


_server = _Server()


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------


class ClaudeBridgePreferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    port: bpy.props.IntProperty(name="Port", default=9876, min=1024, max=65535)
    auto_start: bpy.props.BoolProperty(name="Start server when Blender opens", default=False)

    def draw(self, context):
        self.layout.prop(self, "port")
        self.layout.prop(self, "auto_start")


def _prefs():
    return bpy.context.preferences.addons[__name__].preferences


class CLAUDEBRIDGE_OT_start(bpy.types.Operator):
    bl_idname = "claude_bridge.start"
    bl_label = "Start Claude Bridge"

    def execute(self, context):
        try:
            _server.start(_prefs().port)
        except OSError as e:
            self.report({"ERROR"}, f"Could not start: {e}")
            return {"CANCELLED"}
        return {"FINISHED"}


class CLAUDEBRIDGE_OT_stop(bpy.types.Operator):
    bl_idname = "claude_bridge.stop"
    bl_label = "Stop Claude Bridge"

    def execute(self, context):
        _server.stop()
        return {"FINISHED"}


class CLAUDEBRIDGE_PT_panel(bpy.types.Panel):
    bl_label = "Claude Bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Claude"

    def draw(self, context):
        layout = self.layout
        if _server.running:
            layout.label(text=f"Running on port {_server.port}", icon="CHECKMARK")
            layout.operator("claude_bridge.stop", icon="CANCEL")
        else:
            layout.label(text="Stopped", icon="X")
            layout.prop(_prefs(), "port")
            layout.operator("claude_bridge.start", icon="PLAY")


_classes = (ClaudeBridgePreferences, CLAUDEBRIDGE_OT_start, CLAUDEBRIDGE_OT_stop, CLAUDEBRIDGE_PT_panel)


def _auto_start():
    with contextlib.suppress(Exception):
        if _prefs().auto_start:
            _server.start(_prefs().port)
    return None


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    bpy.app.timers.register(_auto_start, first_interval=1.0)


def unregister():
    _server.stop()
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
