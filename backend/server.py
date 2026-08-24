"""
StockLens backend proxy.

This FastAPI app is the entrypoint required by supervisor (uvicorn on :8001).
It spawns the actual Express + TypeScript research engine as a child process
on port 8002 and proxies every /api/* request to it.

The existing research engine lives in /app/artifacts/api-server and preserves
the Supabase connection, annual-report ingestion, retrieval, AI integration,
research framework/checklist, and multi-agent orchestration.
"""

import asyncio
import os
import signal
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.background import BackgroundTask

load_dotenv()

NODE_BACKEND_DIR = Path("/app/artifacts/api-server")
NODE_BACKEND_PORT = int(os.environ.get("NODE_BACKEND_PORT", "8002"))
NODE_BACKEND_URL = f"http://127.0.0.1:{NODE_BACKEND_PORT}"

# Env vars the Node backend needs
NODE_ENV_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "OPENAI_API_KEY",
    "SESSION_SECRET",
    "LOG_LEVEL",
)

_node_process: subprocess.Popen | None = None


def _load_node_env() -> dict[str, str]:
    """Load env for the Node child. Reads /app/artifacts/api-server/.env first."""
    env: dict[str, str] = {**os.environ}
    env_file = NODE_BACKEND_DIR / ".env"
    if env_file.exists():
        for raw in env_file.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    env["PORT"] = str(NODE_BACKEND_PORT)
    env["NODE_ENV"] = env.get("NODE_ENV", "production")
    return env


def _start_node_backend() -> None:
    """Spawn the compiled Node backend as a child process."""
    global _node_process
    if _node_process and _node_process.poll() is None:
        return

    dist_file = NODE_BACKEND_DIR / "dist" / "index.mjs"
    if not dist_file.exists():
        # Build if missing
        subprocess.run(
            ["pnpm", "run", "build"],
            cwd=str(NODE_BACKEND_DIR),
            env=_load_node_env(),
            check=True,
        )

    _node_process = subprocess.Popen(
        ["node", "--enable-source-maps", str(dist_file)],
        cwd=str(NODE_BACKEND_DIR),
        env=_load_node_env(),
        stdout=open("/var/log/supervisor/node.out.log", "ab"),
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )


def _stop_node_backend() -> None:
    global _node_process
    if _node_process and _node_process.poll() is None:
        try:
            os.killpg(os.getpgid(_node_process.pid), signal.SIGTERM)
            _node_process.wait(timeout=10)
        except Exception:
            try:
                os.killpg(os.getpgid(_node_process.pid), signal.SIGKILL)
            except Exception:
                pass
    _node_process = None


async def _wait_for_node_ready(timeout_s: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout_s
    async with httpx.AsyncClient(timeout=2.0) as client:
        while time.monotonic() < deadline:
            try:
                r = await client.get(f"{NODE_BACKEND_URL}/api/healthz")
                if r.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
    return False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _start_node_backend()
    await _wait_for_node_ready()
    try:
        yield
    finally:
        _stop_node_backend()


app = FastAPI(title="StockLens Proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Long-lived client for proxying (per-request stream)
_client = httpx.AsyncClient(
    base_url=NODE_BACKEND_URL,
    timeout=httpx.Timeout(600.0, connect=10.0),
)


@app.get("/api/proxy-health")
async def proxy_health():
    running = _node_process is not None and _node_process.poll() is None
    return {"proxy": "ok", "node_running": running, "node_url": NODE_BACKEND_URL}


async def _proxy(request: Request, path: str) -> Response:
    # Ensure Node is up (auto-restart if it died)
    if not (_node_process and _node_process.poll() is None):
        _start_node_backend()
        await _wait_for_node_ready()

    # Build target URL
    url = f"/api/{path}" if path else "/api"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    headers = {k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}}
    body = await request.body()

    try:
        req = _client.build_request(
            method=request.method,
            url=url,
            headers=headers,
            content=body,
        )
        r = await _client.send(req, stream=True)
    except httpx.RequestError as exc:
        return Response(
            content=f'{{"error":"upstream_unavailable","detail":{repr(str(exc))}}}',
            status_code=502,
            media_type="application/json",
        )

    resp_headers = {
        k: v
        for k, v in r.headers.items()
        if k.lower() not in {"content-encoding", "transfer-encoding", "connection"}
    }

    return Response(
        content=await r.aread(),
        status_code=r.status_code,
        headers=resp_headers,
        background=BackgroundTask(r.aclose),
    )


@app.api_route("/api", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_root(request: Request):
    return await _proxy(request, "")


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def proxy_all(path: str, request: Request):
    return await _proxy(request, path)
