"""Load env.txt and expose typed constants."""
import os
import sys
from pathlib import Path

# When frozen by PyInstaller, load env.txt from beside the .exe so the API key
# stays editable and is never embedded in the binary. Otherwise use the source
# directory.
if getattr(sys, "frozen", False):
    _ENV_PATH = Path(sys.executable).parent / "env.txt"
else:
    _ENV_PATH = Path(__file__).parent / "env.txt"


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_env(_ENV_PATH)

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL: str      = os.getenv("LLM_MODEL", "gpt-4o")
LLM_BASE_URL: str   = os.getenv("LLM_BASE_URL", "")
