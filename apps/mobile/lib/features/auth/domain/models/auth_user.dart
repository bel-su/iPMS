// ignore_for_file: prefer_initializing_formals
/// Immutable representation of the logged-in user in memory.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    this.displayName,
    this.role,
    this.employeeCode,
    this.permissions = const [],
    String? username,
  }) : _username = username;

  final String id;
  final String email;
  final String? displayName;
  final String? role;
  final String? employeeCode;

  /// Effective permission codes from `/auth/me`, e.g. `qc_evidence.upload`.
  final List<String> permissions;
  final String? _username;

  bool can(String permission) => permissions.contains(permission);

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
      role: json['role'] as String? ?? _firstRoleCode(json['roles']),
      employeeCode: json['employeeCode'] as String?,
      permissions: (json['permissions'] as List<dynamic>?)
              ?.map((p) => p.toString())
              .toList() ??
          const [],
      username: json['username'] as String?,
    );
  }

  /// `/auth/me` lists role codes as strings; `/users/me` lists `{code, name}`.
  static String? _firstRoleCode(dynamic roles) {
    if (roles is! List || roles.isEmpty) return null;
    final first = roles.first;
    if (first is Map) return first['code']?.toString();
    return first?.toString();
  }

  AuthUser copyWith({
    String? id,
    String? email,
    String? displayName,
    String? role,
    String? employeeCode,
    List<String>? permissions,
    String? username,
  }) {
    return AuthUser(
      id: id ?? this.id,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      role: role ?? this.role,
      employeeCode: employeeCode ?? this.employeeCode,
      permissions: permissions ?? this.permissions,
      username: username ?? _username,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'displayName': displayName,
        'role': role,
        'employeeCode': employeeCode,
        'permissions': permissions,
        'username': username,
      };
}
