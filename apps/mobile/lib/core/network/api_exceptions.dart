/// Typed API exceptions representing backend errors in a user-friendly format.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.statusCode,
    this.errorCode,
    this.details,
  });

  final String message;
  final int? statusCode;
  final String? errorCode;
  final dynamic details;

  @override
  String toString() => 'ApiException: $message (code: $errorCode, status: $statusCode)';
}

class UnauthorizedException extends ApiException {
  const UnauthorizedException({super.message = 'Session expired. Please log in again.'})
      : super(statusCode: 401, errorCode: 'UNAUTHORIZED');
}

class NetworkException extends ApiException {
  const NetworkException({super.message = 'No internet connection. Please check your network.'})
      : super(statusCode: 0, errorCode: 'NETWORK_ERROR');
}
