import { describe, expect, it } from 'vitest';
import { resolveReportShareLinkUrl } from './api';

describe('ADR-138 URL del QR', () => {
  it('resuelve la ruta del backend contra el host visible en el navegador', () => {
    expect(resolveReportShareLinkUrl(
      '/api/reports/share/abc123/pdf',
      'https://informes.minera.example:8443',
    )).toBe('https://informes.minera.example:8443/api/reports/share/abc123/pdf');
  });

  it('no reemplaza una URL absoluta devuelta por un backend compatible', () => {
    expect(resolveReportShareLinkUrl(
      'https://cdn.example/report.pdf',
      'https://informes.minera.example',
    )).toBe('https://cdn.example/report.pdf');
  });
});
