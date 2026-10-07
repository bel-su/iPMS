import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/finance_models.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'request_form_screen.dart';

class RequestDetailScreen extends ConsumerStatefulWidget {
  const RequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  ConsumerState<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends ConsumerState<RequestDetailScreen> {
  bool _busy = false;

  void _message(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? AppColors.statusBlockedText : null,
    ));
  }

  void _refresh() {
    ref.invalidate(financeRequestProvider(widget.requestId));
    ref.invalidate(myFinanceRequestsProvider);
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      _refresh();
      _message(done);
    } on ApiException catch (e) {
      _message(e.message, error: true);
    } catch (e) {
      _message('$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(FinanceRequest request) async {
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text('Cancel ${request.number}?'),
        content: TextField(
          controller: reason,
          maxLength: 1000,
          decoration: const InputDecoration(labelText: 'Reason (optional)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusBlockedText, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancel request'),
          ),
        ],
      ),
    );
    final text = reason.text;
    reason.dispose();
    if (confirmed != true) return;
    await _run(() => ref.read(financeRepositoryProvider).cancel(request.id, comment: text), 'Request cancelled.');
  }

  Future<void> _open(Widget screen) async {
    await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => screen));
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final userId = ref.watch(authStateProvider).value?.id ?? '';
    final canSettle = ref.watch(authStateProvider).value?.can('finance_settlement.submit') ?? false;
    final async = ref.watch(financeRequestProvider(widget.requestId));

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        title: Text(async.value?.number ?? 'Request', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(e.toString(), textAlign: TextAlign.center, style: AppTypography.bodySmall),
                TextButton(onPressed: _refresh, child: const Text('Retry')),
              ],
            ),
          ),
        ),
        data: (r) => RefreshIndicator(
          onRefresh: () => ref.refresh(financeRequestProvider(widget.requestId).future).then((_) {}, onError: (_) {}),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: [
              Row(
                children: [
                  Expanded(child: Text(RequestKind.labels[r.kind] ?? r.kind, style: AppTypography.headingSmall)),
                  FinanceStatusChip(status: r.status),
                ],
              ),
              const SizedBox(height: 6),
              Text(r.purpose, style: AppTypography.bodyMedium),
              if (RequestStatus.waitingOn(r.status) != null) ...[
                const SizedBox(height: 6),
                Text(RequestStatus.waitingOn(r.status)!, style: AppTypography.caption),
              ],
              if (r.status == 'RETURNED' && r.lastReviewComment != null)
                _banner(r.lastReviewComment!, AppColors.statusBlockedBg, AppColors.statusBlockedText),
              if (r.status == 'REJECTED' && r.lastReviewComment != null)
                _banner(r.lastReviewComment!, AppColors.statusBlockedBg, AppColors.statusBlockedText),
              const SizedBox(height: 12),
              _section('Summary', [
                FinanceInfoRow('Project', [r.projectCode, r.projectName].whereType<String>().join(' — ')),
                FinanceInfoRow('Category', r.categoryName ?? '—'),
                FinanceInfoRow('Requested', formatMoney(r.requestedAmount), bold: true),
                if (r.approvedAmount != null) FinanceInfoRow('Approved', formatMoney(r.approvedAmount), bold: true),
                if (r.appliedAmount != null) FinanceInfoRow('Applied to advance', formatMoney(r.appliedAmount)),
                FinanceInfoRow('Created', DateFormat('d MMM yyyy, h:mm a').format(r.createdAt)),
              ]),
              if (r.balance != null)
                _section('Advance balance', [
                  FinanceInfoRow('Paid', formatMoney(r.balance!.paid)),
                  FinanceInfoRow('Settled with invoices', formatMoney(r.balance!.applied)),
                  FinanceInfoRow('Cash returned', formatMoney(r.balance!.cashReturned)),
                  FinanceInfoRow('Outstanding', formatMoney(r.balance!.outstanding), bold: true),
                ]),
              if (r.invoices.isNotEmpty)
                _section('Invoices', [
                  for (final i in r.invoices)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(i.vendor, style: AppTypography.titleMedium),
                                Text(
                                  '#${i.invoiceNumber} • ${DateFormat('d MMM yyyy').format(i.invoiceDate)}',
                                  style: AppTypography.caption,
                                ),
                              ],
                            ),
                          ),
                          Text(formatMoney(i.amount), style: AppTypography.titleMedium),
                        ],
                      ),
                    ),
                ]),
              if (r.payments.isNotEmpty)
                _section('Payments', [
                  for (final p in r.payments)
                    FinanceInfoRow(
                      '${p.isCashReturn ? 'Cash returned' : 'Paid'} ${DateFormat('d MMM yyyy').format(p.paidOn)} • ${p.modeLabel}',
                      formatMoney(p.amount),
                    ),
                ]),
              if (r.history.isNotEmpty)
                _section('History', [
                  for (final e in r.history)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(e.description, style: AppTypography.titleMedium),
                          Text(DateFormat('d MMM yyyy, h:mm a').format(e.at), style: AppTypography.caption),
                          if ((e.comment ?? '').isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text('“${e.comment}”', style: AppTypography.bodySmall),
                            ),
                        ],
                      ),
                    ),
                ]),
              const SizedBox(height: 8),
              ..._actions(r, userId, canSettle),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _actions(FinanceRequest r, String userId, bool canSettle) {
    final primary = ElevatedButton.styleFrom(
      backgroundColor: AppColors.darkSlate,
      foregroundColor: Colors.white,
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
    final secondary = OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
    final gap = const SizedBox(height: 10);

    if (r.isEditable(userId)) {
      return [
        ElevatedButton.icon(
          style: primary,
          onPressed: _busy ? null : () => _run(() => ref.read(financeRepositoryProvider).submit(r.id), 'Request submitted.'),
          icon: const Icon(Icons.send_rounded, size: 18),
          label: Text(r.status == 'RETURNED' ? 'Resubmit' : 'Submit', style: const TextStyle(fontWeight: FontWeight.w700)),
        ),
        gap,
        OutlinedButton.icon(
          style: secondary,
          onPressed: _busy ? null : () => _open(RequestFormScreen(kind: r.kind, initial: r, advance: null)),
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: const Text('Edit'),
        ),
      ];
    }
    if (r.canCancel(userId)) {
      return [
        OutlinedButton.icon(
          style: secondary.copyWith(foregroundColor: const WidgetStatePropertyAll(AppColors.statusBlockedText)),
          onPressed: _busy ? null : () => _cancel(r),
          icon: const Icon(Icons.cancel_outlined, size: 18),
          label: const Text('Cancel request'),
        ),
      ];
    }
    if (r.requesterId == userId && r.canSettle && canSettle) {
      return [
        ElevatedButton.icon(
          style: primary,
          onPressed: _busy ? null : () => _open(RequestFormScreen(kind: RequestKind.settlement, advance: r)),
          icon: const Icon(Icons.receipt_long_outlined, size: 18),
          label: const Text('Settle with invoices', style: TextStyle(fontWeight: FontWeight.w700)),
        ),
      ];
    }
    return const [];
  }

  Widget _banner(String text, Color bg, Color fg) => Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.all(12),
        width: double.infinity,
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
        child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
      );

  Widget _section(String title, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppTypography.titleMedium.copyWith(color: AppColors.textSecondary)),
                const SizedBox(height: 6),
                ...children,
              ],
            ),
          ),
        ),
      );
}
