"""Configure only this disposable Hermes process. No user state is mounted."""
import json
import os
from pathlib import Path
import runpy

state = Path(os.environ["HERMES_HOME"])
profile = json.loads(Path("/run/secrets/production_provider").read_text())
# Hermes' production custom-provider adapter resolves key_env. This variable
# is process-local, sourced only from the native owner's private snapshot.
os.environ["OPEN_QUAKE_SAVED_PROFILE_KEY"] = profile["apiKey"]
model = profile["model"]
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
        "base_url": profile["baseURL"],
        "default_model": model,
        "key_env": "OPEN_QUAKE_SAVED_PROFILE_KEY",
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
