import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/async_state_views.dart';
import 'formula_overview_providers.dart';

class FormulaOverviewScreen extends ConsumerWidget {
  const FormulaOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final formulasAsync = ref.watch(formulaOverviewProvider);

    return formulasAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(message: t('error.network'), onRetry: () => ref.invalidate(formulaOverviewProvider)),
      data: (formulas) {
        if (formulas.isEmpty) return EmptyStateView(message: t('common.noData'));
        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.md),
          itemCount: formulas.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final f = formulas[index];
            final isError = f.status == 'error';
            return Card(
              child: ListTile(
                title: Text(f.sensorName),
                subtitle: Text(f.expression, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      f.lastValue?.toStringAsFixed(2) ?? '—',
                      style: TextStyle(fontWeight: FontWeight.w700, color: isError ? AppColors.semanticDestructive : AppColors.primary),
                    ),
                    Text(f.outputChannel, style: const TextStyle(color: AppColors.textDim, fontSize: 11)),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}
