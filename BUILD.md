# Build: standalone `web_playground.exe`

How to package the FastAPI server ([serve.py](serve.py)) into a single Windows
executable that runs without Python, a venv, or VSCode.

The build uses **PyInstaller** in one-file mode. `prompts/` and `env.txt` are
**not** embedded — they stay editable beside the exe (see
[Why files stay external](#why-prompts-and-envtxt-stay-external)).

## Prerequisites

- Windows (the exe is OS + CPU-arch specific — build on the target platform).
- The project venv at `.venv\` with dependencies installed
  (`requirements.txt`).
- PyInstaller installed into that venv:

  ```powershell
  .venv\Scripts\python.exe -m pip install pyinstaller
  ```

## Build steps

1. From the project root, run PyInstaller:

   ```powershell
   .venv\Scripts\python.exe -m PyInstaller --onefile --name web_playground `
     --collect-submodules uvicorn `
     --hidden-import=ai --hidden-import=llm_client --hidden-import=config `
     serve.py
   ```

   - `--onefile` — produce a single `.exe`.
   - `--collect-submodules uvicorn` — pull in uvicorn's dynamically-loaded
     submodules (loggers, protocols) so the server starts cleanly.
   - `--hidden-import=...` — our local modules, imported indirectly.

   Output: `dist\web_playground.exe`.

2. Copy the runtime files beside the exe (they are loaded from the exe's own
   directory, not embedded):

   ```powershell
   Copy-Item env.txt dist\
   Copy-Item -Recurse prompts dist\
   ```

3. The distributable `dist\` folder now looks like:

   ```
   dist/
   ├── web_playground.exe   the executable
   ├── env.txt              API key / model config (edit this)
   └── prompts/             prompt templates (edit these)
   ```

## Run

```powershell
# default: http://127.0.0.1:8766
.\dist\web_playground.exe

# custom port / host
.\dist\web_playground.exe --port 8799 --host 0.0.0.0
```

Verify it works:

```powershell
# in another terminal, with the server running
curl http://127.0.0.1:8766/api/health   # -> {"status":"ok"}
```

## Distribute

Ship the **entire `dist\` folder** (exe + `env.txt` + `prompts/`). The recipient
edits `env.txt` with their own `OPENAI_API_KEY` and runs the exe. No Python
install required.

## Why `prompts/` and `env.txt` stay external

When PyInstaller freezes the app, [config.py](config.py) and [ai.py](ai.py)
detect frozen mode (`sys.frozen`) and load these from the **exe's directory**
(`Path(sys.executable).parent`) instead of the source tree:

- `env.txt` — keeps your OpenAI API key **out of the binary** and editable.
- `prompts/` — lets you tweak prompt wording **without rebuilding**.

If you add a new prompt file (e.g. `grammar.system.txt`), just drop it into
`dist\prompts\` — no rebuild needed.

## Rebuild after code changes

Re-run the build command in [Build steps](#build-steps). To force a fully clean
build, delete the intermediates first:

```powershell
Remove-Item -Recurse -Force build, dist, web_playground.spec
```

- `build\` — PyInstaller work dir, regenerated every build (safe to delete).
- `web_playground.spec` — generated build recipe; keep it if you want to edit
  build options and run `pyinstaller web_playground.spec` directly, otherwise
  it is recreated by the command above.

## Troubleshooting

- **`ModuleNotFoundError` at startup** — a dynamically-imported module was
  missed; add `--hidden-import=<module>` and rebuild.
- **Server starts but `/api/define` errors** — check `env.txt` is present beside
  the exe and contains a valid `OPENAI_API_KEY`.
- **`prompts/...` not found** — ensure the `prompts\` folder sits next to the
  exe (step 2), not only in the source tree.
- **Antivirus flags the exe** — PyInstaller one-file binaries are sometimes
  false-positived; the unpacked `build\` artifacts and source remain available
  for inspection.
