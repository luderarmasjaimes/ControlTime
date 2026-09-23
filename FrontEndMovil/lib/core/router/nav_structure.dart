import 'package:flutter/material.dart';

import '../../features/admin/devices/devices_screen.dart';
import '../../features/admin/users/users_screen.dart';
import '../../features/alarms/alarms_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/formula/canvas/formula_canvas_screen.dart';
import '../../features/formula/overview/formula_overview_screen.dart';
import '../../features/kpis_operacion/kpis_operacion_screen.dart';
import '../../features/maps/map_general/map_screen.dart';
import '../../features/reports/list/reports_list_screen.dart';
import '../widgets/placeholder_screen.dart';

/// Estructura de navegación (ADR-0004): categorías de ADR-042 del repo
/// principal, cada una con sus módulos. `id` es el segmento de ruta
/// (estable, nunca traducido); `labelKey` es la clave i18n visible.
class NavModule {
  const NavModule({required this.id, required this.labelKey, required this.icon, required this.builder});
  final String id;
  final String labelKey;
  final IconData icon;
  final WidgetBuilder builder;
}

class NavCategory {
  const NavCategory({required this.id, required this.labelKey, required this.icon, required this.modules});
  final String id;
  final String labelKey;
  final IconData icon;
  final List<NavModule> modules;
}

final appNavigation = <NavCategory>[
  NavCategory(
    id: 'control',
    labelKey: 'nav.control',
    icon: Icons.dashboard_outlined,
    modules: [
      NavModule(id: 'dashboard', labelKey: 'nav.dashboard', icon: Icons.space_dashboard_outlined, builder: (_) => const DashboardScreen()),
      NavModule(id: 'kpis', labelKey: 'nav.kpis', icon: Icons.insights_outlined, builder: (_) => const KpisOperacionScreen()),
      NavModule(id: 'alarms', labelKey: 'nav.alarms', icon: Icons.notification_important_outlined, builder: (_) => const AlarmsScreen()),
      NavModule(id: 'sensors', labelKey: 'nav.sensors', icon: Icons.sensors_outlined, builder: (_) => const PlaceholderScreen(title: 'Sensores Técnicos')),
      NavModule(id: 'telemetry', labelKey: 'nav.telemetry', icon: Icons.podcasts_outlined, builder: (_) => const PlaceholderScreen(title: 'Telemetría')),
      NavModule(id: 'simulation', labelKey: 'nav.simulation', icon: Icons.timeline_outlined, builder: (_) => const PlaceholderScreen(title: 'Monitor de Simulación')),
      NavModule(id: 'surveillance', labelKey: 'nav.surveillance', icon: Icons.videocam_outlined, builder: (_) => const PlaceholderScreen(title: 'Videovigilancia')),
    ],
  ),
  NavCategory(
    id: 'ground',
    labelKey: 'nav.ground',
    icon: Icons.terrain_outlined,
    modules: [
      NavModule(id: 'inclinometer', labelKey: 'nav.inclinometer', icon: Icons.architecture_outlined, builder: (_) => const PlaceholderScreen(title: 'Inclinómetro')),
      NavModule(id: 'viewer3d', labelKey: 'nav.viewer3d', icon: Icons.view_in_ar_outlined, builder: (_) => const PlaceholderScreen(title: 'Visor 3D')),
      NavModule(id: 'displacement', labelKey: 'nav.displacement', icon: Icons.show_chart_outlined, builder: (_) => const PlaceholderScreen(title: 'Desplazamiento Acumulado')),
    ],
  ),
  NavCategory(
    id: 'maps',
    labelKey: 'nav.maps',
    icon: Icons.map_outlined,
    modules: [
      NavModule(id: 'general', labelKey: 'nav.mapGeneral', icon: Icons.map_outlined, builder: (_) => const MapScreen()),
      NavModule(id: 'geoportal', labelKey: 'nav.geoportal', icon: Icons.public_outlined, builder: (_) => const PlaceholderScreen(title: 'Geoportal Minero')),
      NavModule(id: 'compliance', labelKey: 'nav.complianceGeo', icon: Icons.fact_check_outlined, builder: (_) => const PlaceholderScreen(title: 'Cumplimiento Geoespacial')),
      NavModule(id: 'detailed', labelKey: 'nav.detailedMap', icon: Icons.layers_outlined, builder: (_) => const PlaceholderScreen(title: 'Mapa Detallado')),
    ],
  ),
  NavCategory(
    id: 'reports',
    labelKey: 'nav.reports',
    icon: Icons.description_outlined,
    modules: [
      NavModule(id: 'list', labelKey: 'nav.reportsList', icon: Icons.article_outlined, builder: (_) => const ReportsListScreen()),
      NavModule(id: 'formula_overview', labelKey: 'nav.formulaOverview', icon: Icons.functions_outlined, builder: (_) => const FormulaOverviewScreen()),
      NavModule(id: 'formula_canvas', labelKey: 'nav.formulaCanvas', icon: Icons.account_tree_outlined, builder: (_) => const FormulaCanvasScreen()),
    ],
  ),
  NavCategory(
    id: 'manage',
    labelKey: 'nav.manage',
    icon: Icons.admin_panel_settings_outlined,
    modules: [
      NavModule(id: 'users', labelKey: 'nav.users', icon: Icons.people_outline, builder: (_) => const UsersScreen()),
      NavModule(id: 'companies', labelKey: 'nav.companies', icon: Icons.apartment_outlined, builder: (_) => const PlaceholderScreen(title: 'Empresas')),
      NavModule(id: 'alarm_config', labelKey: 'nav.alarmConfig', icon: Icons.tune_outlined, builder: (_) => const PlaceholderScreen(title: 'Configuración de Alarmas')),
      NavModule(id: 'devices', labelKey: 'nav.devices', icon: Icons.developer_board_outlined, builder: (_) => const DevicesScreen()),
      NavModule(id: 'whatsapp', labelKey: 'nav.whatsapp', icon: Icons.chat_outlined, builder: (_) => const PlaceholderScreen(title: 'WhatsApp')),
      NavModule(id: 'support', labelKey: 'nav.support', icon: Icons.support_agent_outlined, builder: (_) => const PlaceholderScreen(title: 'Soporte')),
      NavModule(id: 'candidates', labelKey: 'nav.candidates', icon: Icons.badge_outlined, builder: (_) => const PlaceholderScreen(title: 'Candidatos RRHH')),
    ],
  ),
  NavCategory(
    id: 'access',
    labelKey: 'nav.access',
    icon: Icons.security_outlined,
    modules: [
      NavModule(id: 'permissions', labelKey: 'nav.permissions', icon: Icons.rule_outlined, builder: (_) => const PlaceholderScreen(title: 'Matriz de Permisos')),
    ],
  ),
];
