# Instala dependencias para entrenar el modelo ONNX de gafas (PyTorch + ONNX).
Set-Location $PSScriptRoot\..
pip install -r ai_engine/requirements-train.txt
Write-Host "Listo. Coloque imagenes en data/glasses_dataset/with_glasses y without_glasses, luego:"
Write-Host "  python ai_engine/scripts/train_glasses_onnx.py --data_root data/glasses_dataset"
