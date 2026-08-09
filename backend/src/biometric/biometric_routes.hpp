#pragma once

#include <string>

#include "../http/router.hpp"

namespace biometric {

void registerRoutes(router::Router &r);

/** X-Capture-Session-Id (una por pestana, ver authApi.ts) -> aisla
 * gBiometricCaptureSessions entre capturas concurrentes. Devuelve
 * kBiometricCaptureDefaultSessionId si el header falta o es invalido. */
std::string
captureSessionIdFromRequest(const http::request<http::string_body> &req);

} // namespace biometric
