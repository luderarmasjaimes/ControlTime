import React from 'react'
import { render, screen } from '@testing-library/react'
import RichTextEditor from './RichTextEditor'

test('MenuBar muestra botones principales (Negrita, Cursiva, Guardar)', async () => {
  render(<RichTextEditor />)

  expect(screen.getByTitle(/Negrita/i)).toBeInTheDocument()
  expect(screen.getByTitle(/Cursiva/i)).toBeInTheDocument()
  expect(screen.getByText(/Guardar Cambios/i)).toBeInTheDocument()
})
