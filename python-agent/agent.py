#!/usr/bin/env python3
"""Mimo Agent — zero-config.

Talks to OpenCode Zen (mimo-v2.5-free, api key "public") through the local
zen-tor-proxy. If the proxy is not already running, it is built and started
automatically. No configuration required.

Usage:
  python agent.py "what time is it and what is 17*23?"
  python agent.py                     # interactive
  python agent.py --model gpt-5.6-luna "hello"
"""

from __future__ import annotations

import argparse
import ast
import datetime
import json
import operator
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from openai import OpenAI

PROXY_PORT = int(os.environ.get("ZEN_PROXY_PORT", "5678"))
PROXY_BASE_URL = f"http://127.0.0.1:{PROXY_PORT}/v1"
API_KEY = "public"
DEFAULT_MODEL = "mimo-v2.5-free"
MAX_TURNS = 10

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current date and time (local and UTC).",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a numeric math expression safely (+, -, *, /, //, %, **, parentheses).",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "The math expression to evaluate, e.g. '17 * 23'.",
                    }
                },
                "required": ["expression"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_system_info",
            "description": "Get information about the machine running the agent (OS, CPU, Python, hostname).",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    },
]

SYSTEM_PROMPT = (
    "You are Mimo, a helpful agent. Use the provided tools when they help answer "
    "the user. Reason carefully, then give a concise answer."
)


class Style:
    DIM = "\x1b[2m"
    ITALIC = "\x1b[3m"
    DIM_YELLOW = "\x1b[2;33m"
    CYAN = "\x1b[36m"
    GREEN = "\x1b[32m"
    BOLD = "\x1b[1m"
    RED = "\x1b[31m"
    RESET = "\x1b[0m"

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def _wrap(self, text: str, code: str) -> str:
        if not self.enabled or not text:
            return text
        return f"{code}{text}{self.RESET}"

    def thinking(self, text: str, end: str = "\n") -> None:
        sys.stdout.write(self._wrap(text, self.DIM_YELLOW + self.ITALIC) + end)
        sys.stdout.flush()

    def answer(self, text: str, end: str = "") -> None:
        sys.stdout.write(text + end)
        sys.stdout.flush()

    def tool_call(self, name: str, arguments: str) -> None:
        print()
        print(self._wrap(f"⚡ tool: {name}", self.CYAN + self.BOLD))
        if arguments:
            print(self._wrap(arguments, self.DIM))

    def tool_result(self, summary: str) -> None:
        print(self._wrap(f"↳ {summary}", self.DIM))
        print()

    def error(self, message: str) -> None:
        print(self._wrap(f"✗ {message}", self.RED), file=sys.stderr)


def extra_field(delta: Any, name: str) -> Any:
    value = getattr(delta, name, None)
    if value is not None:
        return value
    model_extra = getattr(delta, "model_extra", None) or {}
    return model_extra.get(name)


_SAFE_BINOPS: dict[type[ast.operator], Any] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_SAFE_CONSTANTS: dict[str, float] = {
    "pi": 3.141592653589793,
    "e": 2.718281828459045,
    "tau": 6.283185307179586,
}


def _eval_node(node: ast.AST) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError(f"unsupported constant: {node.value!r}")
    if isinstance(node, ast.BinOp):
        op = _SAFE_BINOPS.get(type(node.op))
        if op is None:
            raise ValueError(f"unsupported operator: {type(node.op).__name__}")
        return op(_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, ast.USub):
            return -_eval_node(node.operand)
        if isinstance(node.op, ast.UAdd):
            return +_eval_node(node.operand)
        raise ValueError(f"unsupported operator: {type(node.op).__name__}")
    if isinstance(node, ast.Name):
        if node.id in _SAFE_CONSTANTS:
            return _SAFE_CONSTANTS[node.id]
        raise ValueError(f"unknown name: {node.id}")
    raise ValueError(f"unsupported expression node: {type(node).__name__}")


def execute_tool(name: str, raw_arguments: str) -> str:
    try:
        arguments = json.loads(raw_arguments) if raw_arguments.strip() else {}
    except json.JSONDecodeError:
        return json.dumps({"error": "invalid tool arguments JSON"})

    if name == "get_current_time":
        now = datetime.datetime.now()
        return json.dumps(
            {
                "local": now.isoformat(timespec="seconds"),
                "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "weekday": now.strftime("%A"),
            },
            ensure_ascii=False,
        )

    if name == "calculate":
        expression = arguments.get("expression")
        if not isinstance(expression, str):
            return json.dumps({"error": "missing 'expression' string argument"})
        try:
            tree = ast.parse(expression, mode="eval")
            result = _eval_node(tree)
            return json.dumps({"expression": expression, "result": result})
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"expression": expression, "error": str(exc)})

    if name == "get_system_info":
        return json.dumps(
            {
                "platform": platform.platform(),
                "machine": platform.machine(),
                "processor": platform.processor(),
                "python": platform.python_version(),
                "cpu_count": os.cpu_count(),
                "hostname": socket.gethostname(),
            },
            ensure_ascii=False,
        )

    return json.dumps({"error": f"unknown tool: {name}"})


def build_assistant_message(
    content: list[str], tool_calls: dict[int, dict[str, str]]
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant"}
    if content:
        message["content"] = "".join(content)
    else:
        message["content"] = None
    if tool_calls:
        calls = [
            {
                "id": entry["id"],
                "type": "function",
                "function": {
                    "name": entry["name"],
                    "arguments": entry["arguments"],
                },
            }
            for _, entry in sorted(tool_calls.items())
        ]
        message["tool_calls"] = calls
    return message


def stream_turn(
    client: OpenAI, model: str, messages: list[dict[str, Any]], style: Style
) -> tuple[list[str], dict[int, dict[str, str]]]:
    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=TOOLS,
        stream=True,
        stream_options={"include_usage": True},
    )

    content: list[str] = []
    tool_calls: dict[int, dict[str, str]] = {}
    saw_reasoning = False
    saw_content = False

    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue

        reasoning = extra_field(delta, "reasoning")
        if reasoning:
            if not saw_reasoning:
                style.thinking("…", end="\n")
                saw_reasoning = True
            style.thinking(reasoning, end="")

        text = getattr(delta, "content", None)
        if text:
            if saw_reasoning and not saw_content:
                print()
            saw_content = True
            style.answer(text)

        for call in delta.tool_calls or []:
            entry = tool_calls.setdefault(call.index, {"id": "", "name": "", "arguments": ""})
            if call.id:
                entry["id"] = call.id
            if call.function and call.function.name:
                entry["name"] = call.function.name
            if call.function and call.function.arguments:
                entry["arguments"] += call.function.arguments

    if saw_reasoning:
        print()
    return content, tool_calls


def plain_turn(
    client: OpenAI, model: str, messages: list[dict[str, Any]], style: Style
) -> tuple[list[str], dict[int, dict[str, str]]]:
    completion = client.chat.completions.create(
        model=model,
        messages=messages,
        tools=TOOLS,
        stream=False,
    )
    message = completion.choices[0].message

    reasoning = extra_field(message, "reasoning") or extra_field(message, "reasoning_content")
    if reasoning:
        style.thinking(str(reasoning))
        print()

    content = message.content or ""
    if content:
        style.answer(content)
        print()

    tool_calls: dict[int, dict[str, str]] = {}
    for index, call in enumerate(message.tool_calls or []):
        tool_calls[getattr(call, "index", index)] = {
            "id": call.id,
            "name": call.function.name,
            "arguments": call.function.arguments,
        }
    return [content], tool_calls


def run_agent(
    client: OpenAI, model: str, style: Style, user_prompt: str, streaming: bool = True
) -> None:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    for turn in range(MAX_TURNS):
        if streaming:
            content, tool_calls = stream_turn(client, model, messages, style)
        else:
            content, tool_calls = plain_turn(client, model, messages, style)

        if not tool_calls:
            if content:
                print()
            return

        messages.append(build_assistant_message(content, tool_calls))

        for _, call in sorted(tool_calls.items()):
            if not call["name"]:
                continue
            style.tool_call(call["name"], call["arguments"])
            started = time.perf_counter()
            result = execute_tool(call["name"], call["arguments"])
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            style.tool_result(f"{len(result)} bytes · {elapsed_ms} ms")
            messages.append(
                {"role": "tool", "tool_call_id": call["id"], "content": result}
            )

    style.error(f"reached {MAX_TURNS} tool turns without a final answer")


def health_ok(timeout: float = 2.0) -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(f"http://127.0.0.1:{PROXY_PORT}/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def ensure_build(root: Path) -> None:
    if (root / "dist" / "index.js").exists():
        return
    if not (root / "node_modules").exists():
        _run(["npm", "install"], root, 600)
    _run(["npm", "run", "build"], root, 300)


def _run(command: list[str], cwd: Path, timeout: int) -> None:
    if shutil.which(command[0]) is None:
        raise SystemExit(f"'{command[0]}' was not found on PATH")
    subprocess.run(command, cwd=cwd, timeout=timeout, check=True, capture_output=True)


def start_proxy_if_needed(style: Style) -> subprocess.Popen | None:
    if health_ok():
        style.tool_result("proxy already running — reusing it")
        return None

    root = repo_root()
    if shutil.which("node") is None:
        raise SystemExit("node.js is required to auto-start the proxy")
    style.answer("proxy not running — auto-starting it (first run installs Tor, may take a minute)\n")
    ensure_build(root)

    log_dir = root / "data"
    log_dir.mkdir(exist_ok=True)
    log_path = log_dir / "auto-proxy.log"
    log_handle = open(log_path, "a", encoding="utf-8")

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(
        ["node", "dist/index.js"],
        cwd=str(root),
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        creationflags=flags,
        start_new_session=os.name != "nt",
    )

    deadline = time.time() + 220
    last_tail = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            log_handle.flush()
            raise SystemExit(f"proxy exited during startup — see {log_path}")
        if health_ok(timeout=1.0):
            style.tool_result("proxy is ready (Tor exit IP active)")
            return proc
        time.sleep(2)
        tail = _log_tail(log_path)
        if tail and tail != last_tail:
            last_tail = tail
            style.thinking(tail[:200], end="\n")

    log_handle.flush()
    raise SystemExit(f"proxy did not become ready in 220s — see {log_path}")


def _log_tail(log_path: Path) -> str:
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
        return lines[-1].strip() if lines else ""
    except OSError:
        return ""


def kill_proxy(proc: subprocess.Popen | None, style: Style) -> None:
    if proc is None or proc.poll() is not None:
        return
    style.tool_result("stopping auto-started proxy")
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/pid", str(proc.pid), "/T", "/F"], capture_output=True
        )
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            proc.terminate()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Mimo agent over Zen (zero-config)")
    parser.add_argument("prompt", nargs="*", help="one-shot prompt (omit for interactive REPL)")
    parser.add_argument("--model", default=os.environ.get("ZEN_MODEL", DEFAULT_MODEL))
    parser.add_argument("--no-stream", action="store_true", help="disable streaming")
    parser.add_argument("--no-color", action="store_true", help="disable ANSI colors")
    args = parser.parse_args()

    color = not args.no_color and sys.stdout.isatty()
    style = Style(color)

    proxy_proc: subprocess.Popen | None = None
    try:
        proxy_proc = start_proxy_if_needed(style)
        client = OpenAI(base_url=PROXY_BASE_URL, api_key=API_KEY)
        print(style._wrap(f"mimo agent · model {args.model} · api key {API_KEY!r}", style.BOLD))
        print(
            style._wrap(
                f"base_url {PROXY_BASE_URL} · streaming={not args.no_stream}",
                style.DIM,
            )
        )

        if args.prompt:
            run_agent(client, args.model, style, " ".join(args.prompt), streaming=not args.no_stream)
            return

        print(style._wrap("interactive · type your prompt, Ctrl+C / Ctrl+D to exit", style.DIM))
        while True:
            try:
                prompt = input(style._wrap("you > ", style.GREEN + style.BOLD))
            except (EOFError, KeyboardInterrupt):
                print()
                break
            prompt = prompt.strip()
            if not prompt:
                continue
            if prompt.lower() in ("exit", "quit"):
                break
            try:
                run_agent(client, args.model, style, prompt, streaming=not args.no_stream)
            except KeyboardInterrupt:
                style.error("interrupted")
            except Exception as exc:  # noqa: BLE001
                style.error(f"{type(exc).__name__}: {exc}")
            print()
    finally:
        kill_proxy(proxy_proc, style)


if __name__ == "__main__":
    main()
