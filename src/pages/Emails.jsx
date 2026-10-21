import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, RotateCw, Plus, Search, Star, MessageSquare,
  Send, Sparkles, Inbox, Package, Building2,
  CheckCircle2, Clock, X, Loader2, ArrowUpRight, Copy, Check
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useOrganizationId } from '@/lib/AppStateContext';
import { useProfile } from '@/lib/ProfileContext';
import { useLanguage } from '@/lib/LanguageContext';
import { filterByOrg } from '@/lib/orgScope';
import { useToast } from '@/components/ui/use-toast';

export default function Emails() {
  const orgId = useOrganizationId();
  const { activeProfileId } = useProfile();
  const { locale } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  // Modal de redacción rápida
  const [composeOpen, setComposeOpen] = useState(false);
  const [sendingCompose, setSendingCompose] = useState(false);
  const [composeForm, setComposeForm] = useState({
    to: '',
    subject: '',
    content: '',
    categoria: 'cargas'
  });

  const isEs = locale === 'es';

  // ─── Carga inicial de correos ────────────────────────────────────────────────
  const fetchEmails = async () => {
    try {
      setLoading(true);
      const all = await base44.entities.Email.filter({}, '-fecha', 100);
      const emailList = Array.isArray(all) ? all : [];
      // Filtrar por organización de forma segura
      const scoped = emailList.filter(e => !orgId || !e.organization_id || e.organization_id === orgId);
      // Filtrar por perfil activo si existe
      const profileScoped = activeProfileId
        ? scoped.filter(e => !e.profile_id || e.profile_id === activeProfileId)
        : scoped;

      setEmails(profileScoped);
      if (profileScoped.length > 0) {
        setSelectedEmail(prev => prev ? (profileScoped.find(p => p.id === prev.id) || profileScoped[0]) : profileScoped[0]);
      }
    } catch (err) {
      console.error('Error al cargar correos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, [orgId, activeProfileId]);

  // ─── Estado de Conexión Google OAuth 2.0 ────────────────────────────────────
  const [googleConnectedEmail, setGoogleConnectedEmail] = useState('');
  const [oauthToken, setOauthToken] = useState('');

  const GOOGLE_CLIENT_ID = '940005071153-h3ec1g6i15qo8nkabvrlgijbsas8g9ks.apps.googleusercontent.com';

  useEffect(() => {
    if (activeProfileId) {
      const savedEmail = localStorage.getItem(`trucky_oauth_email_${activeProfileId}`) || '';
      const savedToken = localStorage.getItem(`trucky_oauth_token_${activeProfileId}`) || '';
      setGoogleConnectedEmail(savedEmail);
      setOauthToken(savedToken);
    }
  }, [activeProfileId]);

  // Iniciar popup oficial de Google OAuth 2.0
  const handleConnectGoogle = () => {
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
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
        callback: async (tokenResponse) => {
          if (tokenResponse?.access_token) {
            const token = tokenResponse.access_token;
            setOauthToken(token);

            // Obtener el correo del usuario conectado
            try {
              const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` }
              });
              const info = await infoRes.json();
              const connectedEmail = info.email || 'Google Account';
              setGoogleConnectedEmail(connectedEmail);

              if (activeProfileId) {
                localStorage.setItem(`trucky_oauth_token_${activeProfileId}`, token);
                localStorage.setItem(`trucky_oauth_email_${activeProfileId}`, connectedEmail);
              }

              toast({
                title: isEs ? 'Cuenta de Google Conectada' : 'Google Account Connected',
                description: isEs ? `Conectado como ${connectedEmail}. Ahora puedes sincronizar tus correos.` : `Connected as ${connectedEmail}. You can now sync emails.`,
              });

              // Sincronizar automáticamente tras conectar
              triggerSync(token, connectedEmail);
            } catch (_) {
              setGoogleConnectedEmail('Cuenta Conectada');
            }
          }
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      console.error('Error al iniciar Google OAuth:', err);
      toast({
        title: isEs ? 'Error al abrir Google' : 'Failed to launch Google',
        description: err.message || 'Verifica que las ventanas emergentes estén permitidas.',
        variant: 'destructive',
      });
    }
  };

  const triggerSync = async (currentToken, currentEmail) => {
    const token = currentToken || oauthToken;
    const emailToSync = currentEmail || googleConnectedEmail;

    if (!token) {
      handleConnectGoogle();
      return;
    }

    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncGmail', {
        accessToken: token,
        gmailUser: emailToSync,
        organization_id: orgId,
        profile_id: activeProfileId,
        limit: 10,
      });

      const data = res?.data || {};
      if (data.error) {
        // Si el token expiró, reiniciar conexión
        if (data.error.includes('autenticación') || data.error.includes('401')) {
          handleConnectGoogle();
          return;
        }
        toast({
          title: isEs ? 'Error de sincronización' : 'Sync Error',
          description: data.error,
          variant: 'destructive',
        });
      } else {
        const nuevos = data.nuevosGuardados || 0;
        const omitidos = data.omitidosNoLogisticos || 0;
        toast({
          title: isEs ? 'Sincronización completada' : 'Sync Completed',
          description: isEs
            ? `${nuevos} correos logísticos importados (${omitidos} personales/spam filtrados).`
            : `${nuevos} freight emails imported (${omitidos} non-logistics filtered).`,
        });
        await fetchEmails();
      }
    } catch (err) {
      const serverMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Error de conexión';
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
    triggerSync(oauthToken, googleConnectedEmail);
  };

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

  // ─── Seleccionar correo y marcarlo leído ─────────────────────────────────────
  const handleSelectEmail = async (email) => {
    setSelectedEmail(email);
    if (!email.leido) {
      setEmails(prev => prev.map(item => item.id === email.id ? { ...item, leido: true } : item));
      try {
        await base44.entities.Email.update(email.id, { leido: true });
      } catch (err) {
        console.error('Error al marcar leído:', err);
      }
    }
  };

  // ─── Llevar la carga directo al Chat de Mercado ──────────────────────────────
  const handleAnalyzeInChat = (email) => {
    if (!email) return;
    const prompt = isEs
      ? `Tengo esta oportunidad de flete recibida por correo de ${email.remitente_nombre}:\n\n"${email.asunto}"\n\n${email.cuerpo}\n\n¿Cuál es la tarifa recomendada para esta ruta y equipo?`
      : `I have this load opportunity received via email from ${email.remitente_nombre}:\n\n"${email.asunto}"\n\n${email.cuerpo}\n\nWhat is the recommended rate for this route and equipment?`;

    localStorage.setItem('prefill_chat_prompt', prompt);
    navigate('/chat', { state: { prefillPrompt: prompt } });
  };

  // ─── Abrir respuesta ─────────────────────────────────────────────────────────
  const handleReply = (email) => {
    setComposeForm({
      to: email.remitente_email,
      subject: email.asunto.startsWith('Re:') ? email.asunto : `Re: ${email.asunto}`,
      content: `\n\n---\nOn ${new Date(email.fecha).toLocaleString()}, ${email.remitente_nombre} wrote:\n>${email.cuerpo?.replace(/\n/g, '\n>')}`,
      categoria: email.categoria || 'cargas'
    });
    setComposeOpen(true);
  };

  // ─── Copiar contenido al portapapeles ────────────────────────────────────────
  const handleCopyBody = () => {
    if (!selectedEmail) return;
    navigator.clipboard.writeText(selectedEmail.cuerpo || selectedEmail.snippet || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Enviar correo desde el modal ────────────────────────────────────────────
  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!composeForm.to || !composeForm.subject || !composeForm.content) return;

    setSendingCompose(true);
    try {
      const res = await base44.functions.invoke('sendGmail', {
        to: composeForm.to,
        subject: composeForm.subject,
        content: composeForm.content,
        categoria: composeForm.categoria,
        organization_id: orgId,
        profile_id: activeProfileId,
      });

      if (res?.data?.error) {
        toast({
          title: isEs ? 'Error al enviar' : 'Send error',
          description: res.data.error,
          variant: 'destructive',
        });
      } else {
        toast({
          title: isEs ? 'Correo enviado con éxito' : 'Email sent successfully',
          description: isEs ? `Despachado a ${composeForm.to}` : `Delivered to ${composeForm.to}`,
        });
        setComposeOpen(false);
        setComposeForm({ to: '', subject: '', content: '', categoria: 'cargas' });
        await fetchEmails();
      }
    } catch (err) {
      toast({
        title: isEs ? 'Fallo en el despacho' : 'Dispatch failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSendingCompose(false);
    }
  };

  // ─── Filtros y búsqueda (Se eliminó únicamente 'equipos') ────────────────────
  const filteredEmails = useMemo(() => {
    return emails.filter(item => {
      // Filtro por pestaña
      if (activeTab === 'unread' && item.leido) return false;
      if (activeTab === 'starred' && !item.destacado) return false;
      if (activeTab === 'brokers' && item.categoria !== 'brokers') return false;
      if (activeTab === 'cargas' && item.categoria !== 'cargas') return false;
      if (activeTab === 'sent' && item.tipo_flujo !== 'sent') return false;

      // Filtro de búsqueda
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSender = item.remitente_nombre?.toLowerCase().includes(q) || item.remitente_email?.toLowerCase().includes(q);
        const matchesSubject = item.asunto?.toLowerCase().includes(q);
        const matchesBody = item.cuerpo?.toLowerCase().includes(q);
        return matchesSender || matchesSubject || matchesBody;
      }
      return true;
    });
  }, [emails, activeTab, searchQuery]);

  const unreadCount = useMemo(() => emails.filter(e => !e.leido && e.tipo_flujo !== 'sent').length, [emails]);
  const allCount = emails.length;
  const starredCount = useMemo(() => emails.filter(e => e.destacado).length, [emails]);
  const brokersCount = useMemo(() => emails.filter(e => e.categoria === 'brokers').length, [emails]);
  const cargasCount = useMemo(() => emails.filter(e => e.categoria === 'cargas').length, [emails]);
  const sentCount = useMemo(() => emails.filter(e => e.tipo_flujo === 'sent').length, [emails]);

  // Lista de filtros: Todos, No leídos, Destacados, Brokers, Cargas, Enviados (sin Equipos)
  const TABS = [
    { id: 'all', label: isEs ? 'Todos' : 'All', icon: Inbox, badge: allCount },
    { id: 'unread', label: isEs ? 'No leídos' : 'Unread', icon: CheckCircle2, badge: unreadCount },
    { id: 'starred', label: isEs ? 'Destacados' : 'Starred', icon: Star, badge: starredCount },
    { id: 'brokers', label: isEs ? 'Brokers' : 'Brokers', icon: Building2, badge: brokersCount },
    { id: 'cargas', label: isEs ? 'Cargas' : 'Loads', icon: Package, badge: cargasCount },
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
          <p className="text-xs text-muted-foreground mt-1">
            {isEs
              ? 'Conectado a tu cuenta de Gmail · Filtro inteligente anti-ruido activado'
              : 'Connected to your Gmail account · Smart logistics filter active'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Campo de correo editable con persistencia por perfil */}
          <div className="relative flex items-center">
            <Mail className="w-3.5 h-3.5 text-muted-foreground absolute left-3 pointer-events-none" />
            <input
              type="email"
              value={googleConnectedEmail}
              onChange={(e) => {
                const val = e.target.value;
                setGoogleConnectedEmail(val);
                if (activeProfileId) {
                  localStorage.setItem(`trucky_oauth_email_${activeProfileId}`, val);
                }
              }}
              placeholder={isEs ? 'correo@gmail.com' : 'email@gmail.com'}
              className="bg-card border border-border/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-[220px]"
            />
          </div>

          <button
            onClick={handleSyncGmail}
            disabled={syncing}
            className="flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-card border border-border hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50 whitespace-nowrap"
            title={isEs ? 'Sincronizar correos de esta cuenta' : 'Sync emails from this account'}
          >
            <RotateCw className={`w-3.5 h-3.5 text-primary ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? (isEs ? 'Sincronizando...' : 'Syncing...') : (isEs ? 'Sincronizar' : 'Sync')}</span>
          </button>

          <button
            onClick={() => {
              setComposeForm({ to: '', subject: '', content: '', categoria: 'cargas' });
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

      {/* ─── Panel Master-Detail (Feed de Correos + Lector) ─────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
        {/* Columna Izquierda: Lista de Correos (5 columnas) */}
        <div className="lg:col-span-5 flex flex-col bg-card/60 border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 bg-card flex items-center justify-between text-xs text-muted-foreground">
            <span>{filteredEmails.length} {isEs ? 'correos' : 'emails'}</span>
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
            ) : filteredEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-56 p-6 text-center text-muted-foreground">
                <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                  <Inbox className="w-6 h-6 opacity-40" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {isEs ? 'No hay correos en esta vista' : 'No emails in this view'}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
                  {isEs
                    ? 'Haz clic en "Sincronizar Gmail" para verificar nuevos mensajes o redacta un correo nuevo.'
                    : 'Click "Sync Gmail" to check for new messages or compose a new email.'}
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
              filteredEmails.map(item => {
                const isSelected = selectedEmail?.id === item.id;
                const badge = getCategoryBadge(item.categoria);
                const initials = (item.remitente_nombre || 'TL')
                  .split(' ')
                  .map(w => w[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();

                const timeStr = item.fecha
                  ? new Date(item.fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '';

                return (
                  <div
                    key={item.id}
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
                              {item.remitente_nombre || item.remitente_email}
                            </span>
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
                        <div className="flex items-center justify-between mt-2 pt-1">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${badge.color}`}>
                            {badge.label}
                          </span>

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

        {/* Columna Derecha: Lector de Correo (7 columnas) */}
        <div className="lg:col-span-7 flex flex-col bg-card/60 border border-border rounded-2xl overflow-hidden">
          {selectedEmail ? (
            <div className="flex flex-col h-full">
              {/* Header del Correo */}
              <div className="p-4 md:p-5 border-b border-border/60 bg-card space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${getCategoryBadge(selectedEmail.categoria).color}`}>
                        {getCategoryBadge(selectedEmail.categoria).label}
                      </span>

                      {selectedEmail.tipo_flujo === 'sent' && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-primary/10 text-primary border-primary/30">
                          {isEs ? 'Enviado por Trucky' : 'Sent via Trucky'}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(selectedEmail.fecha).toLocaleString()}
                      </span>
                    </div>

                    <h2 className="text-base md:text-lg font-bold text-foreground tracking-tight leading-snug">
                      {selectedEmail.asunto}
                    </h2>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleToggleStar(selectedEmail, e)}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-amber-400 transition-colors"
                      title={isEs ? 'Destacar' : 'Star'}
                    >
                      <Star className={`w-4 h-4 ${selectedEmail.destacado ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                    <button
                      onClick={handleCopyBody}
                      className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={isEs ? 'Copiar texto' : 'Copy text'}
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Remitente y Destinatario */}
                <div className="flex items-center gap-3 pt-2 border-t border-border/40 text-xs">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center font-bold text-xs text-primary">
                    {(selectedEmail.remitente_nombre || 'TL').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">
                      {selectedEmail.remitente_nombre || selectedEmail.remitente_email}
                      <span className="text-muted-foreground font-normal ml-1.5">&lt;{selectedEmail.remitente_email}&gt;</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {isEs ? 'Para:' : 'To:'} {selectedEmail.destinatario_email}
                    </p>
                  </div>
                </div>

                {/* Botonera de Acción Destacada */}
                <div className="flex items-center gap-2 pt-2 flex-wrap">
                  {/* Botón Estrella: Analizar en Chat (Inhabilitado) */}
                  <button
                    disabled
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 opacity-50 cursor-not-allowed select-none shadow-none"
                    title={isEs ? 'Función inhabilitada' : 'Feature disabled'}
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-zinc-950" />
                    <span>{isEs ? 'Analizar en Chat de Mercado' : 'Analyze in Market Chat'}</span>
                    <ArrowUpRight className="w-3 h-3 ml-0.5" />
                  </button>

                  <button
                    onClick={() => handleReply(selectedEmail)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground transition-colors"
                  >
                    <Send className="w-3.5 h-3.5 text-primary" />
                    <span>{isEs ? 'Responder' : 'Reply'}</span>
                  </button>
                </div>
              </div>

              {/* Cuerpo del Mensaje */}
              <div className="flex-1 p-5 overflow-y-auto bg-card/20">
                <div className="prose prose-invert max-w-none text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-sans text-zinc-200">
                  {selectedEmail.cuerpo || selectedEmail.snippet || '(Sin contenido)'}
                </div>
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
                  ? 'Elige un mensaje del panel izquierdo para leer los detalles o cotizarlo en el Chat de Mercado.'
                  : 'Select a message from the left panel to read details or quote it in Market Chat.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Modal de Redacción Rápida ─────────────────────────────────────────── */}
      {composeOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {isEs ? 'Nuevo Correo (Gmail)' : 'New Email (Gmail)'}
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
