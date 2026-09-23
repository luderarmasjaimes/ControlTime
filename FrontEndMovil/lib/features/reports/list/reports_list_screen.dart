import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/async_state_views.dart';
import '../../../core/widgets/authenticated_webview.dart';
import 'reports_providers.dart';

/// Lista nativa (ver ADR-0005) — abrir un informe usa por ahora el puente
/// WebView (ADR-0005) para ver/editar; un visor nativo de solo-lectura
/// (equivalente a `ReadOnlyViewer.tsx`) es la mejora natural siguiente una
/// vez validado el esquema JSON real de bloques contra el backend.
class ReportsListScreen extends ConsumerWidget {
  const ReportsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final reportsAsync = ref.watch(reportsListProvider);

    return reportsAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(message: t('error.network'), onRetry: () => ref.invalidate(reportsListProvider)),
      data: (reports) {
        if (reports.isEmpty) return EmptyStateView(message: t('report.empty'), icon: Icons.description_outlined);
        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.md),
          itemCount: reports.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final r = reports[index];
            return Card(
              child: ListTile(
                leading: const Icon(Icons.article_outlined, color: AppColors.primary),
                title: Text(r.title),
                subtitle: r.updatedAt != null ? Text(DateFormat('dd/MM/yyyy HH:mm').format(r.updatedAt!)) : null,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => AuthenticatedWebView(path: '/app?view=report&id=${r.id}', title: r.title),
                )),
              ),
            );
          },
        );
      },
    );
  }
}
