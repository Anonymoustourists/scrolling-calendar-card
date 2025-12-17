#!/usr/bin/env python3

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
import yaml


@dataclass(frozen=True)
class CalendarConfig:
    entity_id: str
    instruction: str


def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_slug(value: str, max_len: int = 80) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    if not value:
        value = "event"
    return value[:max_len]


def _event_start_iso(event: Dict[str, Any]) -> str:
    start = event.get("start") or {}
    return start.get("dateTime") or start.get("date") or ""


def _event_uid(event: Dict[str, Any]) -> str:
    # Different calendar providers expose different identifiers.
    for key in ("uid", "recurring_event_id", "recurrence_id", "id"):
        if event.get(key):
            return str(event[key])
    return ""


def _event_key_fallback(calendar_entity_id: str, event: Dict[str, Any]) -> str:
    # Used if uid is missing.
    # IMPORTANT: this is a direct composite key so the Lovelace card can look it up without hashing.
    summary = str(event.get("summary") or "")
    start = _event_start_iso(event)
    return f"{calendar_entity_id}|{summary}|{start}"


def _fallback_hash(fallback_key: str) -> str:
    return hashlib.sha256(fallback_key.encode("utf-8")).hexdigest()


def _load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _ha_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _fetch_events(
    base_url: str,
    token: str,
    calendar_entity_id: str,
    start_iso: str,
    end_iso: str,
    timeout_s: int = 30,
) -> List[Dict[str, Any]]:
    url = f"{base_url}/api/calendars/{calendar_entity_id}"
    params = {"start": start_iso, "end": end_iso}
    resp = requests.get(url, headers=_ha_headers(token), params=params, timeout=timeout_s)
    resp.raise_for_status()
    events = resp.json()
    if not isinstance(events, list):
        return []
    # annotate with source calendar
    for e in events:
        e["calendarEntityId"] = calendar_entity_id
    return events


def _openai_headers(api_key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _chat_build_image_prompt(
    api_key: str,
    model: str,
    event_summary: str,
    start_iso: str,
    calendar_entity_id: str,
    general_instruction: str,
    calendar_instruction: str,
    timeout_s: int = 60,
) -> str:
    # Uses the classic Chat Completions API for simplicity.
    # If your account is configured for the Responses API instead, adapt here.
    url = "https://api.openai.com/v1/chat/completions"
    sys_prompt = (
        "You are an expert prompt engineer for image generation. "
        "Return ONLY a single image prompt (no quotes, no markdown)."
    )
    user_prompt = (
        f"Event summary: {event_summary}\n"
        f"Event start: {start_iso}\n"
        f"Calendar: {calendar_entity_id}\n\n"
        f"General instruction:\n{general_instruction}\n\n"
        f"Calendar-specific instruction:\n{calendar_instruction}\n\n"
        "Write a concise image prompt for a dashboard card illustration. "
        "No text in the image."
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
    }

    resp = requests.post(url, headers=_openai_headers(api_key), json=payload, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        raise RuntimeError(f"Unexpected chat response shape: {e}; response={data}")


def _openai_generate_image_base64(
    api_key: str,
    model: str,
    prompt: str,
    size: str = "1024x1024",
    timeout_s: int = 120,
) -> bytes:
    # Classic Images API (generations). Many accounts still support it.
    url = "https://api.openai.com/v1/images/generations"
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "response_format": "b64_json",
    }
    resp = requests.post(url, headers=_openai_headers(api_key), json=payload, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    try:
        b64 = data["data"][0]["b64_json"]
        return base64.b64decode(b64)
    except Exception as e:
        raise RuntimeError(f"Unexpected image response shape: {e}; response={data}")


def _read_map_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"version": 1, "generated_at": _utc_now_iso(), "by_uid": {}, "by_fallback": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "generated_at": _utc_now_iso(), "by_uid": {}, "by_fallback": {}}


def _write_map_file(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _render_default_prompt(
    event_summary: str,
    start_iso: str,
    calendar_entity_id: str,
    general_instruction: str,
    calendar_instruction: str,
) -> str:
    # Simple fallback when chat prompt building is disabled.
    return (
        f"Illustration for event '{event_summary}' on {start_iso}. "
        f"Calendar: {calendar_entity_id}. "
        f"{general_instruction} {calendar_instruction} "
        "No text, no watermarks, clean composition."
    )


def run_once(config: Dict[str, Any], dry_run: bool = False) -> Tuple[int, int]:
    ha = config.get("home_assistant") or {}
    base_url = str(ha.get("base_url") or "").rstrip("/")
    token_env = str(ha.get("token_env") or "HA_TOKEN")
    ha_token = os.environ.get(token_env, "").strip()

    if not base_url:
        raise SystemExit("config.home_assistant.base_url is required")
    if not ha_token:
        raise SystemExit(f"Missing Home Assistant token env var: {token_env}")

    oa = config.get("openai") or {}
    api_key_env = str(oa.get("api_key_env") or "OPENAI_API_KEY")
    openai_key = os.environ.get(api_key_env, "").strip()
    if not openai_key:
        raise SystemExit(f"Missing OpenAI API key env var: {api_key_env}")

    chat_model = str(oa.get("chat_model") or "gpt-4o-mini")
    image_model = str(oa.get("image_model") or "gpt-image-1-mini")

    window_cfg = config.get("window") or {}
    max_days = int(window_cfg.get("max_days") or 14)

    out = config.get("output") or {}
    images_dir = Path(str(out.get("images_dir") or "./event-images"))
    images_url_prefix = str(out.get("images_url_prefix") or "/local/event-images").rstrip("/")
    map_file = Path(str(out.get("map_file") or images_dir / "event-image-map.json"))

    prompting = config.get("prompting") or {}
    use_chat_prompt_builder = bool(prompting.get("use_chat_prompt_builder") is True)
    general_instruction = str(prompting.get("general_instruction") or "")

    calendars_cfg = config.get("calendars") or []
    calendars: List[CalendarConfig] = []
    for item in calendars_cfg:
        if not item or not item.get("entity_id"):
            continue
        calendars.append(
            CalendarConfig(
                entity_id=str(item["entity_id"]),
                instruction=str(item.get("instruction") or ""),
            )
        )

    cache_cfg = config.get("cache") or {}
    skip_if_exists = bool(cache_cfg.get("skip_if_exists", True))
    force = bool(cache_cfg.get("force", False))

    if not calendars:
        raise SystemExit("config.calendars must include at least one calendar entity_id")

    start = dt.datetime.now(dt.timezone.utc)
    end = start + dt.timedelta(days=max_days)
    start_iso = start.isoformat()
    end_iso = end.isoformat()

    _ensure_dir(images_dir)
    image_map = _read_map_file(map_file)
    image_map.setdefault("by_uid", {})
    image_map.setdefault("by_fallback", {})

    generated = 0
    skipped = 0

    for cal in calendars:
        try:
            events = _fetch_events(base_url, ha_token, cal.entity_id, start_iso, end_iso)
        except Exception as e:
            print(f"[WARN] Failed to fetch events for {cal.entity_id}: {e}", file=sys.stderr)
            continue

        for event in events:
            summary = str(event.get("summary") or "(no title)")
            start_str = _event_start_iso(event)
            uid = _event_uid(event)
            fallback_key = _event_key_fallback(cal.entity_id, event)
            fallback_hash = _fallback_hash(fallback_key)

            existing_url = None
            if uid and uid in image_map["by_uid"]:
                existing_url = image_map["by_uid"][uid].get("image_url")
            elif fallback_key in image_map["by_fallback"]:
                existing_url = image_map["by_fallback"][fallback_key].get("image_url")

            if existing_url and skip_if_exists and not force:
                skipped += 1
                continue

            # Build prompt
            if use_chat_prompt_builder:
                prompt = _chat_build_image_prompt(
                    openai_key,
                    chat_model,
                    summary,
                    start_str,
                    cal.entity_id,
                    general_instruction,
                    cal.instruction,
                )
            else:
                prompt = _render_default_prompt(
                    summary,
                    start_str,
                    cal.entity_id,
                    general_instruction,
                    cal.instruction,
                )

            slug = _safe_slug(summary)
            stable_part = uid or fallback_hash[:12]
            filename = f"{_safe_slug(cal.entity_id)}__{slug}__{stable_part}.png"
            file_path = images_dir / filename
            image_url = f"{images_url_prefix}/{filename}"

            if dry_run:
                print(f"[DRY] Would generate: {cal.entity_id} | {summary} -> {image_url}")
                generated += 1
                continue

            try:
                png_bytes = _openai_generate_image_base64(openai_key, image_model, prompt)
                file_path.write_bytes(png_bytes)
            except Exception as e:
                print(f"[WARN] Image generation failed for '{summary}' ({cal.entity_id}): {e}", file=sys.stderr)
                continue

            entry = {
                "calendar_entity_id": cal.entity_id,
                "summary": summary,
                "start": start_str,
                "uid": uid,
                "fallback_key": fallback_key,
                "fallback_hash": fallback_hash,
                "image_url": image_url,
                "image_path": str(file_path),
                "prompt": prompt,
                "updated_at": _utc_now_iso(),
            }

            if uid:
                image_map["by_uid"][uid] = entry
            image_map["by_fallback"][fallback_key] = entry

            generated += 1

    image_map["generated_at"] = _utc_now_iso()
    if not dry_run:
        _write_map_file(map_file, image_map)

    return generated, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate per-event images for HA calendars and write a JSON map.")
    parser.add_argument("--config", required=True, help="Path to YAML config")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without calling OpenAI")
    parser.add_argument("--loop-seconds", type=int, default=0, help="If >0, run forever every N seconds")
    args = parser.parse_args()

    cfg = _load_config(Path(args.config))

    if args.loop_seconds and args.loop_seconds > 0:
        while True:
            generated, skipped = run_once(cfg, dry_run=args.dry_run)
            print(f"[{_utc_now_iso()}] generated={generated} skipped={skipped}")
            time.sleep(args.loop_seconds)
    else:
        generated, skipped = run_once(cfg, dry_run=args.dry_run)
        print(f"generated={generated} skipped={skipped}")


if __name__ == "__main__":
    main()
