"""Prueba de runtime real, no solo resolucion de pip. Verifica:
1) TensorFlow 2.18 detecta la GPU y ejecuta un forward real.
2) DeepFace/Facenet512 (Keras 2 via tf-keras) carga y calcula un embedding
   real en GPU -- el bug real reportado es "KerasTensor cannot be used as
   input to a TensorFlow function" con Keras 3, asi que esto ES la prueba
   que importa, no un placeholder.
3) torch (mismo proceso) tambien ve la GPU y hace una operacion real --
   confirma que el cudnn/nccl que trajo torch sirve a los dos frameworks
   sin que ninguno pise al otro ni crashee.
Imprime PASS/FAIL explicito por cada paso, no asume nada.
"""
import os
import sys
import traceback

os.environ["TF_USE_LEGACY_KERAS"] = "1"

results = {}


def step(name, fn):
    print(f"\n=== {name} ===", flush=True)
    try:
        fn()
        results[name] = "PASS"
        print(f"[{name}] PASS", flush=True)
    except Exception as exc:
        results[name] = f"FAIL: {exc}"
        print(f"[{name}] FAIL: {exc}", flush=True)
        traceback.print_exc()


def test_tf_gpu():
    import tensorflow as tf
    print("TF version:", tf.__version__, flush=True)
    print("Keras version:", tf.keras.__version__ if hasattr(tf.keras, "__version__") else "?", flush=True)
    gpus = tf.config.list_physical_devices("GPU")
    print("GPUs visibles:", gpus, flush=True)
    if not gpus:
        raise RuntimeError("tf.config.list_physical_devices('GPU') vacio -- cayo a CPU")
    a = tf.random.normal([512, 512])
    b = tf.random.normal([512, 512])
    with tf.device("/GPU:0"):
        c = tf.matmul(a, b)
    _ = c.numpy()
    print("matmul GPU real ejecutado, shape:", c.shape, flush=True)


def test_deepface_facenet512():
    import numpy as np
    from deepface import DeepFace

    img = (np.random.rand(160, 160, 3) * 255).astype(np.uint8)
    reps = DeepFace.represent(
        img_path=img,
        model_name="Facenet512",
        enforce_detection=False,
        detector_backend="skip",
    )
    if not reps or "embedding" not in reps[0]:
        raise RuntimeError("DeepFace.represent no devolvio embedding")
    emb = reps[0]["embedding"]
    print("Embedding Facenet512 real, dim:", len(emb), flush=True)


def test_torch_gpu():
    import torch
    print("torch version:", torch.__version__, flush=True)
    print("torch.cuda.is_available():", torch.cuda.is_available(), flush=True)
    if not torch.cuda.is_available():
        raise RuntimeError("torch.cuda.is_available() False")
    print("torch.backends.cudnn.version():", torch.backends.cudnn.version(), flush=True)
    a = torch.randn(1024, 1024, device="cuda")
    b = torch.randn(1024, 1024, device="cuda")
    c = a @ b
    torch.cuda.synchronize()
    print("matmul GPU real (torch) ejecutado, shape:", tuple(c.shape), flush=True)


step("TF_GPU", test_tf_gpu)
step("DEEPFACE_FACENET512_GPU", test_deepface_facenet512)
step("TORCH_GPU", test_torch_gpu)

print("\n\n===== RESUMEN =====", flush=True)
all_pass = True
for name, res in results.items():
    print(f"{name}: {res}", flush=True)
    if res != "PASS":
        all_pass = False

sys.exit(0 if all_pass else 1)
