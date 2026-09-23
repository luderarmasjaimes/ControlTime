/*
Extraído en vivo de https://board.beemetry.com el 2026-09-16 vía fetch()
autenticado (sesión propia de Steven Vera, GET /api/ruleChain/{id}/metadata,
id ffa2f2d0-629d-11ed-8142-dd34011319e1, "PiezometerRC-V2"), solo lectura.
Texto VERBATIM de los 29 nodos TbTransformMsgNode (jsScript), sin editar,
para comparación exacta contra sensor_formula_template_def/_output
(ADR-189) en SPEC-027 T13/T14/T15. \r\n originales conservados como están.
*/

// ---- 1. "Polynomial RST" Equation ----
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var press = parseFloat(msg.Press);
var tempIni = parseFloat(metadata.shared_TempIni);
var pressIni = parseFloat(metadata.shared_PressIni);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var tk = parseFloat(metadata.shared_tk);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var mca = 0;
newMsg.PsPoros = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + (tk * (temp - tempIni)) + offset;
if (!isNaN(pressIni) && !isNaN(press) && (pressIni !== 0)) {
    if (unidad.toLowerCase() === 'kpa') {
        newMsg.PsPoros = newMsg.PsPoros - (0.1 * (press - pressIni));
    } else if (unidad.toLowerCase() === 'mpa') {
        newMsg.PsPoros = newMsg.PsPoros - (0.0001 * (press - pressIni));
    }
}
newMsg.MPA = newMsg.PsPoros;
if (unidad.toLowerCase() === 'kpa') {
    newMsg.MtColAgua = newMsg.PsPoros * 0.1019744;
} else if (unidad.toLowerCase() === 'mpa') {
    newMsg.MtColAgua = newMsg.PsPoros * 101.9744;
}
newMsg.MCA = newMsg.MtColAgua;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = newMsg.ALT_INSTALL + mca;
// return { msg: newMsg, metadata: metadata, msgType: msgType };

// ---- 2. "Polynomial A2" Equation ----
// (bifurca settlement-cell y excepción de cliente deviceName == 'YR.PZ-05R*' -- YAROS)
var newMsg = {};
var deviceName = metadata.deviceName;
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var paramD = parseFloat(metadata.shared_param_D);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var profInstall = parseFloat(metadata.shared_prof_install);
var cotaSuperficie = parseFloat(metadata.shared_cota_superficie);
var stickup = parseFloat(metadata.shared_stickup);
var incli = parseFloat(metadata.shared_incli);
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freq - freqIni) * cf;
if (unidad === 'KPA') {
    newMsg.MPA = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + paramD - (tk * (tempIni - temp));
    newMsg.MCA = newMsg.MPA * 0.101972 + offset;
}
if (unidad === 'MPA') {
    newMsg.MPA = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + paramD - (tk * (tempIni - temp)) / 1000;
    newMsg.MCA = newMsg.MPA * 101.972 + offset;
}
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType == 'settlement-cell') {
    newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA);
} else {
    if (deviceName == 'YR.PZ-05R-(A)' || deviceName == 'YR.PZ-05R-(B)' || deviceName == 'YR.PZ-05R-(C)' || deviceName == 'YR.PZ-05R') {
        // Para yaros nomás:
        newMsg.MCA = mca;
        if (parseFloat(newMsg.MCA) === 0) {
            newMsg.NF = 'undefined';
            newMsg.ALT = 'undefined';
        } else {
            newMsg.NF = profInstall - newMsg.MCA;
            newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * Math.sin(incli * Math.PI / 180));
        }
    } else {
        newMsg.NF = profInstall - newMsg.MCA;
        newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * Math.sin(incli * Math.PI / 180));
    }
}

// ---- 3. "Linear Geokon" Equation ---- (excepción Boroo Misquichilca "BM.")
var newMsg = {};
var factorConvUpToMca = 1;
var mca = 0;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var inputTemp = parseFloat(metadata.shared_inputTemp);
var inputTempCorreccion = parseFloat(metadata.shared_inputTempCorreccion);
var devicename = metadata.deviceName;
var criteria = metadata.shared_criteria;
var unidad = metadata.shared_unidad;
if (devicename.split(".")[0] === 'BM') {
    if (!isNaN(inputTemp) && inputTemp > 0) {
        temp = inputTemp;
        newMsg.Temp = temp;
    }
    if (!isNaN(inputTempCorreccion)) {
        if (parseFloat(msg.Temp) < inputTempCorreccion) {
            temp = inputTempCorreccion;
            newMsg.Temp = temp;
            newMsg.Tempdetalle = 'correccion de temp';
        }
    }
}
newMsg.MPA = ((freq - freqIni) * cf) + ((temp - tempIni) * tk);
if (criteria === 'negatedCf') {
    newMsg.MPA = ((freqIni - freq) * cf) + ((temp - tempIni) * tk);
}
if (unidad === 'KPA') { factorConvUpToMca = 0.1019744; }
else if (unidad === 'MPA') { factorConvUpToMca = 101.9744; }
else if (unidad === 'PSI') { factorConvUpToMca = 0.703546663; }
newMsg.MCA = newMsg.MPA * factorConvUpToMca + offset;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.PsPoros = newMsg.MPA;
newMsg.MtColAgua = newMsg.MCA;
newMsg.ALT = altitud + mca;

// ---- 4. "Linear B" Equation ----
var newMsg = {};
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var constante = 1;
var factor_unidad = 1;
var mca = 0;
newMsg.Temp = temp;
if (typeof metadata.shared_offset_bunits != undefined) {
    var offsetBunits = parseFloat(metadata.shared_offset_bunits);
    freq = freq + offsetBunits;
    newMsg.Freq = freq;
}
newMsg.resul_freq = (freq - freqIni) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') { constante = 101.972; factor_unidad = 0.001; }
if (deviceType === 'settlement-cell') {
    newMsg.MPA = newMsg.resul;
    newMsg.MCA = newMsg.MPA;
} else {
    newMsg.MPA = newMsg.resul * factor_unidad;
    newMsg.MCA = newMsg.MPA * constante + offset;
}
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') {
    newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA);
} else {
    newMsg.ALT = newMsg.ALT_INSTALL + mca;
}

// ---- 5. "Polynomial A" Equation ----
var mca = 0;
var kpa = 0.1019744;
var mpa = 101.9744;
var newMsg = {};
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var unidad = String(metadata.shared_unidad);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
if (unidad.toLowerCase() === 'kpa') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad.toLowerCase() === 'mpa') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
}
newMsg.MPA = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + (tk * (temp - tempIni));
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca + offset;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = newMsg.ALT_INSTALL + mca;

// ---- 6. "Unknown Equation" == polinomial_comp (CONFIRMADO MUERTO, comentario
// propio del legado: "VERIFICADO EL 13-08-2024 QUE NINGUN SENSOR POSEE
// polinomial_comp COMO EQUATION.") -- también es el dispatcher interno de
// linear_a/linear_b + polynomial_a/polynomial_a1/polynomial_comp por
// substring, con lógica de alarma por color/umbral embebida (umbral1..5,
// alarmcolor, alarmlevel) -- ver texto completo en la sesión si hace falta,
// omitido aquí por ser código muerto confirmado y muy extenso (~200 líneas).

// ---- 7. "Linear C" Equation ----
var newMsg = {};
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101972;
var mpa = 101.972;
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
}
newMsg.MPA = newMsg.resul + offset;
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - newMsg.MCA; }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 8. "Linear E" Equation ---- (incluye corrección barométrica pres_bar/pres_bar_ini)
var newMsg = {};
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var pres_bar_ini = parseFloat(metadata.shared_pres_bar_ini);
var pres_bar = parseFloat(metadata.shared_pres_bar);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101972;
var mpa = 101.972;
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf + (pres_bar_ini - pres_bar) * 0.0001;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
}
newMsg.MPA = newMsg.resul + offset;
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - newMsg.MCA; }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 9. "Unknown Equation" == polinomial_a1 (CONFIRMADO MUERTO, mismo
// comentario "VERIFICADO EL 13-08-2024...", casi idéntico al nodo 6 --
// dispatcher interno duplicado, omitido por ser código muerto confirmado)

// ---- 10. "Linear A" Equation ---- (Temp por defecto 10.13 si NaN)
var newMsg = {};
var constante = 1;
var factor_unidad = 1;
var mca = 0;
var freq = parseFloat(msg.Freq);
if ((typeof msg.Temp == 'undefined') || isNaN(msg.Temp) || (msg.Temp == 'NaN') || (msg.Temp == 'NAN')) {
    var temp = 10.13;
} else {
    var temp = parseFloat(msg.Temp);
}
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
newMsg.TempIni = tempIni;
newMsg.FreqIni = freqIni;
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') { constante = 101.972; factor_unidad = 0.001; }
newMsg.MPA = newMsg.resul * factor_unidad;
newMsg.MCA_original = newMsg.MPA * constante;
newMsg.MCA = newMsg.MCA_original + offset;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA); }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 11. "Polynomial CasaGrande RST" Equation ---- (usa NF/inclinación, no ALT_INSTALL+mca directo)
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var tk = parseFloat(metadata.shared_tk);
var tempIni = parseFloat(metadata.shared_TempIni);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var offsetPp = parseFloat(metadata.shared_offset_pp);
var altitud = parseFloat(metadata.shared_altitud);
var profInstall = parseFloat(metadata.shared_prof_install);
var cotaSuperficie = parseFloat(metadata.shared_cota_superficie);
var stickup = parseFloat(metadata.shared_stickup);
var incli = parseFloat(metadata.shared_incli);
var factor = 0.101974;
var mca = 0;
newMsg.MPA = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + (tk * (temp - tempIni)) + offsetPp;
if (unidad === 'KPA') { newMsg.MCA = newMsg.MPA * factor; }
if (unidad === 'MPA') { newMsg.MCA = newMsg.MPA * factor * 1000; }
mca = newMsg.MCA;
newMsg.ALT_INSTALL = altitud;
var crit = Math.sin(incli * Math.PI / 180);
newMsg.NF = profInstall - (mca / crit);
newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * crit);

// ---- 12. "Linear Soil Instruments" Equation ---- (Pp = G*(R0-R1), sin término de temperatura)
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var freqIni = parseFloat(metadata.shared_FreqIni);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101974;
var mpa = 101.974;
var mca = 0;
newMsg.MPA = cf * (freqIni - freq);
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
}
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = altitud + mca;

// ---- 13. "Linear C1" Equation ---- (idéntica estructura a Linear C pero freq-freqIni en vez de freqIni-freq)
var newMsg = {};
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101972;
var mpa = 101.972;
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freq - freqIni) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
}
newMsg.MPA = newMsg.resul + offset;
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - newMsg.MCA; }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 14. "Copy of Original Data" ---- (utilidad, no es fórmula de familia)
msg.oriFreq = parseFloat(msg.Freq);
msg.oriTemp = parseFloat(msg.Temp);
if (isNaN(msg.oriFreq)) { msg.oriFreq = 'NaN'; }
if (isNaN(msg.oriTemp)) { msg.oriTemp = 'NaN'; }

// ---- 15. "Polynomial CasaGrande" Equation ---- (misma familia que #11 pero sin corrección por temperatura)
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var offsetPp = parseFloat(metadata.shared_offset_pp);
var altitud = parseFloat(metadata.shared_altitud);
var profInstall = parseFloat(metadata.shared_prof_install);
var cotaSuperficie = parseFloat(metadata.shared_cota_superficie);
var stickup = parseFloat(metadata.shared_stickup);
var incli = parseFloat(metadata.shared_incli);
var mca = 0;
newMsg.Temp = temp;
if (unidad === 'KPA') {
    newMsg.MPA = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + offsetPp;
    newMsg.MCA = newMsg.MPA * 0.101974;
}
if (unidad === 'MPA') {
    newMsg.MPA = ((paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + offsetPp);
    newMsg.MCA = newMsg.MPA * 101.974;
}
mca = newMsg.MCA;
newMsg.ALT_INSTALL = altitud;
newMsg.NF = profInstall - (mca / Math.sin(incli * Math.PI / 180));
newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * Math.sin(incli * Math.PI / 180));

// ---- 16. "Linear" Equation ---- (default/genérica; soporta PSI además de KPA/MPA; caso settlement-cell calcula Asentamiento)
var newMsg = {};
var deviceType = metadata.ss_type;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101972;
var mpa = 101.972;
var psi = 0.703546662568367;
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (tempIni - temp) * tk;
newMsg.resul = newMsg.resul_freq - newMsg.resul_temp;
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
} else if (unidad === 'PSI') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = psi; }
}
newMsg.MPA = newMsg.resul;
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') {
    newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA);
    newMsg.ElevacionFinal = newMsg.ALT_INSTALL - newMsg.MPA;
    newMsg.Asentamiento = newMsg.ALT_INSTALL - newMsg.ElevacionFinal;
} else {
    newMsg.ALT = newMsg.ALT_INSTALL + mca;
}

// ---- 17. "Linear D" Equation ---- (densidad de agua por tabla piecewise real -- ver ADR-189)
var newMsg = {};
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var p = 101971.6;
var mca = 0;
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
if (unidad === 'KPA') { p = p / 1000; }
if (temp < 4) { newMsg.densidad = 999.87 + (temp / 4) * 0.13; }
else if (4 <= temp < 10) { newMsg.densidad = 1000 - ((temp - 4) / 6) * 0.27; }
else if (10 <= temp < 20) { newMsg.densidad = 999.73 - ((temp - 10) / 10) * 0.5; }
else if (20 <= temp < 25) { newMsg.densidad = 998.23 - ((temp - 20) / 5) * 1.15; }
else if (25 <= temp < 30) { newMsg.densidad = 997.08 - ((temp - 25) / 5) * 1.4; }
else if (30 <= temp < 40) { newMsg.densidad = 993.68 - ((temp - 30) / 10) * 3.43; }
newMsg.presionKg = newMsg.resul * p;
newMsg.MPA = newMsg.resul;
newMsg.MCA = newMsg.presionKg / newMsg.densidad;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - newMsg.MCA; }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 18. "Add Umbrals" ---- (utilidad, copia umbrales 1-5 al mensaje)
var newMsg = {};
newMsg.umbral1 = metadata.ss_umbral1;
newMsg.umbral2 = metadata.ss_umbral2;
newMsg.umbral3 = metadata.ss_umbral3;
newMsg.umbral4 = metadata.ss_umbral4;
newMsg.umbral5 = metadata.ss_umbral5;

// ---- 19. "Only if MPa: to KPa" ---- (utilidad de conversión post-cálculo)
var unidad = metadata.shared_unidad;
if (unidad === 'MPA') {
    msg.PsPoros = msg.PsPoros * 1000;
    msg.MPA = msg.MPA * 1000;
}

// ---- 20. "Polynomial Slope Hz" Equation ---- (freqHz = sqrt(freq*1000))
var newMsg = {};
var deviceType = metadata.deviceType;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var freqHz = Math.sqrt(freq * 1000);
var factor_conv_up_to_mca = 0.1019744;
var mca = 0;
newMsg.MPA = (paramA * Math.pow(freqHz, 2)) + (paramB * freqHz) + paramC;
newMsg.FreqHz = freqHz;
if (unidad === 'MPA') { factor_conv_up_to_mca = factor_conv_up_to_mca * 1000; }
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca + offset;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') { newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA); }
else { newMsg.ALT = newMsg.ALT_INSTALL + mca; }

// ---- 21. "Polynomial B" Equation ---- (paramC0 en vez de paramC, sin corrección de temperatura en la fórmula)
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC0 = parseFloat(metadata.shared_param_c0);
var altitud = parseFloat(metadata.shared_altitud);
var mpa = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC0;
var mca = mpa * 0.101974;
if (unidad === 'MPA') { mpa = mpa / 1000; mca = mca * 1000; }
var alt;
if (mca > 0) { alt = altitud + mca; } else { alt = altitud + 0; }
newMsg.Temp = temp;
newMsg.Freq = freq;
newMsg.MPA = mpa;
newMsg.MCA = mca;
newMsg.ALT = alt;

// ---- 22. "Polynomial Geokon" Equation ---- (idéntica a Polynomial RST salvo comentarios)
var newMsg = {};
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var press = parseFloat(msg.Press);
var tempIni = parseFloat(metadata.shared_TempIni);
var pressIni = parseFloat(metadata.shared_PressIni);
var paramA = parseFloat(metadata.shared_param_a);
var paramB = parseFloat(metadata.shared_param_b);
var paramC = parseFloat(metadata.shared_param_c);
var tk = parseFloat(metadata.shared_tk);
var altitud = parseFloat(metadata.shared_altitud);
var offset = parseFloat(metadata.shared_offset);
var mca = 0;
newMsg.PsPoros = (paramA * Math.pow(freq, 2)) + (paramB * freq) + paramC + (tk * (temp - tempIni)) + offset;
if (!isNaN(pressIni) && !isNaN(press) && (pressIni !== 0)) {
    if (unidad.toLowerCase() === 'kpa') { newMsg.PsPoros = newMsg.PsPoros - (0.1 * (press - pressIni)); }
    else if (unidad.toLowerCase() === 'mpa') { newMsg.PsPoros = newMsg.PsPoros - (0.0001 * (press - pressIni)); }
}
newMsg.MPA = newMsg.PsPoros;
if (unidad.toLowerCase() === 'kpa') { newMsg.MtColAgua = newMsg.PsPoros * 0.1019744; }
else if (unidad.toLowerCase() === 'mpa') { newMsg.MtColAgua = newMsg.PsPoros * 101.9744; }
newMsg.MCA = newMsg.MtColAgua;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = newMsg.ALT_INSTALL + mca;

// ---- 23. "Linear RST PSI" equation ---- (convierte a PSI antes de MCA)
var newMsg = {};
var mpa_to_psi = 145.038;
var kpa_to_psi = 0.145038;
var psi_to_mca = 0.703546662568367;
var mca = 0;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var deviceType = metadata.ss_type;
var unidad = metadata.shared_unidad;
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (tempIni - temp) * tk;
newMsg.resul = newMsg.resul_freq - newMsg.resul_temp;
newMsg.MPA = newMsg.resul;
if (unidad === 'KPA') { newMsg.MPA = newMsg.MPA * kpa_to_psi; }
else if (unidad === 'MPA') { newMsg.MPA = newMsg.MPA * mpa_to_psi; }
if (factor_conv_up_to_mca === 0 || isNaN(factor_conv_up_to_mca)) { factor_conv_up_to_mca = psi_to_mca; }
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') {
    newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA);
    newMsg.ElevacionFinal = newMsg.ALT_INSTALL - newMsg.MPA;
    newMsg.Asentamiento = newMsg.ALT_INSTALL - newMsg.ElevacionFinal;
} else {
    newMsg.ALT = newMsg.ALT_INSTALL + mca;
}

// ---- 24. "Linear Geokon PSI" Equation ---- (misma que #23 pero freq-freqIni, no freqIni-freq)
var newMsg = {};
var mpa_to_psi = 145.038;
var kpa_to_psi = 0.145038;
var psi_to_mca = 0.703546662568367;
var mca = 0;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var deviceType = metadata.ss_type;
var unidad = metadata.shared_unidad;
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
newMsg.resul_freq = (freq - freqIni) * cf;
newMsg.resul_temp = (temp - tempIni) * tk;
newMsg.resul = newMsg.resul_freq + newMsg.resul_temp;
newMsg.MPA = newMsg.resul;
if (unidad === 'KPA') { newMsg.MPA = newMsg.MPA * kpa_to_psi; }
else if (unidad === 'MPA') { newMsg.MPA = newMsg.MPA * mpa_to_psi; }
if (factor_conv_up_to_mca === 0 || isNaN(factor_conv_up_to_mca)) { factor_conv_up_to_mca = psi_to_mca; }
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
if (deviceType === 'settlement-cell') {
    newMsg.ALT = newMsg.ALT_INSTALL - Math.abs(newMsg.MCA);
    newMsg.ElevacionFinal = newMsg.ALT_INSTALL - newMsg.MPA;
    newMsg.Asentamiento = newMsg.ALT_INSTALL - newMsg.ElevacionFinal;
} else {
    newMsg.ALT = newMsg.ALT_INSTALL + mca;
}

// ---- 25. "Convert Frequency if exist" ---- (utilidad: Hz^2/1000 si shared_unidad_freq=='hertz')
if (metadata.shared_unidad_freq == "hertz" && msg.hasOwnProperty("Freq")) {
    var originalFreq = msg.Freq;
    msg.Freq = Math.pow(originalFreq, 2) / 1000;
}

// ---- 26. "Convert Temperature if exist" ---- (utilidad: ohm -> Celsius, ecuación Steinhart-like)
if (msg.hasOwnProperty('Temp')) {
    if (metadata.shared_unidad_temp == 'ohm') {
        var C0 = 1.40503E-03;
        var C1 = 2.36939E-04;
        var C3 = 1.01266E-07;
        var temp = parseFloat(msg.Temp);
        if (temp > 0) {
            var tempLog = Math.log(temp);
            msg.Temp = 1 / (C3 * Math.pow(tempLog, 3) + C1 * tempLog + C0) - 273.15;
        } else {
            msg.Temp = "NaN";
        }
    }
}

// ---- 27. "MCA < 0 & Umbrales" ---- (fuera del switch de familias; aplica a deviceType piezometer/piezometer_equation)
var tipo = metadata.deviceType;
if (tipo == "piezometer_equation" || tipo == "piezometer") {
    var mca = parseFloat(msg.MCA);
    if (isFinite(mca) && mca <= 0) { msg.ALT = "Seco"; }
}
msg.cota_superficie = metadata.shared_cota_superficie;
msg.nivel_alerta = metadata.shared_nivel_alerta;
msg.nivel_peligro = metadata.shared_nivel_peligro;

// ---- 28. "Linear_GF" Equation ---- (excepción GF.PZ VW-1703 CONFIRMADA)
var newMsg = {};
var deviceType = metadata.ss_type;
var unidad = metadata.shared_unidad;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var cota_superficie = parseFloat(metadata.shared_cota_superficie);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
var kpa = 0.101972;
var mpa = 101.972;
var psi = 0.703546662568367;
var mca = 0;
if (metadata.deviceName == 'GF.PZ VW-1703') { temp = 10.98189; }
newMsg.Temp = temp;
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (tempIni - temp) * tk;
newMsg.resul = newMsg.resul_freq - newMsg.resul_temp;
if (unidad === 'KPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = kpa; }
} else if (unidad === 'MPA') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 100) { factor_conv_up_to_mca = mpa; }
} else if (unidad === 'PSI') {
    if (isNaN(factor_conv_up_to_mca) || factor_conv_up_to_mca <= 0 || factor_conv_up_to_mca >= 1) { factor_conv_up_to_mca = psi; }
}
newMsg.MPA = newMsg.resul;
newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = newMsg.ALT_INSTALL + mca;
newMsg.NF = cota_superficie - newMsg.ALT;

// ---- 29. "Linear Geokon PSI a KPA-MPA" Equation ---- (parte de PSI crudo, convierte a KPA o MPA final)
var newMsg = {};
var psi_to_mpa = 0.006894757;
var psi_to_kpa = 6.894757;
var mca = 0;
var freq = parseFloat(msg.Freq);
var temp = parseFloat(msg.Temp);
var unidadFin = metadata.shared_unidadFin;
var freqIni = parseFloat(metadata.shared_FreqIni);
var tempIni = parseFloat(metadata.shared_TempIni);
var tk = parseFloat(metadata.shared_tk);
var cf = parseFloat(metadata.shared_cf);
var altitud = parseFloat(metadata.shared_altitud);
var factor_conv_up_to_mca = parseFloat(metadata.shared_factor_conv_up_to_mca);
newMsg.resul_freq = (freqIni - freq) * cf;
newMsg.resul_temp = (tempIni - temp) * tk;
newMsg.resul = newMsg.resul_freq - newMsg.resul_temp;
newMsg.MPA_ini = newMsg.resul;
if (unidadFin === 'KPA') {
    newMsg.MPA = newMsg.MPA_ini * psi_to_kpa;
    if (factor_conv_up_to_mca === 0 || isNaN(factor_conv_up_to_mca)) { factor_conv_up_to_mca = 0.101974; }
    newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
} else if (unidadFin === 'MPA') {
    newMsg.MPA = newMsg.MPA_ini * psi_to_mpa;
    if (factor_conv_up_to_mca === 0 || isNaN(factor_conv_up_to_mca)) { factor_conv_up_to_mca = 101.974; }
    newMsg.MCA = newMsg.MPA * factor_conv_up_to_mca;
}
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.ALT_INSTALL = altitud;
newMsg.ALT = newMsg.ALT_INSTALL + mca;
