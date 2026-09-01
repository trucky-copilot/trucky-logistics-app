import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Plus, Loader2, Zap, History, X, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { marketChat } from '@/functions/marketChat';
import { useAppState } from '@/lib/AppStateContext';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import ReactMarkdown from 'react-markdown';

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
      "¿Vale Quickload a $2.20?",
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
      "Is Quickload worth it at $2.20?",
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

export default function MarketChat() {
  const { userProfile } = useAppState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [costConfig, setCostConfig] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionDbId, setSessionDbId] = useState(null); // DB record id for upsert
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  // locale del toggle ES/EN. Fuente inicial: UserProfile.idioma_chat (carga
  // ya hecha por AppStateContext, sin fetch adicional). Default 'es' si el
  // perfil no trae el campo (usuarios previos a este cambio).
  const [locale, setLocale] = useState(userProfile?.idioma_chat === 'en' ? 'en' : 'es');
  const t = UI_STRINGS[locale];
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Escritura optimista: el toggle cambia de inmediato en UI (setLocale ya
  // corrió sincrónicamente en el handler); esta función solo persiste la
  // preferencia en UserProfile en paralelo, sin bloquear. Sigue el mismo
  // patrón filter→update/create de Onboarding.jsx L82-88. Una falla acá no
  // revierte el toggle — solo no persiste para la próxima sesión.
  const persistLocale = async (nextLocale) => {
    try {
      const user = await base44.auth.me();
      const existingProfiles = await base44.entities.UserProfile.filter({ usuario: user.email });
      if (existingProfiles.length > 0) {
        await base44.entities.UserProfile.update(existingProfiles[0].id, { idioma_chat: nextLocale });
      } else {
        await base44.entities.UserProfile.create({ usuario: user.email, idioma_chat: nextLocale });
      }
    } catch (err) {
      console.error('MarketChat: no se pudo persistir idioma_chat', err);
    }
  };

  const handleLocaleChange = (nextLocale) => {
    if (!nextLocale || nextLocale === locale) return; // Radix single-select puede devolver '' al deseleccionar
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };

  useEffect(() => {
    const init = async () => {
      const user = await base44.auth.me();

      // Load cost config
      const configs = await base44.entities.CostConfig.filter({ usuario: user.email });
      if (configs.length > 0) setCostConfig(configs[0]);

      // Load existing session for this user (1 session per user)
      const sessions = await base44.entities.ChatHistory.filter({ usuario: user.email }, '-updated_date', 1);
      if (sessions.length > 0) {
        const session = sessions[0];
        setSessionId(session.session_id);
        setSessionDbId(session.id);
        setMessages(session.messages || []);
      } else {
        // Create a new session ID but don't save to DB until first message
        const newId = `session_${user.email}_${Date.now()}`;
        setSessionId(newId);
      }
    };
    init();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveSession = async (updatedMessages, currentSessionId, currentSessionDbId) => {
    const user = await base44.auth.me();
    const firstUserMsg = updatedMessages.find(m => m.role === 'user');
    const titulo = firstUserMsg
      ? (firstUserMsg.content.length > 50 ? firstUserMsg.content.slice(0, 50) + '...' : firstUserMsg.content)
      : t.defaultTitle;

    if (currentSessionDbId) {
      // Update existing record
      await base44.entities.ChatHistory.update(currentSessionDbId, {
        messages: updatedMessages,
        titulo,
      });
    } else {
      // Create new record
      const created = await base44.entities.ChatHistory.create({
        session_id: currentSessionId,
        usuario: user.email,
        messages: updatedMessages,
        titulo,
      });
      setSessionDbId(created.id);
    }
  };

  const sendMessage = async (text) => {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const newMessages = [...messages, { role: 'user', content: userMessage, timestamp: new Date().toISOString() }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const res = await marketChat({ messages: apiMessages, costConfig, locale });

      if (res.data?.error) {
        setError(res.data.error);
      } else if (res.data?.content) {
        const updatedMessages = [...newMessages, { role: 'assistant', content: res.data.content, timestamp: new Date().toISOString() }];
        setMessages(updatedMessages);
        await saveSession(updatedMessages, sessionId, sessionDbId);
      } else {
        setError(t.errorNoResponse);
      }
    } catch (err) {
      console.error('MarketChat: error al enviar mensaje', err);
      // El cliente de functions se crea con `interceptResponses: false`, así que
      // axios rechaza cualquier respuesta no-2xx con el status en `err.response`.
      // Las entidades (saveSession) sí pasan por el interceptor y lanzan
      // Base44Error, que trae el status en `err.status`. Antes todo caía en el
      // mismo mensaje de "revisa tu conexión", así que un 401 del backend
      // (sesión vencida) se reportaba como problema de red.
      const status = err?.response?.status ?? err?.status;
      if (status === 401 || status === 403) {
        setError(t.errorSessionExpired);
      } else if (status) {
        setError(t.errorStatus(status));
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
    const user = await base44.auth.me();
    const newId = `session_${user.email}_${Date.now()}`;
    setSessionId(newId);
    setSessionDbId(null);
    setMessages([]);
    setInput('');
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const loadHistoryItem = (item) => {
    setSessionId(item.session_id);
    setSessionDbId(item.id);
    setMessages(item.messages || []);
    setShowHistory(false);
  };

  const openHistory = async () => {
    const user = await base44.auth.me();
    const sessions = await base44.entities.ChatHistory.filter({ usuario: user.email }, '-updated_date', 20);
    setHistory(sessions);
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
          <ToggleGroup
            type="single"
            value={locale}
            onValueChange={handleLocaleChange}
            className="border border-border rounded-lg p-0.5"
          >
            <ToggleGroupItem value="es" size="sm" className="text-xs px-2.5 h-6">ES</ToggleGroupItem>
            <ToggleGroupItem value="en" size="sm" className="text-xs px-2.5 h-6">EN</ToggleGroupItem>
          </ToggleGroup>
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
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 text-sm text-muted-foreground hover:text-foreground transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center ${
              msg.role === 'user' ? 'bg-primary/20' : 'bg-muted'
            }`}>
              {msg.role === 'user'
                ? <User className="w-4 h-4 text-primary" />
                : <Bot className="w-4 h-4 text-muted-foreground" />
              }
            </div>
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground ml-auto'
                : 'bg-card border border-border text-foreground'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mb-2 [&>ol]:mb-2 [&>h1]:text-sm [&>h2]:text-sm [&>h3]:text-sm [&>strong]:text-foreground">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
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

      {/* Input */}
      <div className="flex-shrink-0 p-4 md:p-6 border-t border-border">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.inputPlaceholder}
              rows={1}
              className="w-full resize-none bg-muted border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
          </div>
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-11 h-11 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center flex-shrink-0 transition-all"
          >
            <Send className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}