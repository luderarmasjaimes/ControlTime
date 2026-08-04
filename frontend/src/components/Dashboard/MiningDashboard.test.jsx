import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock echarts-for-react to avoid DOM size issues in unit tests
vi.mock('echarts-for-react', () => ({ default: (props) => <div data-testid="echarts-mock" /> }))

import MiningDashboard from './MiningDashboard'

// Este test comprobaba las tarjetas KPI cableadas del dashboard antiguo
// ("Prod. Mensual", "Ley de Cu Prom.", "+4.2%"). La migración JSX→TSX del
// dashboard las sustituyó por indicadores derivados de la telemetría real
// ("Sensores en Red", "Riesgos Geomec.") y movió los KPI corporativos a
// KpiOperationsView. Se asertan ahora los rótulos ESTÁTICOS que sí sobreviven
// al render sin datos: los valores en sí dependen de un fetch, así que en un
// smoke test solo comprobarían el mock, no el componente.
test('Muestra la cabecera y las tarjetas KPI del dashboard', () => {
  render(<MiningDashboard />)
  expect(screen.getByText(/Centro de control operacional/i)).toBeInTheDocument()
  expect(screen.getByText(/Sensores en Red/i)).toBeInTheDocument()
  expect(screen.getByText(/Riesgos Geomec\./i)).toBeInTheDocument()
  expect(screen.getByText(/Monitoreo de Seguridad Geotécnica/i)).toBeInTheDocument()
})

test('Sin datos cargados, los contadores muestran el marcador de vacío', () => {
  render(<MiningDashboard />)
  // El componente monta antes de que resuelva el fetch de telemetría: debe
  // renderizar el guion largo en vez de un 0 engañoso o un NaN.
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})
