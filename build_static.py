"""Prepare the public PWA files for a Cloudflare Pages deployment."""

from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "static"
OUTPUT = ROOT / "dist"


def main():
    if not SOURCE.is_dir():
        raise SystemExit("The static/ directory is missing.")

    OUTPUT.mkdir(parents=True, exist_ok=True)

    for page in SOURCE.glob("*.html"):
        shutil.copy2(page, OUTPUT / page.name)
    for asset in SOURCE.iterdir():
        if asset.is_file() and asset.name in {
            "manifest.webmanifest", "service-worker.js", "pwa-icon.svg", "offline.html",
            "_redirects", "_headers", "public-config.js",
        }:
            shutil.copy2(asset, OUTPUT / asset.name)

    public_assets = OUTPUT / "static"
    public_assets.mkdir(exist_ok=True)
    for asset in SOURCE.iterdir():
        if asset.is_file() and asset.suffix.lower() not in {".html", ".exe", ".db"}:
            shutil.copy2(asset, public_assets / asset.name)

    print(f"Cloudflare Pages output prepared at {OUTPUT}")


if __name__ == "__main__":
    main()
