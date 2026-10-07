import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../domain/finance_models.dart';

ShapeBorder _sheetShape() => const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    );

Widget _frame(BuildContext context, String title, List<Widget> children) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(title, style: AppTypography.headingSmall)),
                  IconButton(icon: const Icon(Icons.close_rounded, size: 20), onPressed: () => Navigator.pop(context)),
                ],
              ),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      ),
    );

ButtonStyle _primary({Color color = AppColors.darkSlate}) => ElevatedButton.styleFrom(
      backgroundColor: color,
      foregroundColor: Colors.white,
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );

/// Asks for a reason (return and reject both need one). Resolves to the
/// trimmed text, or null if dismissed.
Future<String?> askForReason(
  BuildContext context, {
  required String title,
  required String hint,
  required String button,
  bool destructive = false,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    shape: _sheetShape(),
    builder: (_) => _ReasonSheet(title: title, hint: hint, button: button, destructive: destructive),
  );
}

class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.title, required this.hint, required this.button, required this.destructive});

  final String title;
  final String hint;
  final String button;
  final bool destructive;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _frame(context, widget.title, [
      TextField(
        controller: _text,
        autofocus: true,
        minLines: 2,
        maxLines: 5,
        maxLength: 1000,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(labelText: widget.hint),
        onChanged: (_) => setState(() {}),
      ),
      const SizedBox(height: 8),
      ElevatedButton(
        style: _primary(color: widget.destructive ? AppColors.statusBlockedText : AppColors.darkSlate),
        onPressed: _text.text.trim().isEmpty ? null : () => Navigator.pop(context, _text.text.trim()),
        child: Text(widget.button, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}

/// The approval a manager or director gives. Only the director may set an
/// amount, and never above what was asked.
class ApprovalChoice {
  const ApprovalChoice({this.amount, this.comment});

  final String? amount;
  final String? comment;
}

Future<ApprovalChoice?> askApproval(BuildContext context, FinanceRequest request, {required bool setsAmount}) {
  return showModalBottomSheet<ApprovalChoice>(
    context: context,
    isScrollControlled: true,
    shape: _sheetShape(),
    builder: (_) => _ApprovalSheet(request: request, setsAmount: setsAmount),
  );
}

class _ApprovalSheet extends StatefulWidget {
  const _ApprovalSheet({required this.request, required this.setsAmount});

  final FinanceRequest request;
  final bool setsAmount;

  @override
  State<_ApprovalSheet> createState() => _ApprovalSheetState();
}

class _ApprovalSheetState extends State<_ApprovalSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  /// Empty means approve as asked; otherwise a valid amount not above it.
  String? get _amountError {
    final a = _amount.text.trim();
    if (a.isEmpty) return null;
    if (!isValidMoney(a)) return 'Enter an amount with at most two decimals';
    if ((double.tryParse(a) ?? 0) > (double.tryParse(widget.request.requestedAmount) ?? 0)) {
      return 'Cannot be more than ${formatMoney(widget.request.requestedAmount)}';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return _frame(context, 'Approve ${widget.request.number}', [
      Text('Requested ${formatMoney(widget.request.requestedAmount)}', style: AppTypography.bodySmall),
      const SizedBox(height: 12),
      if (widget.setsAmount) ...[
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
          decoration: InputDecoration(
            labelText: 'Approved amount (NPR)',
            hintText: widget.request.requestedAmount,
            helperText: 'Leave empty to approve the full amount, or enter a lower one.',
            errorText: _amountError,
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
      ],
      TextField(
        controller: _note,
        maxLength: 1000,
        decoration: const InputDecoration(labelText: 'Note (optional)'),
      ),
      const SizedBox(height: 8),
      ElevatedButton(
        style: _primary(),
        onPressed: _amountError != null
            ? null
            : () => Navigator.pop(context, ApprovalChoice(amount: _amount.text.trim(), comment: _note.text.trim())),
        child: const Text('Approve', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}

/// Asks how a payment or returned cash was handled. Resolves to the fields
/// the server takes (`mode`, `reference`, `paidOn`, `note`, and `amount` for
/// returned cash), or null if dismissed. With [detailsOptional] (a settlement
/// that pays nothing out) leaving everything empty is allowed.
Future<Map<String, dynamic>?> askPaymentDetails(
  BuildContext context, {
  required String title,
  required String subtitle,
  required String button,
  bool detailsOptional = false,
  bool withAmount = false,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    shape: _sheetShape(),
    builder: (_) => _PaymentSheet(
      title: title,
      subtitle: subtitle,
      button: button,
      detailsOptional: detailsOptional,
      withAmount: withAmount,
    ),
  );
}

class _PaymentSheet extends StatefulWidget {
  const _PaymentSheet({
    required this.title,
    required this.subtitle,
    required this.button,
    required this.detailsOptional,
    required this.withAmount,
  });

  final String title;
  final String subtitle;
  final String button;
  final bool detailsOptional;
  final bool withAmount;

  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _note = TextEditingController();
  String? _mode;
  DateTime _paidOn = DateTime.now();

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _note.dispose();
    super.dispose();
  }

  bool get _anyDetail => _mode != null || _reference.text.trim().isNotEmpty;

  bool get _valid {
    if (widget.withAmount && !isValidMoney(_amount.text)) return false;
    if (widget.detailsOptional && !_anyDetail) return true;
    return _mode != null && _reference.text.trim().isNotEmpty;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidOn,
      firstDate: DateTime(now.year - 1),
      lastDate: now,
    );
    if (picked != null) setState(() => _paidOn = picked);
  }

  Map<String, dynamic> _result() {
    final skip = widget.detailsOptional && !_anyDetail;
    return {
      if (widget.withAmount) 'amount': _amount.text.trim(),
      if (!skip) ...{
        'mode': _mode,
        'reference': _reference.text.trim(),
        'paidOn': DateFormat('yyyy-MM-dd').format(_paidOn),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      },
    };
  }

  @override
  Widget build(BuildContext context) {
    return _frame(context, widget.title, [
      Text(widget.subtitle, style: AppTypography.bodySmall),
      const SizedBox(height: 12),
      if (widget.withAmount) ...[
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
          decoration: const InputDecoration(labelText: 'Amount returned (NPR)'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
      ],
      DropdownButtonFormField<String>(
        initialValue: _mode,
        isExpanded: true,
        decoration: InputDecoration(labelText: widget.detailsOptional ? 'How was it paid? (if money moved)' : 'How was it paid?'),
        items: [
          for (final e in RequestPayment.modeLabels.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
        ],
        onChanged: (v) => setState(() => _mode = v),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _reference,
        maxLength: 100,
        decoration: const InputDecoration(labelText: 'Reference', hintText: 'Transaction or voucher number'),
        onChanged: (_) => setState(() {}),
      ),
      InkWell(
        onTap: _pickDate,
        child: InputDecorator(
          decoration: const InputDecoration(labelText: 'Date'),
          child: Text(DateFormat('d MMM yyyy').format(_paidOn)),
        ),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _note,
        maxLength: 500,
        decoration: const InputDecoration(labelText: 'Note (optional)'),
      ),
      const SizedBox(height: 8),
      ElevatedButton(
        style: _primary(),
        onPressed: _valid ? () => Navigator.pop(context, _result()) : null,
        child: Text(widget.button, style: const TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}
