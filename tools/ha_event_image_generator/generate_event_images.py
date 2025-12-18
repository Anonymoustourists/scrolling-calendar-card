#!/usr/bin/env python3

import argparse
import base64
import datetime as dt
import hashlib
import io
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

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None  # type: ignore

try:
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    Image = None  # type: ignore


@dataclass(frozen=True)
class CalendarConfig:
    entity_id: str
    instruction: str


def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _word_count(value: str) -> int:
    return len([w for w in re.split(r"\s+", (value or "").strip()) if w])


def _is_unclear_summary(summary: str) -> bool:
    s = (summary or "").strip()
    if not s:
        return True
    if _word_count(s) <= 2:
        return True
    # crude heuristic for "codes"/"initialisms"/"gibberish"
    if not re.search(r"[aeiouy]", s.lower()):
        return True
    return False


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


def _event_end_iso(event: Dict[str, Any]) -> str:
    end = event.get("end") or {}
    return end.get("dateTime") or end.get("date") or ""


def _event_uid(event: Dict[str, Any]) -> str:
    # Different calendar providers expose different identifiers.
    for key in ("uid", "recurring_event_id", "recurrence_id", "id"):
        if event.get(key):
            return str(event[key])
    return ""


def _event_description(event: Dict[str, Any]) -> str:
    # Home Assistant calendar API typically includes "description".
    return str(event.get("description") or "")


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


def _load_dotenv_files() -> None:
    if load_dotenv is None:
        return

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent

    # Lowest priority first, highest priority last.
    for p in (repo_root / ".env", script_dir / ".env", Path.cwd() / ".env"):
        if p.exists():
            load_dotenv(dotenv_path=str(p), override=False)


def _resolve_path(base_dir: Path, maybe_path: str) -> Path:
    p = Path(str(maybe_path))
    if p.is_absolute():
        return p
    return (base_dir / p).resolve()


def _read_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
        return default
    except Exception:
        return default


def _write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _load_overrides_yaml(path: Optional[Path]) -> Dict[str, Any]:
    if not path:
        return {}
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _get_clarified_summary(
    overrides: Dict[str, Any],
    uid: str,
    fallback_key: str,
) -> Optional[str]:
    by_uid = overrides.get("overrides", {}).get("by_uid", {}) if isinstance(overrides.get("overrides"), dict) else overrides.get("by_uid", {})
    if uid and isinstance(by_uid, dict):
        entry = by_uid.get(uid)
        if isinstance(entry, dict) and entry.get("clarified_summary"):
            return str(entry.get("clarified_summary")).strip() or None

    by_fallback = overrides.get("overrides", {}).get("by_fallback", {}) if isinstance(overrides.get("overrides"), dict) else overrides.get("by_fallback", {})
    if fallback_key and isinstance(by_fallback, dict):
        entry = by_fallback.get(fallback_key)
        if isinstance(entry, dict) and entry.get("clarified_summary"):
            return str(entry.get("clarified_summary")).strip() or None

    return None


def _summary_in_list(summary: str, summary_in: List[str]) -> bool:
    s = (summary or "").strip().lower()
    for candidate in summary_in or []:
        if s == str(candidate).strip().lower():
            return True
    return False


def _rule_matches(rule_when: Dict[str, Any], calendar_entity_id: str, summary: str) -> Tuple[bool, List[str]]:
    if not isinstance(rule_when, dict):
        return False, []

    cal = rule_when.get("calendar_entity_id")
    if cal and str(cal) != str(calendar_entity_id):
        return False, []

    wc = _word_count(summary)
    if rule_when.get("min_words") is not None and wc < int(rule_when.get("min_words")):
        return False, []
    if rule_when.get("max_words") is not None and wc > int(rule_when.get("max_words")):
        return False, []

    if rule_when.get("summary_in"):
        if not _summary_in_list(summary, list(rule_when.get("summary_in") or [])):
            return False, []

    groups: List[str] = []
    if rule_when.get("summary_regex"):
        pattern = str(rule_when.get("summary_regex"))
        try:
            m = re.search(pattern, summary, flags=re.IGNORECASE)
        except re.error:
            return False, []
        if not m:
            return False, []
        groups = [g or "" for g in m.groups()]

    return True, groups


def _render_prompt_template(template: str, summary: str, groups: List[str]) -> str:
    out = str(template or "")
    out = out.replace("{{SUMMARY}}", summary)
    for idx, g in enumerate(groups, start=1):
        out = out.replace(f"{{{{GROUP{idx}}}}}", g)
    return out


DEFAULT_STYLE_SUFFIX = (
    "Fun, friendly, cartoony illustration. Clean composition. Bright, warm colors. "
    "No text, no captions, no logos, no watermarks."
)


def _build_prompt_with_rules(
    *,
    event: Dict[str, Any],
    calendar_entity_id: str,
    uid: str,
    fallback_key: str,
    prompting_cfg: Dict[str, Any],
    general_instruction: str,
    overrides: Dict[str, Any],
) -> Dict[str, Any]:
    original_summary = str(event.get("summary") or "(no title)")
    description = _event_description(event)
    clarified = _get_clarified_summary(overrides, uid=uid, fallback_key=fallback_key)
    summary = clarified or original_summary

    ask_if_unclear_default = bool(prompting_cfg.get("ask_if_unclear", False))

    # Find first matching rule (top-down).
    matched_rule: Optional[Dict[str, Any]] = None
    matched_groups: List[str] = []
    for rule in prompting_cfg.get("rules") or []:
        if not isinstance(rule, dict):
            continue
        ok, groups = _rule_matches(rule.get("when") or {}, calendar_entity_id, summary)
        if ok:
            matched_rule = rule
            matched_groups = groups
            break

    action = (matched_rule or {}).get("action") or {}
    rule_id = (matched_rule or {}).get("id")
    include_characters = list(action.get("include_characters") or [])
    template = action.get("prompt_template")
    ask_if_unclear = bool(action.get("ask_if_unclear")) if action.get("ask_if_unclear") is not None else ask_if_unclear_default

    needs_info = _is_unclear_summary(summary) and ask_if_unclear

    if needs_info:
        question = (
            f"What does '{summary}' refer to? (person, place, activity, or something else)"
        )
        suggested_examples = [
            "Example: 'Jaxon school lunch (pizza)'.",
            "Example: 'Family movie night at home'.",
            "Example: 'Pistons vs Bulls game at arena'.",
        ]
        return {
            "needs_info": True,
            "rule_id": rule_id,
            "clarified_summary": clarified,
            "question": {
                "uid": uid,
                "fallback_key": fallback_key,
                "calendar_entity_id": calendar_entity_id,
                "summary": summary,
                "start": _event_start_iso(event),
                "question": question,
                "suggested_examples": suggested_examples,
                "created_at": _utc_now_iso(),
            },
        }

    # Template can reference {{SUMMARY}} and {{GROUP1}}...
    if template:
        core = _render_prompt_template(str(template), summary, matched_groups)
    else:
        core = _render_default_prompt(summary, _event_start_iso(event), calendar_entity_id, general_instruction, "")

    char_cfg = prompting_cfg.get("characters") or {}
    char_lines: List[str] = []
    for name in include_characters:
        cfg = char_cfg.get(name) if isinstance(char_cfg, dict) else None
        if isinstance(cfg, dict) and cfg.get("description"):
            char_lines.append(f"{name}: {str(cfg.get('description')).strip()}")
        else:
            char_lines.append(f"{name}: consistent cartoon character")

    policy_parts: List[str] = []
    if char_lines:
        policy_parts.append("Characters (use consistent look across images):\n" + "\n".join(char_lines))
    if description:
        policy_parts.append(f"Event description/context (may be noisy): {description}")
    if general_instruction:
        policy_parts.append(f"Global instruction: {general_instruction}")
    policy_parts.append(core)
    policy_parts.append(DEFAULT_STYLE_SUFFIX)

    return {
        "needs_info": False,
        "rule_id": rule_id,
        "clarified_summary": clarified,
        "include_characters": include_characters,
        "policy_prompt": "\n\n".join([p for p in policy_parts if p.strip()]),
    }


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
        f"Policy prompt (do not change intent):\n{general_instruction}\n\n"
        "Rewrite the policy prompt into a single concise image prompt. "
        "Do NOT add new subjects, do NOT remove subjects, do NOT add text in the image. "
        "Return ONLY the final image prompt (no quotes, no markdown)."
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


def _parse_aspect_ratio(value: str) -> float:
    raw = (value or "").strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$", raw)
    if not m:
        raise ValueError(f"Invalid target_aspect_ratio '{value}'. Expected like '3:4' or '16:9'.")
    w = float(m.group(1))
    h = float(m.group(2))
    if w <= 0 or h <= 0:
        raise ValueError(f"Invalid target_aspect_ratio '{value}'. Both values must be > 0.")
    return w / h


def _postprocess_png(
    png_bytes: bytes,
    target_aspect_ratio: Optional[str],
    final_size_px: Optional[List[int]],
    fit_mode: str,
) -> bytes:
    if not target_aspect_ratio and not final_size_px:
        return png_bytes
    if Image is None:
        raise RuntimeError("Pillow is required for post-processing. Install deps from requirements.txt")

    with Image.open(io.BytesIO(png_bytes)) as img:  # type: ignore[name-defined]
        img = img.convert("RGB")
        iw, ih = img.size
        if iw <= 0 or ih <= 0:
            return png_bytes

        target_ratio = _parse_aspect_ratio(target_aspect_ratio) if target_aspect_ratio else (iw / ih)
        src_ratio = iw / ih
        mode = (fit_mode or "pad").strip().lower()
        if mode not in ("pad", "crop"):
            raise ValueError(f"Invalid fit_mode '{fit_mode}'. Expected 'pad' or 'crop'.")

        if mode == "crop":
            if src_ratio > target_ratio:
                crop_w = max(1, int(round(ih * target_ratio)))
                left = max(0, (iw - crop_w) // 2)
                img = img.crop((left, 0, left + crop_w, ih))
            else:
                crop_h = max(1, int(round(iw / target_ratio)))
                top = max(0, (ih - crop_h) // 2)
                img = img.crop((0, top, iw, top + crop_h))
        else:  # pad
            if src_ratio > target_ratio:
                new_h = max(1, int(round(iw / target_ratio)))
                new_w = iw
            else:
                new_w = max(1, int(round(ih * target_ratio)))
                new_h = ih
            bg = Image.new("RGB", (new_w, new_h), (0, 0, 0))
            x = (new_w - iw) // 2
            y = (new_h - ih) // 2
            bg.paste(img, (x, y))
            img = bg

        if final_size_px:
            if not (isinstance(final_size_px, list) and len(final_size_px) == 2):
                raise ValueError("final_size_px must be [width, height]")
            tw, th = int(final_size_px[0]), int(final_size_px[1])
            if tw <= 0 or th <= 0:
                raise ValueError("final_size_px values must be > 0")
            img = img.resize((tw, th), resample=Image.Resampling.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()


def _resolve_output(config: Dict[str, Any]) -> Dict[str, Any]:
    out = config.get("output") or {}

    # New layout defaults (local generation then push to HA).
    output_dir = Path(str(out.get("output_dir") or "./out/event-images"))
    image_subdir = str(out.get("image_subdir") or "img").strip("/")

    # Legacy support: if images_dir is set explicitly and output_dir is not, keep old behavior
    # (images and JSON together in one directory, no img subfolder).
    if out.get("images_dir") and not out.get("output_dir"):
        output_dir = Path(str(out.get("images_dir")))
        image_subdir = ""

    images_dir = output_dir / image_subdir if image_subdir else output_dir

    # Default URL prefixes depend on layout.
    default_images_url_prefix = (
        f"/local/scrolling-calendar-card/event-images/{image_subdir}".rstrip("/")
        if image_subdir
        else "/local/event-images"
    )
    images_url_prefix = str(out.get("images_url_prefix") or default_images_url_prefix).rstrip("/")

    map_file = Path(str(out.get("map_file") or (output_dir / "event-image-map.json")))
    status_file = Path(str(out.get("status_file") or (output_dir / "event-status.json")))
    write_status_json = bool(out.get("write_status_json", True))

    return {
        "output_dir": output_dir,
        "images_dir": images_dir,
        "images_url_prefix": images_url_prefix,
        "map_file": map_file,
        "status_file": status_file,
        "write_status_json": write_status_json,
        "image_subdir": image_subdir,
    }


def _update_pending_questions(path: Path, question_entry: Dict[str, Any]) -> None:
    payload = _read_json(path, default={"generated_at": _utc_now_iso(), "questions": []})
    payload["generated_at"] = _utc_now_iso()
    questions = payload.get("questions")
    if not isinstance(questions, list):
        questions = []

    def key(q: Dict[str, Any]) -> str:
        uid = str(q.get("uid") or "")
        fb = str(q.get("fallback_key") or "")
        return uid or fb

    new_key = key(question_entry)
    replaced = False
    new_questions: List[Dict[str, Any]] = []
    for q in questions:
        if isinstance(q, dict) and new_key and key(q) == new_key:
            new_questions.append(question_entry)
            replaced = True
        else:
            if isinstance(q, dict):
                new_questions.append(q)
    if not replaced:
        new_questions.append(question_entry)
    payload["questions"] = new_questions
    _write_json_atomic(path, payload)


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


def run_once(config: Dict[str, Any], config_base_dir: Path, dry_run: bool = False) -> Tuple[int, int]:
    ha = config.get("home_assistant") or {}
    base_url = str(os.environ.get("HA_BASE_URL") or ha.get("base_url") or "").rstrip("/")
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

    output = _resolve_output(config)
    images_dir: Path = output["images_dir"]
    images_url_prefix: str = output["images_url_prefix"]
    map_file: Path = output["map_file"]
    status_file: Path = output["status_file"]
    write_status_json: bool = output["write_status_json"]

    prompting = config.get("prompting") or {}
    use_chat_prompt_builder = bool(prompting.get("use_chat_prompt_builder") is True)
    general_instruction = str(prompting.get("general_instruction") or "")

    # Keep relative paths consistent with output_dir defaults (repo-relative when run from repo root).
    path_base = Path.cwd().resolve()
    pending_questions_file = _resolve_path(
        path_base,
        str(prompting.get("pending_questions_file") or "./out/event-images/pending-questions.json"),
    )
    overrides_file_cfg = prompting.get("overrides_file")
    overrides_file = _resolve_path(path_base, str(overrides_file_cfg)) if overrides_file_cfg else None
    overrides = _load_overrides_yaml(overrides_file)

    recurrence_cfg = prompting.get("recurrence") or {}
    reuse_by_uid = bool(recurrence_cfg.get("reuse_by_uid", True))
    regenerate_if_summary_changes = bool(recurrence_cfg.get("regenerate_if_summary_changes", False))

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

    post_cfg = config.get("postprocess") or config.get("image_postprocess") or {}
    # Allow placing these keys under output as well.
    if not post_cfg and (config.get("output") or {}).get("target_aspect_ratio"):
        post_cfg = config.get("output") or {}
    target_aspect_ratio = post_cfg.get("target_aspect_ratio")
    final_size_px = post_cfg.get("final_size_px")
    fit_mode = str(post_cfg.get("fit_mode") or "pad")

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

    status_events: List[Dict[str, Any]] = []

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
            end_str = _event_end_iso(event)
            uid = _event_uid(event)
            fallback_key = _event_key_fallback(cal.entity_id, event)
            fallback_hash = _fallback_hash(fallback_key)

            cached_entry = None
            if uid and uid in image_map["by_uid"]:
                cached_entry = image_map["by_uid"][uid]
            elif fallback_key in image_map["by_fallback"]:
                cached_entry = image_map["by_fallback"][fallback_key]
            existing_url = cached_entry.get("image_url") if isinstance(cached_entry, dict) else None

            cached_summary = (cached_entry or {}).get("summary") if isinstance(cached_entry, dict) else None
            should_regenerate_due_to_summary_change = (
                bool(uid)
                and regenerate_if_summary_changes
                and cached_summary is not None
                and str(cached_summary) != summary
            )

            if existing_url and skip_if_exists and not force and (not should_regenerate_due_to_summary_change) and reuse_by_uid:
                skipped += 1
                status_events.append(
                    {
                        "title": summary,
                        "start": start_str,
                        "end": end_str,
                        "calendar_entity_id": cal.entity_id,
                        "uid": uid,
                        "fallback_key": fallback_key,
                        "has_image": True,
                        "image_url": existing_url,
                        "last_generated": (cached_entry or {}).get("updated_at"),
                        "needs_info": False,
                    }
                )
                continue

            # Apply rule-based policy for prompt construction.
            policy = _build_prompt_with_rules(
                event=event,
                calendar_entity_id=cal.entity_id,
                uid=uid,
                fallback_key=fallback_key,
                prompting_cfg=prompting if isinstance(prompting, dict) else {},
                general_instruction=general_instruction,
                overrides=overrides,
            )

            if policy.get("needs_info") is True:
                question_entry = policy.get("question")
                if isinstance(question_entry, dict) and not dry_run:
                    _update_pending_questions(pending_questions_file, question_entry)

                status_events.append(
                    {
                        "title": summary,
                        "start": start_str,
                        "end": end_str,
                        "calendar_entity_id": cal.entity_id,
                        "uid": uid,
                        "fallback_key": fallback_key,
                        "has_image": False,
                        "image_url": None,
                        "last_generated": None,
                        "needs_info": True,
                        "rule_id": policy.get("rule_id"),
                    }
                )
                skipped += 1
                continue

            # Build prompt (rules-based policy prompt, optionally polished by chat model).
            policy_prompt = str(policy.get("policy_prompt") or "").strip()
            if not policy_prompt:
                policy_prompt = _render_default_prompt(
                    summary,
                    start_str,
                    cal.entity_id,
                    general_instruction,
                    cal.instruction,
                )

            if use_chat_prompt_builder:
                prompt = _chat_build_image_prompt(
                    openai_key,
                    chat_model,
                    summary,
                    start_str,
                    cal.entity_id,
                    policy_prompt,
                    "",
                )
            else:
                prompt = policy_prompt

            slug = _safe_slug(summary)
            stable_part = uid or fallback_hash[:12]
            filename = f"{_safe_slug(cal.entity_id)}__{slug}__{stable_part}.png"
            file_path = images_dir / filename
            image_url = f"{images_url_prefix}/{filename}"

            if dry_run:
                print(f"[DRY] Would generate: {cal.entity_id} | {summary} -> {image_url}")
                generated += 1
                status_events.append(
                    {
                        "title": summary,
                        "start": start_str,
                        "end": end_str,
                        "calendar_entity_id": cal.entity_id,
                        "uid": uid,
                        "fallback_key": fallback_key,
                        "has_image": bool(existing_url),
                        "image_url": existing_url or image_url,
                        "last_generated": (cached_entry or {}).get("updated_at"),
                        "needs_info": False,
                        "rule_id": policy.get("rule_id"),
                    }
                )
                continue

            try:
                png_bytes = _openai_generate_image_base64(openai_key, image_model, prompt)
                if target_aspect_ratio or final_size_px:
                    png_bytes = _postprocess_png(
                        png_bytes,
                        str(target_aspect_ratio) if target_aspect_ratio else None,
                        final_size_px if isinstance(final_size_px, list) else None,
                        fit_mode,
                    )
                file_path.write_bytes(png_bytes)
            except Exception as e:
                print(f"[WARN] Image generation failed for '{summary}' ({cal.entity_id}): {e}", file=sys.stderr)
                status_events.append(
                    {
                        "title": summary,
                        "start": start_str,
                        "end": end_str,
                        "calendar_entity_id": cal.entity_id,
                        "uid": uid,
                        "fallback_key": fallback_key,
                        "has_image": False,
                        "image_url": None,
                        "last_generated": None,
                    }
                )
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
                "rule_id": policy.get("rule_id"),
            }

            if uid:
                image_map["by_uid"][uid] = entry
            image_map["by_fallback"][fallback_key] = entry

            generated += 1

            status_events.append(
                {
                    "title": summary,
                    "start": start_str,
                    "end": end_str,
                    "calendar_entity_id": cal.entity_id,
                    "uid": uid,
                    "fallback_key": fallback_key,
                    "has_image": True,
                    "image_url": image_url,
                    "last_generated": entry.get("updated_at"),
                    "needs_info": False,
                    "rule_id": policy.get("rule_id"),
                }
            )

    image_map["generated_at"] = _utc_now_iso()
    if not dry_run:
        _write_map_file(map_file, image_map)

        if write_status_json:
            status_payload = {
                "generated_at": _utc_now_iso(),
                "event_count": len(status_events),
                "events": status_events,
            }
            status_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = status_file.with_suffix(status_file.suffix + ".tmp")
            tmp.write_text(json.dumps(status_payload, indent=2, sort_keys=True), encoding="utf-8")
            tmp.replace(status_file)

    return generated, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate per-event images for HA calendars and write a JSON map.")
    parser.add_argument("--config", required=True, help="Path to YAML config")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without calling OpenAI")
    parser.add_argument("--loop-seconds", type=int, default=0, help="If >0, run forever every N seconds")
    args = parser.parse_args()

    _load_dotenv_files()

    config_path = Path(args.config).resolve()
    cfg = _load_config(config_path)
    config_base_dir = config_path.parent

    if args.loop_seconds and args.loop_seconds > 0:
        while True:
            generated, skipped = run_once(cfg, config_base_dir=config_base_dir, dry_run=args.dry_run)
            print(f"[{_utc_now_iso()}] generated={generated} skipped={skipped}")
            time.sleep(args.loop_seconds)
    else:
        generated, skipped = run_once(cfg, config_base_dir=config_base_dir, dry_run=args.dry_run)
        print(f"generated={generated} skipped={skipped}")


if __name__ == "__main__":
    main()
