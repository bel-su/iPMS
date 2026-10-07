import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/finance_models.dart';
import '../domain/finance_rules.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'request_detail_screen.dart';
import 'request_form_screen.dart';

/// Filters over the list, by where a request is in its life.
const Map<String, Set<String>?> _filters = {
  'All': null,
  'Drafts': {'DRAFT'},
  'In approval': {'PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'},
  'Paid': {'PAID', 'SETTLED'},
  'Returned': {'RETURNED'},
  'Closed': {'REJECTED', 'CANCELLED'},
};

class FinanceScreen extends ConsumerStatefulWidget {
  const FinanceScreen({super.key});

  @override
  ConsumerState<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends ConsumerState<FinanceScreen> {
  String _filter = 'All';

  /// Whether the list shows other people's requests waiting on me.
  bool _approvals = false;

  Future<void> _newRequest() async {
    final kind = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('New request', style: AppTypography.headingSmall),
              const SizedBox(height: 12),
              _KindTile(
                icon: Icons.payments_outlined,
                title: 'Advance',
                subtitle: 'Money you need before the work. Settle it later with invoices.',
                onTap: () => Navigator.pop(ctx, RequestKind.advance),
              ),
              _KindTile(
                icon: Icons.receipt_long_outlined,
                title: 'Reimbursement',
                subtitle: 'Claim back what you already spent, with its invoices.',
                onTap: () => Navigator.pop(ctx, RequestKind.reimbursement),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'To settle an advance, open it from the list once it is paid.',
                  style: AppTypography.caption,
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (kind == null || !mounted) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (_) => RequestFormScreen(kind: kind)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final viewer = FinanceViewer(id: user?.id ?? '', permissions: user?.permissions ?? const []);
    final showApprovals = _approvals && viewer.hasApprovals;
    final requests = ref.watch(showApprovals ? awaitingFinanceRequestsProvider : myFinanceRequestsProvider);
    final names = ref.watch(financeUserNamesProvider).value ?? const <String, String>{};
    final canView = viewer.can('finance_request.view');
    final canCreate = viewer.raisesRequests;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () => ref
              .refresh((showApprovals ? awaitingFinanceRequestsProvider : myFinanceRequestsProvider).future)
              .then((_) {}, onError: (_) {}),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Finance', style: AppTypography.headingMedium),
                            const SizedBox(height: 2),
                            Text(
                              showApprovals
                                  ? 'Requests waiting for your decision'
                                  : 'Your advances, settlements and reimbursements',
                              style: AppTypography.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      if (canCreate && !showApprovals)
                        FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.darkSlate,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          ),
                          onPressed: _newRequest,
                          icon: const Icon(Icons.add_rounded, size: 18),
                          label: const Text('New', style: TextStyle(fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                ),
              ),
              if (!canView)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: _Notice(
                    icon: Icons.lock_outline,
                    title: 'Finance is not available for your account',
                    message: 'Ask an administrator if you need to raise advances or reimbursements.',
                  ),
                )
              else ...[
                if (viewer.hasApprovals)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                      child: SegmentedButton<bool>(
                        showSelectedIcon: false,
                        segments: [
                          const ButtonSegment(value: false, label: Text('My requests')),
                          ButtonSegment(
                            value: true,
                            label: Text(
                              'Approvals${(ref.watch(awaitingFinanceRequestsProvider).value?.length ?? 0) > 0 ? ' (${ref.watch(awaitingFinanceRequestsProvider).value!.length})' : ''}',
                            ),
                          ),
                        ],
                        selected: {_approvals},
                        onSelectionChanged: (s) => setState(() {
                          _approvals = s.first;
                          _filter = 'All';
                        }),
                      ),
                    ),
                  ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 14),
                    child: SizedBox(
                      height: 38,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        itemCount: _filters.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final name = _filters.keys.elementAt(i);
                          final selected = name == _filter;
                          return ChoiceChip(
                            label: Text(name),
                            selected: selected,
                            showCheckmark: false,
                            selectedColor: AppColors.darkSlate,
                            labelStyle: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: selected ? Colors.white : AppColors.textSecondary,
                            ),
                            onSelected: (_) => setState(() => _filter = name),
                          );
                        },
                      ),
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 12)),
                requests.when(
                  loading: () => const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (e, _) => SliverFillRemaining(
                    hasScrollBody: false,
                    child: _Notice(
                      icon: Icons.cloud_off_outlined,
                      title: 'Could not load your requests',
                      message: e.toString(),
                      action: TextButton(
                        onPressed: () => ref.invalidate(showApprovals ? awaitingFinanceRequestsProvider : myFinanceRequestsProvider),
                        child: const Text('Retry'),
                      ),
                    ),
                  ),
                  data: (all) {
                    final wanted = _filters[_filter];
                    final shown = wanted == null ? all : all.where((r) => wanted.contains(r.status)).toList();
                    if (shown.isEmpty) {
                      return SliverFillRemaining(
                        hasScrollBody: false,
                        child: _Notice(
                          icon: Icons.account_balance_wallet_outlined,
                          title: all.isEmpty ? (showApprovals ? 'Nothing is waiting for you' : 'No requests yet') : 'Nothing here',
                          message: all.isEmpty
                              ? (showApprovals
                                  ? 'Requests that need your approval or payment will show here.'
                                  : canCreate
                                      ? 'Tap New to raise an advance or a reimbursement.'
                                      : 'Requests you raise will show here.')
                              : 'No requests match this filter.',
                        ),
                      );
                    }
                    return SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                      sliver: SliverList.separated(
                        itemCount: shown.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (_, i) => _RequestCard(
                          request: shown[i],
                          requester: showApprovals ? names[shown[i].requesterId] : null,
                        ),
                      ),
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, this.requester});

  final FinanceRequest request;

  /// Shown on the approvals list, where the request is someone else's.
  final String? requester;

  @override
  Widget build(BuildContext context) {
    final waiting = RequestStatus.waitingOn(request.status);
    final shownAmount = request.status == 'PAID' || request.status == 'SETTLED'
        ? (request.approvedAmount ?? request.requestedAmount)
        : request.requestedAmount;
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.push<void>(
          context,
          MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: request.id)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(request.number, style: AppTypography.titleMedium),
                  const SizedBox(width: 8),
                  Text(
                    RequestKind.labels[request.kind] ?? request.kind,
                    style: AppTypography.caption,
                  ),
                  const Spacer(),
                  FinanceStatusChip(status: request.status),
                ],
              ),
              const SizedBox(height: 8),
              Text(request.purpose, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppTypography.bodyMedium),
              const SizedBox(height: 4),
              Text(
                [
                  if ((requester ?? '').isNotEmpty) requester!,
                  if (request.projectCode != null) request.projectCode!,
                  if (request.categoryName != null) request.categoryName!,
                  DateFormat('d MMM yyyy').format(request.createdAt),
                ].join(' • '),
                style: AppTypography.caption,
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Text(formatMoney(shownAmount), style: AppTypography.titleLarge),
                  const Spacer(),
                  if (waiting != null)
                    Flexible(child: Text(waiting, style: AppTypography.caption, overflow: TextOverflow.ellipsis)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KindTile extends StatelessWidget {
  const _KindTile({required this.icon, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: AppColors.primaryLavenderLight, borderRadius: BorderRadius.circular(12)),
        child: Icon(icon, color: AppColors.darkSlate),
      ),
      title: Text(title, style: AppTypography.titleMedium),
      subtitle: Text(subtitle, style: AppTypography.caption),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.title, required this.message, this.action});

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: AppColors.textTertiary),
            const SizedBox(height: 12),
            Text(title, style: AppTypography.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 4),
            Text(message, style: AppTypography.bodySmall, textAlign: TextAlign.center),
            ?action,
          ],
        ),
      ),
    );
  }
}
