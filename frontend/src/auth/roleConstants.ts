/**
 * Estandarización de Perfiles / Niveles de Usuario para ReportStudioV2
 * Fuente de verdad única para AuthGateway, UserManagement y Permissions.
 */

export interface UserRole {
  value: string;
  label: string;
  color: string;
}

// Los 6 roles autoasignables: los que un usuario puede elegir al
// autoregistrarse (AuthGateway). "viewer" (acceso de solo lectura, p.ej.
// auditores externos) queda fuera de esta lista a propósito -- nadie se
// autoasigna ese rol -- pero SÍ es uno de los 7 roles válidos del backend
// (kValidPlatformRoles, auth_routes.cpp) y debe poder asignarlo un admin.
// Ver ADMIN_ASSIGNABLE_ROLES más abajo para las pantallas donde un admin
// asigna/cambia el rol de OTRO usuario (ahí sí deben verse los 7).
export const USER_ROLES: UserRole[] = [
  { value: 'admin', label: 'Admin TI', color: 'text-rose-400' },
  { value: 'manager', label: 'Gerente Ops', color: 'text-amber-400' },
  { value: 'supervisor', label: 'Supervisor / Jefe', color: 'text-indigo-400' },
  { value: 'geologist', label: 'Ing. Geomecánico', color: 'text-sky-400' },
  { value: 'safety', label: 'Prevencionista', color: 'text-emerald-400' },
  { value: 'operator', label: 'Operador / Téc', color: 'text-slate-400' },
];

// Los 7 roles reales de la plataforma (coincide con kValidPlatformRoles del
// backend) -- fuente de verdad única para toda pantalla donde un ADMIN
// asigna o cambia el rol de otro usuario (alta administrada, cambio de
// perfil, matriz de permisos). No usar en el selector de autoregistro.
export const ADMIN_ASSIGNABLE_ROLES: UserRole[] = [
  ...USER_ROLES,
  { value: 'viewer', label: 'Consulta', color: 'text-slate-400' },
];

// Buscan en ADMIN_ASSIGNABLE_ROLES (los 7), no solo en USER_ROLES (6) --
// un usuario real puede tener rol 'viewer' aunque ese rol no aparezca en el
// selector de autoregistro; mostrar su label/color correcto igual.
export const getRoleLabel = (roleValue: string | undefined): string => {
  const role = ADMIN_ASSIGNABLE_ROLES.find(r => r.value === roleValue);
  return role ? role.label : (roleValue || 'Usuario');
};

export const getRoleColor = (roleValue: string | undefined): string => {
  const role = ADMIN_ASSIGNABLE_ROLES.find(r => r.value === roleValue);
  return role ? role.color : 'text-slate-500';
};
