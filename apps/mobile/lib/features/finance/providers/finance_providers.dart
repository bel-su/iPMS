import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../data/finance_repository.dart';
import '../domain/finance_models.dart';

final financeRepositoryProvider = Provider<FinanceRepository>((ref) {
  ref.watch(sessionOwnerProvider);
  return FinanceRepository(apiClient: ref.watch(apiClientProvider));
});

/// The signed-in user's own requests, newest first.
final myFinanceRequestsProvider = FutureProvider<List<FinanceRequest>>((ref) {
  return ref.watch(financeRepositoryProvider).myRequests();
});

final financeRequestProvider = FutureProvider.family<FinanceRequest, String>((ref, id) {
  return ref.watch(financeRepositoryProvider).getRequest(id);
});

/// Categories a request can be filed under (disabled ones left out).
final financeCategoriesProvider = FutureProvider<List<ExpenseCategory>>((ref) {
  return ref.watch(financeRepositoryProvider).categories();
});
