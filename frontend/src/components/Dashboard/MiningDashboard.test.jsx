import React from 'react'
import { render, screen } from '@testing-library/react'

// Mock echarts-for-react to avoid DOM size issues in unit tests
vi.mock('echarts-for-react', () => ({ default: (props) => <div data-testid="echarts-mock" /> }))

import MiningDashboard from './MiningDashboard'

test('Muestra KPI cards en el dashboard', () => {
  render(<MiningDashboard />)
  expect(screen.getByText(/Prod\. Mensual/i)).toBeInTheDocument()
  expect(screen.getByText(/Ley de Cu Prom\./i)).toBeInTheDocument()
  // Use a unique KPI delta token rendered in the first card.
  expect(screen.getByText(/\+4\.2%/i)).toBeInTheDocument()
})
