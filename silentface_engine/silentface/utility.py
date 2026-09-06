# -*- coding: utf-8 -*-
# Vendorizado desde minivision-ai/Silent-Face-Anti-Spoofing (src/utility.py,
# MIT license), recortado a las dos funciones usadas por anti_spoof_predict.py
# en este adaptador de solo-inferencia (sin las utilidades de entrenamiento).


def get_kernel(height, width):
    kernel_size = ((height + 15) // 16, (width + 15) // 16)
    return kernel_size


def parse_model_name(model_name):
    info = model_name.split('_')[0:-1]
    h_input, w_input = info[-1].split('x')
    model_type = model_name.split('.pth')[0].split('_')[-1]

    if info[0] == "org":
        scale = None
    else:
        scale = float(info[0])
    return int(h_input), int(w_input), model_type, scale
