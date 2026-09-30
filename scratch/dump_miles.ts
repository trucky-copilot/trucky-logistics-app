import { createClientFromRequest } from './base44/functions/marketChat/entry.ts'; // O crear cliente manualmente
// Para node/deno fuera de un request, normalmente se hace:
import { createClient } from "npm:@base44/sdk@0.8.48";
import * as dotenv from "npm:dotenv";

dotenv.config();

const client = createClient();
const items = await client.entities.MilesCache.list();
console.log(JSON.stringify(items, null, 2));
