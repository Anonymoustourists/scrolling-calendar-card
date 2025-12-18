#!/usr/bin/env python3

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None  # type: ignore


@dataclass(frozen=True)
class Targets:
    host: str
    www_root: str

    @property
    def images_remote_dir(self) -> str:
        return f"{self.www_root.rstrip('/')}/scrolling-calendar-card/event-images"

    @property
    def card_remote_dir(self) -> str:
        return f"{self.www_root.rstrip('/')}/community/scrolling-calendar-card"


SSH_BASE_OPTS = ["-o", "StrictHostKeyChecking=accept-new"]


def _load_env() -> None:
    if load_dotenv is None:
        return

    repo_root = Path(__file__).resolve().parent.parent
    for p in (repo_root / ".env", Path.cwd() / ".env"):
        if p.exists():
            load_dotenv(dotenv_path=str(p), override=False)


def _run(cmd: List[str]) -> None:
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def _which(name: str) -> Optional[str]:
    return shutil.which(name)


def _ensure_remote_dir(host: str, remote_dir: str) -> None:
    _run(["ssh", *SSH_BASE_OPTS, host, "mkdir", "-p", remote_dir])


def _rsync_push(local_path: Path, host: str, remote_dir: str, delete: bool = False) -> None:
    cmd = ["rsync", "-avz", "--progress", "--mkpath", "-e", "ssh -o StrictHostKeyChecking=accept-new"]
    if delete:
        cmd.append("--delete")
    cmd += [str(local_path), f"{host}:{remote_dir.rstrip('/')}/"]
    _run(cmd)


def _scp_push(local_files: List[Path], host: str, remote_dir: str) -> None:
    _ensure_remote_dir(host, remote_dir)
    cmd = ["scp", *SSH_BASE_OPTS] + [str(p) for p in local_files] + [f"{host}:{remote_dir.rstrip('/')}/"]
    _run(cmd)


def push_images_and_json(targets: Targets, out_dir: Path, delete: bool) -> None:
    # Expecting:
    # out_dir/
    #   event-image-map.json
    #   event-status.json
    #   img/*.png
    out_dir = out_dir.resolve()
    img_dir = out_dir / "img"

    if not out_dir.exists():
        raise SystemExit(f"Output dir not found: {out_dir}")

    # Prefer rsync for directory pushes.
    if _which("rsync"):
        # push json files
        for name in ("event-image-map.json", "event-status.json"):
            p = out_dir / name
            if p.exists():
                _rsync_push(p, targets.host, targets.images_remote_dir, delete=False)

        # push images (directory)
        if img_dir.exists():
            _rsync_push(img_dir, targets.host, f"{targets.images_remote_dir}/", delete=delete)
        return

    # scp fallback: copy json + all pngs
    files: List[Path] = []
    for name in ("event-image-map.json", "event-status.json"):
        p = out_dir / name
        if p.exists():
            files.append(p)

    if img_dir.exists():
        files.extend(sorted(img_dir.glob("*.png")))

    if not files:
        raise SystemExit(f"No artifacts found under: {out_dir}")

    # Ensure img exists remotely to preserve structure when using scp
    _ensure_remote_dir(targets.host, targets.images_remote_dir)
    _ensure_remote_dir(targets.host, f"{targets.images_remote_dir}/img")

    # scp cannot preserve directory structure in a single call easily, so do two.
    json_files = [p for p in files if p.parent == out_dir]
    img_files = [p for p in files if p.parent == img_dir]
    if json_files:
        _scp_push(json_files, targets.host, targets.images_remote_dir)
    if img_files:
        _scp_push(img_files, targets.host, f"{targets.images_remote_dir}/img")


def push_card_js(targets: Targets, repo_root: Path) -> None:
    repo_root = repo_root.resolve()
    files = [
        repo_root / "scrolling-calendar-card.js",
        repo_root / "scrolling-calendar-card-editor.js",
    ]
    missing = [str(p) for p in files if not p.exists()]
    if missing:
        raise SystemExit(f"Card JS files missing: {', '.join(missing)}")

    if _which("rsync"):
        for p in files:
            _rsync_push(p, targets.host, targets.card_remote_dir, delete=False)
    else:
        _ensure_remote_dir(targets.host, targets.card_remote_dir)
        _scp_push(files, targets.host, targets.card_remote_dir)


def main() -> None:
    _load_env()

    parser = argparse.ArgumentParser(description="Push generator outputs and/or card JS to m4mm over SSH.")
    parser.add_argument(
        "--what",
        default="images,json",
        help="Comma-separated: images,json,card (default: images,json)",
    )
    parser.add_argument(
        "--out-dir",
        default="./out/event-images",
        help="Local output directory to push (default: ./out/event-images)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("M4MM_HOST", "m4mm"),
        help="SSH host alias (default: env M4MM_HOST or 'm4mm')",
    )
    parser.add_argument(
        "--www-root",
        default=os.environ.get("M4MM_WWW_ROOT", "/Volumes/ScriptsM4/newhome/ha-config/www"),
        help="Remote www root on m4mm (default: env M4MM_WWW_ROOT or /Volumes/ScriptsM4/newhome/ha-config/www)",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="If using rsync, delete remote images not present locally (only affects img/).",
    )
    args = parser.parse_args()

    what = {w.strip().lower() for w in str(args.what).split(",") if w.strip()}
    if not what:
        raise SystemExit("--what must include at least one of: images,json,card")

    targets = Targets(host=str(args.host), www_root=str(args.www_root))
    repo_root = Path(__file__).resolve().parent.parent

    if "images" in what or "json" in what:
        push_images_and_json(targets, Path(args.out_dir), delete=bool(args.delete))

    if "card" in what:
        push_card_js(targets, repo_root)


if __name__ == "__main__":
    main()
