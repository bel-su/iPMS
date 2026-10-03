import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/config/env.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/security/token_storage.dart';
import '../domain/models/auth_user.dart';

class AuthRepository {
  AuthRepository({
    required this.apiClient,
    required this.tokenStorage,
  });

  final ApiClient apiClient;
  final TokenStorage tokenStorage;

  Future<AuthUser> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        ApiEndpoints.login,
        data: {
          'email': email.trim().toLowerCase(),
          'password': password,
        },
      );

      final data = response.data;
      if (data == null || data['accessToken'] == null) {
        throw const ApiException(message: 'Invalid response from authentication service.');
      }

      // An account that owes a password change gets a token with no
      // permissions; nothing in the app would work with it.
      if (data['mustChangePassword'] == true) {
        throw const ApiException(message: mustChangePasswordMessage, errorCode: 'MUST_CHANGE_PASSWORD');
      }

      await tokenStorage.saveTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: data['refreshToken'] as String? ?? '',
      );

      return await getCurrentUser(username: email.trim());
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        throw const ApiException(message: 'Incorrect email or password.');
      }
      if (AppConfig.demoMode && ApiException.isConnectionIssue(e)) {
        return _fallbackLogin(email.trim());
      }
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to connect to authentication service.');
    }
  }

  /// The signed-in user: identity and permissions from `/auth/me`, merged
  /// with the profile (name, email, employee code) from `/users/me`.
  Future<AuthUser> getCurrentUser({String? username}) async {
    try {
      final meResponse = await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.authMe);
      final me = meResponse.data;
      if (me == null) {
        throw const ApiException(message: 'User profile not found.');
      }
      final identity = AuthUser.fromJson(me);
      if (identity.id.isNotEmpty) {
        await tokenStorage.saveUserId(identity.id);
        await tokenStorage.bindBiometricSession(identity.id);
      }

      AuthUser? profile;
      try {
        final profileResponse =
            await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.usersMe);
        if (profileResponse.data != null) {
          profile = AuthUser.fromJson(profileResponse.data!);
        }
      } on DioException catch (e) {
        // The profile only adds display details; identity and permissions are
        // what the app needs to work, so a failure here is not fatal.
        if (e.response?.statusCode == 401) rethrow;
      }

      final email = profile?.email.isNotEmpty == true
          ? profile!.email
          : (username != null && username.contains('@') ? username : '');
      return AuthUser(
        id: identity.id,
        email: email,
        displayName: profile?.displayName ?? username,
        role: identity.role ?? profile?.role,
        employeeCode: profile?.employeeCode,
        permissions: identity.permissions,
        username: email.isEmpty ? username : null,
      );
    } on DioException catch (e) {
      if (AppConfig.demoMode && ApiException.isConnectionIssue(e)) {
        return _fallbackLogin(username ?? 'engineer');
      }
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load user profile.');
    }
  }

  /// Restores a session after the device's biometric check has passed.
  ///
  /// The biometric check only unlocks what is stored on this device: the
  /// current session if it is still valid, otherwise the refresh token kept
  /// for biometric sign-in. It never stands in for the server.
  Future<AuthUser> loginWithBiometrics({required String username}) async {
    final cleanUsername = username.trim().isEmpty ? 'engineer' : username.trim();

    // 1. The current session, if there is one. An expired access token is
    //    refreshed by the interceptor on the way.
    final accessToken = await tokenStorage.getAccessToken();
    if (accessToken != null && accessToken.isNotEmpty) {
      try {
        return await getCurrentUser(username: cleanUsername);
      } on NetworkException {
        if (AppConfig.demoMode) return _fallbackLogin(cleanUsername);
        rethrow;
      } on ApiException {
        // Session no longer valid; fall through to the biometric session.
      }
    }

    // 2. The session kept for biometric sign-in.
    final refreshToken = await tokenStorage.getBiometricRefreshToken() ??
        await tokenStorage.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      if (AppConfig.demoMode) return _fallbackLogin(cleanUsername);
      throw const ApiException(message: biometricSessionExpired);
    }

    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        ApiEndpoints.refresh,
        data: {'refreshToken': refreshToken},
      );
      final data = response.data;
      if (data == null || data['accessToken'] == null) {
        throw const ApiException(message: 'Invalid response from authentication service.');
      }
      await tokenStorage.saveTokens(
        accessToken: data['accessToken'] as String,
        refreshToken: (data['refreshToken'] as String?) ?? refreshToken,
        userId: await tokenStorage.getBiometricUserId(),
      );
      return await getCurrentUser(username: cleanUsername);
    } on DioException catch (e) {
      if (AppConfig.demoMode && ApiException.isConnectionIssue(e)) {
        return _fallbackLogin(cleanUsername);
      }
      if (e.response?.statusCode == 401) {
        // Revoked or expired (password changed, signed out everywhere, or
        // 30 days unused). Keep the enrollment; the next password sign-in
        // stores a fresh session for it.
        await tokenStorage.clearBiometricSession();
        throw const ApiException(message: biometricSessionExpired, statusCode: 401);
      }
      throw ApiException.fromDio(e, fallbackMessage: 'Could not restore your session.');
    }
  }

  static const String mustChangePasswordMessage =
      'You need to set a new password before using the app. Change it on the Axiom web portal, then sign in here.';

  static const String biometricSessionExpired =
      'Your biometric sign-in has expired. Sign in with your password once to turn it back on.';

  Future<AuthUser> updateProfile({
    String? fullName,
    String? email,
    String? employeeCode,
    String? phone,
  }) async {
    try {
      final payload = <String, dynamic>{};
      if (fullName != null && fullName.trim().isNotEmpty) {
        payload['fullName'] = fullName.trim();
      }
      if (email != null && email.trim().isNotEmpty) {
        payload['email'] = email.trim().toLowerCase();
      }
      if (employeeCode != null) {
        payload['employeeCode'] = employeeCode.trim().isEmpty ? null : employeeCode.trim();
      }
      if (phone != null) {
        payload['phone'] = phone.trim().isEmpty ? null : phone.trim();
      }

      await apiClient.dio.patch<Map<String, dynamic>>(
        ApiEndpoints.usersMe,
        data: payload,
      );

      // Re-read rather than use the PATCH body: it carries the profile but
      // not the permissions the rest of the app depends on.
      return await getCurrentUser();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to update user profile.');
    }
  }

  /// Offline demo sign-in, only reachable with `DEMO_MODE=true`.
  Future<AuthUser> _fallbackLogin(String input) async {
    final clean = input.trim();
    final lower = clean.toLowerCase();
    final rawUser = lower.contains('@') ? lower.split('@').first : lower;
    String role = 'FIELD_ENGINEER';
    String displayName = 'Field Engineer';

    if (rawUser == 'manager') {
      role = 'PROJECT_MANAGER';
      displayName = 'Project Manager';
    } else if (rawUser == 'admin') {
      role = 'SUPER_ADMIN';
      displayName = 'System Administrator';
    } else if (rawUser == 'qc') {
      role = 'QC_MANAGER';
      displayName = 'QC Manager';
    } else if (clean.isNotEmpty) {
      displayName = rawUser;
    }

    final user = AuthUser(
      id: 'usr-${rawUser.isNotEmpty ? rawUser : "engineer"}-101',
      username: rawUser.isNotEmpty ? rawUser : 'engineer',
      email: lower.contains('@') ? lower : '${rawUser.isNotEmpty ? rawUser : "engineer"}@ipms.local',
      displayName: displayName,
      role: role,
    );

    await tokenStorage.saveTokens(
      accessToken: 'offline-field-demo-token',
      refreshToken: 'offline-field-refresh-token',
      userId: user.id,
    );

    return user;
  }

  Future<bool> hasSavedSession() async {
    final token = await tokenStorage.getAccessToken();
    final refresh = await tokenStorage.getRefreshToken();
    return (token != null && token.isNotEmpty) || (refresh != null && refresh.isNotEmpty);
  }

  /// Signs out.
  ///
  /// With [keepBiometricSession] the device is only locked: the session kept
  /// for biometric sign-in is left valid on the server, so Face ID / fingerprint
  /// can open it again. Otherwise every session is revoked server-side, which
  /// also ends the biometric one.
  Future<void> logout({bool keepBiometricSession = false}) async {
    if (keepBiometricSession) {
      await tokenStorage.clearTokens();
      return;
    }
    try {
      // An empty JSON body, not none: the gateway rejects a JSON request
      // without one, and the revoke would silently never happen.
      await apiClient.dio.post<void>(ApiEndpoints.logout, data: const <String, dynamic>{});
    } catch (_) {
      // Best-effort server notification
    } finally {
      await tokenStorage.clearTokens(purgeBiometrics: true);
    }
  }
}
