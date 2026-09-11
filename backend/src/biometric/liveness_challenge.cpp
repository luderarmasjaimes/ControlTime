#include "liveness_challenge.hpp"

#include <algorithm>
#include <array>
#include <random>

namespace biometric {

std::array<LivenessChallengeTypeCounters, kLivenessChallengeTypes.size()>
    gLivenessChallengeMetrics{};

int livenessChallengeTypeIndex(const std::string &type) {
  for (std::size_t i = 0; i < kLivenessChallengeTypes.size(); ++i) {
    if (type == kLivenessChallengeTypes[i]) {
      return static_cast<int>(i);
    }
  }
  return -1;
}

namespace {
std::mt19937 &challengeRng() {
  static thread_local std::mt19937 rng{std::random_device{}()};
  return rng;
}

std::string currentChallenge(const LivenessChallengeState &st) {
  if (st.index < 0 || static_cast<std::size_t>(st.index) >= st.queue.size()) {
    return {};
  }
  return st.queue[static_cast<std::size_t>(st.index)];
}

void recordChallengeArmed(const std::string &type) {
  const int idx = livenessChallengeTypeIndex(type);
  if (idx >= 0) {
    gLivenessChallengeMetrics[static_cast<std::size_t>(idx)].armed.fetch_add(
        1, std::memory_order_relaxed);
  }
}

void recordChallengeTimedOut(const std::string &type) {
  const int idx = livenessChallengeTypeIndex(type);
  if (idx >= 0) {
    gLivenessChallengeMetrics[static_cast<std::size_t>(idx)].timedOut.fetch_add(
        1, std::memory_order_relaxed);
  }
}

void recordChallengeSucceeded(const std::string &type) {
  const int idx = livenessChallengeTypeIndex(type);
  if (idx >= 0) {
    gLivenessChallengeMetrics[static_cast<std::size_t>(idx)].succeeded.fetch_add(
        1, std::memory_order_relaxed);
  }
}

void armNextChallenge(LivenessChallengeState &st,
                       std::chrono::steady_clock::time_point now) {
  st.attempt = 1;
  st.deadline = now + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
  // currentChallenge(st) ya refleja el tipo que se está armando: el llamador
  // siempre deja st.queue[st.index] escrito con el tipo correcto ANTES de
  // llamar a esta función (sorteo inicial, reemplazo, o avance de cola).
  recordChallengeArmed(currentChallenge(st));
}

void advanceOrCompleteChallenge(LivenessChallengeState &st,
                                 std::chrono::steady_clock::time_point now) {
  st.index += 1;
  if (static_cast<std::size_t>(st.index) >= st.queue.size()) {
    st.complete = true;
    return;
  }
  armNextChallenge(st, now);
}
}  // namespace

std::vector<std::string> pickChallengeQueue() {
  std::vector<std::string> pool(kLivenessChallengeTypes.begin(), kLivenessChallengeTypes.end());
  std::shuffle(pool.begin(), pool.end(), challengeRng());
  const std::size_t count =
      std::min(pool.size(), static_cast<std::size_t>(kLivenessChallengeCount));
  return std::vector<std::string>(pool.begin(), pool.begin() + static_cast<long>(count));
}

std::string pickReplacementChallenge(const std::vector<std::string> &exclude) {
  std::vector<std::string> pool;
  for (const char *c : kLivenessChallengeTypes) {
    if (std::find(exclude.begin(), exclude.end(), c) == exclude.end()) {
      pool.push_back(c);
    }
  }
  if (pool.empty()) {
    // `exclude` ya cubre los 4 tipos: no hay uno distinto posible, así que
    // se repite el último (mejor repetir un reto que quedarse sin ninguno).
    return exclude.empty() ? std::string{} : exclude.back();
  }
  std::uniform_int_distribution<std::size_t> dist(0, pool.size() - 1);
  return pool[dist(challengeRng())];
}

void evaluateLivenessChallenge(LivenessChallengeState &st, double headYawRatio,
                                double interEyePx, double faceOvalCx,
                                std::chrono::steady_clock::time_point now) {
  if (st.complete || st.exhausted) {
    return;
  }
  if (st.queue.empty()) {
    st.queue = pickChallengeQueue();
    st.index = 0;
    // Referencia de "distancia/posición neutral" para move_closer/move_away
    // y shift_left/shift_right -- se captura UNA vez, al sortear la cola,
    // sin importar qué tipo termine tocando (turn_left/turn_right no las
    // usan, pero da igual fijarlas).
    st.baselineInterEyePx = interEyePx;
    st.baselineFaceCenterX = faceOvalCx;
    armNextChallenge(st, now);
    if (st.queue.empty()) {
      // No debería pasar (kLivenessChallengeTypes siempre tiene 4), pero
      // fail-closed: sin cola no hay desafío que cumplir, nunca se marca completo.
      return;
    }
  }

  if (now >= st.deadline) {
    recordChallengeTimedOut(currentChallenge(st));
    // ADR-156: se agotó la ventana de este intento. Si todavía quedan
    // intentos de la sesión se pide OTRO reto, sorteado al azar y siempre
    // DISTINTO al que acaba de vencer -- repetir el mismo gesto que la
    // persona ya no logró (comportamiento anterior: 4 reintentos idénticos)
    // es justamente lo que la dejaba trabada, y además le permitiría a un
    // atacante preparar una sola respuesta. Cuando se agota el último
    // intento NO se sortea nada más: se marca `exhausted` y el llamador
    // devuelve toda la captura a la etapa 1 (ver handleProcessFrame), en vez
    // del bucle infinito anterior que nunca se rendía.
    if (st.attempt >= kLivenessChallengeMaxAttempts) {
      st.exhausted = true;
      return;
    }
    st.attempt += 1;
    const std::string next = pickReplacementChallenge({currentChallenge(st)});
    if (!next.empty()) {
      st.queue[static_cast<std::size_t>(st.index)] = next;
    }
    st.deadline = now + std::chrono::milliseconds(kLivenessChallengeTimeoutMs);
    recordChallengeArmed(currentChallenge(st));
    return;
  }

  const std::string type = currentChallenge(st);
  bool satisfied = false;
  if (type == "turn_left") {
    satisfied = headYawRatio >= kLivenessHeadYawTurnThreshold;
  } else if (type == "turn_right") {
    satisfied = headYawRatio <= -kLivenessHeadYawTurnThreshold;
  } else if (type == "move_closer" || type == "move_away") {
    // baselineInterEyePx==0 no debería pasar (se captura junto con la cola),
    // pero fail-closed: sin referencia válida, nunca satisface.
    if (st.baselineInterEyePx > 1e-6) {
      const double ratio = interEyePx / st.baselineInterEyePx;
      satisfied = (type == "move_closer") ? (ratio >= kLivenessMoveCloserRatio)
                                           : (ratio <= kLivenessMoveAwayRatio);
    }
  } else if (type == "shift_left" || type == "shift_right") {
    // Desplazamiento lateral de TODA la cabeza (sin girar), a diferencia de
    // turn_left/turn_right -- ver kLivenessHeadShiftRatio. Misma convención
    // de signo que turn_left/turn_right (positivo = hacia el lado derecho de
    // la imagen = "su izquierda" del usuario): shift_left exige avanzar
    // hacia +X, shift_right hacia -X. Fail-closed sin referencia válida.
    if (st.baselineInterEyePx > 1e-6) {
      const double shiftRatio = (faceOvalCx - st.baselineFaceCenterX) / st.baselineInterEyePx;
      satisfied = (type == "shift_left") ? (shiftRatio >= kLivenessHeadShiftRatio)
                                          : (shiftRatio <= -kLivenessHeadShiftRatio);
    }
  }

  if (satisfied) {
    recordChallengeSucceeded(type);
    advanceOrCompleteChallenge(st, now);
  }
}

bool updateNaturalBlink(NaturalBlinkState &st, bool eyesOpen,
                        std::chrono::steady_clock::time_point now) {
  if (!st.windowStartSet) {
    st.windowStartSet = true;
    st.windowStart = now;
  }

  if (eyesOpen) {
    if (st.eyesClosedSinceSet) {
      const auto closedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                                now - st.eyesClosedSince)
                                .count();
      if (closedMs >= kNaturalBlinkMinDurationMs &&
          closedMs <= kNaturalBlinkMaxDurationMs) {
        st.observed = true;
        st.lastBlinkAtSet = true;
        st.lastBlinkAt = now;
        st.staleFraudReported = false;
      }
      st.eyesClosedSinceSet = false;
    }
    return true;
  }

  // eyesOpen == false
  if (!st.eyesClosedSinceSet) {
    // Recién empieza a cerrarse -- tratarlo como posible parpadeo en curso,
    // no penalizar todavía (se resuelve cuando reabra o cuando se pase de
    // kNaturalBlinkMaxDurationMs).
    st.eyesClosedSinceSet = true;
    st.eyesClosedSince = now;
    return true;
  }
  const auto closedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            now - st.eyesClosedSince)
                            .count();
  return closedMs <= kNaturalBlinkMaxDurationMs;
}

bool isNaturalBlinkStale(const NaturalBlinkState &st,
                        std::chrono::steady_clock::time_point now) {
  const auto since = st.lastBlinkAtSet ? st.lastBlinkAt
                     : st.windowStartSet ? st.windowStart
                                          : now;
  const auto elapsedMs =
      std::chrono::duration_cast<std::chrono::milliseconds>(now - since).count();
  return elapsedMs >= kNaturalBlinkMaxSampleWindowMs;
}

}  // namespace biometric
