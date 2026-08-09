import React from 'react'
import { render } from '@testing-library/react'
import MapViewer from './MapViewer'

test('Renderiza MapViewer sin error', () => {
  render(<MapViewer />)
  // if no exception, component renders
})
