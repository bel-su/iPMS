import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/config/env.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_typography.dart';
import '../../providers/auth_provider.dart';

/// Lets the user point the app at a server and check it can be reached,
/// without rebuilding the app. Opened from the sign-in screen.
class ServerSettingsSheet extends ConsumerStatefulWidget {
  const ServerSettingsSheet({super.key, this.probe});

  /// Checks a base URL; replaceable in tests. Throws when unreachable.
  final Future<void> Function(String baseUrl)? probe;

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const ServerSettingsSheet(),
    );
  }

  @override
  ConsumerState<ServerSettingsSheet> createState() => _ServerSettingsSheetState();
}

class _ServerSettingsSheetState extends ConsumerState<ServerSettingsSheet> {
  late final TextEditingController _controller =
      TextEditingController(text: AppConfig.apiBaseUrl);
  bool _testing = false;
  String? _result;
  bool _ok = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  static Future<void> _defaultProbe(String baseUrl) async {
    final dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 6),
      receiveTimeout: const Duration(seconds: 6),
    ));
    await dio.get<dynamic>('/health/live');
  }

  Future<void> _test() async {
    final url = AppConfig.normalizeApiUrl(_controller.text);
    if (url == null) {
      setState(() {
        _ok = false;
        _result = 'Enter an address like 192.168.1.20:3000 or https://ipms.example.com';
      });
      return;
    }
    setState(() {
      _testing = true;
      _result = null;
    });
    try {
      await (widget.probe ?? _defaultProbe)(url);
      _ok = true;
      _result = 'Connected to $url';
    } on DioException catch (e) {
      _ok = false;
      _result = e.response != null
          ? 'Reached $url, but it answered ${e.response!.statusCode}. Is this the iPMS gateway?'
          : "Can't reach $url from this phone. Check that the phone and the server are on the "
              'same network, the server is running, its firewall allows port '
              '${Uri.parse(url).hasPort ? Uri.parse(url).port : 80}, and that Local Network '
              'access is allowed for this app in iOS Settings.';
    } catch (e) {
      _ok = false;
      _result = "Can't reach $url: $e";
    }
    if (mounted) setState(() => _testing = false);
  }

  Future<void> _save({bool reset = false}) async {
    final url = reset ? null : AppConfig.normalizeApiUrl(_controller.text);
    if (!reset && url == null) {
      await _test(); // explains what is wrong with the address
      return;
    }
    final stored = url == AppConfig.builtInApiBaseUrl ? null : url;
    await ref.read(tokenStorageProvider).setApiBaseUrl(stored);
    AppConfig.setCustomApiUrl(stored);
    // Rebuilds the HTTP client, and everything using it, on the new address.
    ref.invalidate(apiClientProvider);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Server', style: AppTypography.headingSmall),
              const SizedBox(height: 6),
              Text(
                'The iPMS gateway this app talks to. Built-in: ${AppConfig.builtInApiBaseUrl}',
                style: AppTypography.caption,
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('server-url'),
                controller: _controller,
                keyboardType: TextInputType.url,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Server address',
                  hintText: 'e.g. 192.168.1.20:3000',
                  prefixIcon: Icon(Icons.dns_outlined),
                ),
                onChanged: (_) => setState(() => _result = null),
              ),
              if (_result != null) ...[
                const SizedBox(height: 12),
                Text(
                  _result!,
                  key: const Key('server-test-result'),
                  style: TextStyle(
                    fontSize: 12,
                    color: _ok ? AppColors.statusCompletedText : AppColors.statusBlockedText,
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _testing ? null : _test,
                      child: _testing
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Test connection'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _testing ? null : () => _save(),
                      child: const Text('Save'),
                    ),
                  ),
                ],
              ),
              TextButton(
                onPressed: _testing ? null : () => _save(reset: true),
                child: const Text('Use built-in address'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
