import React from 'react'
import { render } from '@testing-library/react'

// Mock maplibre-gl default export to avoid DOM mapping in unit tests
vi.mock('maplibre-gl', () => {
  class MockMap {
    constructor() { this._el = document.createElement('div') }
    addControl() {}
    remove() {}
  }
  return { default: { Map: MockMap, NavigationControl: class {} } }
})

import MapViewer from './MapViewer'

test('Renderiza MapViewer sin error', () => {
  render(<MapViewer />)
  // if no exception, component renders
})
