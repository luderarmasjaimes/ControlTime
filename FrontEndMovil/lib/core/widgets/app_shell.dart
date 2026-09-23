import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_repository.dart';
import '../auth/auth_session.dart';
import '../i18n/i18n_provider.dart';
import '../router/nav_structure.dart';
import '../theme/tokens.dart';

final selectedCategoryIndexProvider = StateProvider<int>((ref) => 0);
final selectedModuleIndexProvider = StateProvider<int>((ref) => 0);

/// Shell de navegación autenticado (ADR-0004): Drawer con las 6 categorías
/// + TabBar con scroll horizontal para los módulos de la categoría activa —
/// misma jerarquía categoría→módulo del frontend web (ADR-040/042 del repo
/// principal), adaptada a gestos táctiles en vez de carriles con hover.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> with SingleTickerProviderStateMixin {
  TabController? _tabController;
  int _tabControllerModuleCount = -1;

  @override
  void dispose() {
    _tabController?.dispose();
    super.dispose();
  }

  void _ensureTabController(int moduleCount, int initialIndex) {
    if (_tabController != null && _tabControllerModuleCount == moduleCount) return;
    _tabController?.dispose();
    _tabControllerModuleCount = moduleCount;
    _tabController = TabController(length: moduleCount, vsync: this, initialIndex: initialIndex.clamp(0, moduleCount - 1));
    _tabController!.addListener(() {
      if (!_tabController!.indexIsChanging) {
        ref.read(selectedModuleIndexProvider.notifier).state = _tabController!.index;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(translationsProvider);
    final categoryIndex = ref.watch(selectedCategoryIndexProvider).clamp(0, appNavigation.length - 1);
    final category = appNavigation[categoryIndex];
    final moduleIndex = ref.watch(selectedModuleIndexProvider).clamp(0, category.modules.length - 1);

    _ensureTabController(category.modules.length, moduleIndex);
    if (_tabController!.index != moduleIndex) {
      _tabController!.index = moduleIndex;
    }

    final session = ref.watch(authSessionControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(t(category.labelKey)),
        bottom: category.modules.length > 1
            ? TabBar(
                controller: _tabController,
                isScrollable: true,
                tabs: [for (final module in category.modules) Tab(text: t(module.labelKey), icon: Icon(module.icon, size: 18))],
              )
            : null,
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('BEEMETRY', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.w800, letterSpacing: 1.2)),
                    const SizedBox(height: 4),
                    Text(session.user?.fullName ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(session.user?.company ?? '', style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  itemCount: appNavigation.length,
                  itemBuilder: (context, index) {
                    final cat = appNavigation[index];
                    final selected = index == categoryIndex;
                    return ListTile(
                      leading: Icon(cat.icon, color: selected ? AppColors.primary : AppColors.textDim),
                      title: Text(t(cat.labelKey), style: TextStyle(color: selected ? AppColors.primary : AppColors.textMain)),
                      selected: selected,
                      onTap: () {
                        ref.read(selectedCategoryIndexProvider.notifier).state = index;
                        ref.read(selectedModuleIndexProvider.notifier).state = 0;
                        Navigator.of(context).pop();
                      },
                    );
                  },
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.logout, color: AppColors.semanticDestructive),
                title: Text(t('auth.logout'), style: const TextStyle(color: AppColors.semanticDestructive)),
                onTap: () async {
                  Navigator.of(context).pop();
                  await ref.read(authRepositoryProvider).logout();
                  await ref.read(authSessionControllerProvider.notifier).clear();
                },
              ),
            ],
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [for (final module in category.modules) Builder(builder: module.builder)],
      ),
    );
  }
}
