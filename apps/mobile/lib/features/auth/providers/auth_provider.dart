import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
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

  Future<void> logout() async {
    state = const AsyncValue.loading();
    await ref.read(authRepositoryProvider).logout();
    state = const AsyncValue.data(null);
  }
}

final authStateProvider =
    AsyncNotifierProvider<AuthNotifier, AuthUser?>(AuthNotifier.new);
