import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/i18n/i18n_provider.dart';
import '../../../core/theme/tokens.dart';
import '../../../core/widgets/async_state_views.dart';
import 'users_providers.dart';

class UsersScreen extends ConsumerWidget {
  const UsersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(translationsProvider);
    final usersAsync = ref.watch(usersListProvider);

    return usersAsync.when(
      loading: () => LoadingView(label: t('common.loading')),
      error: (err, _) => ErrorRetryView(message: t('error.network'), onRetry: () => ref.invalidate(usersListProvider)),
      data: (users) {
        if (users.isEmpty) return EmptyStateView(message: t('common.noData'));
        return ListView.separated(
          padding: const EdgeInsets.all(AppSpacing.md),
          itemCount: users.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
          itemBuilder: (context, index) {
            final u = users[index];
            return Card(
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: u.blocked ? AppColors.semanticDestructive.withValues(alpha: 0.2) : AppColors.semanticAdmin.withValues(alpha: 0.2),
                  child: Icon(u.blocked ? Icons.block : Icons.person_outline, color: u.blocked ? AppColors.semanticDestructive : AppColors.semanticAdmin, size: 20),
                ),
                title: Text(u.fullName),
                subtitle: Text('@${u.username} · ${t('role.${u.role}')}'),
              ),
            );
          },
        );
      },
    );
  }
}
