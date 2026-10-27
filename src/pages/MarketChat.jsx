import { useState, useEffect, useRef, useMemo } from 'react';
import { Send, Bot, User, Plus, Loader2, Zap, History, X, AlertTriangle, Copy, Check, Mail, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAppState, useOrganizationId } from '@/lib/AppStateContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useToast } from '@/components/ui/use-toast';
import ReactMarkdown from 'react-markdown';
import MarketAdvisorCard from '@/components/MarketAdvisorCard';
import { useProfile } from '@/lib/ProfileContext';
import { useDemo } from '@/lib/DemoContext';
import { sendEmailWithAutoAuth } from '@/lib/googleAuthHelper';

const SESSION_KEY = 'trucky_chat_session';


// UI_STRINGS — objeto local ES/EN para las strings de interfaz de este
// componente. Decisión de Preview (engram #9376): NO se extiende
// messageCatalog.ts (backend, base44/functions/marketChat/) al frontend;
// este objeto vive junto al componente que lo consume. Los labels de
// equipo/accesoriales (Reefer, Flatbed, TONU, etc.) NO entran acá — son
// vocabulario de industria fijo en los dos idiomas (ver Design).
const UI_STRINGS = {
  es: {
    quickPrompts: [
      "¿Cuánto cobro Miami a Tampa?",
      "Port Everglades a Naples, ¿cuánto pido?",
      "¿Vale la tarifa de $2.20?",
      "Miami a WPB, ¿cuánto mínimo?",
      "¿Qué es detention y cuánto cobro?",
    ],
    defaultTitle: 'Consulta',
    messagesLabel: (count) => `${count} mensaje${count === 1 ? '' : 's'}`,
    headerTitle: 'Chat de Mercado',
    headerSubtitle: 'Tarifas, rutas y estrategia — respuestas directas',
    historyButton: 'Historial',
    newQueryButton: 'Nueva consulta',
    historyPanelTitle: 'Historial de Consultas',
    noHistory: 'No hay conversaciones guardadas',
    costBannerCustom: (costPerMile, targetRate) => `Personalizado: $${costPerMile}/mi costo · $${targetRate}/mi objetivo`,
    emptyStateTitle: 'TruckyAI — Asesor de Mercado',
    emptyStateSubtitle: 'Respuestas directas. Sin relleno. Solo lo que necesitas saber para decidir.',
    loadingLabel: 'Calculando...',
    errorRetryHint: 'Puedes intentar enviar tu mensaje de nuevo.',
    inputPlaceholder: 'Ej: Tampa a $800 solo ida, ¿conviene?',
    errorNoResponse: 'No se recibió respuesta del asesor. Intenta de nuevo.',
    errorSessionExpired: 'Tu sesión expiró. Vuelve a iniciar sesión para seguir consultando.',
    errorStatus: (status) => `El asesor no pudo responder (error ${status}). Intenta de nuevo en unos segundos.`,
    errorNetwork: 'No se pudo enviar el mensaje. Revisa tu conexión e intenta de nuevo.',
  },
  en: {
    quickPrompts: [
      "How much should I charge Miami to Tampa?",
      "Port Everglades to Naples, what should I ask for?",
      "Is the $2.20 rate worth it?",
      "Miami to WPB, what's the minimum?",
      "What is detention and how much do I charge?",
    ],
    defaultTitle: 'Query',
    messagesLabel: (count) => `${count} message${count === 1 ? '' : 's'}`,
    headerTitle: 'Market Chat',
    headerSubtitle: 'Rates, lanes and strategy — straight answers',
    historyButton: 'History',
    newQueryButton: 'New query',
    historyPanelTitle: 'Query History',
    noHistory: 'No saved conversations',
    costBannerCustom: (costPerMile, targetRate) => `Custom: $${costPerMile}/mi cost · $${targetRate}/mi target`,
    emptyStateTitle: 'TruckyAI — Market Advisor',
    emptyStateSubtitle: 'Straight answers. No filler. Just what you need to decide.',
    loadingLabel: 'Calculating...',
    errorRetryHint: 'You can try sending your message again.',
    inputPlaceholder: 'E.g.: Tampa at $800 one way, worth it?',
    errorNoResponse: 'No response received from the advisor. Try again.',
    errorSessionExpired: 'Your session expired. Log in again to keep asking.',
    errorStatus: (status) => `The advisor couldn't respond (error ${status}). Try again in a few seconds.`,
    errorNetwork: 'Could not send the message. Check your connection and try again.',
  },
};

const CodeBlock = ({ node, orgId, activeProfileId, locale, toast, ...props }) => {
  const [copied, setCopied] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  
  const getText = (children) => {
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) return children.map(getText).join('');
    if (children && children.props && children.props.children) return getText(children.props.children);
    return '';
  };
  
  const textToCopy = getText(props.children);

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');

  const handleOpenSend = () => {
    const subjectMatch = textToCopy.match(/^Subject:\s*(.*)$/im);
    const emailMatch = textToCopy.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    
    let cleanContent = textToCopy;
    if (subjectMatch) {
      cleanContent = cleanContent.replace(/^Subject:\s*.*\n*/im, '').trim();
    }

    setSubject(subjectMatch ? subjectMatch[1].trim() : (locale === 'en' ? 'Rate Quote - Trucky' : 'Cotización de Tarifa - Trucky'));
    setTo(emailMatch ? emailMatch[1].trim() : '');
    setContent(cleanContent);
    setSendModalOpen(true);
  };

  const handleConfirmSend = async (e) => {
    e.preventDefault();
    if (!to || !subject || !content) return;
    setSending(true);
    try {
      const res = await sendEmailWithAutoAuth({
        to,
        subject,
        content,
        organization_id: orgId,
        profile_id: activeProfileId,
        remitente_nombre: currentUser?.full_name || 'Trucky User',
        categoria: 'brokers',
      });

      if (res?.data?.error) {
        toast?.({
          title: locale === 'en' ? 'Send error' : 'Error al enviar',
          description: res.data.error,
          variant: 'destructive',
        });
      } else {
        setSentSuccess(true);
        setSendModalOpen(false);
        toast?.({
          title: locale === 'en' ? 'Email sent successfully' : 'Correo enviado con éxito',
          description: locale === 'en' ? `Delivered to ${to}. Visible in your Emails inbox.` : `Despachado a ${to}. Ya puedes verlo en tu sección de Emails.`,
        });
      }
    } catch (err) {
      toast?.({
        title: locale === 'en' ? 'Failed to send' : 'Fallo en el despacho',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl bg-[#1e1e24] border border-[#2b2b36] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-[#18181b] border-b border-[#2b2b36] flex-wrap gap-2">
        <span className="text-xs font-semibold text-zinc-400">Trucky Email Draft</span>
        <div className="flex items-center gap-2">
          {sentSuccess ? (
            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {locale === 'en' ? 'Sent via Gmail' : 'Enviado por Gmail'}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleOpenSend}
              className="text-xs text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors font-semibold"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{locale === 'en' ? 'Send via Gmail' : 'Enviar por Gmail'}</span>
            </button>
          )}

          <button 
            type="button"
            onClick={handleCopy}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-muted"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? (locale === 'en' ? 'Copied!' : 'Copiado!') : (locale === 'en' ? 'Copy' : 'Copiar')}
          </button>
        </div>
      </div>
      <div className="p-4 overflow-x-auto">
        <pre className="text-[13px] text-zinc-300 font-mono leading-relaxed m-0 whitespace-pre-wrap break-words" {...props} />
      </div>

      {sendModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  {locale === 'en' ? 'Confirm Email Dispatch (Gmail)' : 'Confirmar Envío de Correo (Gmail)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSendModalOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmSend} className="p-5 space-y-3.5 flex-1 overflow-y-auto">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {locale === 'en' ? 'Recipient (Broker / Customer)' : 'Destinatario (Broker / Cliente)'}
                </label>
                <input
                  type="email"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="broker@freight.com"
                  className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {locale === 'en' ? 'Subject' : 'Asunto'}
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {locale === 'en' ? 'Message content' : 'Contenido del mensaje'}
                </label>
                <textarea
                  required
                  rows={8}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full mt-1 bg-background border border-border rounded-xl p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono leading-relaxed resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setSendModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  {locale === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-all disabled:opacity-50"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{locale === 'en' ? 'Sending...' : 'Enviando...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>{locale === 'en' ? 'Send via Gmail' : 'Enviar por Gmail'}</span>
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
};

export default function MarketChat() {
  const { userProfile, currentUser } = useAppState();
  const orgId = useOrganizationId();
  const { toast } = useToast();
  const { locale, setLocale } = useLanguage();
  const { activeProfileId } = useProfile();
  const { isDemoUser, limits } = useDemo();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [costConfig, setCostConfig] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionDbId, setSessionDbId] = useState(null); // DB record id for upsert
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [translatingHistory, setTranslatingHistory] = useState(false);
  const prevLocaleRef = useRef(locale);
  const sessionDbIdRef = useRef(sessionDbId);
  const sessionIdRef = useRef(sessionId);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(null);
  const translationSeqRef = useRef(0);

  useEffect(() => {
    sessionDbIdRef.current = sessionDbId;
  }, [sessionDbId]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // locale del toggle ES/EN. Fuente inicial: UserProfile.idioma_chat (carga
  // ya hecha por AppStateContext, sin fetch adicional). Default 'es' si el
  // perfil no trae el campo (usuarios previos a este cambio).
  const t = UI_STRINGS[locale];
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Soporte para consultas transferidas directamente desde el módulo de Emails
  useEffect(() => {
    const prefill = localStorage.getItem('prefill_chat_prompt');
    if (prefill) {
      setInput(prefill);
      localStorage.removeItem('prefill_chat_prompt');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, []);

  // Escritura optimista: el toggle cambia de inmediato en UI (setLocale ya
  // corrió sincrónicamente en el handler); esta función solo persiste la
  // preferencia en UserProfile en paralelo, sin bloquear. Sigue el mismo
  // patrón filter→update/create de Onboarding.jsx L82-88. Una falla acá no
  // revierte el toggle — solo no persiste para la próxima sesión.

  useEffect(() => {
    const init = async () => {
      const user = await base44.auth.me();
      if (!user?.email) return;

      // Sincronizar identificadores de sesión sin vaciar mensajes prematuramente
      setSessionId(null);
      setSessionDbId(null);

      // Load cost config del perfil activo
      const configs = await base44.entities.CostConfig.filter({ usuario: user.email });
      const profileConfig = configs.find(c => (c.profile_id || '1') === activeProfileId);
      if (profileConfig) {
        setCostConfig(profileConfig);
      } else {
        setCostConfig(null);
      }

      // localStorage guarda qué sessionDbId pertenece a cada perfil
      const lsKey = `chat_session_profile_${user.email}_${activeProfileId}`;
      const savedDbId = localStorage.getItem(lsKey);

      // Cargar primero de caché local para evitar parpadeos al navegar entre módulos
      const localCacheKey = `${lsKey}_messages`;
      const cachedMsgs = localStorage.getItem(localCacheKey);
      let loadedFromCache = false;
      if (cachedMsgs) {
        try {
          const parsed = JSON.parse(cachedMsgs);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            loadedFromCache = true;
          }
        } catch (e) { /* ignora */ }
      }

      // Buscar en Base44 Cloud la sesión del perfil actual
      try {
        let session = null;
        if (savedDbId) {
          try {
            session = await base44.entities.ChatHistory.get(savedDbId);
          } catch (_) {
            session = null;
          }
        }

        if (!session) {
          const allSessions = await base44.entities.ChatHistory.filter({ usuario: user.email }, '-updated_date', 30);
          session = allSessions.find(s => s.profile_id === activeProfileId);
        }

        if (session) {
          localStorage.setItem(lsKey, session.id);
          setSessionId(session.session_id);
          setSessionDbId(session.id);
          sessionDbIdRef.current = session.id;
          sessionIdRef.current = session.session_id;

          let msgs = session.messages || [];
          if (cachedMsgs) {
            try {
              const parsedCached = JSON.parse(cachedMsgs);
              if (Array.isArray(parsedCached) && parsedCached.length >= msgs.length) {
                msgs = parsedCached;
              }
            } catch (_) {}
          }
          setMessages(msgs);
          return;
        } else if (!loadedFromCache) {
          // Perfil nuevo sin historial: iniciar sesión limpia sin pisar otros perfiles
          setMessages([]);
          setSessionDbId(null);
          sessionDbIdRef.current = null;
        }
      } catch (err) {
        console.error('[MarketChat] Error sincronizando sesión con backend:', err);
      }

      const newId = `session_${user.email}_${activeProfileId}_${Date.now()}`;
      setSessionId(newId);
      sessionIdRef.current = newId;
    };
    if (activeProfileId) {
      init();
      // Si el usuario tiene el panel de historial abierto y cambia de perfil, refrescar las consultas del nuevo perfil
      if (showHistory) {
        openHistory();
      }
    }
  }, [activeProfileId, showHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const queueSaveSession = (updatedMessages, targetSessionId) => {
    const activeSid = targetSessionId || sessionIdRef.current;
    if (!activeSid) return;

    // 1. Fase 2: Sanitizar structuredData conservando estrictamente los datos clave
    // (intent, origen, destino, calculo) y eliminando tablas masivas como stateMarketData
    const cleanMessages = updatedMessages.map(m => {
      if (m.structuredData) {
        const { intent, origen, destino, calculo } = m.structuredData;
        return {
          ...m,
          structuredData: {
            ...(intent && { intent }),
            ...(origen && { origen }),
            ...(destino && { destino }),
            ...(calculo && { calculo }),
          }
        };
      }
      return m;
    });

    // 2. Persistencia síncrona inmediata en caché local (0ms, no bloquea ni falla por red)
    try {
      const email = currentUser?.email || userProfile?.usuario || userProfile?.email;
      if (email && activeProfileId) {
        const lsKey = `chat_session_profile_${email}_${activeProfileId}`;
        localStorage.setItem(`${lsKey}_messages`, JSON.stringify(cleanMessages));
      }
    } catch (_e) { /* ignora */ }

    // 3. Fase 2: Limitar a máximo 60 mensajes en BD para evitar crecimiento desmedido del documento
    const cappedForDb = cleanMessages.length > 60 ? cleanMessages.slice(-60) : cleanMessages;

    // 4. Encolar guardado para MongoDB en background (una sola escritura en vuelo a la vez)
    pendingSaveRef.current = {
      messages: cappedForDb,
      sessionId: activeSid,
    };

    if (isSavingRef.current) return;

    const processQueue = async () => {
      isSavingRef.current = true;
      try {
        while (pendingSaveRef.current) {
          const item = pendingSaveRef.current;
          pendingSaveRef.current = null;

          const user = await base44.auth.me();
          if (!user?.email) break;

          const firstUserMsg = item.messages.find(m => m.role === 'user');
          const titulo = firstUserMsg
            ? (firstUserMsg.content.length > 50 ? firstUserMsg.content.slice(0, 50) + '...' : firstUserMsg.content)
            : t.defaultTitle;

          const lsKey = `chat_session_profile_${user.email}_${activeProfileId}`;

          console.time('[PERF ChatHistory save]');
          if (sessionDbIdRef.current) {
            await base44.entities.ChatHistory.update(sessionDbIdRef.current, {
              messages: item.messages,
              titulo,
              profile_id: activeProfileId,
            });
          } else {
            const created = await base44.entities.ChatHistory.create({
              session_id: item.sessionId,
              usuario: user.email,
              profile_id: activeProfileId,
              messages: item.messages,
              titulo,
            });
            sessionDbIdRef.current = created.id;
            setSessionDbId(created.id);
            localStorage.setItem(lsKey, created.id);
          }
          console.timeEnd('[PERF ChatHistory save]');
        }
      } catch (dbErr) {
        // La falla en MongoDB ya no bloquea la interfaz ni contamina errores de traducción
        console.warn('[ChatPersistence] No se pudo sincronizar en MongoDB (guardado en caché local):', dbErr?.message || dbErr);
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          processQueue();
        }
      }
    };

    processQueue();
  };

  const translateHistory = async (targetLang) => {
    if (translatingHistory || messages.length === 0) return;
    const currentSeq = ++translationSeqRef.current;

    // Fase 4: Limitar a los últimos 20 mensajes (ventana visible) y omitir mensajes ya cacheados
    const WINDOW_SIZE = 20;
    const startIndex = Math.max(0, messages.length - WINDOW_SIZE);
    const windowMessages = messages.slice(startIndex);

    const needsTranslationIndices = [];
    const textsToSend = [];

    windowMessages.forEach((m, idx) => {
      const realIdx = startIndex + idx;
      if (m.translations && m.translations[targetLang]) {
        // Ya traducido en caché para este idioma
      } else if (m.content && m.content.trim()) {
        needsTranslationIndices.push(realIdx);
        textsToSend.push({ role: m.role, content: m.content });
      }
    });

    // Caso A: Todos los mensajes ya tienen traducción en caché en memoria (0 ms, sin petición de red)
    if (needsTranslationIndices.length === 0) {
      setMessages(prev => prev.map(m => {
        if (m.translations && m.translations[targetLang]) {
          return { ...m, content: m.translations[targetLang] };
        }
        return m;
      }));
      return;
    }

    // Caso B: Solo enviamos a Google Translate los mensajes que no están en caché
    setTranslatingHistory(true);

    try {
      console.time('[PERF translateChat invoke]');
      const res = await base44.functions.invoke('translateChat', {
        messages: textsToSend,
        targetLang: targetLang
      });
      console.timeEnd('[PERF translateChat invoke]');

      // Si inició otra traducción posterior mientras esta corría, descartar resultado obsoleto
      if (translationSeqRef.current !== currentSeq) {
        return;
      }

      if (res.data?.messages) {
        const returnedTranslated = res.data.messages;
        setMessages(prev => {
          const updated = [...prev];
          needsTranslationIndices.forEach((targetIndex, i) => {
            if (updated[targetIndex] && returnedTranslated[i]) {
              const transText = returnedTranslated[i].content;
              const prevTranslations = updated[targetIndex].translations || {};
              if (!prevTranslations[prevLocaleRef.current || 'es']) {
                prevTranslations[prevLocaleRef.current || 'es'] = updated[targetIndex].content;
              }
              prevTranslations[targetLang] = transText;
              updated[targetIndex] = {
                ...updated[targetIndex],
                content: transText,
                translations: prevTranslations,
              };
            }
          });

          // Aplicar la versión traducida también en los que ya estaban en caché
          const fullyUpdated = updated.map(m => {
            if (m.translations && m.translations[targetLang]) {
              return { ...m, content: m.translations[targetLang] };
            }
            return m;
          });

          // Persistir en caché local
          try {
            const email = currentUser?.email || userProfile?.usuario || userProfile?.email;
            if (email && activeProfileId) {
              const lsKey = `chat_session_profile_${email}_${activeProfileId}_messages_${targetLang}`;
              localStorage.setItem(lsKey, JSON.stringify(fullyUpdated));
            }
          } catch (_e) { /* ignora */ }

          return fullyUpdated;
        });
      } else if (res.data?.error) {
        setError(`Error de traducción: ${res.data.error}`);
      }
    } catch (err) {
      console.error('Error translating history:', err?.response?.data || err.message);
      const backendError = err?.response?.data?.error;
      setError(`Fallo al contactar traducción: ${backendError || err.message || 'Error desconocido'}`);
    } finally {
      if (translationSeqRef.current === currentSeq) {
        setTranslatingHistory(false);
      }
    }
  };

  useEffect(() => {
    if (locale !== prevLocaleRef.current) {
      prevLocaleRef.current = locale;
      if (messages.length > 0) {
        translateHistory(locale);
      }
    }
  }, [locale]);

  // Límite de mensajes para usuarios demo
  const userMessagesCount = useMemo(() => {
    return messages.filter(m => m.role === 'user').length;
  }, [messages]);

  const maxMessages = limits?.CHAT_MESSAGES || 15;
  const isChatLimitReached = isDemoUser && userMessagesCount >= maxMessages;

  const sendMessage = async (text) => {
    if (isChatLimitReached) {
      toast?.({
        title: locale === 'en' ? 'Demo Limit Reached' : 'Límite de la versión demo',
        description: locale === 'en'
          ? `You have reached the maximum of ${maxMessages} messages in demo mode. Upgrade to unlock full access.`
          : `Has alcanzado el máximo de ${maxMessages} mensajes en modo demo. Activa la versión completa para continuar.`,
        variant: 'destructive',
      });
      return;
    }

    const userMessage = text || input.trim();
    if (!userMessage || loading || translatingHistory) return;

    const newMessages = [
      ...messages,
      { 
        role: 'user', 
        content: userMessage, 
        timestamp: new Date().toISOString(),
        translations: { [locale]: userMessage }
      }
    ];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    // Persistir de inmediato el mensaje del usuario en background
    queueSaveSession(newMessages);

    const isEmailDraftRequest = (text) => {
      const t = (text || '').toLowerCase();
      return (
        t.includes('correo') ||
        t.includes('email') ||
        t.includes('plantilla') ||
        t.includes('formato') ||
        t.includes('draft')
      ) && (
        t.includes('hazme') ||
        t.includes('haz') ||
        t.includes('redacta') ||
        t.includes('escribe') ||
        t.includes('dame') ||
        t.includes('generar') ||
        t.includes('crea') ||
        t.includes('pedir') ||
        t.includes('informacion') ||
        t.includes('información') ||
        t.includes('cotizar') ||
        t.includes('negociar') ||
        t.includes('rechazar') ||
        t.includes('aceptar') ||
        t.includes('plantilla') ||
        t.includes('formato')
      );
    };

    const isCarrier = userProfile?.rol === 'carrier';

    if (isCarrier && isEmailDraftRequest(userMessage)) {
      const noCarrierReply = 'No puedo entregar plantillas de correo para carriers.';

      const assistantMsg = {
        role: 'assistant',
        content: noCarrierReply,
        timestamp: new Date().toISOString(),
        translations: { [locale]: noCarrierReply }
      };
      const updatedMessages = [...newMessages, assistantMsg];
      setMessages(updatedMessages);
      setLoading(false);
      queueSaveSession(updatedMessages);
      return;
    }

    try {
      const apiMessages = newMessages.map(m => {
        let cleanStructured = undefined;
        if (m.structuredData) {
          cleanStructured = { ...m.structuredData };
          delete cleanStructured.stateMarketData;
        }
        return { role: m.role, content: m.content, ...(cleanStructured && { structuredData: cleanStructured }) };
      });

      console.time('[PERF marketChat invoke]');
      const res = await base44.functions.invoke('marketChat', {
        messages: apiMessages,
        costConfig,
        locale,
        activeProfileId,
      });
      console.timeEnd('[PERF marketChat invoke]');

      if (res.data?._perf) {
        console.log('[PERF marketChat backend breakdown]', res.data._perf);
      }

      if (res.data?.error) {
        console.log('[DEBUG marketChat] error en respuesta:', res.data.error);
        setError(res.data.error);
      } else if (res.data?.content) {
        let cleanContent = res.data.content;
        // Solo para carriers: si llega un borrador de correo tipo plantilla, interceptar con la regla de negocio
        if (isCarrier && (cleanContent.includes('```text') || cleanContent.toLowerCase().includes('thank you for reaching out') || cleanContent.toLowerCase().includes('before we send our rate'))) {
          cleanContent = 'No puedo entregar plantillas de correo para carriers.';
        }

        const assistantMsg = { 
          role: 'assistant', 
          content: cleanContent, 
          timestamp: new Date().toISOString(),
          translations: { [locale]: cleanContent },
          ...(res.data.structuredData && { structuredData: res.data.structuredData })
        };
        const updatedMessages = [...newMessages, assistantMsg];
        setMessages(updatedMessages);

        // ¡CRUCIAL (Fase 1.1)!: Liberar spinner de UI de inmediato
        setLoading(false);

        // Guardar sesión en background (cola única que no traba la interfaz)
        queueSaveSession(updatedMessages);
        return;
      } else {
        console.log('[DEBUG marketChat] sin content ni error. res.data:', res?.data);
        setError(t.errorNoResponse);
      }
    } catch (err) {
      console.error('MarketChat: error al enviar mensaje', err);
      const status = err?.response?.status ?? err?.status;
      const serverMsg = err?.response?.data?.message || err?.response?.data?.error || (typeof err?.response?.data === 'string' ? err.response.data : '') || err?.message || '';
      console.error('MarketChat: error al enviar mensaje:', err, serverMsg);
      if (status === 401 || status === 403) {
        setError(t.errorSessionExpired);
      } else if (status) {
        setError(serverMsg ? `${t.errorStatus(status)} — ${serverMsg}` : t.errorStatus(status));
      } else {
        setError(t.errorNetwork);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNew = async () => {
    pendingSaveRef.current = null;
    const user = await base44.auth.me();
    const lsKey = `chat_session_profile_${user.email}_${activeProfileId}`;
    localStorage.removeItem(lsKey);
    localStorage.removeItem(`${lsKey}_messages`);
    const newId = `session_${user.email}_${Date.now()}`;
    setSessionId(newId);
    sessionIdRef.current = newId;
    setSessionDbId(null);
    sessionDbIdRef.current = null;
    setMessages([]);
    setInput('');
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const loadHistoryItem = (item) => {
    pendingSaveRef.current = null;
    setSessionId(item.session_id);
    sessionIdRef.current = item.session_id;
    setSessionDbId(item.id);
    sessionDbIdRef.current = item.id;
    setMessages(item.messages || []);
    setShowHistory(false);
  };

  const openHistory = async () => {
    const user = await base44.auth.me();
    // Fase 2: Limitar a 20 registros más recientes en vez de 50
    const allSessions = await base44.entities.ChatHistory.filter({ usuario: user.email }, '-updated_date', 20);
    // Filtrar estrictamente por el perfil activo (resuelve C4 del reporte QA)
    const profileSessions = allSessions.filter(s => s.profile_id === activeProfileId);
    setHistory(profileSessions.slice(0, 15));
    setShowHistory(true);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* History Panel */}
      {showHistory && (
        <div className="absolute inset-0 z-20 bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              {t.historyPanelTitle}
            </h2>
            <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t.noHistory}</p>
            ) : (
              history.map(item => (
                <button
                  key={item.id}
                  onClick={() => loadHistoryItem(item)}
                  className="w-full text-left p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all"
                >
                  <div className="text-sm font-medium text-foreground truncate">{item.titulo || t.defaultTitle}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.messagesLabel(item.messages?.length || 0)} · {new Date(item.updated_date).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            {t.headerTitle}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t.headerSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openHistory}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.historyButton}</span>
          </button>
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.newQueryButton}</span>
          </button>
        </div>
      </div>

      {/* Cost config banner — oculto salvo que costo_por_milla sea un número
          válido y presente. Nunca debe renderizar "$undefined/mi": un
          registro sin configurar (null) o con valores no finitos no cuenta
          como "personalizado". */}
      {costConfig && Number.isFinite(costConfig.costo_por_milla) && (
        <div className="mx-4 md:mx-6 mt-3 flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
          <Zap className="w-3.5 h-3.5 flex-shrink-0" />
          {t.costBannerCustom(costConfig.costo_por_milla.toFixed(2), costConfig.tarifa_objetivo)}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">{t.emptyStateTitle}</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">{t.emptyStateSubtitle}</p>
            <div className="grid gap-2 w-full max-w-md">
              {t.quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  disabled={loading || translatingHistory}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 text-sm text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center ${msg.role === 'user' ? 'bg-primary/20' : 'bg-muted'
              }`}>
              {msg.role === 'user'
                ? <User className="w-4 h-4 text-primary" />
                : <Bot className="w-4 h-4 text-muted-foreground" />
              }
            </div>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${msg.role === 'user'
                ? 'bg-primary text-primary-foreground ml-auto'
                : 'bg-card border border-border text-foreground'
              }`}>
              {msg.role === 'assistant' ? (
                <>
                  {msg.structuredData?.intent === 'rate_check' && 
                   !msg.content?.startsWith('```') &&
                   msg.structuredData?.origen && !msg.structuredData.origen.toLowerCase().includes('unknown') && 
                   msg.structuredData?.destino && !msg.structuredData.destino.toLowerCase().includes('unknown') && (
                    <MarketAdvisorCard data={msg.structuredData} costConfig={costConfig} />
                  )}
                  {(!msg.structuredData || msg.structuredData.intent !== 'rate_check' || msg.content?.startsWith('```') ||
                    !msg.structuredData.origen || msg.structuredData.origen.toLowerCase().includes('unknown') || 
                    !msg.structuredData.destino || msg.structuredData.destino.toLowerCase().includes('unknown')) && (
                    <div className="prose prose-invert prose-sm max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mb-2 [&>ol]:mb-2 [&>h1]:text-sm [&>h2]:text-sm [&>h3]:text-sm [&>strong]:text-foreground [&>pre]:whitespace-pre-wrap [&>pre]:break-words">
                      <ReactMarkdown
                        components={{
                          pre: (preProps) => (
                            <CodeBlock
                              {...preProps}
                              orgId={orgId}
                              activeProfileId={activeProfileId}
                              locale={locale}
                              toast={toast}
                            />
                          ),
                          code: ({ node, inline, ...props }) =>
                            inline
                              ? <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-xs" {...props} />
                              : <code {...props} />
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </>
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
              <Bot className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">{t.loadingLabel}</span>
            </div>
          </div>
        )}

        {translatingHistory && (
          <div className="flex gap-3 justify-center my-4">
            <div className="bg-card border border-border rounded-xl px-4 py-2 flex items-center gap-2 shadow-sm">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <span className="text-sm text-muted-foreground">{locale === 'es' ? 'Traduciendo historial...' : 'Translating history...'}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-red-400/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div className="bg-red-400/5 border border-red-400/30 rounded-xl px-4 py-3 text-sm text-red-400 max-w-[85%]">
              {error}
              <div className="text-xs text-muted-foreground mt-1">{t.errorRetryHint}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input / Demo Limit Banner */}
      <div className="flex-shrink-0 p-4 md:p-6 border-t border-border">
        {isChatLimitReached ? (
          <div className="p-4 rounded-xl bg-gradient-to-r from-violet-950/60 via-purple-900/40 to-indigo-950/60 border border-violet-500/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
            <div>
              <p className="text-sm font-semibold text-white">
                {locale === 'en' ? 'Demo Limit Reached (15 / 15 messages)' : 'Límite de la demo alcanzado (15 / 15 mensajes)'}
              </p>
              <p className="text-xs text-zinc-300">
                {locale === 'en'
                  ? 'Unlock unlimited AI market queries and deep freight analysis.'
                  : 'Desbloquea consultas ilimitadas con IA y análisis profundo de tarifas.'}
              </p>
            </div>
            <a
              href="https://trucky.site"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs whitespace-nowrap shadow-md transition-all flex items-center gap-1.5"
            >
              <span>{locale === 'en' ? 'Upgrade Plan →' : 'Activar versión completa →'}</span>
            </a>
          </div>
        ) : (
          <div>
            {isDemoUser && (
              <div className="flex items-center justify-between mb-2 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 font-medium">
                  DEMO · {userMessagesCount} de {maxMessages} mensajes
                </span>
                <a
                  href="https://trucky.site"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-violet-300 underline transition-colors"
                >
                  {locale === 'en' ? 'Unlimited access' : 'Acceso ilimitado'}
                </a>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={translatingHistory ? (locale === 'en' ? 'Translating history...' : 'Traduciendo historial...') : t.inputPlaceholder}
                  disabled={loading || translatingHistory || isChatLimitReached}
                  rows={1}
                  className="w-full resize-none bg-muted border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors disabled:opacity-60"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                />
              </div>
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading || translatingHistory || isChatLimitReached}
                className="w-11 h-11 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center flex-shrink-0 transition-all"
              >
                <Send className="w-4 h-4 text-primary-foreground" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}