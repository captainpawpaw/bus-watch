# Claude Bridge for Blender (Windows)

Talk to Blender directly from Claude. Ask things like *"add a low-poly tree next to the cube"*,
*"make all the materials red"* or *"show me the viewport"*, and Claude runs them in your open Blender.

```
Claude Desktop / Claude Code ──stdio──▶ blender_mcp_server.py ──TCP 127.0.0.1:9876──▶ Claude Bridge add-on (inside Blender)
```

## What Claude can do

| Tool | What it does |
|---|---|
| `get_scene_info` | Lists objects, materials, collections and the frame range |
| `get_object_info` | Gives details on one object: transform, modifiers, materials, mesh stats |
| `execute_python` | Runs any `bpy` Python code in Blender (this does almost everything) |
| `get_viewport_screenshot` | Lets Claude *see* the 3D viewport |
| `render_image` | Renders from the active camera and returns the image |

## Setup (about 5 minutes)

### 1. Install the add-on in Blender (3.6 or newer)
1. Blender → **Edit → Preferences → Add-ons**
2. Click the dropdown arrow (top right) → **Install from Disk…** (in Blender 3.x it's the **Install…** button)
3. Choose `claude_bridge.zip` and tick the checkbox to enable **Claude Bridge**
4. In the 3D Viewport press **N** → open the **Claude** tab → click **Start Claude Bridge**
   - Tip: in the add-on preferences, tick *Start server when Blender opens*

### 2. Install Python and the MCP package
Open **PowerShell**:
```powershell
winget install Python.Python.3.12      # skip this if you already have Python 3.10+
py -m pip install "mcp[cli]"
```
Copy the `mcp_server` folder somewhere permanent, for example `C:\Tools\blender-claude-bridge\mcp_server`.

### 3. Connect Claude

**Claude Desktop:** open **Settings → Developer → Edit Config** (this opens
`%APPDATA%\Claude\claude_desktop_config.json`) and add:
```json
{
  "mcpServers": {
    "blender": {
      "command": "py",
      "args": ["C:\\Tools\\blender-claude-bridge\\mcp_server\\blender_mcp_server.py"]
    }
  }
}
```
Then restart Claude Desktop fully (close it from the system tray icon too).

**Claude Code:**
```powershell
claude mcp add blender -- py C:\Tools\blender-claude-bridge\mcp_server\blender_mcp_server.py
```

### 4. Try it
With Blender open and the bridge started, ask Claude: *"What's in my Blender scene?"*

## Settings
- Port: change it in the add-on preferences, and set `"env": {"BLENDER_PORT": "9877"}` in the Claude config to match.
- `BLENDER_TIMEOUT` (seconds, default 300): how long to wait for slow commands such as renders.

## Troubleshooting
- **"Blender is not listening"**: click *Start Claude Bridge* in the N panel → Claude tab.
- **The tools don't appear in Claude Desktop**: check that the path in the config uses `\\`, then restart Claude fully.
  Logs are in `%APPDATA%\Claude\logs\mcp-server-blender.log`.
- **`py` isn't found**: use the full path to `python.exe` as `"command"`.
- **Windows Firewall prompt**: you can choose *Cancel*. The bridge only listens on `127.0.0.1`, so it never needs network access.

## Security
`execute_python` runs whatever code Claude sends, with your user's permissions. The server only accepts
connections from this computer (`127.0.0.1`), and it only runs while you have it started. Stop it when you're done.
Claude Desktop asks you to approve tool calls unless you've allowed them permanently.
