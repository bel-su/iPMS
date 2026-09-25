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

  /// Whether the device has a dedicated fingerprint reader.
  Future<bool> hasFingerprintSensor() async {
    final biometrics = await getAvailableBiometrics();
    return biometrics.contains(BiometricType.fingerprint) ||
        biometrics.contains(BiometricType.strong);
  }

  /// Invokes the native platform fingerprint / biometric authentication sheet.
  /// Returns `true` if verified, `false` if cancelled or rejected.
  Future<bool> authenticate({
    String localizedReason =
        'Scan your fingerprint to authenticate to iPMS Field App',
  }) async {
    try {
      final canAuth = await canAuthenticateWithBiometrics();
      if (!canAuth) return false;

      return await _localAuth.authenticate(
        localizedReason: localizedReason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } on LocalAuthException {
      return false;
    } on PlatformException {
      return false;
    } catch (_) {
      return false;
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

  /// Disables biometric login and removes the enrolled username anchor.
  Future<void> disableBiometric() async {
    await _tokenStorage.setBiometricEnabled(false);
    await _tokenStorage.setBiometricUsername(null);
  }
}
