import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/auth/auth_repository.dart';
import '../../core/auth/auth_session.dart';
import '../../core/auth/geo_helper.dart';
import '../../core/i18n/i18n_provider.dart';
import '../../core/theme/tokens.dart';
import 'biometric/face_login_screen.dart';
import 'data/companies_repository.dart';

enum _LoginStep { identity, password, mfa }

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  _LoginStep _step = _LoginStep.identity;
  String? _company;
  final _identityController = TextEditingController();
  final _passwordController = TextEditingController();
  final _mfaController = TextEditingController();
  String? _resolvedUsername;
  String? _mfaToken;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _identityController.dispose();
    _passwordController.dispose();
    _mfaController.dispose();
    super.dispose();
  }

  Future<void> _submitIdentity() async {
    final t = ref.read(translationsProvider);
    if (_company == null || _identityController.text.trim().isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await ref.read(authRepositoryProvider).checkIdentity(
            company: _company!,
            identity: _identityController.text.trim(),
          );
      if (result['ok'] != true) {
        setState(() => _error = t('error.unauthorized'));
        return;
      }
      _resolvedUsername = result['username'] as String?;
      setState(() => _step = _LoginStep.password);
    } catch (_) {
      setState(() => _error = t('error.network'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitPassword() async {
    final t = ref.read(translationsProvider);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final location = await bestEffortLocation();
      final result = await ref.read(authRepositoryProvider).loginWithPassword(
            company: _company!,
            identityLogin: _identityController.text.trim(),
            username: _resolvedUsername ?? _identityController.text.trim(),
            password: _passwordController.text,
            location: location,
          );
      await ref
          .read(authSessionControllerProvider.notifier)
          .applySession(result.user!, accessToken: result.accessToken!, expiresInSeconds: result.expiresIn!);
    } on MfaRequiredException catch (e) {
      setState(() {
        _mfaToken = e.mfaToken;
        _step = _LoginStep.mfa;
      });
    } catch (_) {
      setState(() => _error = t('error.unauthorized'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitMfa() async {
    final t = ref.read(translationsProvider);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await ref.read(authRepositoryProvider).loginWithMfa(
            mfaToken: _mfaToken!,
            code: _mfaController.text.trim(),
          );
      await ref
          .read(authSessionControllerProvider.notifier)
          .applySession(result.user!, accessToken: result.accessToken!, expiresInSeconds: result.expiresIn!);
    } catch (_) {
      setState(() => _error = t('error.unauthorized'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(translationsProvider);
    final companiesAsync = ref.watch(activeCompaniesProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Column(
                      children: [
                        SvgPicture.asset('assets/images/aurixa-logo.svg', height: 56),
                        const SizedBox(height: AppSpacing.md),
                        Text('BEEMETRY', style: TextStyle(color: AppColors.primary, fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 1.4)),
                        const Text('Plataforma minera · Acceso seguro', style: TextStyle(color: AppColors.textDim, fontSize: 12)),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                  if (_step == _LoginStep.identity) ...[
                    companiesAsync.when(
                      loading: () => const LinearProgressIndicator(color: AppColors.primary),
                      error: (_, __) => TextField(
                        decoration: InputDecoration(labelText: t('auth.company')),
                        onChanged: (v) => _company = v,
                      ),
                      data: (companies) => DropdownButtonFormField<String>(
                        decoration: InputDecoration(labelText: t('auth.company')),
                        initialValue: _company,
                        items: [for (final c in companies) DropdownMenuItem(value: c.name, child: Text(c.name))],
                        onChanged: (v) => setState(() => _company = v),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _identityController,
                      decoration: InputDecoration(labelText: t('auth.identity')),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_error != null) _ErrorText(_error!),
                    ElevatedButton(
                      onPressed: _submitting ? null : _submitIdentity,
                      child: _submitting ? const _ButtonSpinner() : Text(t('common.confirm')),
                    ),
                  ] else if (_step == _LoginStep.password) ...[
                    Text('${t('auth.identity')}: ${_resolvedUsername ?? _identityController.text}', style: const TextStyle(color: AppColors.textDim)),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _passwordController,
                      obscureText: true,
                      decoration: InputDecoration(labelText: t('auth.password')),
                      onSubmitted: (_) => _submitPassword(),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_error != null) _ErrorText(_error!),
                    ElevatedButton(
                      onPressed: _submitting ? null : _submitPassword,
                      child: _submitting ? const _ButtonSpinner() : Text(t('auth.loginWithPassword')),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton.icon(
                      icon: const Icon(Icons.face_retouching_natural_outlined),
                      label: Text(t('auth.loginWithFace')),
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => FaceLoginScreen(
                                  company: _company!,
                                  identityLogin: _identityController.text.trim(),
                                  username: _resolvedUsername ?? _identityController.text.trim(),
                                ),
                              )),
                    ),
                    TextButton(
                      onPressed: _submitting ? null : () => setState(() => _step = _LoginStep.identity),
                      child: Text(t('common.cancel')),
                    ),
                  ] else ...[
                    TextField(
                      controller: _mfaController,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(labelText: t('auth.mfaCode')),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    if (_error != null) _ErrorText(_error!),
                    ElevatedButton(
                      onPressed: _submitting ? null : _submitMfa,
                      child: _submitting ? const _ButtonSpinner() : Text(t('common.confirm')),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.message);
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: Text(message, style: const TextStyle(color: AppColors.semanticDestructive)),
      );
}

class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner();

  @override
  Widget build(BuildContext context) =>
      const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.bgMain));
}
