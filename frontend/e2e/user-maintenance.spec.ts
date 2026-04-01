import { test, expect } from '@playwright/test';

test('Mantenimiento usuarios bloquea usuario y registra auditoria', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'mining_auth_session_v1',
      JSON.stringify({
        username: 'admin_mina',
        fullName: 'Admin Mina',
        company: 'Minera Raura',
        role: 'admin',
        token: 'tok_admin_mina',
      }),
    );

    localStorage.setItem(
      'mining_auth_users_v1',
      JSON.stringify([
        {
          id: 'u_admin',
          username: 'admin_mina',
          password: 'Secreto123',
          first_name: 'Admin',
          last_name: 'Mina',
          company: 'Minera Raura',
          role: 'admin',
          is_active: true,
        },
        {
          id: 'u_op1',
          username: 'op_raura',
          first_name: 'Operador',
          last_name: 'Uno',
          company: 'Minera Raura',
          role: 'operator',
          is_active: true,
        },
      ]),
    );
  });

  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 920 });

  await page.getByRole('button', { name: 'Abrir Report v2', exact: true }).click();
  await page.getByRole('button', { name: 'Mis Informes', exact: true }).click();

  await page.getByRole('button', { name: /Mantenimiento Usuarios/i }).click();
  await expect(page.getByText('Mantenimiento de Usuarios')).toBeVisible();

  await page.getByText('op_raura').click();
  await page.locator('.rum-form select').first().selectOption('block');
  await page.getByPlaceholder('Motivo obligatorio...').fill('Bloqueo por validacion operativa');
  await page.getByPlaceholder('Ingrese password del operador').fill('Secreto123');

  await page.getByRole('button', { name: 'Aplicar Cambios' }).click();

  await expect(page.locator('.rum-status-ok')).toContainText('Usuario bloqueado');
  await expect(page.locator('.rum-state.rum-blocked').first()).toBeVisible();
  await expect(page.getByText(/Exito - block/i)).toBeVisible();
});
