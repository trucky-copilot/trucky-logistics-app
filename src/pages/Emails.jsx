import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, RotateCw, Plus, Search, Star, MessageSquare,
  Send, Sparkles, Inbox, Package, Building2,
  CheckCircle2, Clock, X, Loader2, ArrowUpRight, Copy, Check,
  ChevronRight, Lock, Bot, Paperclip
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useProfile } from '@/lib/ProfileContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { filterByOrg } from '@/lib/orgScope';
import { useToast } from '@/components/ui/use-toast';
import { useDemo } from '@/lib/DemoContext';
import { sendEmailWithAutoAuth, getStoredGoogleAuth, saveStoredGoogleAuth, requestGoogleToken } from '@/lib/googleAuthHelper';

const LOGISTICS_EMAIL_TERMS = [
  'trucky', 'load', 'loads', 'freight', 'freights', 'rate confirmation', 'bill of lading', 'bol',
  'flete', 'fletes', 'carga', 'cargas', 'reefer', 'dry van', 'flatbed', 'drayage', 'chassis',
  'detention', 'layover', 'tonu', 'lumper', 'carrier', 'broker', 'dispatcher', 'dispatch',
  'pickup', 'delivery', 'container', 'factoring', 'quickpay', 'camion', 'flota', 'tarifa de flete',
  'rfq', 'quote', 'quotes', 'rate request', 'rate inquiry', 'overweight', 'tri-axle', 'tri axle',
  'port', 'puerto', 'terminal', 'containers', '20ft', '40ft', '40hc', '45hc', '20dc', '40dc', 'soc',
  'shipment', 'shipments', 'rate', 'rates', 'tarifa', 'cotizacion'
];

export function normalizeSubjectForThread(subject = '') {
  return String(subject || '')
    .replace(/^(\s*(re|fwd|rv|fw)\s*:\s*)+/gi, '')
    .trim()
    .toLowerCase();
}

/**
 * Evalúa si el correo tiene etiqueta de Importante (Gmail IMPORTANT, etiqueta importante, o es_importante)
 * junto con contexto logístico (broker, carrier, trucky, carga, drayage, rate request, etc.).
 */
export function hasImportantAndLogisticsTags(email) {
  if (!email) return false;

  const rawLabels = [
    ...(Array.isArray(email.etiquetas) ? email.etiquetas : []),
    ...(Array.isArray(email.labelIds) ? email.labelIds : []),
    email.categoria || '',
  ].map(l => String(l).toLowerCase().trim());

  const subject = String(email.asunto || '').toLowerCase();

  // 1. Etiqueta de Importante:
  // Detecta etiqueta IMPORTANT de Gmail, etiqueta 'importante', o flags es_importante/destacado
  const isImportante =
    rawLabels.some(l => l === 'important' || l === 'importante' || l.includes('important') || l.includes('importante')) ||
    Boolean(email.es_importante) ||
    Boolean(email.destacado) ||
    /\b(importante|important|prioritario|urgente)\b/i.test(subject);

  // 2. Contexto o etiqueta logística (como todos los correos sincronizados ya pasan el filtro logístico):
  const hasLogisticsTag =
    Boolean(email.es_logistico) ||
    rawLabels.some(l =>
      ['broker', 'carrier', 'trucky', 'carga', 'cargas', 'flete', 'freight', 'dispatcher', 'dispatch', 'load'].some(k => l.includes(k))
    ) ||
    Boolean(email.categoria === 'brokers' || email.categoria === 'cargas') ||
    /\b(broker|carrier|trucky|carga|cargas|flete|fletes|dispatcher|rate|drayage|rfq|load|container|pickup|port)\b/i.test(
      `${subject} ${email.remitente_nombre || ''} ${email.snippet || ''}`
    );

  return Boolean(isImportante && hasLogisticsTag);
}

function hasLogisticsSignal(email) {
  if (email?.es_logistico === true || hasImportantAndLogisticsTags(email)) {
    return true;
  }
  const text = `${email.asunto || ''} ${email.snippet || ''} ${email.cuerpo || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return LOGISTICS_EMAIL_TERMS.some(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
  });
}

export default function Emails() {
  const { user } = useAuth();
  const orgId = useOrganizationId();
  const { activeProfileId } = useProfile();
  const { locale } = useLanguage();
  const { toast } = useToast();
  const { isDemoUser } = useDemo();
  const navigate = useNavigate();

  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  // ─── Estado de Conexión Google OAuth 2.0 ────────────────────────────────────
  const [googleConnectedEmail, setGoogleConnectedEmail] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const GOOGLE_CLIENT_ID = '940005071153-h3ec1g6i15qo8nkabvrlgijbsas8g9ks.apps.googleusercontent.com';

  useEffect(() => {
    if (activeProfileId) {
      const { token, email } = getStoredGoogleAuth(activeProfileId);
      setGoogleConnectedEmail(email || '');
      setOauthToken(token || '');
    }
  }, [activeProfileId]);

  // Modal de redacción / respuesta
  const [composeOpen, setComposeOpen] = useState(false);
  const [sendingCompose, setSendingCompose] = useState(false);
  const [composeForm, setComposeForm] = useState({
    to: '',
    subject: '',
    content: '',
    categoria: 'cargas',
    threadId: null,
    inReplyTo: null,
    references: null,
    etiquetas: null,
    es_importante: false,
  });

  const isEs = locale === 'es';

  // ─── Carga inicial de correos desde la base de datos por perfil y cuenta ───
  const fetchEmails = async (overrideAccount) => {
    try {
      setLoading(true);
      const all = await base44.entities.Email.filter({}, '-fecha', 350);
      const emailList = Array.isArray(all) ? all : [];
      // Filtrar por organización
      const scoped = emailList.filter(e => !orgId || !e.organization_id || e.organization_id === orgId);
      // Filtrar estrictamente por el perfil activo para que cada perfil tenga sus propios correos
      const profileScoped = activeProfileId
        ? scoped.filter(e => !e.profile_id || String(e.profile_id) === String(activeProfileId))
        : scoped;

      const activeGoogleAcc = (overrideAccount !== undefined ? overrideAccount : (googleConnectedEmail || '')).toLowerCase().trim();

      // Filtrar correos no deseados de Google/sistema y correos no logísticos
      const cleanList = profileScoped.filter(e => {
        if (hasImportantAndLogisticsTags(e)) {
          return true;
        }

        const sender = (e.remitente_email || '').toLowerCase();
        const subject = (e.asunto || '').toLowerCase();
        const senderIsNonLogistics = [
          'google.com', 'accounts.google', 'openai.com', 'linkedin.com', 'github.com',
          'amazon.com', 'uber.com', 'microsoft.com', 'temu.com', 'x.ai',
        ].some(domain => sender.includes(domain));

        if (e.es_logistico === false || senderIsNonLogistics || !hasLogisticsSignal(e)) {
          return false;
        }

        if (activeGoogleAcc && e.google_account) {
          if (e.google_account.toLowerCase().trim() !== activeGoogleAcc) {
            return false;
          }
        }

        if (
          subject.includes('alerta de seguridad') ||
          subject.includes('security alert') ||
          subject.includes('recuperado correctamente') ||
          subject.includes('código de verificación') ||
          subject.includes('verification code') ||
          subject.includes('política de privacidad') ||
          subject.includes('privacy policy')
        ) {
          return false;
        }

        return true;
      });

      // Ordenar siempre del más reciente al más antiguo
      cleanList.sort((a, b) => new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime());

      if (isDemoUser) {
        const sampleEmails = [
          {
            id: 'demo-1',
            thread_id: 'thread-demo-1',
            remitente_nombre: 'Miami Cargo Express',
            remitente_email: 'dispatch@miamicargo.com',
            destinatario_email: 'operations@trucky.site',
            asunto: 'Pickup Confirmation – 04/14/2026',
            fecha: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
            categoria: 'cargas',
            etiquetas: ['IMPORTANT', 'carrier', 'trucky'],
            es_importante: true,
            tipo_flujo: 'inbox',
            leido: false,
            destacado: true,
            snippet: 'Please confirm the pickup for 1 container in Miami Yard...',
            cuerpo: `Hi team,\n\nPlease confirm the pickup for 1 container in Miami Yard scheduled for 04/14/2026 at 09:00 AM.\n\nDetails:\n- Equipment: 1 container (40ft High Cube)\n- Commodity: Electronics\n- Weight: 38,500 lbs\n- Rate: $1,450.00 Flat\n\nPlease let us know driver info as soon as assigned.\n\nBest regards,\nMiami Cargo Express Team`,
          },
          {
            id: 'demo-2',
            thread_id: 'thread-demo-2',
            remitente_nombre: 'DHL Logistics',
            remitente_email: 'freight-quote@dhl.com',
            destinatario_email: 'operations@trucky.site',
            asunto: 'Rate request – 20ft container PortMiami to Orlando',
            fecha: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
            categoria: 'cargas',
            etiquetas: ['carrier', 'cargas'],
            es_importante: false,
            tipo_flujo: 'inbox',
            leido: false,
            destacado: false,
            snippet: 'Hi, can you provide your best rate for 20ft container...',
            cuerpo: `Hi dispatch team,\n\nCan you provide your best rate and availability for a 20ft container moving from PortMiami to Orlando, FL on Friday?\n\n- Pickup: PortMiami (G-Gate)\n- Delivery: Orlando Distribution Center\n- Chassis: Tri-axle required\n\nThanks,\nDHL Freight Logistics`,
          },
          {
            id: 'demo-3',
            thread_id: 'thread-demo-3',
            remitente_nombre: 'Port of Miami',
            remitente_email: 'terminal-updates@portmiami.gov',
            destinatario_email: 'operations@trucky.site',
            asunto: 'Terminal update – Extended gate hours next week',
            fecha: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
            categoria: 'brokers',
            etiquetas: ['broker'],
            es_importante: false,
            tipo_flujo: 'inbox',
            leido: true,
            destacado: false,
            snippet: 'Important information regarding terminal gate hours...',
            cuerpo: `Attention All Port Users & Carriers:\n\nPlease be advised that terminal gates will operate with extended hours starting next Monday 06:00 AM to 18:00 PM to accommodate increased container traffic.\n\nPlease ensure your drivers have valid TWIC badges and pre-registered appointments.\n\nOperations Department\nPort of Miami`,
          },
          {
            id: 'demo-4',
            thread_id: 'thread-demo-4',
            remitente_nombre: 'Seaboard Marine',
            remitente_email: 'docs@seaboardmarine.com',
            destinatario_email: 'operations@trucky.site',
            asunto: 'Shipping documents & Delivery Order #90214',
            fecha: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
            categoria: 'brokers',
            etiquetas: ['IMPORTANT', 'broker'],
            es_importante: true,
            tipo_flujo: 'inbox',
            leido: true,
            destacado: true,
            snippet: 'Attached you will find the BOL and customs release...',
            cuerpo: `Hello,\n\nPlease find attached the Bill of Lading (BOL) and delivery release order for shipment #90214.\n\nConsignee: Global Freight Hub LLC\nCustoms Status: Cleared / Released\nDemurrage free time expires: 04/18/2026\n\nKind regards,\nSeaboard Documentation Desk`,
          },
          {
            id: 'demo-5',
            thread_id: 'thread-demo-5',
            remitente_nombre: 'Customer USA',
            remitente_email: 'loads@customerusa.com',
            destinatario_email: 'operations@trucky.site',
            asunto: 'New load opportunity – 3 loads per week contract',
            fecha: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
            categoria: 'cargas',
            etiquetas: ['cargas', 'trucky'],
            es_importante: false,
            tipo_flujo: 'inbox',
            leido: true,
            destacado: false,
            snippet: 'We have an upcoming weekly contracted lane ready for dispatch...',
            cuerpo: `Good afternoon,\n\nWe have an upcoming contract lane with 3 loads per week (Dry Van / Reefer) between Jacksonville and Atlanta.\n\nConsistent freight, Net 15 payment terms, fuel surcharge included.\n\nLet us know if you have dedicated capacity to take on this volume.\n\nBest,\nCustomer USA Supply Chain`,
          },
        ];

        setEmails(sampleEmails);
        setSelectedEmail(sampleEmails[0]);
        return;
      }

      setEmails(cleanList);
      if (cleanList.length > 0) {
        setSelectedEmail(prev => {
          if (prev) {
            const matchById = cleanList.find(p => p.id === prev.id);
            if (matchById) return matchById;
          }
          return cleanList[0];
        });
      } else {
        setSelectedEmail(null);
      }
    } catch (err) {
      console.error('Error al cargar correos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, [orgId, activeProfileId, googleConnectedEmail, isDemoUser]);

  // Iniciar popup oficial de Google OAuth 2.0
  const handleConnectGoogle = (promptMode = 'select_account') => {
    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) {
      toast({
        title: isEs ? 'Cargando Google...' : 'Loading Google...',
        description: isEs ? 'El servicio de Google se está cargando. Intenta en 3 segundos.' : 'Google service is initializing, retry in 3 seconds.',
      });
      return;
    }

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse) => {
          if (tokenResponse?.error) {
            console.error('[Google OAuth error]:', tokenResponse);
            return;
          }

          if (tokenResponse?.access_token) {
            const token = tokenResponse.access_token;
            setOauthToken(token);

            try {
              const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              const info = await infoRes.json();
              const connectedEmail = info.email || googleConnectedEmail || 'Google Account';
              setGoogleConnectedEmail(connectedEmail);
              saveStoredGoogleAuth(token, connectedEmail, activeProfileId);

              toast({
                title: isEs ? 'Cuenta de Google Conectada' : 'Google Account Connected',
                description: isEs ? `Conectado como ${connectedEmail}. Sincronizando...` : `Connected as ${connectedEmail}. Syncing...`,
              });

              triggerSync(token, connectedEmail);
            } catch (_) {
              setGoogleConnectedEmail('Cuenta Conectada');
              saveStoredGoogleAuth(token, googleConnectedEmail, activeProfileId);
              triggerSync(token, googleConnectedEmail);
            }
          }
        },
      });

      client.requestAccessToken({ prompt: promptMode });
    } catch (err) {
      console.error('Error al iniciar Google OAuth:', err);
      toast({
        title: isEs ? 'Error al abrir Google' : 'Failed to launch Google',
        description: err.message || 'Verifica que las ventanas emergentes estén permitidas.',
        variant: 'destructive',
      });
    }
  };

  const clearExpiredToken = () => {
    setOauthToken('');
    if (activeProfileId) {
      localStorage.removeItem(`trucky_oauth_token_${activeProfileId}`);
    }
  };

  const triggerSync = async (currentToken, currentEmail) => {
    const token = currentToken || oauthToken;
    const emailToSync = currentEmail || googleConnectedEmail;

    if (!token) {
      handleConnectGoogle('select_account');
      return;
    }

    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncGmail', {
        accessToken: token,
        gmailUser: emailToSync,
        organization_id: orgId,
        profile_id: activeProfileId,
        user_id: user?.id || null,
        limit: 80,
      });

      const data = res?.data || {};
      if (data.error) {
        const errorText = String(data.error).toLowerCase();
        const diagnostics = data.diagnostics;
        const diagnosticText = diagnostics
          ? ` Gmail: ${diagnostics.mensajesDevueltosPorGmail} mensajes recibidos, ${diagnostics.detallesCargados} revisados, ${diagnostics.coincidenciasTrucky} con “Trucky”, ${diagnostics.duplicados} ya existentes.`
          : '';
        if (
          errorText.includes('autenticación') ||
          errorText.includes('401') ||
          errorText.includes('invalid authentication credentials') ||
          errorText.includes('expected oauth 2 access token')
        ) {
          clearExpiredToken();
          toast({
            title: isEs ? 'Sesión de Google caducada' : 'Google session expired',
            description: isEs ? 'Renovando credenciales con Google...' : 'Refreshing Google credentials...',
          });
          handleConnectGoogle('select_account');
          return;
        }

        toast({
          title: isEs ? 'Error de sincronización' : 'Sync Error',
          description: `${data.error}${diagnosticText}`,
          variant: 'destructive',
        });
      } else {
        const nuevos = data.nuevosGuardados || 0;
        const omitidos = data.omitidosNoLogisticos || 0;
        const diagnostics = data.diagnostics;
        const diagnosticText = diagnostics
          ? isEs
            ? ` Gmail: ${diagnostics.mensajesDevueltosPorGmail} recibidos, ${diagnostics.reparados || 0} existentes actualizados.`
            : ` Gmail: ${diagnostics.mensajesDevueltosPorGmail} received, ${diagnostics.reparados || 0} existing emails refreshed.`
          : '';
        toast({
          title: isEs ? 'Sincronización completada' : 'Sync Completed',
          description: isEs
            ? `${nuevos} correos logísticos importados (${omitidos} personales/spam filtrados).${diagnosticText}`
            : `${nuevos} freight emails imported (${omitidos} non-logistics filtered).${diagnosticText}`,
        });
        
        await fetchEmails(emailToSync);
      }
    } catch (err) {
      const serverMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Error de conexión';
      const msgLower = String(serverMsg).toLowerCase();
      if (
        msgLower.includes('autenticación') ||
        msgLower.includes('401') ||
        msgLower.includes('invalid authentication credentials') ||
        msgLower.includes('expected oauth 2 access token')
      ) {
        clearExpiredToken();
        toast({
          title: isEs ? 'Sesión de Google caducada' : 'Google session expired',
          description: isEs ? 'Renovando credenciales con Google...' : 'Refreshing Google credentials...',
        });
        handleConnectGoogle('select_account');
        return;
      }

      toast({
        title: isEs ? 'Error en sincronización' : 'Sync failed',
        description: serverMsg,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncGmail = () => {
    if (isDemoUser) {
      toast({
        title: isEs ? 'Modo Demostración' : 'Demo Mode',
        description: isEs
          ? 'La sincronización con Gmail no está disponible en la versión demo. Activa la versión completa para conectar tu cuenta.'
          : 'Gmail synchronization is not available in demo mode. Activate full version to connect your account.',
      });
      return;
    }
    handleConnectGoogle('select_account');
  };

  // ─── Actualizar correos recientes (renueva token automáticamente si expiró) ──
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshInbox = async () => {
    setRefreshing(true);
    try {
      let { token, email } = getStoredGoogleAuth(activeProfileId);
      const effectiveEmail = email || googleConnectedEmail;

      if (!isDemoUser) {
        // Si no hay token, solicitarlo de forma silenciosa/transparente
        if (!token) {
          try {
            const fresh = await requestGoogleToken('');
            token = fresh.token;
            if (fresh.email) {
              setGoogleConnectedEmail(fresh.email);
            }
            saveStoredGoogleAuth(token, fresh.email || effectiveEmail, activeProfileId);
          } catch (_) {
            // Si requiere selección explícita de cuenta
            handleConnectGoogle('select_account');
            return;
          }
        }

        if (token) {
          let syncRes = await base44.functions.invoke('syncGmail', {
            accessToken: token,
            gmailUser: effectiveEmail,
            organization_id: orgId,
            profile_id: activeProfileId,
            user_id: user?.id || null,
            limit: 80,
          }).catch(err => ({ data: { error: err?.message || '401' } }));

          // Si el token expiró (después de 1 hora), renovarlo automáticamente y reintentar
          if (syncRes?.data?.error && /401|autenticaci|credentials|expired|token/i.test(String(syncRes.data.error))) {
            try {
              const fresh = await requestGoogleToken('');
              token = fresh.token;
              setOauthToken(token);
              saveStoredGoogleAuth(token, fresh.email || effectiveEmail, activeProfileId);
              syncRes = await base44.functions.invoke('syncGmail', {
                accessToken: token,
                gmailUser: fresh.email || effectiveEmail,
                organization_id: orgId,
                profile_id: activeProfileId,
                user_id: user?.id || null,
                limit: 80,
              });
            } catch (_) {
              clearExpiredToken();
              handleConnectGoogle('select_account');
              return;
            }
          }
        }
      }

      await fetchEmails(effectiveEmail);
      toast({
        title: isEs ? 'Bandeja actualizada' : 'Inbox refreshed',
        description: isEs ? 'Se han cargado los correos e hilos más recientes de hoy.' : 'Latest emails and threads from today loaded.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Agrupación de correos en Hilos (Threads) estilo Gmail ──────────────────
  const emailThreads = useMemo(() => {
    const groups = new Map();

    // Ordenar cronológicamente ascendente para armar cada hilo desde el primer correo hasta el último
    const chronological = [...emails].sort(
      (a, b) => new Date(a.fecha || 0).getTime() - new Date(b.fecha || 0).getTime()
    );

    for (const email of chronological) {
      const normSubj = normalizeSubjectForThread(email.asunto);
      // Agrupar por thread_id de Gmail o por asunto normalizado si pertenecen a la misma conversación
      const key = email.thread_id || (normSubj ? `subj__${normSubj}` : `id__${email.id}`);

      if (!groups.has(key)) {
        groups.set(key, {
          threadKey: key,
          threadId: email.thread_id || null,
          messages: [],
        });
      }
      const g = groups.get(key);
      if (email.thread_id && !g.threadId) {
        g.threadId = email.thread_id;
      }
      g.messages.push(email);
    }

    const threadList = [];
    for (const [, group] of groups.entries()) {
      const msgs = group.messages;
      const latestMsg = msgs[msgs.length - 1];
      const hasUnread = msgs.some(m => !m.leido && m.tipo_flujo !== 'sent');
      const isStarred = msgs.some(m => m.destacado);
      const isImportant = msgs.some(m => hasImportantAndLogisticsTags(m));
      const hasSent = msgs.some(m => m.tipo_flujo === 'sent');
      const hasInbox = msgs.some(m => m.tipo_flujo !== 'sent');

      // Participantes únicos del hilo (estilo Gmail: "Vince, yo 2")
      const participants = [];
      for (const m of msgs) {
        const name = m.tipo_flujo === 'sent'
          ? (isEs ? 'yo' : 'me')
          : (m.remitente_nombre || m.remitente_email || '').split(' ')[0];
        if (name && !participants.includes(name)) {
          participants.push(name);
        }
      }

      threadList.push({
        ...latestMsg,
        threadKey: group.threadKey,
        thread_id: group.threadId || latestMsg.thread_id || null,
        threadMessages: msgs,
        threadCount: msgs.length,
        participantsLabel: participants.join(', ') || latestMsg.remitente_nombre || latestMsg.remitente_email,
        leido: !hasUnread,
        destacado: isStarred,
        hasImportantThread: isImportant,
        hasSentInThread: hasSent,
        hasInboxInThread: hasInbox,
      });
    }

    // Ordenar hilos por la fecha del último mensaje (más reciente primero)
    threadList.sort((a, b) => new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime());
    return threadList;
  }, [emails, isEs]);

  // Obtener el hilo completo seleccionado actualmente
  const selectedThread = useMemo(() => {
    if (!selectedEmail) return null;
    const found = emailThreads.find(
      t =>
        t.id === selectedEmail.id ||
        (selectedEmail.thread_id && t.thread_id === selectedEmail.thread_id) ||
        t.threadMessages.some(m => m.id === selectedEmail.id)
    );
    return found || {
      ...selectedEmail,
      threadKey: selectedEmail.thread_id || selectedEmail.id,
      threadMessages: [selectedEmail],
      threadCount: 1,
    };
  }, [selectedEmail, emailThreads]);

  // ─── Marcar / Desmarcar como favorito ────────────────────────────────────────
  const handleToggleStar = async (email, e) => {
    e.stopPropagation();
    const nextState = !email.destacado;
    setEmails(prev => prev.map(item => item.id === email.id ? { ...item, destacado: nextState } : item));
    if (selectedEmail?.id === email.id) {
      setSelectedEmail(prev => ({ ...prev, destacado: nextState }));
    }
    try {
      await base44.entities.Email.update(email.id, { destacado: nextState });
    } catch (err) {
      console.error('Error al actualizar favorito:', err);
    }
  };

  // ─── Seleccionar hilo de correo y marcar sus mensajes como leídos ────────────
  const handleSelectEmail = async (threadItem) => {
    setSelectedEmail(threadItem);
    const msgsToMark = (threadItem.threadMessages || [threadItem]).filter(m => !m.leido);
    if (msgsToMark.length > 0) {
      const idsToMark = new Set(msgsToMark.map(m => m.id));
      setEmails(prev => prev.map(item => idsToMark.has(item.id) ? { ...item, leido: true } : item));
      for (const m of msgsToMark) {
        try {
          await base44.entities.Email.update(m.id, { leido: true });
        } catch (err) {
          console.error('Error al marcar leído:', err);
        }
      }
    }
  };

  // ─── Abrir respuesta sobre el ÚLTIMO correo del hilo ─────────────────────────
  const handleReply = (threadOrEmail) => {
    const msgs = threadOrEmail?.threadMessages || [threadOrEmail];
    const lastMessage = msgs[msgs.length - 1] || threadOrEmail;
    if (!lastMessage) return;

    // Si el último mensaje del hilo fue enviado por nosotros mismos, responder al destinatario de ese correo
    // o al último remitente externo del hilo para no respondernos a nuestra propia dirección
    const myEmail = (googleConnectedEmail || user?.email || '').toLowerCase().trim();
    let replyToAddress = lastMessage.remitente_email;
    if (lastMessage.tipo_flujo === 'sent' || (myEmail && replyToAddress?.toLowerCase().trim() === myEmail)) {
      const lastExternal = [...msgs].reverse().find(
        m => m.tipo_flujo !== 'sent' && m.remitente_email?.toLowerCase().trim() !== myEmail
      );
      replyToAddress = lastExternal ? lastExternal.remitente_email : lastMessage.destinatario_email;
    }

    const baseSubj = lastMessage.asunto || '';
    const replySubject = /^re:/i.test(baseSubj) ? baseSubj : `Re: ${baseSubj}`;
    const rfcId = lastMessage.rfc_message_id || null;

    setComposeForm({
      to: replyToAddress || '',
      subject: replySubject,
      content: `\n\n---\nOn ${new Date(lastMessage.fecha).toLocaleString()}, ${lastMessage.remitente_nombre || lastMessage.remitente_email} wrote:\n> ${(lastMessage.cuerpo || lastMessage.snippet || '').replace(/\n/g, '\n> ')}`,
      categoria: lastMessage.categoria || 'cargas',
      threadId: lastMessage.thread_id || threadOrEmail?.thread_id || null,
      inReplyTo: rfcId,
      references: rfcId,
      etiquetas: Array.from(new Set([...(Array.isArray(lastMessage.etiquetas) ? lastMessage.etiquetas : []), 'INBOX', 'SENT'])),
      es_importante: Boolean(lastMessage.es_importante || hasImportantAndLogisticsTags(lastMessage)),
    });
    setComposeOpen(true);
  };

  // ─── Copiar contenido al portapapeles ────────────────────────────────────────
  const handleCopyBody = () => {
    if (!selectedThread) return;
    const msgs = selectedThread.threadMessages || [selectedThread];
    const lastMsg = msgs[msgs.length - 1];
    navigator.clipboard.writeText(lastMsg.cuerpo || lastMsg.snippet || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Enviar correo / respuesta desde el modal (se agrega al hilo en Trucky y Gmail) ──
  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!composeForm.to || !composeForm.subject || !composeForm.content) return;

    setSendingCompose(true);
    try {
      const res = await sendEmailWithAutoAuth({
        to: composeForm.to,
        subject: composeForm.subject,
        content: composeForm.content,
        categoria: composeForm.categoria,
        organization_id: orgId,
        profile_id: activeProfileId,
        remitente_nombre: user?.full_name || 'Trucky User',
        threadId: composeForm.threadId || null,
        inReplyTo: composeForm.inReplyTo || null,
        references: composeForm.references || null,
        etiquetas: composeForm.etiquetas || ['INBOX', 'SENT', composeForm.categoria || 'cargas'],
        es_importante: composeForm.es_importante || false,
      });

      if (res?.data?.error) {
        toast({
          title: isEs ? 'Error al enviar' : 'Send error',
          description: res.data.error,
          variant: 'destructive',
        });
      } else {
        const createdEmail = res?.data?.email;
        toast({
          title: isEs ? 'Correo enviado con éxito' : 'Email sent successfully',
          description: isEs
            ? `Respuesta enviada a ${composeForm.to} y agregada al hilo en Trucky y Gmail.`
            : `Reply sent to ${composeForm.to} and added to thread in Trucky and Gmail.`,
        });
        setComposeOpen(false);
        setComposeForm({
          to: '',
          subject: '',
          content: '',
          categoria: 'cargas',
          threadId: null,
          inReplyTo: null,
          references: null,
          etiquetas: null,
          es_importante: false,
        });

        // Insertar inmediatamente en el estado local para que se vea al instante en el hilo y en la bandeja
        if (createdEmail) {
          setEmails(prev => [createdEmail, ...prev]);
          setSelectedEmail(createdEmail);
        }
        await fetchEmails();
      }
    } catch (err) {
      toast({
        title: isEs ? 'Fallo en el despacho' : 'Dispatch failed',
        description: err.message || 'Error al conectar con el servicio de correo.',
        variant: 'destructive',
      });
    } finally {
      setSendingCompose(false);
    }
  };

  // ─── Filtros y búsqueda sobre los Hilos (Threads) ───────────────────────────
  const isConversationReplyThread = (thread) => {
    if (!thread) return false;
    return (
      thread.threadCount > 1 ||
      Boolean(thread.hasSentInThread && thread.hasInboxInThread) ||
      (thread.threadMessages || []).some(m => /^\s*(re|rv)\s*:/i.test(String(m.asunto || '')))
    );
  };

  const filteredThreads = useMemo(() => {
    return emailThreads.filter(thread => {
      const hasImportant = thread.hasImportantThread || hasImportantAndLogisticsTags(thread);

      if (activeTab === 'important_logistics') {
        if (!hasImportant) return false;
      }
      if (activeTab === 'unread' && thread.leido) return false;
      if (activeTab === 'starred' && !thread.destacado && !thread.es_importante) return false;
      if (activeTab === 'replies') {
        if (!isConversationReplyThread(thread)) return false;
      }
      if (activeTab === 'sent' && !thread.hasSentInThread) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return thread.threadMessages.some(item => {
          const matchesSender = item.remitente_nombre?.toLowerCase().includes(q) || item.remitente_email?.toLowerCase().includes(q);
          const matchesSubject = item.asunto?.toLowerCase().includes(q);
          const matchesBody = item.cuerpo?.toLowerCase().includes(q);
          const matchesTags = Array.isArray(item.etiquetas) && item.etiquetas.some(t => t.toLowerCase().includes(q));
          return matchesSender || matchesSubject || matchesBody || matchesTags;
        });
      }
      return true;
    });
  }, [emailThreads, activeTab, searchQuery]);

  const importantLogisticsCount = useMemo(
    () => emailThreads.filter(t => t.hasImportantThread || hasImportantAndLogisticsTags(t)).length,
    [emailThreads]
  );
  const unreadCount = useMemo(() => emailThreads.filter(t => !t.leido).length, [emailThreads]);
  const allCount = emailThreads.length;
  const starredCount = useMemo(() => emailThreads.filter(t => t.destacado || t.es_importante).length, [emailThreads]);
  const repliesCount = useMemo(
    () => emailThreads.filter(t => isConversationReplyThread(t)).length,
    [emailThreads]
  );
  const sentCount = useMemo(() => emailThreads.filter(t => t.hasSentInThread).length, [emailThreads]);

  const TABS = [
    { id: 'all', label: isEs ? 'Todos' : 'All', icon: Inbox, badge: allCount },
    { id: 'important_logistics', label: isEs ? 'Importantes' : 'Important', icon: Sparkles, badge: importantLogisticsCount },
    { id: 'unread', label: isEs ? 'No leídos' : 'Unread', icon: CheckCircle2, badge: unreadCount },
    { id: 'starred', label: isEs ? 'Destacados' : 'Starred', icon: Star, badge: starredCount },
    { id: 'replies', label: isEs ? 'Respuestas' : 'Replies', icon: MessageSquare, badge: repliesCount },
    { id: 'sent', label: isEs ? 'Enviados' : 'Sent', icon: Send, badge: sentCount },
  ];

  const getCategoryBadge = (cat) => {
    switch (cat) {
      case 'brokers':
        return { label: isEs ? 'Broker' : 'Broker', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'cargas':
        return { label: isEs ? 'Carga' : 'Load', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      default:
        return { label: isEs ? 'Broker' : 'Broker', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
    }
  };

  // Formatear fecha/hora amigable en la lista (si es hoy muestra hora, si es de otro día muestra fecha corta + hora)
  const formatEmailListDate = (isoDate) => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-[1600px] mx-auto p-4 md:p-6 space-y-4">
      {/* ─── Encabezado Principal ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Mail className="w-5 h-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
              {isEs ? 'Bandeja de Correos' : 'Logistics Mailbox'}
            </h1>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/30">
                {unreadCount} {isEs ? 'nuevos' : 'new'}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
            <span>
              {isEs
                ? 'Conectado a Gmail · Filtro inteligente anti-ruido activado'
                : 'Connected to Gmail · Smart logistics filter active'}
            </span>
            {googleConnectedEmail && (
              <span className="px-2 py-0.5 rounded-md bg-muted text-[11px] font-medium text-foreground border border-border">
                {googleConnectedEmail}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button
            onClick={handleRefreshInbox}
            disabled={refreshing || loading}
            className="flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-card border border-border text-foreground hover:bg-muted/80 transition-colors whitespace-nowrap disabled:opacity-50"
            title={isEs ? 'Actualizar para ver correos recientes de hoy' : 'Refresh to view today’s recent emails'}
          >
            <RotateCw className={`w-3.5 h-3.5 text-primary ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? (isEs ? 'Actualizando...' : 'Refreshing...') : (isEs ? 'Actualizar' : 'Refresh')}</span>
          </button>

          <button
            onClick={handleSyncGmail}
            disabled={syncing || isDemoUser}
            className={`flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-card border border-border text-foreground transition-colors whitespace-nowrap ${
              isDemoUser ? 'opacity-40 cursor-not-allowed hover:bg-card' : 'hover:bg-muted/80 disabled:opacity-50'
            }`}
            title={
              isDemoUser
                ? (isEs ? 'Sincronización deshabilitada en la versión Demo' : 'Sync disabled in Demo version')
                : (isEs ? 'Sincronizar correos de tu cuenta de Google' : 'Sync emails from your Google account')
            }
          >
            <RotateCw className={`w-3.5 h-3.5 text-primary ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? (isEs ? 'Sincronizando...' : 'Syncing...') : (isEs ? 'Sincronizar' : 'Sync')}</span>
          </button>

          <button
            onClick={() => {
              setComposeForm({
                to: '',
                subject: '',
                content: '',
                categoria: 'cargas',
                threadId: null,
                inReplyTo: null,
                references: null,
                etiquetas: null,
                es_importante: false,
              });
              setComposeOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>{isEs ? 'Redactar' : 'Compose'}</span>
          </button>
        </div>
      </div>

      {/* ─── Barra de Filtros y Búsqueda ───────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Píldoras de Filtro */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'bg-card border border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.badge > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    active ? 'bg-black/20 text-white' : 'bg-primary/20 text-primary font-bold'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Buscador */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isEs ? 'Buscar por broker, flete, asunto...' : 'Search broker, freight, subject...'}
            className="w-full bg-card border border-border/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ─── Panel Master-Detail (Feed de Hilos + Lector de Conversación) ─────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Columna Izquierda: Lista de Hilos de Correo (5 columnas) */}
        <div className="lg:col-span-5 flex flex-col bg-card/60 border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 bg-card flex items-center justify-between text-xs text-muted-foreground">
            <span>{filteredThreads.length} {isEs ? 'conversaciones' : 'threads'}</span>
            <span className="text-[11px] opacity-70">
              {activeTab === 'all' ? (isEs ? 'Bandeja principal' : 'Main inbox') : ''}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs">{isEs ? 'Cargando correos...' : 'Loading emails...'}</span>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 p-6 text-center text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                  <Inbox className="w-6 h-6 opacity-40" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {isEs ? 'No hay correos en esta vista' : 'No emails in this view'}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                  {isEs
                    ? 'Haz clic en "Actualizar" o "Sincronizar" para verificar nuevos mensajes o redacta un correo nuevo.'
                    : 'Click "Refresh" or "Sync" to check for new messages or compose a new email.'}
                </p>
                {activeTab !== 'all' && (
                  <button
                    onClick={() => setActiveTab('all')}
                    className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 transition-all"
                  >
                    {isEs ? `Ver todos los correos (${allCount})` : `View all emails (${allCount})`}
                  </button>
                )}
              </div>
            ) : (
              filteredThreads.map(item => {
                const isSelected = selectedThread?.threadKey === item.threadKey;
                const badge = getCategoryBadge(item.categoria);
                const initials = (item.remitente_nombre || 'TL')
                  .split(' ')
                  .map(w => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();

                const timeStr = formatEmailListDate(item.fecha);

                return (
                  <div
                    key={item.threadKey || item.id}
                    onClick={() => handleSelectEmail(item)}
                    className={`p-3.5 transition-colors cursor-pointer relative group ${
                      isSelected
                        ? 'bg-primary/10 border-l-4 border-l-primary'
                        : 'hover:bg-muted/40 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-border flex items-center justify-center font-bold text-xs text-zinc-300 flex-shrink-0">
                        {initials}
                      </div>

                      {/* Info Central */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className={`text-xs truncate ${!item.leido ? 'font-black text-foreground' : 'font-medium text-zinc-300'}`}>
                              {item.threadCount > 1 ? item.participantsLabel : (item.remitente_nombre || item.remitente_email)}
                            </span>
                            {item.threadCount > 1 && (
                              <span className="px-1.5 py-0.2 rounded-md bg-primary/20 text-primary border border-primary/30 text-[10px] font-bold flex-shrink-0">
                                {item.threadCount}
                              </span>
                            )}
                            {!item.leido && (
                              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title={isEs ? 'No leído' : 'Unread'} />
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground flex-shrink-0">
                            {timeStr}
                          </span>
                        </div>

                        <p className={`text-xs mt-0.5 truncate ${!item.leido ? 'font-bold text-foreground' : 'text-zinc-200'}`}>
                          {item.asunto || '(Sin asunto)'}
                        </p>

                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 leading-relaxed">
                          {item.snippet || item.cuerpo}
                        </p>

                        {/* Badges y Estrella */}
                        <div className="flex items-center justify-between mt-2 pt-1 gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${badge.color}`}>
                              {badge.label}
                            </span>
                            {(item.hasImportantThread || hasImportantAndLogisticsTags(item)) && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-red-400" />
                                {isEs ? 'Importante' : 'Important'}
                              </span>
                            )}
                            {item.hasSentInThread && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-primary/10 text-primary border-primary/30">
                                {isEs ? 'Respondido' : 'Replied'}
                              </span>
                            )}
                          </div>

                          <button
                            onClick={(e) => handleToggleStar(item, e)}
                            className="p-1 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-amber-400 transition-colors"
                          >
                            <Star className={`w-3.5 h-3.5 ${item.destacado ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Columna Derecha: Lector de Hilo de Correo (7 columnas) */}
        <div className="lg:col-span-7 flex flex-col bg-card/60 border border-border rounded-2xl overflow-hidden">
          {selectedThread ? (
            <div className="flex flex-col h-full">
              {/* Header del Hilo */}
              <div className="p-4 md:p-5 border-b border-border/60 bg-card space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${getCategoryBadge(selectedThread.categoria).color}`}>
                        {getCategoryBadge(selectedThread.categoria).label}
                      </span>

                      {(selectedThread.hasImportantThread || hasImportantAndLogisticsTags(selectedThread)) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-1 shadow-sm">
                          <Sparkles className="w-3 h-3 text-red-400" />
                          {isEs ? 'Importante' : 'Important'}
                        </span>
                      )}

                      {selectedThread.threadCount > 1 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border bg-primary/15 text-primary border-primary/30 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {selectedThread.threadCount} {isEs ? 'mensajes en el hilo' : 'messages in thread'}
                        </span>
                      )}

                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(selectedThread.fecha).toLocaleString()}
                      </span>
                    </div>

                    <h2 className="text-base md:text-lg font-bold text-foreground tracking-tight leading-snug">
                      {selectedThread.asunto}
                    </h2>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleToggleStar(selectedThread, e)}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-amber-400 transition-colors"
                      title={isEs ? 'Destacar' : 'Star'}
                    >
                      <Star className={`w-4 h-4 ${selectedThread.destacado ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                    <button
                      onClick={handleCopyBody}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={isEs ? 'Copiar texto del último correo' : 'Copy latest email text'}
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Botonera de Acción Destacada */}
                <div className="flex items-center gap-2 pt-2 flex-wrap">
                  {/* Botón Amarillo: Analizar en Chat de Mercado (Deshabilitado) */}
                  <button
                    disabled={true}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 transition-all opacity-40 cursor-not-allowed select-none shadow-none"
                    title={isEs ? 'Función disponible en el Plan $99 / Flota' : 'Feature available on $99 / Fleet Plan'}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-zinc-950" />
                    <span>{isEs ? 'Analizar en Chat de Mercado' : 'Analyze in Market Chat'}</span>
                    <ArrowUpRight className="w-3 h-3 ml-0.5" />
                  </button>

                  <button
                    onClick={() => handleReply(selectedThread)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-primary" />
                    <span>
                      {isEs
                        ? (selectedThread.threadCount > 1 ? 'Responder al último correo' : 'Responder')
                        : (selectedThread.threadCount > 1 ? 'Reply to latest email' : 'Reply')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Historial de Mensajes del Hilo */}
              <div className="flex-1 p-4 md:p-5 overflow-y-auto bg-card/20 space-y-4">
                {(selectedThread.threadMessages || [selectedThread]).map((msg, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const isSentByMe = msg.tipo_flujo === 'sent';
                  const msgInitials = (msg.remitente_nombre || 'TL').slice(0, 2).toUpperCase();

                  return (
                    <div
                      key={msg.id || idx}
                      className={`rounded-2xl border p-4 transition-all ${
                        isLast
                          ? 'bg-card/90 border-primary/40 shadow-md'
                          : 'bg-card/40 border-border/60 opacity-90'
                      }`}
                    >
                      {/* Encabezado de cada mensaje individual en el hilo */}
                      <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-border/40 text-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-xl border flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                            isSentByMe
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : 'bg-primary/15 border-primary/30 text-primary'
                          }`}>
                            {msgInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-foreground truncate">
                                {msg.remitente_nombre || msg.remitente_email}
                              </span>
                              <span className="text-muted-foreground font-normal text-[11px] truncate">
                                &lt;{msg.remitente_email}&gt;
                              </span>
                              {isSentByMe && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-primary/10 text-primary border-primary/30">
                                  {isEs ? 'Enviado desde Trucky / Gmail' : 'Sent via Trucky / Gmail'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {isEs ? 'Para:' : 'To:'} {msg.destinatario_email}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(msg.fecha).toLocaleString()}
                          </span>
                          {isLast && (
                            <button
                              onClick={() => handleReply(selectedThread)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 transition-colors flex items-center gap-1"
                              title={isEs ? 'Responder a este último mensaje' : 'Reply to this latest message'}
                            >
                              <Send className="w-3 h-3" />
                              <span>{isEs ? 'Responder' : 'Reply'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Cuerpo del correo */}
                      <div className="prose prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-sans text-zinc-200">
                        {msg.cuerpo || msg.snippet || '(Sin contenido)'}
                      </div>
                    </div>
                  );
                })}

                {/* Si es usuario demo, mostramos la tarjeta de desbloqueo al pie del correo */}
                {isDemoUser && (
                  <div className="p-5 rounded-2xl bg-gradient-to-b from-[#18152c] to-[#100e1f] border border-violet-500/30 text-center space-y-4 shadow-xl mt-6">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-300 shadow-lg shadow-violet-600/20">
                      <Lock className="w-6 h-6" />
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-sm md:text-base font-bold text-white">
                        Desbloquea el análisis completo
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Conecta tu email y obtén el análisis completo y respuestas con IA.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-left max-w-md mx-auto text-[11px] text-zinc-300">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        <span>Clasificación inteligente</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                        <span>Respuestas con IA</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        <span>Automatización de tareas</span>
                      </div>
                    </div>

                    <div className="pt-1">
                      <a
                        href="https://trucky.site"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 w-full max-w-sm py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-violet-600/25 transition-all hover:scale-[1.01]"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Activar versión completa →</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
              <div className="w-16 h-16 rounded-3xl bg-muted/40 flex items-center justify-center mb-4">
                <Mail className="w-8 h-8 opacity-30 text-primary" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {isEs ? 'Ningún correo seleccionado' : 'No email selected'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                {isEs
                  ? 'Elige una conversación del panel izquierdo para leer el hilo completo o responder.'
                  : 'Select a conversation from the left panel to read the full thread or reply.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Modal de Redacción / Respuesta en Hilo ────────────────────────────── */}
      {composeOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {composeForm.threadId
                    ? (isEs ? 'Responder en el Hilo (Trucky + Gmail)' : 'Reply in Thread (Trucky + Gmail)')
                    : (isEs ? 'Nuevo Correo (Gmail)' : 'New Email (Gmail)')}
                </h3>
              </div>
              <button
                onClick={() => setComposeOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSendEmail} className="p-5 space-y-3.5 flex-1 overflow-y-auto">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {isEs ? 'Destinatario (Broker / Cliente)' : 'To (Broker / Client)'}
                </label>
                <input
                  type="email"
                  required
                  value={composeForm.to}
                  onChange={(e) => setComposeForm(p => ({ ...p, to: e.target.value }))}
                  placeholder="broker@freightcompany.com"
                  className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {isEs ? 'Asunto' : 'Subject'}
                  </label>
                  <input
                    type="text"
                    required
                    value={composeForm.subject}
                    onChange={(e) => setComposeForm(p => ({ ...p, subject: e.target.value }))}
                    placeholder="Miami -> Atlanta - 53' Dry Van Quote"
                    className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {isEs ? 'Categoría' : 'Category'}
                  </label>
                  <select
                    value={composeForm.categoria}
                    onChange={(e) => setComposeForm(p => ({ ...p, categoria: e.target.value }))}
                    className="w-full mt-1 bg-background border border-border rounded-xl px-2.5 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="cargas">{isEs ? 'Cargas' : 'Loads'}</option>
                    <option value="brokers">{isEs ? 'Brokers' : 'Brokers'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {isEs ? 'Mensaje' : 'Message'}
                </label>
                <textarea
                  required
                  rows={8}
                  value={composeForm.content}
                  onChange={(e) => setComposeForm(p => ({ ...p, content: e.target.value }))}
                  placeholder={isEs ? 'Escribe aquí tu cotización, términos o confirmación...' : 'Write your quote, terms or confirmation here...'}
                  className="w-full mt-1 bg-background border border-border rounded-xl p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono leading-relaxed resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  {isEs ? 'Cancelar' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={sendingCompose}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all disabled:opacity-50"
                >
                  {sendingCompose ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{isEs ? 'Enviando...' : 'Sending...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>{isEs ? 'Enviar por Gmail' : 'Send via Gmail'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
