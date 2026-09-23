/// Diccionario canónico (español) — fallback de último recurso para
/// cualquier clave ausente en otro idioma (ver translations.dart y
/// docs/decisions/0006). Mismo criterio de namespaces que
/// `frontend/src/i18n/I18nProvider.tsx` del repo principal (nav.*, auth.*,
/// etc.), recortado a lo que esta app móvil realmente usa.
const Map<String, String> esDictionary = {
  // common
  'common.loading': 'Cargando…',
  'common.retry': 'Reintentar',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.delete': 'Eliminar',
  'common.edit': 'Editar',
  'common.close': 'Cerrar',
  'common.confirm': 'Confirmar',
  'common.search': 'Buscar',
  'common.filter': 'Filtrar',
  'common.all': 'Todos',
  'common.noData': 'Sin datos disponibles',
  'common.seeMore': 'Ver más',
  'common.refresh': 'Actualizar',
  'common.offline': 'Sin conexión',
  'common.openInBrowser': 'Abrir edición avanzada',

  // error
  'error.generic': 'Ocurrió un error. Intenta de nuevo.',
  'error.network': 'No se pudo conectar al servidor.',
  'error.sessionExpired': 'Tu sesión expiró. Vuelve a iniciar sesión.',
  'error.unauthorized': 'No tienes permiso para ver esto.',

  // auth
  'auth.login': 'Iniciar sesión',
  'auth.logout': 'Cerrar sesión',
  'auth.company': 'Empresa',
  'auth.identity': 'Usuario / DNI / RUC',
  'auth.password': 'Contraseña',
  'auth.loginWithPassword': 'Ingresar con contraseña',
  'auth.loginWithFace': 'Ingresar con rostro',
  'auth.register': 'Crear cuenta',
  'auth.restoringSession': 'Restaurando sesión…',
  'auth.mfaCode': 'Código de verificación',
  'auth.startCamera': 'Iniciar cámara',
  'auth.positionFace': 'Coloca tu rostro dentro del óvalo',
  'auth.captureQuality': 'Verificando calidad de captura…',

  // liveness
  'liveness.challenge.turnLeft': 'Gira la cabeza a la izquierda',
  'liveness.challenge.turnRight': 'Gira la cabeza a la derecha',
  'liveness.challenge.lookDown': 'Mira hacia abajo',
  'liveness.challenge.lookUp': 'Mira hacia arriba',
  'liveness.challenge.moveCloser': 'Acércate un poco más',
  'liveness.challenge.moveAway': 'Aléjate un poco',
  'liveness.waiting': 'Esperando desafío del servidor…',
  'liveness.completed': 'Verificación completada',

  // role
  'role.admin': 'Administrador',
  'role.manager': 'Gerente',
  'role.supervisor': 'Supervisor',
  'role.geologist': 'Geólogo',
  'role.safety': 'Seguridad',
  'role.operator': 'Operador',
  'role.viewer': 'Solo lectura',

  // nav — categorías (ADR-0004/ADR-042)
  'nav.control': 'Control',
  'nav.ground': 'Terreno',
  'nav.maps': 'Mapas',
  'nav.reports': 'Informes',
  'nav.manage': 'Gestión',
  'nav.access': 'Permisos',

  // nav — módulos
  'nav.dashboard': 'Panel principal',
  'nav.kpis': 'KPIs de Operación',
  'nav.alarms': 'Alarmas',
  'nav.sensors': 'Sensores Técnicos',
  'nav.telemetry': 'Telemetría',
  'nav.simulation': 'Monitor de Simulación',
  'nav.surveillance': 'Videovigilancia',
  'nav.inclinometer': 'Inclinómetro',
  'nav.viewer3d': 'Visor 3D',
  'nav.displacement': 'Desplazamiento Acumulado',
  'nav.mapGeneral': 'Mapa General',
  'nav.geoportal': 'Geoportal Minero',
  'nav.complianceGeo': 'Cumplimiento Geoespacial',
  'nav.detailedMap': 'Mapa Detallado',
  'nav.reportsList': 'Informes',
  'nav.formulaOverview': 'Resumen de Fórmulas',
  'nav.formulaCanvas': 'Fórmulas',
  'nav.users': 'Usuarios',
  'nav.companies': 'Empresas',
  'nav.alarmConfig': 'Configuración de Alarmas',
  'nav.devices': 'Dispositivos',
  'nav.whatsapp': 'WhatsApp',
  'nav.support': 'Soporte',
  'nav.candidates': 'Candidatos RRHH',
  'nav.permissions': 'Matriz de Permisos',

  // alarm
  'alarm.acknowledge': 'Reconocer',
  'alarm.acknowledged': 'Reconocida',
  'alarm.severity.info': 'Info',
  'alarm.severity.warning': 'Advertencia',
  'alarm.severity.critical': 'Crítica',
  'alarm.createReport': 'Crear informe desde esta alarma',
  'alarm.empty': 'No hay alarmas activas',

  // dashboard/kpi
  'kpi.target': 'Meta',
  'kpi.trend.up': 'Subiendo',
  'kpi.trend.down': 'Bajando',
  'kpi.trend.flat': 'Estable',

  // devices
  'device.online': 'En línea',
  'device.offline': 'Sin conexión',
  'device.unknown': 'Desconocido',
  'device.register': 'Registrar dispositivo',
  'device.rotateKey': 'Rotar clave',
  'device.revoke': 'Revocar',

  // reports
  'report.view': 'Ver',
  'report.share': 'Compartir',
  'report.export': 'Exportar PDF',
  'report.presenterMode': 'Modo presentador',
  'report.editAdvanced': 'Editar (edición avanzada)',
  'report.empty': 'Aún no hay informes',

  // formula
  'formula.status.ok': 'Correcto',
  'formula.status.error': 'Error de cálculo',
  'formula.openCanvas': 'Abrir editor de fórmulas',

  // maps
  'map.layers': 'Capas',
  'map.myLocation': 'Mi ubicación',
};
