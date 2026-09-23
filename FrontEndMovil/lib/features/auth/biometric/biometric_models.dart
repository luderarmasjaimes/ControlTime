/// Forma del payload devuelto por `POST /api/process_frame` /
/// `GET /api/status` — confirmada a nivel de campos por la investigación
/// de la API (`icao`, `liveness_score`, `capture_count`,
/// `quality_gate_reached`, `reset_reason`, `challenge`), pero el nombre
/// exacto del campo booleano de "desafío completado" dentro de `challenge`
/// no se pudo verificar sin una sesión de captura real contra el backend —
/// se ajusta en la primera prueba de integración end-to-end si difiere
/// (ver docs/decisions/0003 y 0001 §Verificación). Mientras tanto se
/// infiere completitud por `quality_gate_reached == true` cuando ya no hay
/// un `challenge` pendiente, que es la señal más robusta disponible.
class BiometricFrameStatus {
  const BiometricFrameStatus({
    required this.eyesOpen,
    required this.mouthClosed,
    required this.faceStraight,
    required this.noGlasses,
    required this.livenessScore,
    required this.captureCount,
    required this.qualityGateReached,
    required this.resetReason,
    required this.challengeType,
    required this.challengeCompleted,
  });

  final bool eyesOpen;
  final bool mouthClosed;
  final bool faceStraight;
  final bool noGlasses;
  final double livenessScore;
  final int captureCount;
  final bool qualityGateReached;
  final String? resetReason;
  final String? challengeType; // turn_left | turn_right | look_down | look_up | move_closer | move_away
  final bool challengeCompleted;

  bool get icaoAllPassed => eyesOpen && mouthClosed && faceStraight && noGlasses;

  factory BiometricFrameStatus.fromJson(Map<String, dynamic> json) {
    final icao = json['icao'] as Map<String, dynamic>? ?? const {};
    final challenge = json['challenge'] as Map<String, dynamic>?;
    return BiometricFrameStatus(
      eyesOpen: icao['eyes_open'] as bool? ?? false,
      mouthClosed: icao['mouth_closed'] as bool? ?? false,
      faceStraight: icao['face_straight'] as bool? ?? false,
      noGlasses: icao['no_glasses'] as bool? ?? true,
      livenessScore: (json['liveness_score'] as num?)?.toDouble() ?? 0,
      captureCount: json['capture_count'] as int? ?? 0,
      qualityGateReached: json['quality_gate_reached'] as bool? ?? false,
      resetReason: json['reset_reason'] as String?,
      challengeType: challenge?['type'] as String?,
      challengeCompleted: (challenge?['completed'] as bool?) ?? (challenge == null && (json['quality_gate_reached'] as bool? ?? false)),
    );
  }
}
