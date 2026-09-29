import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/security/token_storage.dart';
import '../data/auth_repository.dart';
import '../domain/models/auth_user.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return TokenStorage();
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return ApiClient(tokenStorage: tokenStorage);
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final tokenStorage = ref.watch(tokenStorageProvider);
  return AuthRepository(apiClient: apiClient, tokenStorage: tokenStorage);
});

class AuthNotifier extends AsyncNotifier<AuthUser?> {
  @override
  FutureOr<AuthUser?> build() async {
    final repo = ref.watch(authRepositoryProvider);
    final hasSession = await repo.hasSavedSession();
    if (!hasSession) {
      return null;
    }
    try {
      return await repo.getCurrentUser();
    } on NetworkException {
      // Offline at launch says nothing about the session: keep the tokens so
      // signing in again (or biometrics) can restore it once back online.
      return null;
    } catch (_) {
      await repo.logout();
      return null;
    }
  }

  Future<void> login(String email, String password) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      return await ref.read(authRepositoryProvider).login(
            email: email,
            password: password,
          );
    });
  }

  Future<void> loginWithBiometrics(String username) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      return await ref
          .read(authRepositoryProvider)
          .loginWithBiometrics(username: username);
    });
  }

  Future<void> updateProfile({
    String? fullName,
    String? email,
    String? employeeCode,
    String? phone,
  }) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      return await ref.read(authRepositoryProvider).updateProfile(
            fullName: fullName,
            email: email,
            employeeCode: employeeCode,
            phone: phone,
          );
    });
  }

  Future<void> logout({bool purgeBiometrics = false}) async {
    state = const AsyncValue.loading();
    await ref.read(authRepositoryProvider).logout();
    if (purgeBiometrics) {
      await ref.read(tokenStorageProvider).clearBiometric();
    }
    state = const AsyncValue.data(null);
  }
}

final authStateProvider =
    AsyncNotifierProvider<AuthNotifier, AuthUser?>(AuthNotifier.new);
