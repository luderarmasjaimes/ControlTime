#!/usr/bin/env python3
"""
Entrena un clasificador binario (con gafas / sin gafas) y exporta ONNX + meta.json
para glasses_fusion.py (inferencia en ai_engine con onnxruntime).

Dataset (ImageFolder):
  <DATA_ROOT>/
    with_glasses/     *.jpg, *.jpeg, *.png, *.webp, *.bmp
    without_glasses/

Clase "gafas" = índice de carpeta with_glasses (orden lexicográfico: with_glasses=0).

Ejemplo:
  pip install -r ai_engine/requirements-train.txt
  python ai_engine/scripts/train_glasses_onnx.py --data_root data/glasses_dataset --epochs 15

Salida por defecto:
  ai_engine/models/glasses_classifier.onnx
  ai_engine/models/glasses_classifier_meta.json

Docker (montar dataset y modelos):
  docker run -v %CD%:/work -w /work informe-ai-engine:latest \\
    python ai_engine/scripts/train_glasses_onnx.py --data_root data/glasses_dataset
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def main() -> int:
    ap = argparse.ArgumentParser(description="Entrenar clasificador gafas → ONNX")
    ap.add_argument(
        "--data_root",
        type=str,
        default=str(_repo_root() / "data" / "glasses_dataset"),
        help="Carpeta con subcarpetas with_glasses y without_glasses",
    )
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch_size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--val_ratio", type=float, default=0.15)
    ap.add_argument("--input_size", type=int, default=224)
    ap.add_argument(
        "--out_onnx",
        type=str,
        default=str(_repo_root() / "ai_engine" / "models" / "glasses_classifier.onnx"),
    )
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--num_workers",
        type=int,
        default=0,
        help="Workers del DataLoader (paraleliza decode/resize/jitter -- 0 = igual que antes)",
    )
    ap.add_argument(
        "--report_json",
        type=str,
        default="",
        help="Ruta del informe JSON (default: junto al ONNX, *_training_report.json)",
    )
    args = ap.parse_args()

    try:
        import numpy as np
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, Subset, random_split
        from torchvision import datasets, transforms, models
    except ImportError as e:
        print("Instale dependencias: pip install -r ai_engine/requirements-train.txt", file=sys.stderr)
        print(e, file=sys.stderr)
        return 1

    data_root = Path(args.data_root).resolve()
    for sub in ("with_glasses", "without_glasses"):
        p = data_root / sub
        if not p.is_dir():
            print(f"Falta carpeta: {p}", file=sys.stderr)
            return 1

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".JPG", ".PNG"}
    n_with = sum(1 for f in (data_root / "with_glasses").iterdir() if f.suffix in exts)
    n_without = sum(1 for f in (data_root / "without_glasses").iterdir() if f.suffix in exts)
    if n_with < 5 or n_without < 5:
        print(
            f"Se necesitan al menos 5 imágenes por clase (with={n_with}, without={n_without}).",
            file=sys.stderr,
        )
        return 1

    tfm = transforms.Compose(
        [
            transforms.Resize((args.input_size, args.input_size)),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.ColorJitter(0.15, 0.15, 0.1, 0.05),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    tfm_val = transforms.Compose(
        [
            transforms.Resize((args.input_size, args.input_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    full = datasets.ImageFolder(str(data_root), transform=tfm)
    # validar nombres de clase
    class_to_idx = full.class_to_idx
    if "with_glasses" not in class_to_idx or "without_glasses" not in class_to_idx:
        print(
            "Las carpetas deben llamarse exactamente 'with_glasses' y 'without_glasses'.",
            file=sys.stderr,
        )
        print(f"Encontrado: {list(class_to_idx.keys())}", file=sys.stderr)
        return 1

    glasses_idx = int(class_to_idx["with_glasses"])

    n_val = max(1, int(len(full) * args.val_ratio))
    n_train = len(full) - n_val
    if n_train < 4:
        print("Dataset demasiado pequeño para train/val.", file=sys.stderr)
        return 1

    gen = torch.Generator().manual_seed(args.seed)
    train_ds, val_ds = random_split(full, [n_train, n_val], generator=gen)

    # Dataset de validación con transform sin augment
    val_full = datasets.ImageFolder(str(data_root), transform=tfm_val)
    val_indices = val_ds.indices
    val_subset = Subset(val_full, val_indices)

    train_loader = DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True,
        num_workers=args.num_workers, pin_memory=False,
        persistent_workers=args.num_workers > 0,
    )
    val_loader = DataLoader(
        val_subset, batch_size=args.batch_size, shuffle=False,
        num_workers=args.num_workers, pin_memory=False,
        persistent_workers=args.num_workers > 0,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    weights = models.MobileNet_V2_Weights.IMAGENET1K_V1
    m = models.mobilenet_v2(weights=weights)
    m.classifier[1] = nn.Linear(m.last_channel, 2)
    m = m.to(device)

    for p in m.features.parameters():
        p.requires_grad = False
    for p in m.classifier.parameters():
        p.requires_grad = True

    opt = torch.optim.AdamW(m.classifier.parameters(), lr=args.lr, weight_decay=1e-4)
    crit = nn.CrossEntropyLoss()
    best_state = None
    best_acc = 0.0

    t0 = time.perf_counter()
    started_iso = datetime.now(timezone.utc).isoformat()
    epoch_log: list = []

    for epoch in range(args.epochs):
        ep_t0 = time.perf_counter()
        m.train()
        total_loss = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            logits = m(x)
            loss = crit(logits, y)
            loss.backward()
            opt.step()
            total_loss += float(loss.item())

        m.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for x, y in val_loader:
                x, y = x.to(device), y.to(device)
                pred = m(x).argmax(dim=1)
                correct += int((pred == y).sum().item())
                total += y.size(0)
        acc = correct / max(1, total)
        avg_loss = total_loss / max(1, len(train_loader))
        elapsed = time.perf_counter() - t0
        pct = 100.0 * float(epoch + 1) / float(args.epochs)
        ep_sec = time.perf_counter() - ep_t0
        row = {
            "epoch": int(epoch + 1),
            "epochs_total": int(args.epochs),
            "progress_pct": round(pct, 2),
            "elapsed_sec": round(elapsed, 2),
            "epoch_duration_sec": round(ep_sec, 2),
            "train_loss": round(avg_loss, 6),
            "val_acc": round(float(acc), 6),
            "best_val_acc_so_far": round(float(max(best_acc, acc)), 6),
        }
        epoch_log.append(row)
        print(
            f"[{pct:5.1f}%] epoch {epoch + 1}/{args.epochs} "
            f"loss={avg_loss:.4f} val_acc={acc:.4f} "
            f"elapsed={elapsed:.0f}s ep={ep_sec:.1f}s",
            flush=True,
        )
        if acc >= best_acc:
            best_acc = acc
            best_state = {k: v.cpu().clone() for k, v in m.state_dict().items()}

    if best_state is not None:
        m.load_state_dict(best_state)
    m.eval()

    out_onnx = Path(args.out_onnx).resolve()
    out_onnx.parent.mkdir(parents=True, exist_ok=True)
    meta_path = out_onnx.with_name(out_onnx.stem + "_meta.json")
    report_json_path = Path(args.report_json).resolve() if args.report_json.strip() else out_onnx.with_name(
        out_onnx.stem + "_training_report.json"
    )
    report_txt_path = report_json_path.with_suffix(".txt")

    dummy = torch.randn(1, 3, args.input_size, args.input_size, device=device)
    export_path = str(out_onnx)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=DeprecationWarning)
        torch.onnx.export(
            m.cpu(),
            dummy.cpu(),
            export_path,
            input_names=["input"],
            output_names=["logits"],
            opset_version=17,
            dynamo=False,
            do_constant_folding=True,
        )

    total_elapsed = time.perf_counter() - t0
    finished_iso = datetime.now(timezone.utc).isoformat()

    meta = {
        "format": "informe_glasses_v1",
        "classes": sorted(class_to_idx.keys(), key=lambda c: class_to_idx[c]),
        "class_to_idx": {k: int(v) for k, v in class_to_idx.items()},
        "glasses_class_index": glasses_idx,
        "input_size": args.input_size,
        "val_acc": float(best_acc),
        "notes": "P(gafas) = softmax[logits][glasses_class_index]",
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    report = {
        "status": "completed",
        "started_at_utc": started_iso,
        "finished_at_utc": finished_iso,
        "total_elapsed_sec": round(total_elapsed, 2),
        "device": str(device),
        "dataset": {
            "data_root": str(data_root),
            "with_glasses_count": n_with,
            "without_glasses_count": n_without,
            "total_images": n_with + n_without,
            "train_samples": int(n_train),
            "val_samples": int(n_val),
        },
        "hyperparameters": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
            "val_ratio": args.val_ratio,
            "input_size": args.input_size,
            "seed": args.seed,
            "backbone": "mobilenet_v2_imagenet",
        },
        "best_val_accuracy": float(best_acc),
        "outputs": {
            "onnx": export_path,
            "meta": str(meta_path),
        },
        "epochs_timeline": epoch_log,
    }
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    lines = [
        "INFORME DE ENTRENAMIENTO — clasificador gafas (ONNX)",
        "=" * 60,
        f"Inicio (UTC): {started_iso}",
        f"Fin (UTC):    {finished_iso}",
        f"Tiempo total: {total_elapsed:.1f} s ({total_elapsed / 60:.1f} min)",
        f"Dispositivo:  {device}",
        "",
        "Dataset",
        f"  with_glasses:    {n_with}",
        f"  without_glasses: {n_without}",
        f"  train / val:     {n_train} / {n_val}",
        "",
        "Hiperparámetros",
        f"  epochs={args.epochs} batch={args.batch_size} lr={args.lr} input={args.input_size}",
        f"  mejor val_acc:    {best_acc:.4f}",
        "",
        "Avance por época (% tiempo y métricas)",
        "-" * 60,
    ]
    for row in epoch_log:
        lines.append(
            f"  época {row['epoch']}/{row['epochs_total']} | "
            f"progreso {row['progress_pct']:5.1f}% | "
            f"t={row['elapsed_sec']:7.1f}s | "
            f"loss={row['train_loss']:.4f} | val_acc={row['val_acc']:.4f}"
        )
    lines.extend(
        [
            "-" * 60,
            "Salidas",
            f"  ONNX:  {export_path}",
            f"  meta:  {meta_path}",
            f"  JSON:  {report_json_path}",
            "",
            "Docker / ai_engine:",
            f"  GLASSES_ONNX_PATH={export_path.replace(chr(92), '/')}",
        ]
    )
    report_txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"[OK] ONNX: {export_path}", flush=True)
    print(f"[OK] meta: {meta_path}", flush=True)
    print(f"[OK] informe JSON: {report_json_path}", flush=True)
    print(f"[OK] informe TXT:  {report_txt_path}", flush=True)
    print(f"     glasses_class_index={glasses_idx} (with_glasses)", flush=True)
    print(
        "Configure: GLASSES_ONNX_PATH=" + export_path.replace("\\", "/"),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
