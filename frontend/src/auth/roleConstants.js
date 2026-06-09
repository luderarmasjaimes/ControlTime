/**
 * Estandarización de Perfiles / Niveles de Usuario para ReportStudioV2
 * Fuente de verdad única para AuthGateway, UserManagement y Permissions.
 */

export const USER_ROLES = [
  { value: 'admin', label: 'Admin TI', color: 'text-rose-400' },
  { value: 'manager', label: 'Gerente Ops', color: 'text-amber-400' },
  { value: 'supervisor', label: 'Supervisor / Jefe', color: 'text-indigo-400' },
  { value: 'geologist', label: 'Ing. Geomecánico', color: 'text-sky-400' },
  { value: 'safety', label: 'Prevencionista', color: 'text-emerald-400' },
  { value: 'operator', label: 'Operador / Téc', color: 'text-slate-400' },
];

export const getRoleLabel = (roleValue) => {
  const role = USER_ROLES.find(r => r.value === roleValue);
  return role ? role.label : (roleValue || 'Usuario');
};

export const getRoleColor = (roleValue) => {
  const role = USER_ROLES.find(r => r.value === roleValue);
  return role ? role.color : 'text-slate-500';
};
