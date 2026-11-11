# F6-01 · Tarifas en base de datos

Las tarifas drayage (rutas, zonas, accesoriales y alias) viven en Base44, se ven y
editan en **Tarifas** (`/tarifas`) y el chat las lee de ahí. La lógica del
cotizador no cambió: solo la fuente de los datos.

## Quién puede usarlo

Rol `admin` en Base44 **y** correo en `src/lib/adminAccess.js` /
`base44/shared/adminAccess.ts` (hoy `luis.bermudez@ogm.com.co`,
`juan.grau@ogm.com.co`). Las cuentas de pruebas no ven el panel.

## Piezas

| Pieza | Qué hace |
|---|---|
| `RateRoute`, `RateZone`, `RateAccessorial`, `RateAlias` | Tablas (solo admin). Clave estable por registro. |
| `RateChangeLog` | Historial: quién, cuándo, antes → después (también lo eliminado). Se conserva 12 meses. |
| `marketChat/rateSource.ts` | El chat lee las tablas (caché 60 s). Base vacía, migración a medias, error o dato inválido → sigue con los JSON del repo / lo último bueno. |
| `adminSaveRates` | Única puerta de escritura: vista previa → confirmar. Valida todo; si hay un error no guarda nada. Detecta si otro admin guardó en medio. |
| `adminMigrateRates` | Copia inicial de los JSON a la base (una vez) y verificación de 0 diferencias. |
| `shared/rateEdits.ts`, `shared/rateApply.ts`, `shared/rateCatalog.ts` | Reglas puras (validación, UPSERT, conversión), probadas con `deno test`. |

## Excel

Mismo conversor que generó las tablas (`scripts/convertRateTables.ts`, hojas
`Rates_Drayage`/`Accesoriales` para FL y `Rates_Drayage_TX`/`Accesoriales_TX`
para TX). Cada ruta se reconoce por **estado + mercado + ciudad + zona** (no por
la fila), así un archivo con filas corridas actualiza el mismo registro. Con la
casilla marcada, lo que no viene en el archivo se **elimina** (no se acumula).

## Puesta en marcha

1. Publicar (sincroniza tablas y funciones). Con la base vacía el chat responde igual que hoy.
2. Tarifas → Migración → **Previsualizar** (esperado: 272 rutas, 28 accesoriales, 61 alias, 10 zonas nuevas).
3. **Migrar** y luego **Verificar** → debe decir *0 diferencias*. Desde ahí el chat lee la base.
4. Alias → corregir los 48 ZIP de TX marcados "ruta no existe" (ya estaban rotos antes de F6-01).
5. Cuando la verificación esté ok en producción, se puede quitar `adminMigrateRates` y la pestaña Migración.

## Fuera de alcance

Factores de tamaño de TX y tramos cortos (lógica del cotizador, sin cambios).
`ContainerRoute` (cargas antiguas del panel `/admin`) sigue funcionando igual y
**el cotizador la consulta antes que la tabla de rutas**: si tiene una fila para la
misma ciudad, esa gana. Revisar en Base44 → Data → ContainerRoute que esté vacía
(o decidir qué hacer con esas filas) para que lo editado en Tarifas sea lo que use el chat.
