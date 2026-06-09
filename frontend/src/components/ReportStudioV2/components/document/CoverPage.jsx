import React from 'react';
import { FileText, Calendar, User, Building2, MapPin, Shield } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   COVER PAGE TEMPLATES — 5 diseños de carátula minera
   Corporativo | Técnico | Ejecutivo | Campo | Normativo
   ───────────────────────────────────────────────────────────────────────── */

const COVER_DATA_DEFAULTS = {
  title: 'INFORME TÉCNICO',
  subtitle: 'Plataforma de Monitoreo Minero',
  company: 'AURIXA Mining Corporation',
  unit: 'Unidad Minera Principal',
  author: 'Ing. Responsable',
  date: new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' }),
  docCode: 'IT-MIN-2026-001',
  classification: 'CONFIDENCIAL',
};

function CorporateCover({ data }) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return (
    <div className="cover-page cover-page--corporate">
      <div className="cover-accent-bar" />
      <div className="cover-logo-area">
        <Building2 size={48} strokeWidth={1} />
      </div>
      <div className="cover-main">
        <div className="cover-classification">{d.classification}</div>
        <h1 className="cover-title">{d.title}</h1>
        <h2 className="cover-subtitle">{d.subtitle}</h2>
        <div className="cover-divider" />
        <div className="cover-meta-grid">
          <div className="cover-meta-item"><Building2 size={14} /><span>{d.company}</span></div>
          <div className="cover-meta-item"><MapPin size={14} /><span>{d.unit}</span></div>
          <div className="cover-meta-item"><User size={14} /><span>{d.author}</span></div>
          <div className="cover-meta-item"><Calendar size={14} /><span>{d.date}</span></div>
          <div className="cover-meta-item"><FileText size={14} /><span>{d.docCode}</span></div>
        </div>
      </div>
      <div className="cover-footer">
        <span>Documento generado por AURIXA Mining Platform</span>
      </div>
    </div>
  );
}

function TechnicalCover({ data }) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return (
    <div className="cover-page cover-page--technical">
      <div className="cover-tech-header">
        <div className="cover-tech-badge">INGENIERÍA</div>
        <span className="cover-tech-code">{d.docCode}</span>
      </div>
      <div className="cover-main">
        <h1 className="cover-title">{d.title}</h1>
        <h2 className="cover-subtitle">{d.subtitle}</h2>
        <div className="cover-tech-specs">
          <div className="cover-spec"><span>Empresa:</span><strong>{d.company}</strong></div>
          <div className="cover-spec"><span>Unidad:</span><strong>{d.unit}</strong></div>
          <div className="cover-spec"><span>Elaborado por:</span><strong>{d.author}</strong></div>
          <div className="cover-spec"><span>Fecha:</span><strong>{d.date}</strong></div>
          <div className="cover-spec"><span>Clasificación:</span><strong>{d.classification}</strong></div>
        </div>
      </div>
      <div className="cover-footer cover-footer--tech">
        <div className="cover-tech-grid-pattern" />
      </div>
    </div>
  );
}

function ExecutiveCover({ data }) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return (
    <div className="cover-page cover-page--executive">
      <div className="cover-exec-gradient" />
      <div className="cover-main">
        <div className="cover-exec-seal"><Shield size={32} /></div>
        <h1 className="cover-title">{d.title}</h1>
        <h2 className="cover-subtitle">{d.subtitle}</h2>
        <div className="cover-exec-divider" />
        <p className="cover-exec-company">{d.company}</p>
        <p className="cover-exec-unit">{d.unit}</p>
        <div className="cover-exec-author-block">
          <span>{d.author}</span>
          <span>{d.date}</span>
        </div>
      </div>
    </div>
  );
}

function FieldCover({ data }) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return (
    <div className="cover-page cover-page--field">
      <div className="cover-field-stripe" />
      <div className="cover-main">
        <div className="cover-field-badge">OPERACIÓN CAMPO</div>
        <h1 className="cover-title">{d.title}</h1>
        <h2 className="cover-subtitle">{d.subtitle}</h2>
        <div className="cover-field-info">
          <div><strong>{d.company}</strong></div>
          <div>{d.unit}</div>
          <div>{d.author} — {d.date}</div>
        </div>
      </div>
      <div className="cover-field-bottom-bar" />
    </div>
  );
}

function NormativeCover({ data }) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return (
    <div className="cover-page cover-page--normative">
      <div className="cover-norm-header">
        <Shield size={24} />
        <span>CUMPLIMIENTO NORMATIVO</span>
      </div>
      <div className="cover-main">
        <h1 className="cover-title">{d.title}</h1>
        <h2 className="cover-subtitle">{d.subtitle}</h2>
        <table className="cover-norm-table">
          <tbody>
            <tr><td>Empresa:</td><td>{d.company}</td></tr>
            <tr><td>Unidad operativa:</td><td>{d.unit}</td></tr>
            <tr><td>Responsable:</td><td>{d.author}</td></tr>
            <tr><td>Fecha emisión:</td><td>{d.date}</td></tr>
            <tr><td>Código documento:</td><td>{d.docCode}</td></tr>
            <tr><td>Clasificación:</td><td>{d.classification}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="cover-norm-footer">
        <p>Este documento es propiedad de {d.company}. Su reproducción parcial o total está prohibida sin autorización escrita.</p>
      </div>
    </div>
  );
}

const COVER_COMPONENTS = {
  corporate: CorporateCover,
  technical: TechnicalCover,
  executive: ExecutiveCover,
  field: FieldCover,
  normative: NormativeCover,
};

export default function CoverPage({ templateId = 'corporate', data }) {
  const Component = COVER_COMPONENTS[templateId] || CorporateCover;
  return <Component data={data} />;
}

export function generateCoverPageElements(templateId, data = {}) {
  const d = { ...COVER_DATA_DEFAULTS, ...data };
  return {
    type: 'cover',
    templateId,
    data: d,
    width: '100%',
    height: '100%',
  };
}

export { COVER_COMPONENTS, COVER_DATA_DEFAULTS };
