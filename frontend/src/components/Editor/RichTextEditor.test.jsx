import React from 'react'
import { render, screen } from '@testing-library/react'
import RichTextEditor from './RichTextEditor'

test('muestra el encabezado del informe en el editor', async () => {
  render(<RichTextEditor />)

  const header = await screen.findByText(/Informe Geomecánico/i)
  expect(header).toBeInTheDocument()
})
