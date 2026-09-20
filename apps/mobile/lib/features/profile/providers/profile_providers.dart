import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Notifier for in-memory app preferences.
class AppPreferencesNotifier extends Notifier<Map<String, bool>> {
  @override
  Map<String, bool> build() => {
        'notifications': true,
        'darkMode': false,
      };

  void toggleNotification(bool val) {
    state = {...state, 'notifications': val};
  }

  void toggleDarkMode(bool val) {
    state = {...state, 'darkMode': val};
  }
}

final appPreferencesProvider =
    NotifierProvider<AppPreferencesNotifier, Map<String, bool>>(
  AppPreferencesNotifier.new,
);
