import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'package:mobile/features/finance/presentation/request_detail_screen.dart';
import 'package:mobile/features/finance/presentation/request_form_screen.dart';

class _Finance implements HttpClientAdapter {
  final List<RequestOptions> calls = [];
  List<Map<String, dynamic>> list = [];
  Map<String, Map<String, dynamic>> byId = {};

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    ResponseBody json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    final path = options.path;
    if (path == '/api/v1/finance/requests' && options.method == 'GET') {
      return json(200, {'items': list, 'total': list.length, 'page': 1, 'limit': 100});
    }
    if (path == '/api/v1/finance/requests' && options.method == 'POST') {
      return json(201, {'id': 'new-1', 'number': 'ADV-2026-0009', 'kind': 'ADVANCE', 'status': 'DRAFT'});
    }
    if (path == '/api/v1/finance/categories') {
      return json(200, [
        {'id': 'c-1', 'code': 'TRAVEL', 'name': 'Travel', 'disabledAt': null},
        {'id': 'c-2', 'code': 'OLD', 'name': 'Retired', 'disabledAt': '2026-01-01T00:00:00Z'},
      ]);
    }
    if (path == '/api/v1/projects') {
      return json(200, [
        {'id': 'p-1', 'code': 'KOS', 'name': 'Koshi rollout', 'status': 'ACTIVE'},
      ]);
    }
    if (path.endsWith('/submit') || path.endsWith('/cancel')) return json(200, {});
    final id = path.split('/').last;
    if (byId.containsKey(id)) return json(200, byId[id]!);
    return json(404, {});
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> request(String id, String status, {String kind = 'ADVANCE', Map<String, dynamic>? extra}) => {
      'id': id,
      'number': 'ADV-2026-000${id.length}',
      'kind': kind,
      'status': status,
      'revision': 1,
      'projectId': 'p-1',
      'projectCode': 'KOS',
      'projectName': 'Koshi rollout',
      'categoryId': 'c-1',
      'category': {'code': 'TRAVEL', 'name': 'Travel'},
      'requesterId': 'u-1',
      'purpose': 'Site visit to Ilam',
      'requestedAmount': '50000.00',
      'approvedAmount': null,
      'appliedAmount': null,
      'createdAt': '2026-10-01T04:00:00.000Z',
      'invoices': [],
      'actions': [],
      'payments': [],
      ...?extra,
    };

const _engineer = AuthUser(
  id: 'u-1',
  email: 'eng@ipms.local',
  displayName: 'Field Engineer',
  permissions: ['finance_request.view', 'finance_request.create', 'finance_settlement.submit'],
);

class _Auth extends AuthNotifier {
  _Auth(this.user);
  final AuthUser? user;

  @override
  Future<AuthUser?> build() async => user;
}

void main() {
  late _Finance server;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    server = _Finance();
  });

  Widget app(Widget home, {AuthUser? user = _engineer}) {
    final api = ApiClient(
      tokenStorage: TokenStorage(),
      dio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server,
    );
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        authStateProvider.overrideWith(() => _Auth(user)),
      ],
      child: MaterialApp(home: home),
    );
  }

  Future<void> settle(WidgetTester tester) async {
    // Dio's replies need real async under the widget tester.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  group('money', () {
    test('is formatted with Indian grouping and two decimals', () {
      expect(formatMoney('150000'), 'NPR 1,50,000.00');
      expect(formatMoney('1500.5'), 'NPR 1,500.50');
      expect(formatMoney(null), '—');
    });

    test('is summed in whole paisa, not floating point', () {
      expect(sumMoney(['0.10', '0.20']), '0.30');
      expect(sumMoney(['1500.50', '499.5', '1']), '2001.00');
      expect(sumMoney([]), '0.00');
    });

    test('is accepted only as the server accepts it', () {
      for (final ok in ['1', '50000', '1500.5', '0.01']) {
        expect(isValidMoney(ok), isTrue, reason: ok);
      }
      for (final bad in ['', '0', '0.00', '-5', '12.345', '1,000', 'abc', '01']) {
        expect(isValidMoney(bad), isFalse, reason: bad);
      }
    });
  });

  group('a request', () {
    test('reads the reviewer comment of the last return', () {
      final r = FinanceRequest.fromJson(request('abc', 'RETURNED', extra: {
        'actions': [
          {'step': 'REQUESTER', 'action': 'SUBMITTED', 'at': '2026-10-01T05:00:00Z', 'revision': 1},
          {'step': 'PM', 'action': 'RETURNED', 'comment': 'Attach the quotation', 'at': '2026-10-02T05:00:00Z', 'revision': 1},
        ],
      }));
      expect(r.lastReviewComment, 'Returned by the project manager: Attach the quotation');
      expect(r.history.first.description, 'Submitted');
    });

    test('says what the requester may do', () {
      FinanceRequest r(String status, {Map<String, dynamic>? extra}) => FinanceRequest.fromJson(request('abc', status, extra: extra));
      expect(r('DRAFT').isEditable('u-1'), isTrue);
      expect(r('RETURNED').isEditable('u-1'), isTrue);
      expect(r('PENDING_PM').isEditable('u-1'), isFalse);
      expect(r('PENDING_PM').canCancel('u-1'), isTrue);
      expect(r('PENDING_PM').canCancel('u-2'), isFalse);
      expect(r('PAID').canSettle, isTrue);
      expect(r('PAID', extra: {'balance': {'status': 'CLOSED', 'outstanding': '0.00'}}).canSettle, isFalse);
      expect(r('DRAFT').canSettle, isFalse);
    });
  });

  testWidgets('the list shows my requests, filters them, and opens one', (tester) async {
    server.list = [request('aa', 'PENDING_PM'), request('bbb', 'PAID'), request('cccc', 'DRAFT')];
    server.byId = {'aa': request('aa', 'PENDING_PM')};
    await tester.pumpWidget(app(const FinanceScreen()));
    await settle(tester);

    expect(find.text('Site visit to Ilam'), findsNWidgets(3));
    expect(find.text('Waiting for the project manager'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Paid'));
    await tester.pump();
    expect(find.text('Site visit to Ilam'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Returned'));
    await tester.pump();
    expect(find.text('Nothing here'), findsOneWidget);
  });

  testWidgets('without the create permission there is no New button', (tester) async {
    const viewer = AuthUser(id: 'u-1', email: 'v@ipms.local', permissions: ['finance_request.view']);
    await tester.pumpWidget(app(const FinanceScreen(), user: viewer));
    await settle(tester);
    expect(find.text('New'), findsNothing);
  });

  testWidgets('a pending request can be cancelled, a returned one edited and resubmitted', (tester) async {
    server.byId = {'pend': request('pend', 'PENDING_PM'), 'ret': request('ret', 'RETURNED', extra: {
      'actions': [
        {'step': 'PM', 'action': 'RETURNED', 'comment': 'Attach the quotation', 'at': '2026-10-02T05:00:00Z', 'revision': 1},
      ],
    })};

    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'pend')));
    await settle(tester);
    expect(find.text('Cancel request'), findsOneWidget);
    expect(find.text('Submit'), findsNothing);

    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'ret')));
    await settle(tester);
    expect(find.text('Resubmit'), findsOneWidget);
    expect(find.text('Edit'), findsOneWidget);
    expect(find.textContaining('Attach the quotation'), findsWidgets);
  });

  testWidgets('a paid advance offers settlement, with its balance', (tester) async {
    server.byId = {
      'paid': request('paid', 'PAID', extra: {
        'approvedAmount': '50000.00',
        'balance': {'paid': '50000.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '50000.00', 'status': 'PAID'},
      }),
    };
    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'paid')));
    await settle(tester);
    expect(find.text('Settle with invoices'), findsOneWidget);
    expect(find.text('Outstanding'), findsOneWidget);
    expect(find.text('NPR 50,000.00'), findsWidgets);
  });

  testWidgets('an advance is saved and submitted with the server\'s fields', (tester) async {
    await tester.pumpWidget(app(const RequestFormScreen(kind: RequestKind.advance)));
    await settle(tester);

    await tester.tap(find.text('Project'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KOS — Koshi rollout').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Category'));
    await tester.pumpAndSettle();
    expect(find.text('Retired'), findsNothing); // disabled categories are not offered
    await tester.tap(find.text('Travel').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'What is it for?'), 'Fuel for the survey');
    await tester.enterText(find.widgetWithText(TextField, 'Amount (NPR)'), '25000.50');
    await tester.pump();

    await tester.runAsync(() async {
      await tester.tap(find.text('Submit'));
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pump();

    final create = server.calls.firstWhere((c) => c.method == 'POST' && c.path == '/api/v1/finance/requests');
    expect(create.data, {
      'kind': 'ADVANCE',
      'projectId': 'p-1',
      'amount': '25000.50',
      'categoryId': 'c-1',
      'purpose': 'Fuel for the survey',
    });
    expect(server.calls.any((c) => c.path == '/api/v1/finance/requests/new-1/submit'), isTrue);
  });

  testWidgets('the form stays disabled until it is complete', (tester) async {
    await tester.pumpWidget(app(const RequestFormScreen(kind: RequestKind.reimbursement)));
    await settle(tester);
    expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Submit')).onPressed, isNull);
    expect(find.text('Invoice 1'), findsOneWidget);
    expect(find.text('Total NPR 0.00'), findsOneWidget);
  });
}
