#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


GEOGRAPHY_ROOT = Path(__file__).resolve().parents[1]
LIVE_HOST_ROOT = Path("/data/workspace/graph-synchronizer")
LIVE_PUBLIC_DIR = LIVE_HOST_ROOT / "docs" / "prototypes"
LIVE_FIREBASE_JSON = LIVE_HOST_ROOT / "firebase.json"
LIVE_ROOT_HTML = LIVE_PUBLIC_DIR / "hf_landing_prototype.html"
VIEWMYMODEL_ROOT_URL = "https://viewmymodel.com/"

REQUIRED_GLOBE_ITEMS = [
    "index.html",
    "style.css",
    "game.js",
    "firebase-config.js",
    "Jonas_1.webp",
    "Jonas_2.webp",
    "high_five.wav",
    "assets",
    "vendor",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely stage Geography under a secret viewmymodel.com subpath"
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="Secret subpath slug. Default: globe-<current Geography git sha12>",
    )
    parser.add_argument(
        "--stage-dir",
        default=None,
        help="Explicit staging directory. Default: /tmp/<slug>-site",
    )
    parser.add_argument(
        "--preview-channel",
        default=None,
        help="Optional Firebase Hosting preview channel to deploy before anything else",
    )
    parser.add_argument(
        "--expires",
        default="30d",
        help="Preview-channel expiry for --preview-channel",
    )
    parser.add_argument(
        "--deploy-live",
        action="store_true",
        help="Deploy the staged site to the live viewmymodel Hosting site",
    )
    parser.add_argument(
        "--skip-live-root-check",
        action="store_true",
        help="Skip the safety check that viewmymodel.com/ matches graph-synchronizer's current live root",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the staging site and print commands, but do not call firebase-tools",
    )
    return parser.parse_args()


def run(cmd: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    subprocess.run(cmd, cwd=str(cwd), env=env, check=True)


def current_git_sha12(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short=12", "HEAD"],
        cwd=str(repo_root),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def ensure_required_items() -> None:
    missing = [name for name in REQUIRED_GLOBE_ITEMS if not (GEOGRAPHY_ROOT / name).exists()]
    if missing:
        raise SystemExit(f"Missing required Geography items: {', '.join(missing)}")
    if not LIVE_PUBLIC_DIR.exists():
        raise SystemExit(f"Missing live public dir: {LIVE_PUBLIC_DIR}")
    if not LIVE_FIREBASE_JSON.exists():
        raise SystemExit(f"Missing live firebase.json: {LIVE_FIREBASE_JSON}")


def live_root_matches_repo() -> bool:
    with urllib.request.urlopen(VIEWMYMODEL_ROOT_URL, timeout=30) as response:
        live_root = response.read()
    repo_root = LIVE_ROOT_HTML.read_bytes()
    return live_root == repo_root


def copy_item(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def build_stage(stage_dir: Path, slug: str) -> None:
    public_dir = stage_dir / "public"
    slug_dir = public_dir / slug
    if stage_dir.exists():
        subprocess.run(["rm", "-rf", str(stage_dir)], check=True)
    public_dir.mkdir(parents=True)
    shutil.copytree(LIVE_PUBLIC_DIR, public_dir, dirs_exist_ok=True)
    slug_dir.mkdir(parents=True, exist_ok=True)

    for item_name in REQUIRED_GLOBE_ITEMS:
        src = GEOGRAPHY_ROOT / item_name
        dst = slug_dir / item_name
        copy_item(src, dst)

    firebase_config = json.loads(LIVE_FIREBASE_JSON.read_text())
    firebase_config["hosting"]["public"] = "public"
    (stage_dir / "firebase.json").write_text(json.dumps(firebase_config, indent=2) + "\n")


def firebase_env() -> dict[str, str]:
    env = os.environ.copy()
    env["HOME"] = "/data/codex-home"
    env["XDG_CONFIG_HOME"] = "/data/codex-home/.config"
    return env


def main() -> None:
    args = parse_args()
    ensure_required_items()

    slug = args.slug or f"globe-{current_git_sha12(GEOGRAPHY_ROOT)}"
    stage_dir = (
        Path(args.stage_dir)
        if args.stage_dir
        else Path(tempfile.mkdtemp(prefix=f"{slug}-site-"))
    )

    if not args.skip_live_root_check:
        roots_match = live_root_matches_repo()
        if not roots_match and args.deploy_live:
            raise SystemExit(
                "Safety check failed: https://viewmymodel.com/ does not match "
                f"{LIVE_ROOT_HTML}. Refusing to stage a live custom-domain deploy."
            )
        if not roots_match:
            print(
                "warning=live root mismatch against graph-synchronizer; "
                "continuing because this run does not deploy live"
            )

    build_stage(stage_dir, slug)

    print(f"stage_dir={stage_dir}")
    print(f"secret_path=https://viewmymodel.com/{slug}/?region=globe")

    env = firebase_env()
    firebase_json = stage_dir / "firebase.json"

    preview_channel = args.preview_channel
    if preview_channel:
        preview_cmd = [
            "npx",
            "--yes",
            "firebase-tools",
            "hosting:channel:deploy",
            preview_channel,
            "--project",
            "viewmymodel",
            "--expires",
            args.expires,
            "--config",
            str(firebase_json),
        ]
        print("preview_cmd=" + " ".join(preview_cmd))
        if not args.dry_run:
            run(preview_cmd, cwd=stage_dir, env=env)

    if args.deploy_live:
        live_cmd = [
            "npx",
            "--yes",
            "firebase-tools",
            "deploy",
            "--only",
            "hosting",
            "--project",
            "viewmymodel",
            "--config",
            str(firebase_json),
        ]
        print("live_cmd=" + " ".join(live_cmd))
        if not args.dry_run:
            run(live_cmd, cwd=stage_dir, env=env)

    if not preview_channel and not args.deploy_live:
        print("No deploy action requested. Staging site prepared only.")


if __name__ == "__main__":
    main()
