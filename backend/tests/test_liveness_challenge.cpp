#include <catch2/catch_test_macros.hpp>
#include "biometric/liveness_challenge.hpp"

// ADR-142/146: liveness activa verificada en el servidor -- antes de
// ADR-142 la cola de desafíos y si cada uno se cumplió las decidía el
// cliente (frontend/src/auth/livenessChallenge.ts), lo que permitía a un
// cliente scripteado fingir "ya cumplí el desafío" sin que nadie hubiera
// visto un gesto real frente a la cámara. ADR-146 bajó la cola de 2 a 1
// desafío y reemplazó blink/mouth por move_closer/move_away (acercarse/
// alejarse de la cámara, más manejable que abrir la boca, parpadear o
// inclinar la cabeza a propósito -- el parpadeo ya queda cubierto, mejor,
// por el parpadeo NATURAL pasivo de ADR-143). Estas pruebas cubren la
// máquina de estados que corre en el servidor (evaluateLivenessChallenge), a
// partir de los mismos headYawRatio/interEyePx que ya calcula MediaPipe por
// frame en /api/process_frame.

using namespace biometric;

namespace {
std::chrono::steady_clock::time_point t0() {
  return std::chrono::steady_clock::now();
}
}  // namespace

TEST_CASE("pickChallengeQueue: sortea 1 desafio de los 6 conocidos") {
  const auto queue = pickChallengeQueue();
  CHECK(queue.size() == static_cast<std::size_t>(kLivenessChallengeCount));
  for (const auto &c : queue) {
    CHECK((c == "turn_left" || c == "turn_right" || c == "shift_left" ||
           c == "shift_right" || c == "move_closer" || c == "move_away"));
  }
}

TEST_CASE("pickReplacementChallenge: nunca devuelve uno excluido si hay pool disponible") {
  const std::vector<std::string> exclude = {"turn_left", "turn_right", "shift_left", "shift_right"};
  const auto replacement = pickReplacementChallenge(exclude);
  CHECK((replacement == "move_closer" || replacement == "move_away"));
}

TEST_CASE("pickReplacementChallenge: fail-closed cuando los 6 ya estan excluidos") {
  const std::vector<std::string> exclude = {"turn_left",  "turn_right",  "shift_left",
                                            "shift_right", "move_closer", "move_away"};
  const auto replacement = pickReplacementChallenge(exclude);
  CHECK(replacement == "move_away");  // repite el ultimo, nunca queda vacio
}

TEST_CASE("evaluateLivenessChallenge: sortea la cola y captura la referencia de distancia/posicion en la primera llamada") {
  LivenessChallengeState st;
  const auto now = t0();
  evaluateLivenessChallenge(st, /*headYawRatio*/ 0.0, /*interEyePx*/ 200.0,
                            /*faceOvalCx*/ 300.0, now);
  CHECK(st.queue.size() == 1);
  CHECK_FALSE(st.complete);
  CHECK(st.index == 0);
  CHECK(st.baselineInterEyePx == 200.0);
  CHECK(st.baselineFaceCenterX == 300.0);
}

TEST_CASE("evaluateLivenessChallenge: turn_left/turn_right satisfacen por umbral de headYawRatio") {
  LivenessChallengeState stLeft;
  stLeft.queue = {"turn_left"};
  stLeft.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(stLeft, kLivenessHeadYawTurnThreshold - 0.01, 200.0, 0.0, t0());
  CHECK_FALSE(stLeft.complete);  // por debajo del umbral no satisface
  evaluateLivenessChallenge(stLeft, kLivenessHeadYawTurnThreshold + 0.01, 200.0, 0.0, t0());
  CHECK(stLeft.complete);

  LivenessChallengeState stRight;
  stRight.queue = {"turn_right"};
  stRight.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(stRight, -kLivenessHeadYawTurnThreshold - 0.01, 200.0, 0.0, t0());
  CHECK(stRight.complete);
}

TEST_CASE("evaluateLivenessChallenge: shift_left/shift_right satisfacen por desplazamiento lateral del centro del ovalo") {
  LivenessChallengeState stLeft;
  stLeft.queue = {"shift_left"};
  stLeft.baselineInterEyePx = 200.0;
  stLeft.baselineFaceCenterX = 500.0;
  stLeft.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  // Por debajo del umbral (kLivenessHeadShiftRatio == 0.35 * 200 == 70px) no satisface.
  evaluateLivenessChallenge(stLeft, 0.0, 200.0, 500.0 + 60.0, t0());
  CHECK_FALSE(stLeft.complete);
  evaluateLivenessChallenge(stLeft, 0.0, 200.0, 500.0 + 80.0, t0());
  CHECK(stLeft.complete);

  LivenessChallengeState stRight;
  stRight.queue = {"shift_right"};
  stRight.baselineInterEyePx = 200.0;
  stRight.baselineFaceCenterX = 500.0;
  stRight.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(stRight, 0.0, 200.0, 500.0 - 80.0, t0());
  CHECK(stRight.complete);
}

TEST_CASE("evaluateLivenessChallenge: shift_left/shift_right fail-closed sin referencia valida") {
  LivenessChallengeState st;
  st.queue = {"shift_left"};
  st.baselineInterEyePx = 0.0;  // no deberia pasar en la practica, pero fail-closed
  st.baselineFaceCenterX = 500.0;
  st.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(st, 0.0, 200.0, 5000.0, t0());
  CHECK_FALSE(st.complete);
}

TEST_CASE("evaluateLivenessChallenge: move_closer/move_away satisfacen por proporcion de interEyePx sobre la referencia") {
  LivenessChallengeState stCloser;
  stCloser.queue = {"move_closer"};
  stCloser.baselineInterEyePx = 200.0;
  stCloser.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(stCloser, 0.0, 200.0 * kLivenessMoveCloserRatio - 1.0, 0.0, t0());
  CHECK_FALSE(stCloser.complete);  // por debajo del umbral no satisface
  evaluateLivenessChallenge(stCloser, 0.0, 200.0 * kLivenessMoveCloserRatio + 1.0, 0.0, t0());
  CHECK(stCloser.complete);

  LivenessChallengeState stAway;
  stAway.queue = {"move_away"};
  stAway.baselineInterEyePx = 200.0;
  stAway.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(stAway, 0.0, 200.0 * kLivenessMoveAwayRatio - 1.0, 0.0, t0());
  CHECK(stAway.complete);  // por debajo del umbral SI satisface (mas lejos que la referencia)
}

TEST_CASE("evaluateLivenessChallenge: move_closer/move_away fail-closed sin referencia valida") {
  LivenessChallengeState st;
  st.queue = {"move_closer"};
  st.baselineInterEyePx = 0.0;  // no deberia pasar en la practica, pero fail-closed
  st.deadline = t0() + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  evaluateLivenessChallenge(st, 0.0, 1000.0, 0.0, t0());
  CHECK_FALSE(st.complete);
}

TEST_CASE("evaluateLivenessChallenge: vencido el plazo pide OTRO reto distinto, no el mismo") {
  // ADR-156: repetir el gesto que la persona acaba de no lograr es lo que la
  // dejaba trabada -- cada intento nuevo sortea un tipo distinto.
  LivenessChallengeState st;
  st.queue = {"turn_left"};
  st.index = 0;
  st.attempt = 1;
  const auto now = t0();
  st.deadline = now - std::chrono::milliseconds(1);  // ya vencido

  evaluateLivenessChallenge(st, 0.0, 0.45, 0.0, now);
  CHECK(st.index == 0);              // sigue siendo el desafio 1 de la cola
  CHECK(st.attempt == 2);            // segundo de los kLivenessChallengeMaxAttempts pedidos
  CHECK(st.queue[0] != "turn_left"); // tipo nuevo, sorteado al azar
  CHECK(st.deadline > now);          // plazo renovado
  CHECK_FALSE(st.exhausted);
  CHECK_FALSE(st.complete);
}

TEST_CASE("evaluateLivenessChallenge: agotados los intentos marca exhausted en vez de seguir para siempre") {
  // ADR-156: al vencer el intento numero kLivenessChallengeMaxAttempts no se
  // sortea nada mas -- handleProcessFrame devuelve toda la captura a 0/5.
  LivenessChallengeState st;
  st.queue = {"turn_left"};
  st.index = 0;
  st.attempt = kLivenessChallengeMaxAttempts;  // ultimo intento permitido
  const auto now = t0();
  st.deadline = now - std::chrono::milliseconds(1);

  evaluateLivenessChallenge(st, 0.0, 0.45, 0.0, now);
  CHECK(st.exhausted);
  CHECK_FALSE(st.complete);
  CHECK(st.attempt == kLivenessChallengeMaxAttempts);  // no sigue subiendo
}

TEST_CASE("evaluateLivenessChallenge: exactamente kLivenessChallengeMaxAttempts retos antes de rendirse") {
  LivenessChallengeState st;
  auto now = t0();
  evaluateLivenessChallenge(st, 0.0, 200.0, 0.0, now);  // sortea la cola: reto 1 armado
  CHECK(st.attempt == 1);

  // Nadie cumple ningun gesto: cada vencimiento pide el siguiente reto.
  for (int expected = 2; expected <= kLivenessChallengeMaxAttempts; ++expected) {
    now += std::chrono::milliseconds(kLivenessChallengeTimeoutMs + 1);
    evaluateLivenessChallenge(st, 0.0, 200.0, 0.0, now);
    CHECK(st.attempt == expected);
    CHECK_FALSE(st.exhausted);
  }

  now += std::chrono::milliseconds(kLivenessChallengeTimeoutMs + 1);
  evaluateLivenessChallenge(st, 0.0, 200.0, 0.0, now);
  CHECK(st.exhausted);
  CHECK_FALSE(st.complete);
}

TEST_CASE("evaluateLivenessChallenge: no hace nada una vez exhausted (hasta que el llamador resetee)") {
  LivenessChallengeState st;
  st.queue = {"turn_left"};
  st.exhausted = true;
  const auto now = t0();
  evaluateLivenessChallenge(st, 5.0, 5.0, 0.0, now);  // gesto de sobra para satisfacer
  CHECK_FALSE(st.complete);
  CHECK(st.exhausted);
}

TEST_CASE("evaluateLivenessChallenge: no hace nada una vez complete") {
  LivenessChallengeState st;
  st.queue = {"turn_left"};
  st.index = 1;
  st.complete = true;
  const auto now = t0();
  evaluateLivenessChallenge(st, 5.0, 5.0, 0.0, now);
  CHECK(st.complete);
  CHECK(st.index == 1);
  CHECK(st.queue.size() == 1);  // no reordena ni sortea de nuevo
}

// ADR-143: parpadeo natural evaluado en SIMULTÁNEO con el resto de chequeos
// ICAO (a diferencia del desafío de arriba, que es una fase aparte porque
// gira la cabeza/abre la boca a propósito). Cubre que un parpadeo breve no
// penalice el gate de calidad, que un cierre sostenido sí, y que sólo haga
// falta un parpadeo real (no una foto fija) para marcar observed=true.

TEST_CASE("updateNaturalBlink: ojos abiertos todo el tiempo nunca marca observed") {
  NaturalBlinkState st;
  const auto now = t0();
  for (int i = 0; i < 10; ++i) {
    CHECK(updateNaturalBlink(st, /*eyesOpen*/ true, now + std::chrono::milliseconds(i * 175)));
  }
  CHECK_FALSE(st.observed);
}

TEST_CASE("updateNaturalBlink: foto fija con ojos cerrados todo el tiempo nunca marca observed") {
  NaturalBlinkState st;
  const auto now = t0();
  // Un cierre que nunca vuelve a abrir no completa ningún ciclo -- eso es
  // justo lo que distingue un parpadeo real de una foto/máscara con los
  // ojos cerrados: el ciclo cerrado->abierto nunca se cierra.
  for (int i = 0; i < 10; ++i) {
    updateNaturalBlink(st, /*eyesOpen*/ false, now + std::chrono::milliseconds(i * 175));
  }
  CHECK_FALSE(st.observed);
}

TEST_CASE("updateNaturalBlink: parpadeo breve (un frame cerrado) se tolera y marca observed") {
  NaturalBlinkState st;
  const auto now = t0();
  CHECK(updateNaturalBlink(st, true, now));                                    // frame 1: abierto
  CHECK(updateNaturalBlink(st, false, now + std::chrono::milliseconds(175)));   // frame 2: cerrado (parpadeo) -- tolerado, no invalida
  CHECK_FALSE(st.observed);  // todavia no completo el ciclo
  CHECK(updateNaturalBlink(st, true, now + std::chrono::milliseconds(350)));    // frame 3: abierto de nuevo -> ciclo completo
  CHECK(st.observed);
}

TEST_CASE("updateNaturalBlink: cierre sostenido mas alla de la ventana deja de tolerarse") {
  NaturalBlinkState st;
  const auto now = t0();
  CHECK(updateNaturalBlink(st, true, now));
  CHECK(updateNaturalBlink(st, false, now + std::chrono::milliseconds(175)));  // empieza a cerrarse -- tolerado
  // Sigue cerrado mucho mas alla de kNaturalBlinkMaxDurationMs (1500ms):
  // ya no es un parpadeo, es un cierre sostenido -- debe volver a contar
  // como frame invalido para el gate de calidad.
  const bool stillOk = updateNaturalBlink(
      st, false, now + std::chrono::milliseconds(175 + kNaturalBlinkMaxDurationMs + 200));
  CHECK_FALSE(stillOk);
  CHECK_FALSE(st.observed);
}

TEST_CASE("updateNaturalBlink: reabrir despues de un cierre demasiado largo no cuenta como parpadeo valido") {
  NaturalBlinkState st;
  const auto now = t0();
  CHECK(updateNaturalBlink(st, true, now));
  updateNaturalBlink(st, false, now + std::chrono::milliseconds(175));
  // Reabre despues de 2000ms cerrado -- mas alla de kNaturalBlinkMaxDurationMs,
  // no es un parpadeo plausible (alguien mirando hacia abajo, no vivo/no real).
  updateNaturalBlink(st, true, now + std::chrono::milliseconds(2000));
  CHECK_FALSE(st.observed);
}

TEST_CASE("updateNaturalBlink: con un parpadeo real ya alcanza, no hace falta que se repita") {
  NaturalBlinkState st;
  const auto now = t0();
  updateNaturalBlink(st, true, now);
  updateNaturalBlink(st, false, now + std::chrono::milliseconds(175));
  updateNaturalBlink(st, true, now + std::chrono::milliseconds(350));
  CHECK(st.observed);
  // Frames posteriores (con o sin nuevos parpadeos) no revierten observed.
  CHECK(updateNaturalBlink(st, true, now + std::chrono::milliseconds(525)));
  CHECK(st.observed);
}

// Pedido explicito del usuario 2026-09-07: control CONTINUO de parpadeo
// (distinto de `observed`, que es sticky para siempre) -- una foto estatica/
// mascara nunca parpadea, asi que isNaturalBlinkStale debe pasar a true si
// pasa demasiado tiempo sin ningun parpadeo nuevo, incluso si ya hubo uno al
// principio de la sesion.

TEST_CASE("isNaturalBlinkStale: false antes de cumplirse la ventana maxima sin parpadeo") {
  NaturalBlinkState st;
  const auto now = t0();
  updateNaturalBlink(st, true, now);  // arranca la ventana (windowStart)
  CHECK_FALSE(isNaturalBlinkStale(
      st, now + std::chrono::milliseconds(kNaturalBlinkMaxSampleWindowMs - 1)));
}

TEST_CASE("isNaturalBlinkStale: true al cumplirse la ventana maxima sin ningun parpadeo") {
  NaturalBlinkState st;
  const auto now = t0();
  updateNaturalBlink(st, true, now);
  CHECK(isNaturalBlinkStale(
      st, now + std::chrono::milliseconds(kNaturalBlinkMaxSampleWindowMs)));
}

TEST_CASE("isNaturalBlinkStale: un parpadeo real reinicia el reloj (no queda trabado en true)") {
  NaturalBlinkState st;
  const auto now = t0();
  updateNaturalBlink(st, true, now);
  updateNaturalBlink(st, false, now + std::chrono::milliseconds(175));
  updateNaturalBlink(st, true, now + std::chrono::milliseconds(350));  // parpadeo confirmado
  CHECK(st.observed);
  // Justo antes de cumplirse la ventana completa DESDE EL PARPADEO (350ms +
  // ventana - 1), todavia no esta stale aunque ya haya pasado la ventana
  // completa desde el ARRANQUE de la sesion -- el reloj se reinicio.
  CHECK_FALSE(isNaturalBlinkStale(
      st, now + std::chrono::milliseconds(350 + kNaturalBlinkMaxSampleWindowMs - 1)));
  // Pero si vuelve a pasar la ventana completa SIN un nuevo parpadeo desde
  // el ultimo confirmado, si queda stale -- "parpadeaba al principio y
  // despues dejo de hacerlo" es justamente el caso que esto detecta.
  CHECK(isNaturalBlinkStale(
      st, now + std::chrono::milliseconds(350 + kNaturalBlinkMaxSampleWindowMs + 1)));
}
