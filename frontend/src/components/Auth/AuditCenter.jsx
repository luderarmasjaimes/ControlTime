import React, { useEffect, useMemo, useState } from 'react'
import { Download, Filter, RefreshCw, X } from 'lucide-react'
import { fetchAuthAudit, getAuthAuditCsvUrl } from '../../auth/authApi'

const ACTION_OPTIONS = [
    { label: 'Todos', value: '' },
    { label: 'Registro', value: 'register' },
    { label: 'Login facial', value: 'login_face' },
    { label: 'Login password', value: 'login_password' },
]

const SUCCESS_OPTIONS = [
    { label: 'Todos', value: '' },
    { label: 'Exitoso', value: 'true' },
    { label: 'Fallido', value: 'false' },
]

const PAGE_SIZE = 10

const AuditCenter = ({ open, onClose, defaultCompany }) => {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [rows, setRows] = useState([])
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [pages, setPages] = useState(1)

    const [filters, setFilters] = useState({
        company: defaultCompany || '',
        username: '',
        action: '',
        success: '',
    })

    useEffect(() => {
        setFilters((prev) => ({ ...prev, company: defaultCompany || prev.company }))
    }, [defaultCompany])

    const query = useMemo(() => {
        const success =
            filters.success === '' ? undefined : filters.success === 'true'

        return {
            page,
            pageSize: PAGE_SIZE,
            company: filters.company || undefined,
            username: filters.username || undefined,
            action: filters.action || undefined,
            success,
        }
    }, [filters, page])

    const loadAudit = async () => {
        setLoading(true)
        setError('')
        try {
            const result = await fetchAuthAudit(query)
            setRows(Array.isArray(result.logs) ? result.logs : [])
            setTotal(Number(result.total || 0))
            setPages(Number(result.pages || 1))
        } catch (err) {
            setRows([])
            setError(err.message || 'No se pudo cargar la auditoria')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!open) return
        loadAudit()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, query])

    if (!open) {
        return null
    }

    const csvUrl = getAuthAuditCsvUrl({
        company: query.company,
        username: query.username,
        action: query.action,
        success: query.success,
    })

    return (
        <div className="audit-overlay" role="dialog" aria-modal="true">
            <div className="audit-modal">
                <div className="audit-head">
                    <div>
                        <h3>Auditoria de Autenticacion</h3>
                        <p>Eventos biometria, password y registros</p>
                    </div>
                    <button className="audit-close" onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>

                <div className="audit-filters">
                    <label>
                        Empresa
                        <input
                            value={filters.company}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, company: event.target.value }))
                            }}
                            placeholder="Minera Raura"
                        />
                    </label>
                    <label>
                        Usuario
                        <input
                            value={filters.username}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, username: event.target.value }))
                            }}
                            placeholder="usuario"
                        />
                    </label>
                    <label>
                        Accion
                        <select
                            value={filters.action}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, action: event.target.value }))
                            }}
                        >
                            {ACTION_OPTIONS.map((option) => (
                                <option key={option.label} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Estado
                        <select
                            value={filters.success}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, success: event.target.value }))
                            }}
                        >
                            {SUCCESS_OPTIONS.map((option) => (
                                <option key={option.label} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="audit-actions">
                    <button className="audit-btn" onClick={loadAudit} disabled={loading}>
                        <RefreshCw size={14} /> {loading ? 'Cargando...' : 'Actualizar'}
                    </button>
                    <a className="audit-btn audit-download" href={csvUrl} target="_blank" rel="noreferrer">
                        <Download size={14} /> Exportar CSV
                    </a>
                    <span className="audit-meta"><Filter size={12} /> Total: {total}</span>
                </div>

                {error && <div className="audit-error">{error}</div>}

                <div className="audit-table-wrap">
                    <table className="audit-table">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Accion</th>
                                <th>Empresa</th>
                                <th>Usuario</th>
                                <th>Estado</th>
                                <th>Detalle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="audit-empty">No hay registros para este filtro.</td>
                                </tr>
                            )}
                            {rows.map((row, index) => (
                                <tr key={`${row.event_time || 'time'}-${row.username || 'user'}-${index}`}>
                                    <td>{row.event_time || '-'}</td>
                                    <td>{row.event_action || '-'}</td>
                                    <td>{row.company_name || '-'}</td>
                                    <td>{row.username || '-'}</td>
                                    <td>
                                        <span className={row.success ? 'audit-badge ok' : 'audit-badge fail'}>
                                            {row.success ? 'OK' : 'FAIL'}
                                        </span>
                                    </td>
                                    <td>{row.detail || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="audit-pagination">
                    <button
                        className="audit-btn"
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page <= 1 || loading}
                    >
                        Anterior
                    </button>
                    <span>Pagina {page} de {pages}</span>
                    <button
                        className="audit-btn"
                        onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
                        disabled={page >= pages || loading}
                    >
                        Siguiente
                    </button>
                </div>
            </div>
        </div>
    )
}

export default AuditCenter
