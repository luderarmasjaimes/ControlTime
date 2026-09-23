import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/auth/auth_repository.dart';
import '../../../core/auth/auth_session.dart';
import '../../../core/auth/geo_helper.dart';
import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import 'biometric_models.dart';
import 'biometric_repository.dart';

const _challengeKeyByType = {
  'turn_left': 'liveness.challenge.turnLeft',
  'turn_right': 'liveness.challenge.turnRight',
  'look_down': 'liveness.challenge.lookDown',
  'look_up': 'liveness.challenge.lookUp',
  'move_closer': 'liveness.challenge.moveCloser',
  'move_away': 'liveness.challenge.moveAway',
};

/// Login biométrico (ver docs/decisions/0003): el desafío de vida activa es
/// 100% decidido por el servidor — esta pantalla solo envía frames y
/// refleja el campo `challenge` de cada respuesta, nunca decide
/// aprobación/rechazo localmente.
class FaceLoginScreen extends ConsumerStatefulWidget {
  const FaceLoginScreen({super.key, required this.company, required this.identityLogin, required this.username});

  final String company;
  final String identityLogin;
  final String username;

  @override
  ConsumerState<FaceLoginScreen> createState() => _FaceLoginScreenState();
}

class _FaceLoginScreenState extends ConsumerState<FaceLoginScreen> {
  CameraController? _controller;
  Timer? _loop;
  final _captureSessionId = const Uuid().v4();
  bool _busy = false;
  bool _submittingLogin = false;
  Uint8List? _lastFrameBytes;
  BiometricFrameStatus? _status;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      await ref.read(biometricRepositoryProvider).resetCapture(_captureSessionId);
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      final controller = CameraController(front, ResolutionPreset.medium, enableAudio: false);
      await controller.initialize();
      if (!mounted) return;
      setState(() => _controller = controller);
      _loop = Timer.periodic(const Duration(milliseconds: 500), (_) => _captureTick());
    } catch (e) {
      setState(() => _error = ref.read(translationsProvider)('error.generic'));
    }
  }

  Future<void> _captureTick() async {
    final controller = _controller;
    if (controller == null || _busy || _submittingLogin || !controller.value.isInitialized) return;
    _busy = true;
    try {
      final file = await controller.takePicture();
      final bytes = await file.readAsBytes();
      final status = await ref.read(biometricRepositoryProvider).processFrame(
            jpegBytes: bytes,
            captureSessionId: _captureSessionId,
          );
      _lastFrameBytes = bytes;
      if (!mounted) return;
      setState(() => _status = status);
      if (status.challengeCompleted && !_submittingLogin) {
        await _finishLogin();
      }
    } catch (_) {
      // Frame individual fallido — se ignora, el siguiente tick reintenta.
    } finally {
      _busy = false;
    }
  }

  Future<void> _finishLogin() async {
    final frame = _lastFrameBytes;
    if (frame == null) return;
    setState(() => _submittingLogin = true);
    _loop?.cancel();
    try {
      final location = await bestEffortLocation();
      final result = await ref.read(authRepositoryProvider).loginWithFace(
            company: widget.company,
            identityLogin: widget.identityLogin,
            username: widget.username,
            faceImageBase64: base64Encode(frame),
            captureSessionId: _captureSessionId,
            location: location,
          );
      await ref
          .read(authSessionControllerProvider.notifier)
          .applySession(result.user!, accessToken: result.accessToken!, expiresInSeconds: result.expiresIn!);
      if (mounted) Navigator.of(context).pop();
    } on MfaRequiredException catch (e) {
      if (!mounted) return;
      final code = await _promptMfaCode();
      if (code == null) {
        setState(() => _submittingLogin = false);
        return;
      }
      try {
        final result = await ref.read(authRepositoryProvider).loginWithMfa(mfaToken: e.mfaToken, code: code);
        await ref
            .read(authSessionControllerProvider.notifier)
            .applySession(result.user!, accessToken: result.accessToken!, expiresInSeconds: result.expiresIn!);
        if (mounted) Navigator.of(context).pop();
      } catch (_) {
        setState(() {
          _error = ref.read(translationsProvider)('error.unauthorized');
          _submittingLogin = false;
        });
      }
    } catch (_) {
      setState(() {
        _error = ref.read(translationsProvider)('error.unauthorized');
        _submittingLogin = false;
      });
      _loop = Timer.periodic(const Duration(milliseconds: 500), (_) => _captureTick());
    }
  }

  Future<String?> _promptMfaCode() async {
    final controller = TextEditingController();
    final t = ref.read(translationsProvider);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgSidebar,
        title: Text(t('auth.mfaCode')),
        content: TextField(controller: controller, keyboardType: TextInputType.number, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t('common.cancel'))),
          ElevatedButton(onPressed: () => Navigator.of(context).pop(controller.text.trim()), child: Text(t('common.confirm'))),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _loop?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(translationsProvider);
    final controller = _controller;

    return Scaffold(
      appBar: AppBar(title: Text(t('auth.loginWithFace'))),
      body: _error != null
          ? Center(child: Text(_error!, style: const TextStyle(color: AppColors.semanticDestructive)))
          : controller == null || !controller.value.isInitialized
              ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
              : Stack(
                  fit: StackFit.expand,
                  children: [
                    CameraPreview(controller),
                    CustomPaint(painter: _OvalGuidePainter(passed: _status?.icaoAllPassed ?? false)),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 32,
                      child: Column(
                        children: [
                          if (_status?.challengeType != null)
                            _InstructionChip(text: t(_challengeKeyByType[_status!.challengeType] ?? 'liveness.waiting'))
                          else if (_status != null)
                            _InstructionChip(text: t('auth.positionFace'))
                          else
                            _InstructionChip(text: t('auth.captureQuality')),
                          if (_submittingLogin) ...[
                            const SizedBox(height: AppSpacing.md),
                            const CircularProgressIndicator(color: AppColors.primary),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _InstructionChip extends StatelessWidget {
  const _InstructionChip({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(AppRadii.nav)),
        child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      );
}

class _OvalGuidePainter extends CustomPainter {
  const _OvalGuidePainter({required this.passed});
  final bool passed;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.42), width: size.width * 0.7, height: size.height * 0.45);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..color = passed ? AppColors.semanticLive : AppColors.primary;
    canvas.drawOval(rect, paint);
  }

  @override
  bool shouldRepaint(covariant _OvalGuidePainter oldDelegate) => oldDelegate.passed != passed;
}
