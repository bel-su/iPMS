import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'token_storage.dart';

/// Service encapsulating native hardware biometric operations (Fingerprint / TouchID / FaceID)
/// and linking them securely to stored session tokens in the device's Secure Enclave.
class BiometricAuthService {
  BiometricAuthService({
    LocalAuthentication? localAuth,
    TokenStorage? tokenStorage,
  })  : _localAuth = localAuth ?? LocalAuthentication(),
        _tokenStorage = tokenStorage ?? TokenStorage();

  final LocalAuthentication _localAuth;
  final TokenStorage _tokenStorage;

  /// Checks whether the device hardware supports biometrics and has enrolled credentials.
  Future<bool> canAuthenticateWithBiometrics() async {
    try {
      final bool canCheck = await _localAuth.canCheckBiometrics;
      final bool isSupported = await _localAuth.isDeviceSupported();
      return canCheck && isSupported;
    } on PlatformException {
      return false;
    }
  }

  /// Returns the specific biometric modalities available on this device.
  Future<List<BiometricType>> getAvailableBiometrics() async {
    try {
      return await _localAuth.getAvailableBiometrics();
    } on PlatformException {
      return [];
    }
  }

  /// Whether the device has a Face ID sensor (iOS TrueDepth camera).
  Future<bool> hasFaceIdSensor() async {
    final biometrics = await getAvailableBiometrics();
    return biometrics.contains(BiometricType.face);
  }

  /// Whether the device has a dedicated fingerprint reader.
  Future<bool> hasFingerprintSensor() async {
    final biometrics = await getAvailableBiometrics();
    return biometrics.contains(BiometricType.fingerprint) ||
        biometrics.contains(BiometricType.strong);
  }

  /// Invokes the native platform Face ID / Touch ID / fingerprint sheet.
  /// The device passcode is allowed as a fallback, as the platforms expect.
  Future<BiometricResult> authenticate({
    String? localizedReason,
  }) async {
    try {
      if (!await _localAuth.isDeviceSupported()) {
        return const BiometricResult.failed('This device does not support biometric sign-in.');
      }
      final isFace = await hasFaceIdSensor();
      final reason = localizedReason ??
          (isFace
              ? 'Authenticate with Face ID to access Axiom Field App'
              : 'Scan fingerprint to authenticate to Axiom Field App');

      final ok = await _localAuth.authenticate(
        localizedReason: reason,
        biometricOnly: false,
        persistAcrossBackgrounding: true,
      );
      return ok
          ? const BiometricResult.success()
          : const BiometricResult.failed('Biometric check was not recognized. Try again.');
    } on LocalAuthException catch (e) {
      return BiometricResult.fromException(e);
    } on PlatformException catch (e) {
      return BiometricResult.failed(e.message ?? 'Biometric sign-in is unavailable on this device.');
    } catch (e) {
      return BiometricResult.failed('Biometric sign-in failed: $e');
    }
  }

  /// Returns true if biometric login was previously enabled and enrolled for a user.
  Future<bool> isBiometricLoginConfigured() async {
    final isEnabled = await _tokenStorage.isBiometricEnabled();
    if (!isEnabled) return false;

    final canAuth = await canAuthenticateWithBiometrics();
    if (!canAuth) return false;

    final username = await _tokenStorage.getBiometricUsername();
    return username != null && username.isNotEmpty;
  }

  /// Retrieves the username enrolled for biometric authentication.
  Future<String?> getEnrolledUsername() async {
    return await _tokenStorage.getBiometricUsername();
  }

  /// Enrolls the given username for biometric login.
  Future<void> enrollBiometric(String username) async {
    await _tokenStorage.setBiometricEnabled(true);
    await _tokenStorage.setBiometricUsername(username);
  }

  /// Disables biometric login and forgets the session kept for it.
  Future<void> disableBiometric() => _tokenStorage.clearBiometric();
}

/// The outcome of one native biometric prompt.
class BiometricResult {
  const BiometricResult.success()
      : success = true,
        cancelled = false,
        message = null;

  const BiometricResult.cancelled()
      : success = false,
        cancelled = true,
        message = null;

  const BiometricResult.failed(this.message)
      : success = false,
        cancelled = false;

  factory BiometricResult.fromException(LocalAuthException e) {
    switch (e.code) {
      case LocalAuthExceptionCode.userCanceled:
      case LocalAuthExceptionCode.systemCanceled:
      case LocalAuthExceptionCode.userRequestedFallback:
        return const BiometricResult.cancelled();
      case LocalAuthExceptionCode.noBiometricsEnrolled:
        return const BiometricResult.failed(
            'No Face ID or fingerprint is set up on this device. Add one in Settings.');
      case LocalAuthExceptionCode.noCredentialsSet:
        return const BiometricResult.failed(
            'Set a device passcode and Face ID or fingerprint in Settings first.');
      case LocalAuthExceptionCode.noBiometricHardware:
      case LocalAuthExceptionCode.biometricHardwareTemporarilyUnavailable:
        return const BiometricResult.failed('Biometric hardware is not available right now.');
      case LocalAuthExceptionCode.temporaryLockout:
        return const BiometricResult.failed('Too many attempts. Wait a moment and try again.');
      case LocalAuthExceptionCode.biometricLockout:
        return const BiometricResult.failed(
            'Biometrics are locked. Unlock the device with its passcode, then try again.');
      case LocalAuthExceptionCode.authInProgress:
        return const BiometricResult.failed('A biometric check is already in progress.');
      default:
        return BiometricResult.failed(e.description ?? 'Biometric sign-in failed.');
    }
  }

  final bool success;
  final bool cancelled;
  final String? message;
}
