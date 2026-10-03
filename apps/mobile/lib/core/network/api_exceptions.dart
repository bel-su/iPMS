import 'package:dio/dio.dart';

/// Typed API exceptions representing backend errors in a user-friendly format.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.statusCode,
    this.errorCode,
    this.details,
  });

  /// Maps a Dio failure to an [ApiException], reading the platform's error
  /// envelope (`{error: {code, message, details}}`) when the server sent one.
  factory ApiException.fromDio(DioException e, {String? fallbackMessage}) {
    if (isConnectionIssue(e)) {
      final base = e.requestOptions.baseUrl;
      return NetworkException(
        message: base.isEmpty
            ? 'No internet connection. Please check your network.'
            : "Can't reach the Axiom server at $base. Check your connection, "
                'or that the app was built with the right API_BASE_URL.',
      );
    }
    final status = e.response?.statusCode;
    if (status == 401) return const UnauthorizedException();

    final data = e.response?.data;
    String? message;
    String? code;
    dynamic details;
    if (data is Map) {
      final envelope = data['error'];
      if (envelope is Map) {
        message = envelope['message']?.toString();
        code = envelope['code']?.toString();
        details = envelope['details'];
      } else {
        message = data['message']?.toString();
      }
    }
    return ApiException(
      message: message ?? fallbackMessage ?? 'Request failed${status != null ? ' ($status)' : ''}.',
      statusCode: status,
      errorCode: code,
      details: details,
    );
  }

  final String message;
  final int? statusCode;
  final String? errorCode;
  final dynamic details;

  /// True when the server never answered: offline, timed out, or unreachable.
  static bool isConnectionIssue(DioException e) =>
      e.type == DioExceptionType.connectionError ||
      e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.sendTimeout ||
      e.type == DioExceptionType.receiveTimeout ||
      e.response == null;

  @override
  String toString() => message;
}

class UnauthorizedException extends ApiException {
  const UnauthorizedException({super.message = 'Session expired. Please log in again.'})
      : super(statusCode: 401, errorCode: 'UNAUTHORIZED');
}

class NetworkException extends ApiException {
  const NetworkException({super.message = 'No internet connection. Please check your network.'})
      : super(statusCode: 0, errorCode: 'NETWORK_ERROR');
}
