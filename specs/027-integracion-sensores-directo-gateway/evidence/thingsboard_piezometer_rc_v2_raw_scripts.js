// Extraído en vivo de https://board.beemetry.com el 2026-09-16 vía fetch()
// autenticado (sesión propia de Steven Vera, GET /api/ruleChain/{id}/metadata),
// solo lectura. Cadena: PiezometerRC-V2 (id ffa2f2d0-629d-11ed-8142-dd34011319e1).
// Estos son los 29 nodos TbTransformMsgNode y el dispatcher TbJsSwitchNode
// TEXTUALES del ThingsBoard legado real, para comparar 1:1 contra las 27
// plantillas de sensor_formula_template_def (ADR-189) en SPEC-027 T13/T14/T15.

// ============================================================
// DISPATCHER: "Filter Equation" (TbJsSwitchNode)
// ============================================================
/*
if (msgType === 'POST_TELEMETRY_REQUEST') {
    if (metadata.shared_equation == 'linear') { return ['linear']; }
    else if (metadata.shared_equation == 'linear_GF') { return ['linear_GF']; }
    else if (metadata.shared_equation == 'linear_a') { return ['linear_a']; }
    else if (metadata.shared_equation == 'linear_b') { return ['linear_b']; }
    else if (metadata.shared_equation == 'linear_c') { return ['linear_c']; }
    else if (metadata.shared_equation == 'linear_c1') { return ['linear_c1']; }
    else if (metadata.shared_equation == 'linear_d') { return ['linear_d']; }
    else if (metadata.shared_equation == 'linear_e') { return ['linear_e']; }
    else if (metadata.shared_equation == 'linearGeokon') { return ['linearGeokon']; }
    else if (metadata.shared_equation == 'linearSoilInstruments') { return ['linearSoilInstruments']; }
    else if (metadata.shared_equation == 'linearRSTPsi') { return ['linearRSTPsi']; }
    else if (metadata.shared_equation == 'linearGeokonPsi') { return ['linearGeokonPsi']; }
    else if (metadata.shared_equation == 'polinomial_a' || metadata.shared_equation == 'polynomial_a') { return ['polinomial_a']; }
    else if (metadata.shared_equation == 'polinomial_a1') { return ['polinomial_a1']; }
    else if (metadata.shared_equation == 'polinomial_a2') { return ['polinomial_a2']; }
    else if (metadata.shared_equation == 'polinomial_comp') { return ['polinomial_comp']; }
    else if (metadata.shared_equation == 'polinomial_casagrande') { return ['polinomial_casagrande']; }
    else if (metadata.shared_equation == 'polinomial_casagrande_rst') { return ['polinomial_casagrande_rst']; }
    else if (metadata.shared_equation == 'polynomialB') { return ['polynomialB']; }
    else if (metadata.shared_equation == 'polynomialGeokon') { return ['polynomialGeokon']; }
    else if (metadata.shared_equation == 'polynomialRST') { return ['polynomialRST']; }
    else if (metadata.shared_equation == 'polynomialSlope') { return ['polynomialSlope']; }
    else if (metadata.shared_equation == 'linear_psi_geokon') { return ['linear_psi_geokon']; }
    else { return ['default']; }
}
*/

// ============================================================
// "Polynomial RST" Equation
// ============================================================
/*
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
*/

// ============================================================
// "Polynomial A2" Equation  (bifurca por deviceType == 'settlement-cell' y por
// deviceName exacto 'YR.PZ-05R*' -- excepción de cliente adicional NO
// documentada todavía en ADR-189, hallazgo nuevo de esta sesión)
// ============================================================
/*
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
        if (parseFloat(newMsg.MCA) === 0) { newMsg.NF = 'undefined'; newMsg.ALT = 'undefined'; }
        else { newMsg.NF = profInstall - newMsg.MCA; newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * Math.sin(incli * Math.PI / 180)); }
    } else {
        newMsg.NF = profInstall - newMsg.MCA;
        newMsg.ALT = cotaSuperficie - ((newMsg.NF - stickup) * Math.sin(incli * Math.PI / 180));
    }
}
*/

// ============================================================
// "Linear Geokon" Equation (excepción Boroo Misquichilca real, deviceName
// empieza con "BM.")
// ============================================================
/*
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
// Revisar si es Boroo Misquichilca:
if (devicename.split(".")[0] === 'BM') {
    if (!isNaN(inputTemp) && inputTemp > 0) { temp = inputTemp; newMsg.Temp = temp; }
    if (!isNaN(inputTempCorreccion)) {
        if (parseFloat(msg.Temp) < inputTempCorreccion) { temp = inputTempCorreccion; newMsg.Temp = temp; newMsg.Tempdetalle = 'correccion de temp'; }
    }
}
newMsg.MPA = ((freq - freqIni) * cf) + ((temp - tempIni) * tk);
if (criteria === 'negatedCf') { newMsg.MPA = ((freqIni - freq) * cf) + ((temp - tempIni) * tk); }
if (unidad === 'KPA') { factorConvUpToMca = 0.1019744; }
else if (unidad === 'MPA') { factorConvUpToMca = 101.9744; }
else if (unidad === 'PSI') { factorConvUpToMca = 0.703546663; }
newMsg.MCA = newMsg.MPA * factorConvUpToMca + offset;
if (newMsg.MCA > 0) { mca = newMsg.MCA; }
newMsg.PsPoros = newMsg.MPA;
newMsg.MtColAgua = newMsg.MCA;
newMsg.ALT = altitud + mca;
*/

// ============================================================
// "Linear B" / "Linear A" / "Linear C" / "Linear C1" / "Linear E" / "Linear"
// Equation -- misma familia estructural (G*(freq-freqIni)*cf +/- K*(temp-tempIni)*tk,
// difieren en signo de freq, si usan factor_conv_up_to_mca fijo o dinámico,
// y en el trato especial de deviceType=='settlement-cell')
// ============================================================
// Ver transcripción completa de la sesión para el texto íntegro de cada una
// (idéntico en estructura, difieren en detalle -- confirmar contra
// sensor_formula_template_def.expression antes de cerrar T13 por familia).

// ============================================================
// "Polynomial A" / "Polynomial B" / "Polynomial CasaGrande" /
// "Polynomial CasaGrande RST" / "Polynomial Geokon" / "Polynomial Slope Hz" /
// "Polynomial RST" Equation -- familia paramA*freq^2 + paramB*freq + paramC
// (+/- variantes de offset/paramD/temperatura)
// ============================================================

// ============================================================
// "Linear D" Equation -- CONFIRMA la simplificación ya documentada en
// ADR-189: densidad de agua por tabla piecewise real (no constante):
// ============================================================
/*
if (temp < 4) { newMsg.densidad = 999.87 + (temp / 4) * 0.13; }
else if (4 <= temp < 10) { newMsg.densidad = 1000 - ((temp - 4) / 6) * 0.27; }
else if (10 <= temp < 20) { newMsg.densidad = 999.73 - ((temp - 10) / 10) * 0.5; }
else if (20 <= temp < 25) { newMsg.densidad = 998.23 - ((temp - 20) / 5) * 1.15; }
else if (25 <= temp < 30) { newMsg.densidad = 997.08 - ((temp - 25) / 5) * 1.4; }
else if (30 <= temp < 40) { newMsg.densidad = 993.68 - ((temp - 30) / 10) * 3.43; }
newMsg.presionKg = newMsg.resul * p;   // p = 101971.6 (o /1000 si KPA)
newMsg.MCA = newMsg.presionKg / newMsg.densidad;
*/

// ============================================================
// "Linear_GF" Equation -- CONFIRMA la excepción GF.PZ VW-1703 real:
// ============================================================
/*
if (metadata.deviceName == 'GF.PZ VW-1703') { temp = 10.98189; }
*/

// ============================================================
// "MCA < 0 & Umbrales" (nodo fuera del switch de familias, aplica a
// deviceType 'piezometer'/'piezometer_equation') -- CONFIRMA que "Seco" es
// capa de presentación, no parte de ninguna fórmula:
// ============================================================
/*
var tipo = metadata.deviceType;
if (tipo == "piezometer_equation" || tipo == "piezometer") {
    var mca = parseFloat(msg.MCA);
    if (isFinite(mca) && mca <= 0) { msg.ALT = "Seco"; }
}
*/

// ============================================================
// "Unknown Equation" (dispatcher interno de polinomial_a1 / polinomial_comp)
// -- CONFIRMA por comentario propio del legado que AMBAS están muertas:
// ============================================================
/*
// NOTA IMPORTANTE: VERIFICADO EL 13-08-2024 QUE NINGUN SENSOR POSEE
// polinomial_comp COMO EQUATION.   (nodo 1)
// NOTA IMPORTANTE: VERIFICADO EL 13-08-2024 QUE NINGUN SENSOR POSEE
// polinomial_a1 COMO EQUATION.     (nodo 2, casi idéntico, dispatcher interno
//                                    de polynomial_a1/_a/_comp por substring)
*/

// NOTA: este archivo es un resumen curado con los fragmentos más relevantes
// para T13/T14/T15 (excepciones de dispositivo, simplificaciones numéricas,
// familias confirmadas muertas). El texto verbatim completo de los 29 nodos
// fue capturado en la sesión del navegador del 2026-09-16 y puede
// re-extraerse con el mismo método (fetch autenticado a
// /api/ruleChain/{id}/metadata) si se necesita el detalle íntegro de las
// familias restantes (Linear A/B/C/C1/E, Polynomial A/B/CasaGrande/Geokon/
// Slope, RST PSI, Geokon PSI, Geokon PSI a KPA-MPA, Soil Instruments).
