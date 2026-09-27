// ignore_for_file: prefer_initializing_formals
/// Immutable representation of the logged-in user in memory.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    this.displayName,
    this.role,
    this.employeeCode,
    String? username,
  }) : _username = username;

  final String id;
  final String email;
  final String? displayName;
  final String? role;
  final String? employeeCode;
  final String? _username;

  String get username {
    if (_username != null && _username.isNotEmpty) {
      return _username;
    }
    if (email.contains('@')) {
      return email.split('@').first;
    }
    return email.isNotEmpty ? email : (displayName ?? 'engineer');
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    final email = json['email'] as String? ?? json['username'] as String? ?? '';
    return AuthUser(
      id: json['id'] as String? ?? json['sub'] as String? ?? '',
      email: email,
      displayName: json['displayName'] as String? ?? json['fullName'] as String? ?? json['username'] as String?,
      role: json['role'] as String? ??
          ((json['roles'] as List<dynamic>?)?.firstOrNull?.toString()),
      employeeCode: json['employeeCode'] as String?,
      username: json['username'] as String?,
    );
  }

  AuthUser copyWith({
    String? id,
    String? email,
    String? displayName,
    String? role,
    String? employeeCode,
    String? username,
  }) {
    return AuthUser(
      id: id ?? this.id,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      role: role ?? this.role,
      employeeCode: employeeCode ?? this.employeeCode,
      username: username ?? _username,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'displayName': displayName,
        'role': role,
        'employeeCode': employeeCode,
        'username': username,
      };
}
