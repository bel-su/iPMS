import 'finance_models.dart';

/// What the signed-in user may do with a request, in display order.
enum FinanceAction { edit, submit, cancel, approve, returnToRequester, reject, pay, settle, cashReturn }

/// Who is signed in and what they are allowed to do.
class FinanceViewer {
  const FinanceViewer({required this.id, required this.permissions});

  final String id;
  final List<String> permissions;

  bool can(String permission) => permissions.contains(permission);

  /// Raises requests: managers' and engineers' side of finance.
  bool get raisesRequests => can('finance_request.create');

  /// Has a queue of other people's requests to act on.
  bool get hasApprovals =>
      can('finance_approval.pm') || can('finance_approval.director') || can('finance_payment.record');
}

/// The buttons to offer. Hiding a button is a courtesy: the service checks
/// every rule again. [request] must carry its history, which tells who
/// approved an earlier step of its current revision; the service refuses
/// those people a later step, so they are not offered one.
List<FinanceAction> availableActions(FinanceRequest request, FinanceViewer viewer) {
  // A fully settled advance stays PAID; only its balance says CLOSED, and the
  // service then refuses settlements and cash returns.
  final open = !(request.balance?.isClosed ?? false);
  final settleable = request.isAdvance && request.status == 'PAID';

  if (request.requesterId == viewer.id) {
    if (request.status == 'DRAFT' || request.status == 'RETURNED') {
      return [FinanceAction.edit, FinanceAction.submit];
    }
    if (RequestStatus.pending.contains(request.status)) return [FinanceAction.cancel];
    if (open && settleable && viewer.can('finance_settlement.submit')) return [FinanceAction.settle];
    return const [];
  }

  final approvedEarlier = request.history
      .where((e) => e.revision == request.revision && e.action == 'APPROVED')
      .map((e) => e.actorId);
  if (approvedEarlier.contains(viewer.id)) return const [];

  const decide = [FinanceAction.approve, FinanceAction.returnToRequester, FinanceAction.reject];
  if (request.status == 'PENDING_PM' && viewer.can('finance_approval.pm')) return decide;
  if (request.status == 'PENDING_DIRECTOR' && viewer.can('finance_approval.director')) return decide;
  if (request.status == 'PENDING_FINANCE' && viewer.can('finance_payment.record')) {
    return [FinanceAction.pay, FinanceAction.returnToRequester, FinanceAction.reject];
  }
  if (open && settleable && viewer.can('finance_payment.record')) return [FinanceAction.cashReturn];
  return const [];
}
