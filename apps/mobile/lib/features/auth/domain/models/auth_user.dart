/// Immutable representation of the logged-in user in memory.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    this.displayName,
    this.role,
  });

  final String id;
  final String email;
  final String? displayName;
  final String? role;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? json['sub'] as String? ?? '',
      email: json['email'] as String? ?? '',
      displayName: json['displayName'] as String? ?? json['fullName'] as String?,
      role: json['role'] as String? ??
          ((json['roles'] as List<dynamic>?)?.firstOrNull?.toString()),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'displayName': displayName,
        'role': role,
      };
}
