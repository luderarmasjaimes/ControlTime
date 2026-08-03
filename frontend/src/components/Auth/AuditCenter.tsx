import React, { memo, useEffect, useMemo, useState } from 'react'
import { Download, Filter, RefreshCw, X } from 'lucide-react'
import { fetchAuthAudit, downloadAuthAuditCsv } from '../../auth/authApi'
import { useI18n } from '../../i18n/I18nProvider'

const PAGE_SIZE = 10

interface AuditCenterProps {
    open: boolean;
    onClose: () => void;
    defaultCompany?: string;
}

const AuditCenter = ({ open, onClose, defaultCompany }: AuditCenterProps) => {
    const { t, localizeMessage } = useI18n()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [rows, setRows] = useState<any[]>([])
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
            setError(localizeMessage((err as Error).message) || t('audit.loadError'))
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

    const exportCsv = async () => {
        setError('')
        try {
            await downloadAuthAuditCsv({
                company: query.company,
                username: query.username,
                action: query.action,
                success: query.success,
            })
        } catch (err: any) {
            setError(localizeMessage(err?.message) || String(err))
        }
    }
    const actionOptions = [
        { label: t('audit.all'), value: '' },
        { label: t('audit.register'), value: 'register' },
        { label: t('audit.faceLogin'), value: 'login_face' },
        { label: t('audit.passwordLogin'), value: 'login_password' },
    ]
    const successOptions = [
        { label: t('audit.all'), value: '' },
        { label: t('audit.success'), value: 'true' },
        { label: t('audit.failed'), value: 'false' },
    ]

    return (
        <div className="audit-overlay" role="dialog" aria-modal="true">
            <div className="audit-modal">
                <div className="audit-head">
                    <div>
                        <h3>{t('audit.title')}</h3>
                        <p>{t('audit.subtitle')}</p>
                    </div>
                    <button className="audit-close" onClick={onClose} aria-label={t('common.close')}>
                        <X size={16} />
                    </button>
                </div>

                <div className="audit-filters">
                    <label>
                        {t('audit.company')}
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
                        {t('audit.user')}
                        <input
                            value={filters.username}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, username: event.target.value }))
                            }}
                            placeholder={t('audit.user').toLocaleLowerCase()}
                        />
                    </label>
                    <label>
                        {t('audit.action')}
                        <select
                            value={filters.action}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, action: event.target.value }))
                            }}
                        >
                            {actionOptions.map((option) => (
                                <option key={option.label} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        {t('audit.status')}
                        <select
                            value={filters.success}
                            onChange={(event) => {
                                setPage(1)
                                setFilters((prev) => ({ ...prev, success: event.target.value }))
                            }}
                        >
                            {successOptions.map((option) => (
                                <option key={option.label} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="audit-actions">
                    <button className="audit-btn" onClick={loadAudit} disabled={loading}>
                        <RefreshCw size={14} /> {loading ? t('audit.loading') : t('audit.refresh')}
                    </button>
                    <button className="audit-btn audit-download" onClick={exportCsv} disabled={loading}>
                        <Download size={14} /> {t('audit.export')}
                    </button>
                    <span className="audit-meta"><Filter size={12} /> {t('audit.total', { total })}</span>
                </div>

                {error && <div className="audit-error">{error}</div>}

                <div className="audit-table-wrap">
                    <table className="audit-table">
                        <thead>
                            <tr>
                                <th>{t('audit.date')}</th>
                                <th>{t('audit.action')}</th>
                                <th>{t('audit.company')}</th>
                                <th>{t('audit.user')}</th>
                                <th>{t('audit.status')}</th>
                                <th>{t('audit.detail')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="audit-empty">{t('audit.empty')}</td>
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
                        {t('audit.previous')}
                    </button>
                    <span>{t('audit.page', { page, pages })}</span>
                    <button
                        className="audit-btn"
                        onClick={() => setPage((prev) => Math.min(pages, prev + 1))}
                        disabled={page >= pages || loading}
                    >
                        {t('audit.next')}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default memo(AuditCenter)
