"""Configure only this disposable Hermes process. No user state is mounted."""
import json
import os
from pathlib import Path
import runpy

state = Path(os.environ["HERMES_HOME"])
os.environ["OPEN_QUAKE_E2E_API_KEY"] = os.environ.get("OPEN_QUAKE_E2E_API_KEY") or "no-key-required"
model = os.environ["OPEN_QUAKE_E2E_MODEL"]
config = {
    "agent": {"max_turns": 1},
    "compression": {"enabled": False},
    "fallback_providers": [],
    "gateway": {"multiplex_profiles": False},
    "mcp_servers": {},
    "memory": {"enabled": False},
    "security": {"allow_lazy_installs": False},
    "plugins": {"enabled": []},
    "model": {"default": model, "provider": "e2e"},
    "platform_toolsets": {"api_server": []},
    "providers": {"e2e": {
        "base_url": os.environ["OPEN_QUAKE_E2E_BASE_URL"],
        "default_model": model,
        "key_env": "OPEN_QUAKE_E2E_API_KEY",
        "api_mode": "chat_completions",
        "request_timeout_seconds": 75,
    }},
    "stt": {"enabled": False},
}
# JSON is a YAML subset; no key is included in the config file.
(state / "config.yaml").write_text(json.dumps(config))
from model_tools import get_tool_definitions
assert get_tool_definitions([]) == [], "Hermes unexpectedly enabled tools"
runpy.run_module("gateway.run", run_name="__main__")
