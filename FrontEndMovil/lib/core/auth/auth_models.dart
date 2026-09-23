/// DTOs de sesión — forma exacta verificada contra
/// `authUserSessionJson()` (backend/src/auth/auth_storage_file.cpp) y los
/// handlers de login/registro (ver docs/decisions/0003).
class AuthUser {
  const AuthUser({
    required this.id,
    required this.company,
    required this.username,
    required this.role,
    required this.tenantId,
    required this.fullName,
    this.department,
    this.avatarCartoonBase64,
    this.isOrganizationTenant = false,
  });

  final String id;
  final String company;
  final String username;
  final String role;
  final String tenantId;
  final String fullName;
  final String? department;
  final String? avatarCartoonBase64;
  final bool isOrganizationTenant;

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String? ?? '',
        company: json['company'] as String? ?? '',
        username: json['username'] as String? ?? '',
        role: json['role'] as String? ?? 'operator',
        tenantId: json['tenant_id'] as String? ?? '',
        fullName: json['full_name'] as String? ?? '',
        department: json['department'] as String?,
        avatarCartoonBase64: json['avatar_cartoon_base64'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'company': company,
        'username': username,
        'role': role,
        'tenant_id': tenantId,
        'full_name': fullName,
        if (department != null) 'department': department,
      };

  AuthUser copyWith({String? avatarCartoonBase64}) => AuthUser(
        id: id,
        company: company,
        username: username,
        role: role,
        tenantId: tenantId,
        fullName: fullName,
        department: department,
        avatarCartoonBase64: avatarCartoonBase64 ?? this.avatarCartoonBase64,
        isOrganizationTenant: isOrganizationTenant,
      );
}

/// Resultado de un intento de login/registro — nunca persiste el token
/// (vive en memoria únicamente, ver AuthSessionController).
class LoginResult {
  const LoginResult.success(this.user, {required this.accessToken, required this.expiresIn})
      : mfaRequired = false,
        mfaToken = null;

  const LoginResult.mfaRequired(this.mfaToken)
      : mfaRequired = true,
        user = null,
        accessToken = null,
        expiresIn = null;

  final bool mfaRequired;
  final String? mfaToken;
  final AuthUser? user;
  final String? accessToken;
  final int? expiresIn;
}
