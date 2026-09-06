"""Silent-Face-Anti-Spoofing (MiniFASNet) local liveness inference.

Vendorizado (MIT) desde minivision-ai/Silent-Face-Anti-Spoofing, commit
b6d5f04ad78778917853b25c778acef6d5626d15 (HEAD de master al integrar esta
funcionalidad -- re-verificar con `git ls-remote` si se re-vendoriza) --
solo el código de inferencia
(sin entrenamiento/data augmentation). Ver ai_engine/deepface_silentface_adapter.py
para el punto de entrada usado por eye_analyzer.py.
"""
