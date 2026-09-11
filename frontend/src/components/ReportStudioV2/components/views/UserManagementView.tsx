import React, { memo, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  ShieldCheck, Users, X, Lock, Unlock, UserCog, Clock,
  Search, Edit2, RotateCcw, Save, Trash2, AlertTriangle,
  CheckCircle2, ScanFace, UserPlus, Building2, Plus, ShieldOff, ScanLine
} from 'lucide-react';
import { ADMIN_ASSIGNABLE_ROLES, getRoleLabel, getRoleColor } from '../../../../auth/roleConstants';
import { getSession, authHeaders as sharedAuthHeaders } from '../../../../auth/authStorage';
import { applyUserMaintenanceUnified, listCompanyUsersUnified, listMaintenanceAuditUnified } from '../../lib/userMaintenanceStorage';
import { log } from '../../../../lib/logger';
import { useI18n } from '../../../../i18n/I18nProvider';
import { requestConfirmation } from '../../../UI/ConfirmActionDialog';
import { DocumentScanCapture } from '../../../UI/DocumentScanCapture';
import type { DniScanResult } from '../../../../auth/authApi';
import { fetchOrgAccessCandidates, grantOrgAccess, revokeOrgAccess, type OrgAccessCandidateTenant } from '../../../../auth/authApi';
import { usePermissions } from '../../../../auth/usePermissions';
import { FACIAL_ICAO } from '../../../../config/facialIcaoConfig';
import { acquireFaceCameraStream } from '../../../../auth/adaptiveCameraCapture';
import { useLivenessChallengeSync } from '../../../../auth/useLivenessChallengeSync';
import { createBestFrameCollector, faceBoxFromServerOval } from '../../../../auth/bestBiometricFrame';
import {
  ACTIVE_CHALLENGE_ENABLED,
  challengeInstructionKey,
  currentChallenge,
  isChallengeSequenceComplete,
} from '../../../../auth/livenessChallenge';
import './accessAdministration.css';
// Modal movido internamente para evitar errores de resolucion dinamica en tiempo de ejecucion

function authHeaders(): Record<string, string> {
  // ADR-082: la credencial es la cookie HttpOnly `access_token`, que el
  // navegador adjunta sola. Aqui solo viaja el token CSRF del double-submit,
  // que el backend exige en toda peticion que mute estado.
  return sharedAuthHeaders();
}

interface TenantAssignment {
  tenant_id: string;
  tenant_name: string;
  role: string | null;
  is_default: boolean;
  /** db_scripts/72: "membership" (auth_user_tenant, default) | "org_grant" (org_tenant_access -- acceso cruzado). */
  via?: 'membership' | 'org_grant';
}

const ACTIONS = [
  { value: 'block', label: 'Bloquear acceso', icon: Lock, color: 'text-amber-500' },
  { value: 'unblock', label: 'Desbloquear / Activar', icon: Unlock, color: 'text-emerald-500' },
  { value: 'suspend', label: 'Suspender temporalmente', icon: Clock, color: 'text-orange-500' },
  { value: 'delete', label: 'Eliminar usuario', icon: Trash2, color: 'text-red-500' },
  { value: 'change_profile', label: 'Cambiar perfil/rol', icon: UserCog, color: 'text-indigo-500' },
  { value: 'edit_data', label: 'Editar información', icon: Edit2, color: 'text-sky-500' },
  { value: 'reset_password', label: 'Resetear clave', icon: RotateCcw, color: 'text-emerald-500' },
];

// Esta pantalla la usa un admin para gestionar OTROS usuarios (no
// autoregistro) -- debe ofrecer los 7 roles reales, incluido 'viewer'.
const ROLE_OPTIONS = ADMIN_ASSIGNABLE_ROLES;

function statusLabel(status: string): string {
  if (status === 'blocked') return 'Bloqueado';
  if (status === 'suspended') return 'Suspendido';
  if (status === 'deleted') return 'Eliminado';
  return 'Activo';
}

interface IntegratedBiometricModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: any) => void;
  operatorUsername?: string;
  company?: string;
}

function UserManagementView() {
  const { t } = useI18n();
  const session = getSession();
  const company = session?.company || '';
  const { isOrganizationTenant, hasPermission, isAdmin } = usePermissions();
  const canManageOrgAccess = (isAdmin || hasPermission('org.cross_tenant.manage')) && isOrganizationTenant;

  const [users, setUsers] = useState<any[]>([]);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUsername, setSelectedUsername] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // UI States
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: 'info', text: '' });

  const [isBioModalOpen, setIsBioModalOpen] = useState(false);

  // Alta de usuario admin-driven (sin biometría, ver auth_routes.cpp::handleAdminCreateUser)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '', password: '', firstName: '', lastName: '', dni: '', role: 'operator', email: '',
  });

  // Unidades mineras asignadas (multitenant) del usuario seleccionado
  const [userTenants, setUserTenants] = useState<TenantAssignment[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [assignRole, setAssignRole] = useState('operator');
  const [assigningTenant, setAssigningTenant] = useState(false);

  // db_scripts/72: acceso cruzado (personal de organización -> empresas
  // mineras clientes). Solo se carga/usa si canManageOrgAccess.
  const [orgCandidates, setOrgCandidates] = useState<OrgAccessCandidateTenant[]>([]);
  const [orgAccessTenantId, setOrgAccessTenantId] = useState('');
  const [orgAccessRole, setOrgAccessRole] = useState('operator');
  const [grantingOrgAccess, setGrantingOrgAccess] = useState(false);

  // Form States for edits
  const [formData, setFormData] = useState({
    reason: '',
    suspensionUntil: '',
    newRole: 'operator',
    firstName: '',
    lastName: '',
    dni: '',
    email: '',
    phone: '',
    mobile: '',
    newPassword: '',
    securityPassword: '',
    securityMethod: 'password', // 'password' or 'facial'
  });
  const [showDniScan, setShowDniScan] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, aRes] = await Promise.all([
        listCompanyUsersUnified(company),
        listMaintenanceAuditUnified(company)
      ]);
      setUsers(uRes.users || []);
      setAuditRows(aRes.logs || []);
    } catch (e) { log.error("Load failed", e); }
    setLoading(false);
  };

  useEffect(() => {
    if (company) loadData();
  }, [company]);

  useEffect(() => {
    if (!canManageOrgAccess) { setOrgCandidates([]); return; }
    fetchOrgAccessCandidates()
      .then(setOrgCandidates)
      .catch((err) => log.error('fetchOrgAccessCandidates', err));
  }, [canManageOrgAccess]);

  const createUser = async () => {
    if (!createForm.username.trim() || !createForm.password.trim() ||
        !createForm.firstName.trim() || !createForm.lastName.trim() || !createForm.dni.trim()) {
      setStatusMsg({ type: 'error', text: 'Complete usuario, contraseña, nombres, apellidos y DNI.' });
      return;
    }
    if (createForm.password.length < 8) {
      setStatusMsg({ type: 'error', text: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    setCreating(true);
    setStatusMsg({ type: 'info', text: 'Creando usuario...' });
    try {
      const res = await fetch('/api/auth/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          username: createForm.username.trim(),
          password: createForm.password,
          first_name: createForm.firstName.trim(),
          last_name: createForm.lastName.trim(),
          dni: createForm.dni.trim(),
          role: createForm.role,
          email: createForm.email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setStatusMsg({ type: 'success', text: `Usuario ${data.username} creado correctamente. Puede iniciar sesión de inmediato; el enrolamiento biométrico queda pendiente para su primer ingreso.` });
      setShowCreateForm(false);
      setCreateForm({ username: '', password: '', firstName: '', lastName: '', dni: '', role: 'operator', email: '' });
      loadData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo crear el usuario: ${(err as Error).message}` });
    } finally {
      setCreating(false);
    }
  };

  const loadUserTenants = useCallback(async (username: string) => {
    if (!username) { setUserTenants([]); return; }
    setTenantsLoading(true);
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}/tenants`, { headers: authHeaders() });
      const data = await res.json();
      setUserTenants(Array.isArray(data?.tenants) ? data.tenants : []);
    } catch (err) {
      log.error('loadUserTenants', err);
      setUserTenants([]);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  const assignCurrentTenant = async (username: string) => {
    setAssigningTenant(true);
    try {
      const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ role: assignRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setStatusMsg({ type: 'success', text: `Acceso a ${company} otorgado (${assignRole}).` });
      loadUserTenants(username);
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo otorgar el acceso: ${(err as Error).message}` });
    } finally {
      setAssigningTenant(false);
    }
  };

  // db_scripts/72: una fila "org_grant" es una concesión de acceso cruzado
  // (org_tenant_access), no una membresía real (auth_user_tenant) -- se
  // revoca por un endpoint distinto (POST /api/auth/org-access/revoke).
  const revokeTenant = async (username: string, assignment: TenantAssignment) => {
    if (!(await requestConfirmation(t('confirm.revokeTenant', { user: username, tenant: assignment.tenant_name })))) return;
    try {
      if (assignment.via === 'org_grant') {
        await revokeOrgAccess(username, assignment.tenant_id);
      } else {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}/tenants/remove`, {
          method: 'POST', headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setStatusMsg({ type: 'success', text: 'Acceso revocado.' });
      loadUserTenants(username);
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo revocar: ${(err as Error).message}` });
    }
  };

  const grantSelectedOrgAccess = async (username: string) => {
    if (!orgAccessTenantId) {
      setStatusMsg({ type: 'error', text: 'Seleccione la empresa minera destino.' });
      return;
    }
    setGrantingOrgAccess(true);
    try {
      await grantOrgAccess(username, orgAccessTenantId, orgAccessRole);
      const tenantName = orgCandidates.find(c => c.tenant_id === orgAccessTenantId)?.tenant_name || orgAccessTenantId;
      setStatusMsg({ type: 'success', text: `Acceso cruzado a "${tenantName}" otorgado (${orgAccessRole}).` });
      loadUserTenants(username);
    } catch (err) {
      setStatusMsg({ type: 'error', text: `No se pudo otorgar el acceso cruzado: ${(err as Error).message}` });
    } finally {
      setGrantingOrgAccess(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return users.filter(u =>
      (u.username || '').toLowerCase().includes(term) ||
      (u.fullName || '').toLowerCase().includes(term) ||
      (u.dni || '').toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const selectedUser = useMemo(() =>
    users.find(u => u.username === selectedUsername),
    [users, selectedUsername]
  );

  useEffect(() => {
    if (selectedUsername) loadUserTenants(selectedUsername);
    else setUserTenants([]);
  }, [selectedUsername, loadUserTenants]);

  // Pre-fill logic when user OR action changes
  useEffect(() => {
    if (selectedUser) {
      setFormData(prev => ({
        ...prev,
        firstName: selectedUser.firstName || '',
        lastName: selectedUser.lastName || '',
        dni: selectedUser.dni || '',
        email: selectedUser.email || '',
        phone: selectedUser.phone || '',
        mobile: selectedUser.mobile || '',
        newRole: selectedUser.role || 'operator',
        reason: '',
      }));
    }
  }, [selectedUser, activeAction]);

  const executeMaintenanceAction = async (securityParams: Record<string, unknown> = {}) => {
    setSaving(true);
    setStatusMsg({ type: 'info', text: 'Procesando cambios...' });

    log.debug("[USER_MAINT_UI] executeMaintenanceAction starting...", {
      action: activeAction,
      target: selectedUser?.username,
      method: formData.securityMethod
    });

    try {
      const result = await applyUserMaintenanceUnified({
        company,
        targetUsername: selectedUser.username,
        action: activeAction!,
        details: {
          reason: formData.reason,
          suspensionUntil: formData.suspensionUntil,
          newRole: formData.newRole,
          firstName: formData.firstName,
          lastName: formData.lastName,
          dni: formData.dni,
          email: formData.email,
          phone: formData.phone,
          mobile: formData.mobile,
          newPassword: formData.newPassword,
        },
        securityMethod: formData.securityMethod,
        securityPassword: formData.securityPassword,
        ...securityParams,
        operator: session as any,
      });

      log.debug("[USER_MAINT_UI] executeMaintenanceAction result:", result);

      if (result.ok) {
        setStatusMsg({ type: 'success', text: result.message });
        setActiveAction(null);
        setFormData(prev => ({ ...prev, securityPassword: '', newPassword: '', reason: '' }));
        loadData();
      } else {
        setStatusMsg({ type: 'error', text: result.message });
      }
    } catch (err) {
      log.error("[USER_MAINT_UI] executeMaintenanceAction CRITICAL ERROR:", err);
      setStatusMsg({ type: 'error', text: `Error critico: ${(err as Error).message}` });
    } finally {
      setSaving(false);
      log.debug("[USER_MAINT_UI] executeMaintenanceAction finished.");
    }
  };

  const handleApply = async () => {
    log.debug("[USER_MAINT_UI] handleApply clicked.", {
      activeAction,
      method: formData.securityMethod,
      target: selectedUser?.username
    });

    if (!selectedUser || !activeAction) {
      log.warn("[USER_MAINT_UI] handleApply aborted: No selected user or action.");
      return;
    }

    if (!formData.reason.trim()) {
      log.warn("[USER_MAINT_UI] handleApply aborted: Empty reason.");
      setStatusMsg({ type: 'error', text: 'Debe ingresar un motivo o justificación para realizar este cambio.' });
      return;
    }

    try {
      if (formData.securityMethod === 'facial') {
        log.debug("[USER_MAINT_UI] handleApply: Opening Biometric Modal");
        setIsBioModalOpen(true);
      } else {
        log.debug("[USER_MAINT_UI] handleApply: Executing directly with password");
        executeMaintenanceAction();
      }
    } catch (err) {
      log.error("[USER_MAINT_UI] handleApply CRITICAL ERROR:", err);
      setStatusMsg({ type: 'error', text: `Falla en el proceso: ${(err as Error).message}` });
    }
  };

  /** Biometric Modal Interno **/
  const IntegratedBiometricModal = ({ isOpen, onClose, onSuccess, operatorUsername, company }: IntegratedBiometricModalProps) => {
    const [bioloading, setBioLoading] = useState(false);
    const [bioError, setBioError] = useState('');
    const [faceSamples, setFaceSamples] = useState(0);
    const [timeLeft, setTimeLeft] = useState(60);
    const [cameraActive, setCameraActive] = useState(false);
    const [faceGuide, setFaceGuide] = useState({
      eyesOpen: false, mouthClosed: false, frontal: false, noGlasses: false, qualityReady: false
    });

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isVerifyingRef = useRef(false);
    const cameraCancelledRef = useRef(false);
    const [serverOval, setServerOval] = useState<any>(null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const { challengeUiState, challengesPassedRef, challengeStartedRef, syncChallengeFromServer, resetChallengeState } =
      useLivenessChallengeSync();
    /**
     * ADR-158: el frame que se verifica sale del mejor de la ETAPA 1 (5
     * lecturas ICAO consecutivas), no del frame en vivo del instante en que
     * se cumple el gate -- que es el final del gesto del desafío activo.
     */
    const bestFrameRef = useRef(
      createBestFrameCollector<{ imageBase64: string; template: number[] | undefined }>({
        label: 'USER_MGMT_BIO',
      })
    );

    useEffect(() => {
      if (isOpen) {
        (async () => {
          try {
            setBioLoading(true);
            setBioError('');
            resetChallengeState();
      bestFrameRef.current.reset();
            const { resetBiometricCapture } = await import('../../../../auth/authApi');
            await resetBiometricCapture();
            if (!videoRef.current) {
              throw new Error('No se pudo inicializar el elemento de video.');
            }
            // Escalera adaptativa de resoluciones (ver adaptiveCameraCapture.ts):
            // prueba de mayor a menor y verifica que realmente llegue un frame
            // real antes de aceptar cada escalón, en vez de una única
            // resolución "ideal" fija que en ciertos drivers "resuelve" pero
            // nunca pinta imagen.
            cameraCancelledRef.current = false;
            const stream = await acquireFaceCameraStream(videoRef.current, () => cameraCancelledRef.current);
            if (cameraCancelledRef.current) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }
            streamRef.current = stream;
            setCameraActive(true);
            setBioLoading(false);
            setTimeLeft(60);

            timerRef.current = setInterval(async () => {
              if (!videoRef.current || isVerifyingRef.current) return;
              try {
                if (videoRef.current.videoWidth > 0 && stageSize.width === 0) {
                  setStageSize({ width: videoRef.current.clientWidth, height: videoRef.current.clientHeight });
                }

                const canvas = document.createElement('canvas');
                canvas.width = FACIAL_ICAO.CAMERA.width.ideal; canvas.height = FACIAL_ICAO.CAMERA.height.ideal;
                canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
                const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
                const { processBiometricFrame, fetchBiometricStatus } = await import('../../../../auth/authApi');
                await processBiometricFrame(base64);
                const status = await fetchBiometricStatus();
                setFaceSamples(status.capture_count || 0);
                if (status.face_oval) setServerOval(status.face_oval);
                setFaceGuide({
                  eyesOpen: !!status.icao?.eyes_open,
                  mouthClosed: !!status.icao?.mouth_closed,
                  frontal: !!status.icao?.face_straight,
                  noGlasses: !!status.icao?.no_glasses,
                  qualityReady: !!status.icao?.is_ready
                });
                syncChallengeFromServer(status.challenge);

                // ETAPA 1 (ADR-158): candidatos sólo mientras el servidor no
                // haya sorteado el desafío y las 4 condiciones ICAO estén en
                // verde. El desempate lo hace la calidad visual dentro del
                // colector (nitidez, exposición, centrado, encuadre).
                if (!challengeStartedRef.current && status.icao?.is_ready && videoRef.current) {
                  const video = videoRef.current;
                  const { buildFullFrameJpegBase64FromVideo, frameToTemplate } = await import('../../../../auth/biometricOvalFrame');
                  bestFrameRef.current.consider({
                    video,
                    faceBox: faceBoxFromServerOval(status.face_oval, video),
                    build: () => ({
                      imageBase64: buildFullFrameJpegBase64FromVideo(
                        video,
                        FACIAL_ICAO.CAMERA.width.ideal,
                        FACIAL_ICAO.CAMERA.height.ideal,
                        0.9
                      ),
                      template: frameToTemplate(video, null),
                    }),
                  });
                }
                // ADR-146: además de las N muestras, el servidor exige
                // completar el desafío activo (girar cabeza/acercarse-
                // alejarse) -- sin este chequeo, esta pantalla disparaba
                // loginWithFace apenas llegaba a N muestras y el backend lo
                // rechazaba siempre con liveness_challenge_incomplete, sin
                // mostrar nunca el gesto pedido (regresión real tras
                // reactivar BEEMETRY_LIVENESS_CHALLENGE_REQUIRED).
                if (
                  (status.capture_count || 0) >= FACIAL_ICAO.REQUIRED_VALID_FRAMES &&
                  challengesPassedRef.current &&
                  !isVerifyingRef.current
                ) {
                  isVerifyingRef.current = true;
                  verifyAction();
                }
              } catch (e) {}
            }, 600);
          } catch (err) {
            if (cameraCancelledRef.current) {
              // El modal se cerró mientras acquireFaceCameraStream negociaba
              // la cámara -- no es un error real, no pisar el estado.
              return;
            }
            setBioError("No se pudo iniciar la camara: " + (err as Error).message);
            setBioLoading(false);
          }
        })();
      } else {
        cameraCancelledRef.current = true;
        if (timerRef.current) clearInterval(timerRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        setCameraActive(false);
      }
      return () => {
        cameraCancelledRef.current = true;
        if (timerRef.current) clearInterval(timerRef.current);
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      };
    }, [isOpen]);

    useEffect(() => {
      let intv: ReturnType<typeof setInterval> | null = null;
      if (isOpen && cameraActive && timeLeft > 0) {
        intv = setInterval(() => {
          setTimeLeft(p => {
            if (p <= 1) {
              setBioError("TIEMPO DE ESPERA EXCEDIDO");
              setTimeout(() => onClose(), 2000);
              return 0;
            }
            return p - 1;
          });
        }, 1000);
      }
      return () => { if (intv) clearInterval(intv); };
    }, [isOpen, cameraActive, timeLeft]);

    const verifyAction = async () => {
      try {
        setBioLoading(true);
        const { buildFullFrameJpegBase64FromVideo, frameToTemplate } = await import('../../../../auth/biometricOvalFrame');
        const { loginWithFace } = await import('../../../../auth/authApi');
        // ADR-158: mejor frame de la etapa 1; sólo si no hay (o venció) se
        // cae a la captura en vivo, que es el comportamiento anterior.
        const bestFrame = bestFrameRef.current.takeFresh();
        if (!bestFrame) {
          log.warn('[USER_MGMT_BIO] sin mejor candidato de etapa 1, usando captura en vivo');
        }
        const img = bestFrame
          ? bestFrame.payload.imageBase64
          : buildFullFrameJpegBase64FromVideo(videoRef.current!, FACIAL_ICAO.CAMERA.width.ideal, FACIAL_ICAO.CAMERA.height.ideal, 0.9);
        const tmp = bestFrame ? bestFrame.payload.template : frameToTemplate(videoRef.current!, null);
        const res = await loginWithFace({ company, username: operatorUsername, imageBase64: img, template: tmp });
        if (res.status === 'authenticated' || res.ok || res.success) onSuccess(res);
        else { setBioError(res.message || "Falla biometria"); isVerifyingRef.current = false; }
      } catch (e) { setBioError((e as Error).message); isVerifyingRef.current = false; }
      finally { setBioLoading(false); }
    };

    if (!isOpen) return null;

    const timerProgress = timeLeft / 60;
    const circ = 2 * Math.PI * 18;

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md">
        <div className="bg-[var(--a11y-bg-form)] border border-[var(--a11y-border-form)] w-full max-w-xl rounded-[2rem] overflow-hidden flex flex-col p-5 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          <div className="flex justify-between items-center mb-4">
             <div className="flex items-center gap-3">
               <div className="relative w-10 h-10 flex items-center justify-center">
                 <svg width="40" height="40" viewBox="0 0 44 44" className="rotate-[-90deg]">
                   <circle cx="22" cy="22" r="18" stroke="rgba(255,255,255,0.05)" strokeWidth="3" fill="none" />
                   <circle cx="22" cy="22" r="18" stroke={timerProgress > 0.3 ? "#6366f1" : "#f43f5e"} strokeWidth="3" fill="none"
                           strokeDasharray={circ} strokeDashoffset={circ * (1 - timerProgress)} strokeLinecap="round" className="transition-all duration-1000 linear" />
                 </svg>
                 <span className="absolute text-[10px] font-black text-white">{timeLeft}</span>
               </div>
               <div>
                 <h2 className="text-white font-black uppercase text-[10px] tracking-widest leading-none">Validación Biométrica</h2>
                 <p className="text-slate-500 text-[8px] font-bold uppercase mt-1">Seguridad de administrador</p>
               </div>
             </div>
             <button type="button" onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all">
               <X size={16} />
             </button>
          </div>

          <div className="relative aspect-[4/3] bg-black rounded-3xl overflow-hidden mb-4 border border-white/5 shadow-inner">
             <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />

             {/* Oval de Seguimiento */}
             {serverOval && stageSize.width > 0 && (
               <div className="absolute pointer-events-none transition-all duration-200"
                    style={{
                      borderRadius: '50%',
                      left: `${(serverOval.cx/640)*100}%`, top: `${(serverOval.cy/480)*100}%`,
                      width: `${(serverOval.w/640)*100}%`, height: `${(serverOval.h/480)*100}%`,
                      transform: `translate(-50%, -50%) rotate(${serverOval.angle_deg || 0}deg)`,
                      border: faceGuide.qualityReady ? '3px solid #10b981' : '3px solid #f43f5e',
                      boxShadow: faceGuide.qualityReady ? '0 0 20px rgba(16,185,129,0.3)' : '0 0 20px rgba(244,63,94,0.3)',
                      zIndex: 10
                    }}>
                  <div className="absolute inset-0 border border-white/20 rounded-full" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-0.5 bg-current opacity-50" />
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-current opacity-50" />
               </div>
             )}

             {/* Overlay de Sombra fuera del oval */}
             <div className="absolute inset-0 pointer-events-none bg-slate-950/40" style={{
               maskImage: serverOval ? 'radial-gradient(ellipse at center, transparent 40%, black 70%)' : 'none',
               WebkitMaskImage: serverOval ? 'radial-gradient(ellipse at center, transparent 40%, black 70%)' : 'none'
             } as React.CSSProperties} />

             <div className="absolute top-4 left-4 flex flex-col gap-1">
                <div className="bg-[var(--a11y-bg-form)]/80 backdrop-blur px-3 py-1.5 rounded-xl border border-[var(--a11y-border-form)] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-black text-white uppercase tracking-wider">{faceSamples}/{FACIAL_ICAO.REQUIRED_VALID_FRAMES} Muestras</span>
                </div>
             </div>

             {ACTIVE_CHALLENGE_ENABLED && cameraActive && !isChallengeSequenceComplete(challengeUiState) && (() => {
               const chType = currentChallenge(challengeUiState);
               if (!chType) return null;
               return (
                 <div className="absolute top-4 right-4 max-w-[70%] bg-indigo-950/90 backdrop-blur px-3 py-2 rounded-xl border border-indigo-400/40 flex flex-col gap-0.5 z-20">
                   <span className="text-[8px] font-black text-indigo-300 uppercase tracking-widest">
                     Desafío {challengeUiState.index + 1} de {challengeUiState.queue.length}
                   </span>
                   <span className="text-[11px] font-black text-white uppercase leading-tight">
                     {t(challengeInstructionKey(chType))}
                   </span>
                 </div>
               );
             })()}

             {!cameraActive && !bioError && (
               <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 gap-3">
                 <RotateCcw className="text-indigo-400 animate-spin" size={32} />
                 <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Iniciando Sensor...</span>
               </div>
             )}
          </div>

          <div className="grid grid-cols-5 gap-2 mb-4">
             {[
               ['Frontal', faceGuide.frontal],
               ['Ojos', faceGuide.eyesOpen],
               ['Boca', faceGuide.mouthClosed],
               ['Sin Gafas', faceGuide.noGlasses],
               ['Liveness', faceGuide.qualityReady]
             ].map(([L, V]) => (
               <div key={L as string} className={`flex flex-col items-center gap-1.5 p-2 rounded-2xl border transition-all ${V ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/40 border-white/5 opacity-40'}`}>
                 <div className={`w-1.5 h-1.5 rounded-full ${V ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                 <span className={`text-[7px] font-black uppercase tracking-tighter ${V ? 'text-emerald-400' : 'text-slate-500'}`}>{L as string}</span>
               </div>
             ))}
          </div>

          {bioError && (
             <div className="flex items-center gap-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl mb-4 animate-in shake-in">
               <AlertTriangle className="text-rose-500 shrink-0" size={18} />
               <p className="text-[9px] font-black text-rose-400 uppercase leading-tight">{bioError}</p>
             </div>
          )}

          {bioloading && !bioError && (
             <div className="flex items-center justify-center gap-2 py-2">
               <RotateCcw className="text-indigo-500 animate-spin" size={14} />
               <span className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">Verificando Identidad...</span>
             </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="access-admin access-users" aria-labelledby="users-title">
      <header className="access-admin__header access-users__header">
        <div className="access-admin__identity">
          <span className="access-admin__eyebrow">Administración de identidad</span>
          <div className="access-admin__title-row">
          <div className="access-admin__title-icon">
            <Users className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 id="users-title">Administración de usuarios</h1>
            <p>
              {company || 'Empresa no identificada'} · {users.length} registros
              {isOrganizationTenant && <span className="access-badge-sky ml-2">Personal de organización</span>}
            </p>
          </div>
          </div>
        </div>

        <div className="access-admin__actions access-users__toolbar">
          <div className="access-search">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              placeholder="Buscar por nombre, DNI o usuario..."
              className="access-search__input"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
            <button
              type="button"
              onClick={loadData}
            className="access-button access-button--icon"
            title="Sincronizar"
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setShowCreateForm(v => !v); setSelectedUsername(''); }}
            className={`access-button ${showCreateForm ? 'access-button--ghost' : 'access-button--primary'}`}
          >
            {showCreateForm ? <X size={14} /> : <UserPlus size={14} />}
            {showCreateForm ? 'Cancelar' : 'Nuevo Usuario'}
          </button>
        </div>
      </header>

      {showCreateForm && (
        <section className="access-create-panel">
          <h3 className="text-[11px] font-black text-slate-100 uppercase tracking-wider flex items-center gap-2 mb-3">
            <UserPlus size={13} className="text-indigo-400" /> Alta de Nuevo Usuario — {company}
          </h3>
          <div className="access-create-grid">
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Nombres</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Apellidos</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">DNI</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.dni} onChange={e => setCreateForm({ ...createForm, dni: e.target.value })} />
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Perfil de Acceso</label>
              <select className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-indigo-500/50"
                value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
                {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[8px] font-black text-slate-500 uppercase mb-1 block">Usuario (login)</label>
              <input type="text" className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-indigo-300 outline-none focus:border-indigo-500/50"
                value={createForm.username} onChange={e => setCreateForm({ ...createForm, username: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Contraseña Temporal</label>
              <input type="text" placeholder="Mínimo 8 caracteres" className="form-input-base"
                value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
            <div>
              <label className="form-label">Email (opcional)</label>
              <input type="email" className="form-input-base"
                value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={creating}
                onClick={createUser}
                className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
              >
                {creating ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                {creating ? 'Creando...' : 'Crear Usuario'}
              </button>
            </div>
          </div>
          <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-2 opacity-60">
            El usuario queda vinculado a {company} con el perfil elegido. El enrolamiento biométrico se completa en su primer ingreso.
          </p>
        </section>
      )}

      <div className="access-users__workspace">
        {/* Tabla de Usuarios */}
        <section className="access-users__list-card">
          <div className="access-users__table-scroll">
            <table className="access-users-table">
              <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur shadow-sm">
                <tr className="border-b border-white/5">
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase">Perfil</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase">Nombre Completo</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase">Usuario</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase text-center">Estado</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase text-right px-8">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
        {loading ? (
          <tr><td colSpan={5} className="py-10 text-center text-slate-500 animate-pulse font-bold uppercase text-[9px]">Cargando usuarios...</td></tr>
        ) : filteredUsers.length === 0 ? (
          <tr><td colSpan={5} className="py-10 text-center text-slate-500 font-bold uppercase text-[9px]">No hay registros.</td></tr>
        ) : filteredUsers.map(user => (
          <tr
            key={user.username}
            onClick={() => { setSelectedUsername(user.username); setShowCreateForm(false); }}
            className={selectedUsername === user.username ? 'is-selected' : ''}
          >
            <td className="px-5 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${getRoleColor(user.role).replace('text-', 'bg-').replace('400', '500/20')} ${getRoleColor(user.role)} ${getRoleColor(user.role).replace('text-', 'border-').replace('400', '500/30')}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="text-[11px] font-black text-white group-hover:text-indigo-400 transition-colors uppercase tracking-tight leading-none">{user.fullName}</div>
                      <div className="text-[9px] text-slate-500 font-medium">{user.email || 'Sin correo'}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="text-xs font-mono text-indigo-300/80">{user.username}</div>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        user.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                        user.status === 'blocked' ? 'bg-amber-500/10 text-amber-400' :
                        user.status === 'suspended' ? 'bg-orange-500/10 text-orange-400' :
                        'bg-rose-500/10 text-rose-400'
                      }`}>
                        <div className={`w-1 h-1 rounded-full ${user.status === 'active' ? 'bg-emerald-400' : 'bg-current'}`} />
                        {statusLabel(user.status)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                       <button type="button" className="p-1 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition-colors">
                         <Edit2 size={10} />
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Panel de Control de Usuario Seleccionado */}
        <aside className="access-users__detail-card">
          <div className="access-users__detail-inner">
            {selectedUser ? (
              <div className="flex flex-col h-full min-h-0">
                <div className="p-4 border-b border-white/5 bg-gradient-to-br from-slate-800/50 to-transparent shrink-0">
                  <div className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mb-0.5">Usuario Seleccionado</div>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                      <Users size={16} />
                    </div>
                    <div>
                      <h2 className="text-sm font-black text-white leading-none">{selectedUser.fullName}</h2>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{selectedUser.username} | {selectedUser.dni || 'DNI N/A'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-4 scrollbar-thin">
                  {/* Grid de Acciones Rápidas */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {ACTIONS.map(act => {
                      if (act.value === 'block' && selectedUser.status === 'blocked') return null;
                      if (act.value === 'unblock' && selectedUser.status === 'active') return null;

                      // Seguridad: No permitir bloquearse, suspenderse o eliminarse a sí mismo
                      const isSelf = selectedUser.username === session?.username;
                      const isDestructive = ['block', 'suspend', 'delete'].includes(act.value);
                      if (isSelf && isDestructive) return null;

                      const Icon = act.icon;
                      const isActive = activeAction === act.value;
                      return (
                        <button
                          type="button"
                          key={act.value}
                          onClick={() => setActiveAction(isActive ? null : act.value)}
                          className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                            isActive
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                              : 'bg-slate-800/50 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-white'
                          }`}
                        >
                          <Icon size={14} className={isActive ? 'text-white' : act.color} />
                          <span className="text-[7px] font-black uppercase mt-1 text-center leading-none">{act.label.split(' ')[0]}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Unidades Mineras Asignadas (multitenant) */}
                  <div className="p-3 rounded-xl bg-slate-950/40 border border-white/10 space-y-2">
                    <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Building2 size={11} className="text-indigo-400" /> Unidades Mineras Asignadas
                    </h3>
                    {tenantsLoading ? (
                      <p className="text-[9px] text-slate-500 font-bold uppercase animate-pulse">Cargando...</p>
                    ) : userTenants.length === 0 ? (
                      <p className="text-[9px] text-slate-500">Sin unidades asignadas explícitamente.</p>
                    ) : (
                      <div className="space-y-1">
                        {userTenants.map(t => (
                          <div key={t.tenant_id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
                            <div className="min-w-0">
                              <div className="text-[10px] font-black text-white truncate">{t.tenant_name}</div>
                              <div className="text-[8px] text-slate-500 uppercase font-bold flex items-center gap-1.5">
                                {t.role || 'sin rol'} {t.is_default && '· Predeterminada'}
                                {t.via === 'org_grant' && <span className="access-badge-sky">Acceso cruzado</span>}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => revokeTenant(selectedUser.username, t)}
                              className="shrink-0 p-1 rounded bg-slate-800 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                              title="Revocar acceso a esta unidad"
                            >
                              <ShieldOff size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      <select className="flex-1 form-select-base"
                        value={assignRole} onChange={e => setAssignRole(e.target.value)}>
                        {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={assigningTenant}
                        onClick={() => assignCurrentTenant(selectedUser.username)}
                        className="shrink-0 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[8px] font-black uppercase flex items-center gap-1"
                        title={`Otorgar acceso a ${company}`}
                      >
                        <Plus size={10} /> {company}
                      </button>
                    </div>
                  </div>

                  {/* db_scripts/72: acceso a otras empresas mineras (acceso
                      cruzado de personal de organización) -- visible solo si
                      el tenant activo de la sesión es de organización y el
                      operador tiene org.cross_tenant.manage; el backend
                      revalida ambas condiciones en cada request. */}
                  {canManageOrgAccess && (
                    <div className="p-3 rounded-xl bg-slate-950/40 border border-white/10 space-y-2">
                      <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Building2 size={11} className="text-sky-400" /> Acceso a otras empresas mineras
                      </h3>
                      <p className="text-[8px] text-slate-500 leading-relaxed">
                        Otorga acceso de soporte a una empresa minera cliente, sobre uno de los perfiles existentes — auditado aparte del acceso normal.
                      </p>
                      <div className="flex items-center gap-1.5">
                        <select className="flex-1 form-select-base"
                          value={orgAccessTenantId} onChange={e => setOrgAccessTenantId(e.target.value)}>
                          <option value="">Seleccione empresa minera...</option>
                          {orgCandidates.map(c => (
                            <option key={c.tenant_id} value={c.tenant_id}>{c.tenant_name}</option>
                          ))}
                        </select>
                        <select className="form-select-base"
                          value={orgAccessRole} onChange={e => setOrgAccessRole(e.target.value)}>
                          {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                        <button
                          type="button"
                          disabled={grantingOrgAccess || !orgAccessTenantId}
                          onClick={() => grantSelectedOrgAccess(selectedUser.username)}
                          className="shrink-0 px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-[8px] font-black uppercase flex items-center gap-1"
                          title="Otorgar acceso cruzado"
                        >
                          <Plus size={10} /> Otorgar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Formulario Dinámico según Acción */}
                  {activeAction && (
                    <div className="p-3 rounded-xl bg-slate-950/40 border border-white/10 space-y-3 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[11px] font-black text-slate-100 uppercase tracking-wider flex items-center gap-2">
                          <CheckCircle2 size={12} className="text-indigo-400" />
                          Configurar {ACTIONS.find(a => a.value === activeAction)?.label}
                        </h3>
                        <button type="button" onClick={() => setActiveAction(null)} className="text-slate-500 hover:text-white">
                          <X size={14} />
                        </button>
                      </div>

                      {activeAction === 'edit_data' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Nombres</label>
                            <input type="text" className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                              value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} />
                          </div>
                          <div className="col-span-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Apellidos</label>
                            <input type="text" className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                              value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} />
                          </div>
                          <div className="col-span-2">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">DNI</label>
                            <div className="flex gap-1.5">
                              <input type="text" maxLength={12} className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                                value={formData.dni} onChange={e => setFormData({...formData, dni: e.target.value})} />
                              <button type="button" onClick={() => setShowDniScan(true)} title="Escanear DNI con la cámara"
                                className="shrink-0 px-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20 transition-colors">
                                <ScanLine size={14} />
                              </button>
                            </div>
                          </div>
                          <div className="col-span-2">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Email Institucional</label>
                            <input type="email" className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                              value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                          </div>
                          <div className="col-span-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Telf. Fijo</label>
                            <input type="text" className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                              value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                          </div>
                          <div className="col-span-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase mb-0.5 block">Celular</label>
                            <input type="text" className="w-full bg-slate-900 border border-white/5 rounded-lg px-2 py-1.5 text-[10px] text-white"
                              value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} />
                          </div>
                        </div>
                      )}

                      {activeAction === 'reset_password' && (
                        <div>
                          <label className="form-label text-[8px]">Nueva Contraseña Temporal</label>
                          <input type="text" placeholder="Mínimo 8 caracteres..." className="form-input-base"
                            value={formData.newPassword} onChange={e => setFormData({...formData, newPassword: e.target.value})} />
                        </div>
                      )}

                      {activeAction && (
                        <div>
                          <label className="form-label text-[8px]">Justificación / Motivo del Cambio <span className="text-rose-500">*</span></label>
                          <textarea rows={2} className="form-textarea" placeholder="Escriba aquí la justificación obligatoria..."
                            value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} />
                        </div>
                      )}

                      {activeAction === 'change_profile' && (
                        <div>
                          <label className="form-label text-[8px]">Nuevo Perfil de Acceso</label>
                          <select className="form-select-base"
                            value={formData.newRole} onChange={e => setFormData({...formData, newRole: e.target.value})}>
                            {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                          </select>
                        </div>
                      )}

                      <div className="pt-2 border-t border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-black text-indigo-400 uppercase flex items-center gap-1">
                            <ShieldCheck size={10} /> Confirmación de Operador
                          </label>
                          <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/5 shadow-inner">
                            <button
                              type="button"
                              onClick={() => setFormData({...formData, securityMethod: 'password'})}
                              className={`px-3 py-1 text-[8px] font-black uppercase rounded ${formData.securityMethod === 'password' ? 'bg-indigo-600 shadow text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            >Clave</button>
                            <button
                              type="button"
                              onClick={() => setFormData({...formData, securityMethod: 'facial'})}
                              className={`px-3 py-1 text-[8px] font-black uppercase rounded ${formData.securityMethod === 'facial' ? 'bg-indigo-600 shadow text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            >Facial</button>
                          </div>
                        </div>

                       {formData.securityMethod === 'password' ? (
                          <input type="password" placeholder="Su contraseña de administrador..." className="form-input-base"
                            value={formData.securityPassword} onChange={e => setFormData({...formData, securityPassword: e.target.value})} />
                        ) : (
                          <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex flex-col items-center gap-2">
                             <ScanFace className="text-indigo-400" size={24} />
                             <p className="text-[8px] text-indigo-300 text-center uppercase font-black tracking-widest leading-tight">Confirmación Biométrica Requerida</p>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleApply}
                        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
                      >
                        {saving ? <RotateCcw size={12} className="animate-spin" /> : <Save size={12} />}
                        {saving ? 'Procesando...' : 'Confirmar Cambios'}
                      </button>

                      <IntegratedBiometricModal
                        isOpen={isBioModalOpen}
                        onClose={() => setIsBioModalOpen(false)}
                        onSuccess={(result) => {
                          setIsBioModalOpen(false);
                          executeMaintenanceAction({
                            securityMethod: 'facial',
                            securityFaceCode: 'VALIDAR'
                          });
                        }}
                        operatorUsername={session?.username}
                        company={company}
                      />
                      <DocumentScanCapture
                        isOpen={showDniScan}
                        onClose={() => setShowDniScan(false)}
                        onSuccess={(result: DniScanResult) => {
                          setShowDniScan(false);
                          setFormData(prev => ({
                            ...prev,
                            dni: result.dni || prev.dni,
                            firstName: result.first_name || prev.firstName,
                            lastName: result.last_name || prev.lastName,
                          }));
                        }}
                      />
                    </div>
                  )}

                  {statusMsg.text && (
                    <div className={`p-3 rounded-xl border flex items-center gap-3 animate-in fade-in zoom-in-95 ${
                      statusMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                      statusMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                      'bg-sky-500/10 border-sky-500/20 text-sky-400'
                    }`}>
                      {statusMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                      <span className="text-[10px] font-bold uppercase leading-tight">{statusMsg.text}</span>
                      <button className="ml-auto" onClick={() => setStatusMsg({type:'info', text:''})}><X size={12} /></button>
                    </div>
                  )}

                  <div className="pt-3 border-t border-white/5 mt-auto">
                    <h3 className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                      Auditoría TI Reciente
                      <span className="text-[7px] bg-slate-800 px-1 py-0.5 rounded text-slate-400">Ult. 5</span>
                    </h3>
                    <div className="space-y-1">
                       {auditRows.slice(0, 5).map(log => (
                         <div key={log.id} className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[8px]">
                            <div className="flex items-center justify-between">
                              <span className={`font-black uppercase tracking-tighter ${log.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {log.action} {log.success ? '· OK' : '· ERROR'}
                              </span>
                              <span className="text-slate-500 font-mono text-[7px]">{new Date(log.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-900/40">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 text-slate-600">
                  <UserCog size={32} />
                </div>
                <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">Panel de Gestión TI</h3>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">Seleccione un usuario de la lista para gestionar su perfil, estado de cuenta y seguridad en modo multi-tenant.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default memo(UserManagementView);
