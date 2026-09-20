/// Immutable representation of the logged-in user in memory.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.username,
    this.email,
    this.displayName,
    this.role,
  });

  final String id;
  final String username;
  final String? email;
  final String? displayName;
  final String? role;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? json['sub'] as String? ?? '',
      username: json['username'] as String? ?? '',
      email: json['email'] as String?,
      displayName: json['displayName'] as String? ?? json['username'] as String?,
      role: json['role'] as String? ??
          ((json['roles'] as List<dynamic>?)?.firstOrNull?.toString()),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'username': username,
        'email': email,
        'displayName': displayName,
        'role': role,
      };
}
