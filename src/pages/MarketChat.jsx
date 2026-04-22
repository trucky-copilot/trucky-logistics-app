import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Plus, Loader2, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { marketChat } from '@/functions/marketChat';
import ReactMarkdown from 'react-markdown';

const QUICK_PROMPTS = [
  "¿Cuánto cobro por una carga de Miami a Tampa?",
  "¿Qué tarifa pido de Port Everglades a Naples?",
  "¿Vale la pena Quickload a $2.20/milla?",
  "¿Cuánto debería cobrar Miami a West Palm Beach?",
  "¿Qué tasa mínima necesito para no perder dinero?",
];

export default function MarketChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [costConfig, setCostConfig] = useState(null);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const loadConfig = async () => {
      const user = await base44.auth.me();
      const configs = await base44.entities.CostConfig.filter({ usuario: user.email });
      if (configs.length > 0) setCostConfig(configs[0]);
    };
    loadConfig();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text) => {
    const userMessage = text || input.trim();
    if (!userMessage || loading) return;

    const newMessages = [...messages, { role: 'user', content: userMessage, timestamp: new Date().toISOString() }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));

    const res = await marketChat({ messages: apiMessages, costConfig });
    
    if (res.data?.content) {
      const updatedMessages = [...newMessages, { role: 'assistant', content: res.data.content, timestamp: new Date().toISOString() }];
      setMessages(updatedMessages);

      // Save to history
      const user = await base44.auth.me();
      const title = userMessage.length > 50 ? userMessage.slice(0, 50) + '...' : userMessage;
      await base44.entities.ChatHistory.create({
        session_id: sessionId,
        usuario: user.email,
        messages: updatedMessages,
        titulo: title,
      });
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNew = () => {
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Chat de Mercado
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Consulta tarifas, rutas y estrategia de precios</p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva consulta
        </button>
      </div>

      {/* Cost config banner */}
      {costConfig && (
        <div className="mx-4 md:mx-6 mt-3 flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary">
          <Zap className="w-3.5 h-3.5 flex-shrink-0" />
          Personalizado: ${costConfig.costo_por_milla?.toFixed(2)}/mi costo · ${costConfig.tarifa_objetivo}/mi objetivo
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground mb-1">TruckyAI — Asesor de Mercado</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">Pregunta sobre tarifas por ruta, estrategia de precios o rentabilidad. Conozco el mercado de Florida.</p>
            <div className="grid gap-2 w-full max-w-md">
              {QUICK_PROMPTS.map((prompt, i) => (
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
              <span className="text-sm text-muted-foreground">Analizando mercado...</span>
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
              placeholder="Pregunta sobre tarifas, rutas, mercado..."
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