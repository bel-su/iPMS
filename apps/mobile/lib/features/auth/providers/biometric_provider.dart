import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import '../../../core/security/biometric_auth_service.dart';
import 'auth_provider.dart';

class BiometricAuthState {
  const BiometricAuthState({
    this.isHardwareSupported = false,
    this.isConfigured = false,
    this.enrolledUsername,
    this.availableBiometrics = const [],
    this.isAuthenticating = false,
    this.statusMessage,
  });

  final bool isHardwareSupported;
  final bool isConfigured;
  final String? enrolledUsername;
  final List<BiometricType> availableBiometrics;
  final bool isAuthenticating;
  final String? statusMessage;

  bool get hasFingerprint =>
      availableBiometrics.contains(BiometricType.fingerprint) ||
      availableBiometrics.contains(BiometricType.strong);

  BiometricAuthState copyWith({
    bool? isHardwareSupported,
    bool? isConfigured,
    String? enrolledUsername,
    List<BiometricType>? availableBiometrics,
    bool? isAuthenticating,
    String? statusMessage,
  }) {
    return BiometricAuthState(
      isHardwareSupported: isHardwareSupported ?? this.isHardwareSupported,
      isConfigured: isConfigured ?? this.isConfigured,
      enrolledUsername: enrolledUsername ?? this.enrolledUsername,
      availableBiometrics: availableBiometrics ?? this.availableBiometrics,
      isAuthenticating: isAuthenticating ?? this.isAuthenticating,
      statusMessage: statusMessage,
    );
  }
}

final biometricServiceProvider = Provider<BiometricAuthService>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return BiometricAuthService(tokenStorage: tokenStorage);
});

class BiometricAuthNotifier extends Notifier<BiometricAuthState> {
  @override
  BiometricAuthState build() {
    Future.microtask(() => checkBiometricStatus());
    return const BiometricAuthState();
  }

  Future<void> checkBiometricStatus() async {
    final service = ref.read(biometricServiceProvider);
    final isSupported = await service.canAuthenticateWithBiometrics();
    final isConfigured = await service.isBiometricLoginConfigured();
    final username = await service.getEnrolledUsername();
    final available = await service.getAvailableBiometrics();

    state = state.copyWith(
      isHardwareSupported: isSupported,
      isConfigured: isConfigured,
      enrolledUsername: username,
      availableBiometrics: available,
    );
  }

  Future<bool> authenticateAndLogin() async {
    final service = ref.read(biometricServiceProvider);
    final enrolledUser = state.enrolledUsername;
    if (enrolledUser == null || enrolledUser.isEmpty) return false;

    state = state.copyWith(isAuthenticating: true, statusMessage: null);

    try {
      final success = await service.authenticate(
        localizedReason:
            'Scan fingerprint to access iPMS Field App as @$enrolledUser',
      );

      if (success) {
        await ref
            .read(authStateProvider.notifier)
            .loginWithBiometrics(enrolledUser);
        state = state.copyWith(isAuthenticating: false);
        return true;
      } else {
        state = state.copyWith(
          isAuthenticating: false,
          statusMessage: 'Biometric scan was cancelled or unrecognized.',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        isAuthenticating: false,
        statusMessage: 'Biometric error: $e',
      );
      return false;
    }
  }

  Future<bool> enrollBiometric(String username) async {
    final service = ref.read(biometricServiceProvider);
    state = state.copyWith(isAuthenticating: true);

    try {
      final verified = await service.authenticate(
        localizedReason: 'Scan fingerprint to confirm biometric login enrollment',
      );

      if (verified) {
        await service.enrollBiometric(username);
        state = state.copyWith(
          isConfigured: true,
          enrolledUsername: username,
          isAuthenticating: false,
        );
        return true;
      } else {
        state = state.copyWith(isAuthenticating: false);
        return false;
      }
    } catch (_) {
      state = state.copyWith(isAuthenticating: false);
      return false;
    }
  }

  Future<void> disableBiometric() async {
    final service = ref.read(biometricServiceProvider);
    await service.disableBiometric();
    state = state.copyWith(
      isConfigured: false,
      enrolledUsername: null,
      statusMessage: null,
    );
  }
}

final biometricAuthStateProvider =
    NotifierProvider<BiometricAuthNotifier, BiometricAuthState>(
  BiometricAuthNotifier.new,
);
