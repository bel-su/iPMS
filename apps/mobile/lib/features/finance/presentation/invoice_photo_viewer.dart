import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../media/providers/evidence_upload_provider.dart';

/// Full-screen view of an invoice photo already in the media bucket. The link
/// is signed when the screen opens and expires within minutes.
class InvoicePhotoViewer extends ConsumerWidget {
  const InvoicePhotoViewer({super.key, required this.mediaId});

  final String mediaId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = ref.watch(_invoiceUrlProvider(mediaId));
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Invoice photo', style: TextStyle(fontSize: 16)),
      ),
      body: url.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Colors.white)),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(e.toString(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          ),
        ),
        data: (link) => InteractiveViewer(
          maxScale: 5,
          child: Center(
            child: Image.network(
              link,
              loadingBuilder: (_, child, progress) =>
                  progress == null ? child : const Center(child: CircularProgressIndicator(color: Colors.white)),
              errorBuilder: (_, _, _) => const Text('The photo could not be loaded.', style: TextStyle(color: Colors.white70)),
            ),
          ),
        ),
      ),
    );
  }
}

final _invoiceUrlProvider = FutureProvider.autoDispose.family<String, String>((ref, id) {
  return ref.watch(mediaRepositoryProvider).financeFileUrl(id);
});
