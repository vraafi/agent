# roblox_telemetry_server.py
import http.server
import json
import os
import urllib.parse

PORT = 5000
LOG_FILE = os.path.join(os.path.dirname(__file__), "output", "roblox_telemetry.json")

class TelemetryHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Print HTTP requests to stdout for rich telemetry tracking
        print(f"[HTTP] {format % args}")


    def do_OPTIONS(self):
        # Support CORS
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "active", "message": "Telemetry server is running."}).encode("utf-8"))
        elif parsed_url.path == "/sync_all":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            lua_sync_code = """game:GetService("HttpService").HttpEnabled = true; print("HttpEnabled is now true!"); local h=game:GetService("HttpService"); local function post(t, m) pcall(function() h:PostAsync("http://localhost:5000/telemetry", h:JSONEncode({type=t, message=m, timestamp=os.time(), details={scriptName="SyncAll"}}), Enum.HttpContentType.ApplicationJson) end) end; post("SYNC_START", "Synchronization started..."); local function u(ip,dp,dt) local s,c=pcall(function() return h:GetAsync("http://localhost:5000/get_script?path="..dp) end) if s and c and c~="File not found." then local p=string.split(ip,".") local o=game:GetService(p[1]) for i=2,#p do local n=o:FindFirstChild(p[i]) if not n then if i==#p then n=Instance.new(dt) else n=Instance.new("Folder") end n.Name=p[i] n.Parent=o end o=n end o.Source=c; print("Synced "..ip); post("SYNC_FILE_SUCCESS", "Successfully synced "..ip) else warn("Fail "..ip); post("SYNC_FILE_FAIL", "Failed to sync "..ip..": "..tostring(c or "Unknown")) end end; u("ServerScriptService.LOBBY_SPACESHIP_1","scratch/Roblox_otomation/src/ServerScriptService/LOBBY_SPACESHIP_1.lua","ModuleScript"); u("ServerScriptService.Main","scratch/Roblox_otomation/src/ServerScriptService/Main.server.lua","Script"); u("ServerScriptService.BuildPhysicalAssets","scratch/Roblox_otomation/src/ServerScriptService/BuildPhysicalAssets.server.lua","Script"); u("ServerScriptService.CombatManager","scratch/Roblox_otomation/src/ServerScriptService/CombatManager.lua","ModuleScript"); u("ServerScriptService.ItemManager","scratch/Roblox_otomation/src/ServerScriptService/ItemManager.lua","ModuleScript"); u("ServerScriptService.PlayerManager","scratch/Roblox_otomation/src/ServerScriptService/PlayerManager.lua","ModuleScript"); u("ServerScriptService.MACRO_BIOME_KALIMANTAN","scratch/Roblox_otomation/src/ServerScriptService/MACRO_BIOME_KALIMANTAN.lua","ModuleScript"); u("ServerScriptService.STREET_LIGHTS_BATCH","scratch/Roblox_otomation/src/ServerScriptService/STREET_LIGHTS_BATCH.lua","ModuleScript"); u("ServerScriptService.FURNITURE_BATCH_1_10","scratch/Roblox_otomation/src/ServerScriptService/FURNITURE_BATCH_1_10.lua","ModuleScript"); u("ServerScriptService.MonsterManager","scratch/Roblox_otomation/src/ServerScriptService/MonsterManager.lua","ModuleScript"); u("ServerScriptService.MONSTERS_BATCH_1_6","scratch/Roblox_otomation/src/ServerScriptService/MONSTERS_BATCH_1_6.lua","ModuleScript"); u("ServerScriptService.MONSTERS_BATCH_7_16","scratch/Roblox_otomation/src/ServerScriptService/MONSTERS_BATCH_7_16.lua","ModuleScript"); u("StarterPlayer.StarterPlayerScripts.CameraSetup","scratch/Roblox_otomation/src/StarterPlayer/StarterPlayerScripts/CameraSetup.client.lua","LocalScript"); u("StarterPlayer.StarterPlayerScripts.InputManager","scratch/Roblox_otomation/src/StarterPlayer/StarterPlayerScripts/InputManager.client.lua","LocalScript"); u("StarterPlayer.StarterPlayerScripts.GUIManager","scratch/Roblox_otomation/src/StarterPlayer/StarterPlayerScripts/GUIManager.client.lua","LocalScript"); u("ReplicatedStorage.Shared.ClientState","scratch/Roblox_otomation/src/ReplicatedStorage/Shared/ClientState.lua","ModuleScript"); post("SYNC_END", "Synchronization complete!")"""
            self.wfile.write(lua_sync_code.encode("utf-8"))
        elif parsed_url.path == "/get_script":
            query_params = urllib.parse.parse_qs(parsed_url.query)
            relative_path = query_params.get("path", [""])[0]
            
            # Prevent directory traversal
            clean_path = os.path.normpath(relative_path).replace("..", "")
            base_dir = os.path.dirname(__file__)
            full_path = os.path.join(base_dir, clean_path)
            
            if os.path.exists(full_path) and os.path.isfile(full_path):
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"File not found.")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/telemetry":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                payload = json.loads(post_data.decode('utf-8'))
                print(f"[Telemetry] Received {payload.get('type')}: {payload.get('message')}")
                
                # Append to JSON log file
                logs = []
                if os.path.exists(LOG_FILE):
                    try:
                        with open(LOG_FILE, "r", encoding="utf-8") as f:
                            logs = json.load(f)
                    except Exception:
                        pass
                
                logs.append(payload)
                # Keep only last 200 logs
                if len(logs) > 200:
                    logs = logs[-200:]
                    
                os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
                with open(LOG_FILE, "w", encoding="utf-8") as f:
                    json.dump(logs, f, indent=4)
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def run():
    print(f"Starting Roblox Telemetry & Sync Server on port {PORT}...")
    server_address = ('', PORT)
    httpd = http.server.HTTPServer(server_address, TelemetryHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping telemetry server...")
        httpd.server_close()

if __name__ == "__main__":
    run()
