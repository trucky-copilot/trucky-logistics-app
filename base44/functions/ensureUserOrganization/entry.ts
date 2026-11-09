import {ensureUserOrganization} from './handler.ts';
// Preserve the existing Base44 Deno.serve entrypoint. Tests import handler.ts.
Deno.serve(req=>ensureUserOrganization(req));
