"""CA-15(a): prueba visual interna con retratos oficiales de dominio público.

Los archivos se descargan desde Wikimedia Commons. El manifiesto conserva la
fuente, la declaración de dominio público y SHA-256. Las salidas son evidencia
local de QA; no forman parte del producto ni deben publicarse como endorsement.
"""

import argparse
import base64
import hashlib
import json
import time
from pathlib import Path
from urllib.parse import quote


CASES = [
    ("barack_obama", "Barack Obama.jpg"),
    ("pete_buttigieg", "Pete Buttigieg official photo.jpg"),
    ("deb_haaland", "Deb Haaland, official portrait, 116th Congress.jpg"),
    ("lloyd_austin", "Secretary of Defense Lloyd Austin, official portrait, 2023.jpg"),
    ("janet_yellen", "Janet Yellen official portrait.jpg"),
    ("tammy_duckworth", "Tammy Duckworth, official portrait, 115th Congress.jpg"),
    ("mazie_hirono", "Mazie Hirono, official portrait, 113th Congress.jpg"),
    ("tim_scott", "Tim Scott official portrait.jpg"),
    ("antony_blinken", "Antony Blinken.jpg"),
    ("marcia_fudge", "Marcia Fudge official photo.jpg"),
    ("condoleezza_rice", "Condoleezza Rice.jpg"),
    ("miguel_cardona", "Secretary Miguel A. Cardona.jpg"),
]

COMMONS = "https://commons.wikimedia.org"
LICENSE_NOTE = (
    "Dominio público en EE. UU.; obra de gobierno federal según la página "
    "individual de Wikimedia Commons. Uso exclusivamente interno de QA."
)


def _source_page(filename: str) -> str:
    return f"{COMMONS}/wiki/File:{quote(filename.replace(' ', '_'), safe='(),')}"


def _download_url(filename: str) -> str:
    return f"{COMMONS}/wiki/Special:Redirect/file/{quote(filename, safe='')}?width=900"


def download(root: Path) -> None:
    import requests

    input_dir = root / "inputs"
    input_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = (
        "BeemetryAvatarQualityAudit/1.0 (internal public-domain QA)"
    )
    manifest = []
    for index, (slug, filename) in enumerate(CASES, start=1):
        target = input_dir / f"{index:02d}_{slug}.jpg"
        response = None
        for attempt in range(5):
            response = session.get(_download_url(filename), timeout=90)
            if response.status_code != 429:
                break
            wait_s = 10 * (attempt + 1)
            print(f"rate limited {slug}; retry in {wait_s}s")
            time.sleep(wait_s)
        assert response is not None
        response.raise_for_status()
        target.write_bytes(response.content)
        manifest.append(
            {
                "id": index,
                "slug": slug,
                "commons_filename": filename,
                "source_page": _source_page(filename),
                "download_url": response.url,
                "license": LICENSE_NOTE,
                "bytes": len(response.content),
                "sha256": hashlib.sha256(response.content).hexdigest(),
                "local_input": target.name,
            }
        )
        print(f"downloaded {index:02d}/{len(CASES)} {slug} {len(response.content)} bytes")
        time.sleep(1.5)
    (root / "sources.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _make_contact_sheet(root: Path, rows: list[dict]) -> None:
    from PIL import Image, ImageDraw, ImageOps

    cell_w, image_h, label_h = 720, 420, 42
    sheet = Image.new("RGB", (cell_w * 2, (image_h + label_h) * len(rows)), "white")
    draw = ImageDraw.Draw(sheet)
    for row_index, row in enumerate(rows):
        y = row_index * (image_h + label_h)
        before = Image.open(root / "inputs" / row["input"]).convert("RGB")
        after = Image.open(root / "outputs" / row["output"]).convert("RGB")
        before = ImageOps.contain(before, (cell_w, image_h))
        after = ImageOps.contain(after, (cell_w, image_h))
        sheet.paste(before, ((cell_w - before.width) // 2, y))
        sheet.paste(after, (cell_w + (cell_w - after.width) // 2, y))
        draw.text((10, y + image_h + 10), f"{row['id']:02d} {row['slug']} — original", fill="black")
        draw.text((cell_w + 10, y + image_h + 10), f"{row['id']:02d} {row['slug']} — avatar", fill="black")
    sheet.save(root / "comparison.jpg", quality=90)


def evaluate(root: Path) -> None:
    import cv2
    import numpy as np
    import eye_analyzer

    manifest = json.loads((root / "sources.json").read_text(encoding="utf-8"))
    output_dir = root / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for item in manifest:
        source = root / "inputs" / item["local_input"]
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        started = time.monotonic()
        avatars = eye_analyzer._cartoonify_face_bgr(image)
        elapsed = round(time.monotonic() - started, 3)
        if not avatars:
            results.append(
                {"id": item["id"], "slug": item["slug"], "ok": False, "elapsed_s": elapsed}
            )
            print(f"failed {item['id']:02d} {item['slug']} elapsed={elapsed}s")
            continue
        thumb_b64, _hd_b64, generator = avatars
        output_name = f"{item['id']:02d}_{item['slug']}_avatar.png"
        (output_dir / output_name).write_bytes(base64.b64decode(thumb_b64))
        row = {
            "id": item["id"],
            "slug": item["slug"],
            "ok": True,
            "elapsed_s": elapsed,
            "generator": generator,
            "input": item["local_input"],
            "output": output_name,
        }
        results.append(row)
        print(f"ok {item['id']:02d} {item['slug']} generator={generator} elapsed={elapsed}s")
    successful = [row for row in results if row["ok"]]
    if successful:
        _make_contact_sheet(root, successful)
    summary = {
        "total": len(results),
        "ok": len(successful),
        "failed": len(results) - len(successful),
        "diffusion": sum(row.get("generator") == "local_sd15_controlnet" for row in results),
        "results": results,
    }
    (root / "results.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({key: summary[key] for key in ("total", "ok", "failed", "diffusion")}))


def diagnose_masks(root: Path) -> None:
    """Registra cobertura de la máscara para explicar fallos visuales de composición."""
    import cv2
    import numpy as np
    import eye_analyzer

    manifest = json.loads((root / "sources.json").read_text(encoding="utf-8"))
    mask_dir = root / "masks"
    mask_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    segmenter = eye_analyzer._get_selfie_segmenter()
    for item in manifest:
        image = cv2.imread(str(root / "inputs" / item["local_input"]), cv2.IMREAD_COLOR)
        h, w = image.shape[:2]
        confidence = None
        if segmenter is not None:
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            mp_image = eye_analyzer.mp.Image(
                image_format=eye_analyzer.mp.ImageFormat.SRGB, data=rgb
            )
            with eye_analyzer._mediapipe_lock:
                segmented = segmenter.segment(mp_image)
            if segmented.confidence_masks:
                confidence = np.asarray(
                    segmented.confidence_masks[0].numpy_view(), dtype=np.float32
                ).squeeze().copy()
                if confidence.shape != (h, w):
                    confidence = cv2.resize(confidence, (w, h), interpolation=cv2.INTER_LINEAR)
                confidence = np.clip(np.nan_to_num(confidence), 0.0, 1.0)
        mask = eye_analyzer._person_mask_selfie_or_fallback(image)
        ys, xs = np.where(mask >= 128)
        bbox = None if not len(xs) else [
            round(float(xs.min()) / w, 4), round(float(ys.min()) / h, 4),
            round(float(xs.max() + 1) / w, 4), round(float(ys.max() + 1) / h, 4),
        ]
        row = {
            "id": item["id"], "slug": item["slug"],
            "selected_coverage": round(float(np.mean(mask >= 128)), 4),
            "selected_bbox_xyxy_fraction": bbox,
        }
        if confidence is not None:
            row["confidence_coverage"] = {
                str(threshold): round(float(np.mean(confidence >= threshold)), 4)
                for threshold in (0.1, 0.2, 0.3, 0.4, 0.5)
            }
            cv2.imwrite(
                str(mask_dir / f"{item['id']:02d}_{item['slug']}_confidence.png"),
                np.clip(confidence * 255.0, 0, 255).astype(np.uint8),
            )
        cv2.imwrite(str(mask_dir / f"{item['id']:02d}_{item['slug']}_selected.png"), mask)
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))
    (root / "mask_diagnostics.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("download", "evaluate", "diagnose-masks"))
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "download":
        download(args.root)
    elif args.mode == "evaluate":
        evaluate(args.root)
    else:
        diagnose_masks(args.root)


if __name__ == "__main__":
    main()
