import { demoRedis } from "./base44/functions/getBillingLinkState/demoRegistry.ts";

// 1. Check Redis keys
console.log("--- REVISIÓN EN REDIS ---");
try {
  // Buscar claves de identidad y vinculación
  const identityKeys = await demoRedis(["KEYS", "trucky:billing:identity:v1:*"]);
  console.log("Claves trucky:billing:identity:v1:* encontradas:", identityKeys.length, identityKeys);

  const nativeKeys = await demoRedis(["KEYS", "trucky:billing:native:v1:*"]);
  console.log("Claves trucky:billing:native:v1:* encontradas:", nativeKeys.length, nativeKeys);

  const memberProvenanceKeys = await demoRedis(["KEYS", "trucky:billing:member:v1:*"]);
  console.log("Claves trucky:billing:member:v1:* (provenance) encontradas:", memberProvenanceKeys.length, memberProvenanceKeys);

  const handoffKeys = await demoRedis(["KEYS", "trucky:billing:handoff:v1:*"]);
  console.log("Claves trucky:billing:handoff:v1:* (tickets en espera) encontradas:", handoffKeys.length);
  // Nota: handoffKeys son hashes SHA-256 de los códigos temporales, no los códigos en texto claro.
} catch (err) {
  console.error("Error consultando Redis:", err.message);
}
