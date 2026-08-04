import { test, expect } from '@playwright/test';
import { dismissUserMaintenancePrompt, openCategory, openMisInformes, realLogin } from './helpers';

// Cuenta real pre-existente con rol admin (requerido por `canMaintain` en
// App.tsx -- solo admin/supervisor ven Mantenimiento de Usuarios):
// JUANP / Alpayana / 123456. El objetivo a bloquear es otro usuario real de
// la misma empresa (e2e_attacker, operator) en vez del mock 'op_raura', que
// no existe en el backend real.
const REAL_CREDS = { company: 'Alpayana', username: 'JUANP', password: '123456' };
const TARGET_USERNAME = 'e2e_attacker';

test('Mantenimiento usuarios bloquea usuario y registra auditoria', async ({ page }) => {
  await realLogin(page, REAL_CREDS);

  await page.goto('/');
  await dismissUserMaintenancePrompt(page);
  await page.setViewportSize({ width: 1440, height: 920 });

  await openCategory(page, 'Informes');
  await page.getByRole('button', { name: 'Abrir Informes', exact: true }).click();
  await openMisInformes(page);

  // El boton real dentro del panel "Mis Informes" se llama "Gestion de
  // Usuarios" (verificado en vivo), no "Mantenimiento Usuarios" como asumia
  // el test viejo (nunca llegaba a este paso con el token falso).
  await page.getByRole('button', { name: /Gesti.n de Usuarios/i }).click();
  await expect(page.getByText('Mantenimiento de Usuarios')).toBeVisible();

  // getByText simple matchea tambien la fila de auditoria mas abajo (misma
  // empresa, corridas previas ya generaron entradas para este mismo target)
  // -- se acota a la celda de la tabla de usuarios.
  await page.locator('.rum-table').getByText(TARGET_USERNAME, { exact: true }).click();
  await page.locator('.rum-form select').first().selectOption('block');
  await page.getByPlaceholder('Motivo obligatorio...').fill('Bloqueo por validacion operativa');
  await page.getByPlaceholder('Ingrese password del operador').fill('123456');

  await page.getByRole('button', { name: 'Aplicar Cambios' }).click();

  // El backend real responde con un mensaje generico de confirmacion (no el
  // texto local "Usuario bloqueado." que usaba el fallback offline) --
  // verificado en vivo: "Mantenimiento aplicado correctamente en servidor.".
  await expect(page.locator('.rum-status-ok')).toContainText('Mantenimiento aplicado correctamente en servidor');
  await expect(page.locator('.rum-state.rum-blocked').first()).toBeVisible();
  // Con backend real y multiples corridas repetidas contra el mismo target,
  // la auditoria acumula varias entradas "Exito - block" historicas -- basta
  // con que exista al menos una (la mas reciente que se acaba de generar).
  await expect(page.getByText(/Exito - block/i).first()).toBeVisible();
});
