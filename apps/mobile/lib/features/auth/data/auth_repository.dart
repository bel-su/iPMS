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

  /// Authenticates using device hardware biometrics (Face ID / Touch ID / Fingerprint).
  /// Restores access via the existing access token or the refresh token that
  /// was kept for biometric sign-in. The biometric check itself only unlocks
  /// that stored session; it never stands in for the server.
  Future<AuthUser> loginWithBiometrics({required String username}) async {
    final cleanUsername = username.trim().isEmpty ? 'engineer' : username.trim();

    // 1. Try to restore using active access token if available
    final accessToken = await tokenStorage.getAccessToken();
    if (accessToken != null && accessToken.isNotEmpty) {
      try {
        return await getCurrentUser(username: cleanUsername);
      } catch (_) {
        // Access token expired, proceed to refresh
      }
    }

    // 2. Try refresh token (either active or biometric-persisted)
    final refreshToken = await tokenStorage.getRefreshToken() ??
        await tokenStorage.getBiometricRefreshToken();

    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        final response = await apiClient.dio.post<Map<String, dynamic>>(
          ApiEndpoints.refresh,
          data: {'refreshToken': refreshToken},
        );
        final data = response.data;
        if (data != null && data['accessToken'] != null) {
          await tokenStorage.saveTokens(
            accessToken: data['accessToken'] as String,
            refreshToken: (data['refreshToken'] as String?) ?? refreshToken,
          );
          return await getCurrentUser(username: cleanUsername);
        }
      } on DioException catch (e) {
        if (AppConfig.demoMode && ApiException.isConnectionIssue(e)) {
          return _fallbackLogin(cleanUsername);
        }
        if (ApiException.isConnectionIssue(e)) throw const NetworkException();
      }
    }

    if (AppConfig.demoMode) return _fallbackLogin(cleanUsername);
    throw const ApiException(
      message: 'Your saved session has expired. Please sign in with your password.',
    );
  }

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

  Future<void> logout() async {
    try {
      await apiClient.dio.post<void>(ApiEndpoints.logout);
    } catch (_) {
      // Best-effort server notification
    } finally {
      await tokenStorage.clearTokens();
    }
  }
}
