import React from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import PageCanvas from './PageCanvas';

export default function MultipageView({ zoomPercent = 100 }) {
  const pages = useEditorStore((s) => s.doc.pages);

  return (
    <section className="multipage-engine">
      <div className="page-scroll">
        {pages.map((page) => (
          <div key={page.page_number} className="multipage-page-shell">
            <PageCanvas
              page={page}
              totalPages={pages.length}
              viewportScale={Math.min(1.8, Math.max(0.6, (Number(zoomPercent) || 100) / 100))}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
