import { billingGuard } from "./billingGuard.ts";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

// ═══════════════════════════════════════════════════════════════════════════════
// extractDocumentText
// ───────────────────────────────────────────────────────────────────────────────
// Operación acotada: extrae el texto de UNA imagen/documento que la propia app ya
// subió a su almacenamiento, con un prompt fijo. No es un proxy genérico: no
// acepta prompt del llamador, no acepta URLs externas y devuelve solo texto plano.
//
// Existe porque `integrations.Core.InvokeLLM` no debe invocarse desde el cliente.
// Lo usan el Verificador de Documentos y el panel de administración.
// ═══════════════════════════════════════════════════════════════════════════════

const EXTRACT_PROMPT =
  'Extract all text content from this document exactly as it appears. Return only the raw text, no commentary.';

// Solo archivos de la propia app: almacenamiento de Base44 (medios) o su dominio.
function isAppOwnedFileUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false;
  try {
    const host = new URL(value).hostname;
    return (
      host === 'media.base44.com' ||
      host.endsWith('.base44.com') ||
      host.endsWith('.base44.app')
    );
  } catch (_error) {
    return false;
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const billingDenied = await billingGuard(req, base44);
    if (billingDenied) return billingDenied;
    let user;
    try {
      user = await base44.auth.me();
    } catch (_error) {
      user = null;
    }
    if (!user) return Response.json({ error: 'No autorizado' }, { status: 401 });

    let body;
    try {
      body = await req.json();
    } catch (_error) {
      return Response.json({ error: 'Cuerpo de la petición inválido' }, { status: 400 });
    }

    const { file_url } = body || {};
    if (!isAppOwnedFileUrl(file_url)) {
      return Response.json({ error: 'Archivo no válido' }, { status: 400 });
    }

    const extracted = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: EXTRACT_PROMPT,
      file_urls: [file_url],
    });

    return Response.json({
      text: typeof extracted === 'string' ? extracted : JSON.stringify(extracted),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}