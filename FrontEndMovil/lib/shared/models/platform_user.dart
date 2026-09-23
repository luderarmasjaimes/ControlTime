/// `GET /api/auth/users` — usuarios de la empresa del que llama. Forma
/// exacta no volcada por la investigación de la API; parseo defensivo.
class PlatformUser {
  const PlatformUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.role,
    required this.blocked,
  });

  final String id;
  final String username;
  final String fullName;
  final String role;
  final bool blocked;

  factory PlatformUser.fromJson(Map<String, dynamic> json) => PlatformUser(
        id: (json['id'] ?? '').toString(),
        username: (json['username'] ?? '') as String,
        fullName: (json['full_name'] ?? json['username'] ?? '') as String,
        role: (json['role'] ?? 'operator') as String,
        blocked: (json['blocked'] ?? json['is_blocked'] ?? false) as bool,
      );
}
