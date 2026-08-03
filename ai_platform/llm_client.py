"""
Cliente LLM unificado — OpenAI, Anthropic, Ollama, mock (CI sin keys).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

ROOT_ENV = os.environ


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    mock: bool = False


def _mode() -> str:
    return ROOT_ENV.get("AURIXA_LLM_MODE", "auto").lower()


def _ollama_generate(prompt: str, model: str) -> str | None:
    url = ROOT_ENV.get("OLLAMA_URL", "http://localhost:11434").rstrip("/") + "/api/generate"
    payload = json.dumps({"model": model or "tinyllama", "prompt": prompt, "stream": False}).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def _openai_chat(prompt: str, model: str) -> str | None:
    key = ROOT_ENV.get("OPENAI_API_KEY")
    if not key:
        return None
    url = ROOT_ENV.get("OPENAI_BASE_URL", "https://api.openai.com/v1/chat/completions")
    body = {
        "model": model or "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            return data["choices"][0]["message"]["content"]
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError):
        return None


def _anthropic_chat(prompt: str, model: str) -> str | None:
    key = ROOT_ENV.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    url = "https://api.anthropic.com/v1/messages"
    body = {
        "model": model or "claude-3-5-sonnet-20241022",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            return data["content"][0]["text"]
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError):
        return None


def _mock_response(prompt: str, model: str) -> str:
    return (
        f"[Beemetry mock LLM — model={model}]\n"
        "Respuesta simulada para CI/desarrollo sin API keys.\n"
        "Configure OPENAI_API_KEY, ANTHROPIC_API_KEY u OLLAMA_URL para generación real.\n\n"
        f"Prompt recibido ({len(prompt)} chars): {prompt[:400]}..."
    )


def resolve_provider(model: str) -> str:
    m = model.lower()
    if "claude" in m:
        return "anthropic"
    if "gpt" in m or "codex" in m or "cursor" in m:
        return "openai"
    if "gemini" in m or "deepseek" in m:
        return "openai"  # via compatible endpoint if configured
    if "ollama" in m or m in ("tinyllama", "llama"):
        return "ollama"
    return "openai"


def complete(prompt: str, model: str = "gpt-4o-mini", provider: str | None = None) -> LLMResponse:
    mode = _mode()
    if mode == "mock":
        return LLMResponse(text=_mock_response(prompt, model), provider="mock", model=model, mock=True)

    prov = provider or resolve_provider(model)
    text: str | None = None

    if prov == "anthropic":
        text = _anthropic_chat(prompt, model)
    elif prov == "ollama":
        text = _ollama_generate(prompt, model)
    else:
        text = _openai_chat(prompt, model)

    if text is None and mode == "auto":
        text = _ollama_generate(prompt, "tinyllama")
        if text:
            return LLMResponse(text=text, provider="ollama", model="tinyllama")

    if text is None:
        return LLMResponse(text=_mock_response(prompt, model), provider="mock", model=model, mock=True)

    return LLMResponse(text=text, provider=prov, model=model)
