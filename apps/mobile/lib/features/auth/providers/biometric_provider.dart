import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show IconData, Icons;
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

  bool get hasFaceId => availableBiometrics.contains(BiometricType.face);

  bool get hasFingerprint =>
      availableBiometrics.contains(BiometricType.fingerprint) ||
      availableBiometrics.contains(BiometricType.strong);

  bool get hasFace => availableBiometrics.contains(BiometricType.face);

  /// User-facing name of the device's biometric method, e.g. "Face ID" on
  /// iPhone X and later, "Touch ID" on older iPhones, "Fingerprint" on Android.
  String get biometricLabel {
    final isIOS = defaultTargetPlatform == TargetPlatform.iOS;
    if (hasFace) return isIOS ? 'Face ID' : 'Face Unlock';
    if (isIOS && hasFingerprint) return 'Touch ID';
    return 'Fingerprint';
  }

  /// Platform-neutral name of the biometric method, for prose such as
  /// "Fast face id access".
  String get biometricName => hasFace ? 'Face ID' : 'Fingerprint';

  IconData get biometricIcon =>
      hasFace ? Icons.face_rounded : Icons.fingerprint_rounded;

  BiometricAuthState copyWith({
    bool? isHardwareSupported,
    bool? isConfigured,
    String? enrolledUsername,
    List<BiometricType>? availableBiometrics,
    bool? isAuthenticating,
    String? statusMessage,
    bool clearEnrolledUsername = false,
  }) {
    return BiometricAuthState(
      isHardwareSupported: isHardwareSupported ?? this.isHardwareSupported,
      isConfigured: isConfigured ?? this.isConfigured,
      enrolledUsername:
          clearEnrolledUsername ? null : (enrolledUsername ?? this.enrolledUsername),
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
    Future.microtask(checkBiometricStatus);
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
      clearEnrolledUsername: username == null,
      availableBiometrics: available,
      statusMessage: state.statusMessage,
    );
  }

  /// Runs the native prompt, then restores the stored session. Returns false
  /// (with [BiometricAuthState.statusMessage] set, unless the user simply
  /// cancelled) when either step does not succeed.
  Future<bool> authenticateAndLogin() async {
    final service = ref.read(biometricServiceProvider);
    final enrolledUser = state.enrolledUsername;
    if (enrolledUser == null || enrolledUser.isEmpty) return false;

    state = state.copyWith(isAuthenticating: true);
    try {
      final check = await service.authenticate(
        localizedReason:
            'Use ${state.biometricLabel} to access Axiom Field App as @$enrolledUser',
      );
      if (!check.success) {
        state = state.copyWith(
          isAuthenticating: false,
          statusMessage: check.cancelled ? null : check.message,
        );
        return false;
      }

      final auth = ref.read(authStateProvider.notifier);
      await auth.loginWithBiometrics(enrolledUser);
      final result = ref.read(authStateProvider);
      if (result.hasError || result.value == null) {
        state = state.copyWith(
          isAuthenticating: false,
          statusMessage: result.error?.toString() ?? 'Could not restore your session.',
        );
        return false;
      }
      state = state.copyWith(isAuthenticating: false);
      return true;
    } catch (e) {
      state = state.copyWith(
        isAuthenticating: false,
        statusMessage: 'Biometric sign-in failed: $e',
      );
      return false;
    }
  }

  /// Confirms with the native prompt, then keeps the current session for
  /// biometric sign-in. Must be called while signed in. Returns null on
  /// success, otherwise why it did not happen ('' when the user cancelled).
  Future<String?> enrollBiometric(String username) async {
    final service = ref.read(biometricServiceProvider);
    state = state.copyWith(isAuthenticating: true);

    try {
      final check = await service.authenticate(
        localizedReason:
            'Use ${state.biometricLabel} to turn on biometric sign-in',
      );
      if (!check.success) {
        state = state.copyWith(isAuthenticating: false);
        return check.cancelled ? '' : check.message;
      }
      await service.enrollBiometric(username);
      state = state.copyWith(
        isConfigured: true,
        enrolledUsername: username,
        isAuthenticating: false,
      );
      return null;
    } catch (e) {
      state = state.copyWith(isAuthenticating: false);
      return 'Could not turn on biometric sign-in: $e';
    }
  }

  Future<void> disableBiometric() async {
    final service = ref.read(biometricServiceProvider);
    await service.disableBiometric();
    state = state.copyWith(isConfigured: false, clearEnrolledUsername: true);
  }

  void clearStatus() => state = state.copyWith();
}

final biometricAuthStateProvider =
    NotifierProvider<BiometricAuthNotifier, BiometricAuthState>(
  BiometricAuthNotifier.new,
);
