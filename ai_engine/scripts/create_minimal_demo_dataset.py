#!/usr/bin/env python3
"""
Genera PNG sinteticos SOLO para probar que el pipeline train -> ONNX funciona.
No sirven para precision real; reemplace por fotos reales para produccion.
"""
import os
import sys
from pathlib import Path

import numpy as np


def main() -> int:
    root = Path(__file__).resolve().parents[2] / "data" / "glasses_dataset"
    for sub, bias in (("with_glasses", 40), ("without_glasses", 0)):
        d = root / sub
        d.mkdir(parents=True, exist_ok=True)
        for i in range(6):
            x = np.random.randint(0, 256, (128, 128, 3), dtype=np.uint8)
            x = np.clip(x.astype(np.int16) + bias, 0, 255).astype(np.uint8)
            try:
                from PIL import Image
            except ImportError:
                print("Necesita Pillow (pip install Pillow)", file=sys.stderr)
                return 1
            Image.fromarray(x).save(str(d / f"demo_{i:03d}.png"))
    print(f"[OK] PNG demo en {root} (6+6 imagenes). Reemplazar por fotos reales.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
