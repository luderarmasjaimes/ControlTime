import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock echarts-for-react to avoid DOM size issues in unit tests
vi.mock('echarts-for-react', () => ({ default: (props) => <div data-testid="echarts-mock" /> }))

import MiningDashboard from './MiningDashboard'

test('Muestra KPI cards en el dashboard', () => {
  render(<MiningDashboard />)
  expect(screen.getByText(/Producción \(kt\)/i)).toBeInTheDocument()
  expect(screen.getByText(/Tasa de recuperación/i)).toBeInTheDocument()
  // check presence of KPI value instead of generic 'Rendimiento' to avoid duplicate matches
  expect(screen.getByText(/\+15%/i)).toBeInTheDocument()
})
