import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/config/env.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';

/// What `POST /media/uploads` hands back: where to PUT the bytes, or nothing
/// when the file is already past PENDING.
class UploadRegistration {
  const UploadRegistration({
    required this.id,
    required this.status,
    this.signedUrl,
    this.headers = const {},
    this.mode,
  });

  factory UploadRegistration.fromJson(Map<String, dynamic> json) {
    final upload = json['upload'] as Map<String, dynamic>?;
    return UploadRegistration(
      id: json['id'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      mode: upload?['mode'] as String?,
      signedUrl: upload?['signedUrl'] as String?,
      headers: (upload?['headers'] as Map<String, dynamic>? ?? const {})
          .map((k, v) => MapEntry(k, v.toString())),
    );
  }

  final String id;
  final String status;
  final String? mode;
  final String? signedUrl;
  final Map<String, String> headers;

  bool get needsBytes => status == 'PENDING' && signedUrl != null;
}

class UploadStatusItem {
  const UploadStatusItem({required this.id, required this.status, this.rejectReason});

  factory UploadStatusItem.fromJson(Map<String, dynamic> json) => UploadStatusItem(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? 'UNKNOWN',
        rejectReason: json['rejectReason'] as String?,
      );

  final String id;
  final String status;
  final String? rejectReason;
}

/// A work order's evidence as the media service holds it.
class RemoteMedia {
  const RemoteMedia({
    required this.id,
    required this.status,
    this.checklistItemId,
    this.capturedAt,
    this.thumbnailUrl,
    this.kind = 'PHOTO',
    this.latitude,
    this.longitude,
    this.uploadedBy,
  });

  factory RemoteMedia.fromJson(Map<String, dynamic> json) => RemoteMedia(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? 'UNKNOWN',
        checklistItemId: json['checklistItemId'] as String?,
        capturedAt: json['capturedAt'] != null ? DateTime.tryParse(json['capturedAt'].toString()) : null,
        kind: json['kind'] as String? ?? 'PHOTO',
        latitude: (json['latitude'] as num?)?.toDouble(),
        longitude: (json['longitude'] as num?)?.toDouble(),
        uploadedBy: json['uploadedBy'] as String?,
        thumbnailUrl: (json['thumbnail'] as Map<String, dynamic>?)?['signedUrl'] as String?,
      );

  final String id;
  final String status;
  final String? checklistItemId;
  final DateTime? capturedAt;
  final String? thumbnailUrl;
  final String kind;
  final double? latitude;
  final double? longitude;
  final String? uploadedBy;

  /// Past verification, so there are bytes to download.
  bool get isViewable => status == 'READY' || status == 'ATTACHED';
}

/// The phone's side of the media service's upload protocol
/// (docs/superpowers/specs/2026-09-28-media-core-design.md §5):
/// register → PUT bytes to the presigned bucket URL → complete → poll status.
class MediaRepository {
  MediaRepository({required this.apiClient, Dio? storageDio})
      : _storageDio = storageDio ??
            Dio(BaseOptions(
              connectTimeout: AppConfig.connectTimeout,
              sendTimeout: AppConfig.uploadTimeout,
              receiveTimeout: AppConfig.uploadTimeout,
            ));

  final ApiClient apiClient;

  /// Talks to the bucket directly. Deliberately without the auth interceptor:
  /// the presigned URL is the credential, and a bearer token would both leak
  /// to storage and break the signature.
  final Dio _storageDio;

  Future<UploadRegistration> register({
    required String id,
    required String workOrderId,
    required String checklistItemId,
    required int sizeBytes,
    required String contentHash,
    required DateTime capturedAt,
    required String deviceId,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        ApiEndpoints.mediaUploads,
        data: {
          'id': id,
          'category': 'EVIDENCE',
          'workOrderId': workOrderId,
          'checklistItemId': checklistItemId,
          'kind': 'PHOTO',
          'contentType': 'image/jpeg',
          'sizeBytes': sizeBytes,
          'contentHash': contentHash,
          'capturedAt': capturedAt.toUtc().toIso8601String(),
          if (latitude != null && longitude != null) ...{
            'latitude': latitude,
            'longitude': longitude,
          },
          'deviceId': deviceId,
        },
      );
      return UploadRegistration.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not register the photo for upload.');
    }
  }

  /// Sends the file to the bucket. The URL is signed over the length, type
  /// and SHA-256, so the headers the server returned must go out unchanged.
  Future<void> putBytes(UploadRegistration registration, Uint8List bytes) async {
    try {
      await _storageDio.put<void>(
        registration.signedUrl!,
        data: Stream.fromIterable([bytes]),
        options: Options(
          headers: {
            ...registration.headers,
            Headers.contentLengthHeader: bytes.length,
          },
          contentType: registration.headers['content-type'] ?? 'image/jpeg',
        ),
      );
    } on DioException catch (e) {
      if (ApiException.isConnectionIssue(e)) throw const NetworkException();
      throw ApiException(
        message: 'The storage server refused the photo (${e.response?.statusCode}).',
        statusCode: e.response?.statusCode,
      );
    }
  }

  Future<String> complete(String id) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(
        ApiEndpoints.mediaComplete(id),
        data: const <String, dynamic>{},
      );
      return response.data?['status'] as String? ?? 'VERIFYING';
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not finish the upload.');
    }
  }

  Future<List<UploadStatusItem>> status(List<String> ids) async {
    if (ids.isEmpty) return const [];
    try {
      final response = await apiClient.dio.post<List<dynamic>>(
        ApiEndpoints.mediaUploadStatus,
        data: {'ids': ids},
      );
      return (response.data ?? const [])
          .map((e) => UploadStatusItem.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not check upload status.');
    }
  }

  /// Discards an uploaded retake. The server refuses once it is attached.
  Future<void> discard(String id) async {
    try {
      await apiClient.dio.delete<void>(ApiEndpoints.media(id));
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not discard the photo.');
    }
  }

  Future<List<RemoteMedia>> listForWorkOrder(String workOrderId) async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(
        ApiEndpoints.mediaList,
        queryParameters: {'workOrderId': workOrderId},
      );
      return (response.data ?? const [])
          .map((e) => RemoteMedia.fromJson(e as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not load evidence.');
    }
  }

  /// Downloads a file from a signed URL. Like uploads, it goes to the bucket
  /// directly and carries no bearer token.
  Future<Uint8List> download(String signedUrl) async {
    try {
      final response = await _storageDio.get<List<int>>(
        signedUrl,
        options: Options(responseType: ResponseType.bytes),
      );
      return Uint8List.fromList(response.data ?? const []);
    } on DioException catch (e) {
      if (ApiException.isConnectionIssue(e)) throw const NetworkException();
      throw ApiException(
        message: 'The storage server refused the download (${e.response?.statusCode}).',
        statusCode: e.response?.statusCode,
      );
    }
  }

  /// A short-lived download link for the original or its thumbnail.
  Future<String> viewUrl(String id, {String variant = 'original'}) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.mediaUrl(id),
        queryParameters: {'variant': variant},
      );
      final url = response.data?['signedUrl'] as String?;
      if (url == null) throw const ApiException(message: 'No download link was returned.');
      return url;
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not load the photo.');
    }
  }
}
