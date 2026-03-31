import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import PageCanvas from './PageCanvas';

export default function MultipageView({ zoomPercent = 100 }) {
  const pages = useEditorStore((s) => s.doc.pages);

  return (
    <section className="multipage-engine">
      <div className="page-scroll">
        {pages.map((page) => (
          <div
            key={page.page_number}
            className="page-wrapper"
            style={{ zoom: `${zoomPercent}%` }}
          >
             <span className="page-meta">Página {page.page_number} de {pages.length}</span>
             <PageCanvas page={page} />
          </div>
        ))}
      </div>
    </section>
  );
}
