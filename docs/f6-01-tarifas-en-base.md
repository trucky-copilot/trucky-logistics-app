# F6-01 · Tarifas en base de datos

Las tarifas drayage (rutas, zonas, accesoriales y alias) viven en Base44, se
cargan y editan en **Panel Admin → Tarifas** y el chat las lee de ahí.
El Excel es la entrada principal: cada carga es una nueva versión de las tarifas. La lógica del
cotizador no cambió: solo la fuente de los datos.

## Quién puede usarlo

Rol `admin` en Base44 **y** correo en `src/lib/adminAccess.js` /
`base44/shared/adminAccess.ts` (hoy `luis.bermudez@ogm.com.co`,
`juan.grau@ogm.com.co`). Las cuentas de pruebas no ven el panel.

## Piezas

| Pieza | Qué hace |
|---|---|
| `RateRoute`, `RateZone`, `RateAccessorial`, `RateAlias` | Tablas (solo admin). Clave estable por registro. |
| `RateChangeLog` | Sin uso: el historial se retiró por decisión de producto. La tabla puede eliminarse en Base44. |
| `marketChat/rateSource.ts` | El chat lee las tablas (caché 60 s). Base vacía, migración a medias, error o dato inválido → sigue con los JSON del repo / lo último bueno. |
| `adminSaveRates` | Única puerta de escritura: vista previa → confirmar. Valida todo; si hay un error no guarda nada. Detecta si otro admin guardó en medio. |
| `adminMigrateRates` | Carga inicial automática: la primera vez que se abre la sección, copia las tarifas actuales (JSON del repo) a las tablas vacías y verifica 0 diferencias. No tiene botón. |
| `adminUploadStateData` | Ya NO escribe `ContainerRoute`; solo analiza con IA tarifas por milla por estado. Si recibe el Excel drayage, la pantalla lo redirige a Tarifas. |
| `shared/rateEdits.ts`, `shared/rateApply.ts`, `shared/rateCatalog.ts` | Reglas puras (validación, UPSERT, conversión), probadas con `deno test`. |

## Excel

Mismo conversor que generó las tablas (`shared/rateExcel.ts`, hojas
`Rates_Drayage`/`Accesoriales` para FL y `Rates_Drayage_TX`/`Accesoriales_TX`
para TX). Cada ruta se reconoce por **estado + mercado + ciudad + zona** (no por
la fila), así un archivo con filas corridas actualiza el mismo registro. Con la
casilla marcada, lo que no viene en el archivo se **elimina** (no se acumula).

## Pantalla

Panel Admin → **Tarifas**: *Cargar Excel* (entrada principal), *Rutas* y *Zonas*.
Los accesoriales se actualizan con la hoja de accesoriales del mismo Excel. Los
alias (terminales FL, ZIP TX) siguen en la base y el chat los usa, pero no tienen
pantalla.

## Control de calidad del Excel (validación estricta)

Al revisar el archivo se muestra, antes de confirmar, con la fila exacta:

| Revisión | Resultado |
|---|---|
| Filas leídas (rutas y accesoriales) | informativo |
| Campos vacíos o precios inválidos (≤ 0, piso > objetivo) | **bloquea** |
| Rutas repetidas en el archivo (misma ciudad + mercado + zona) | **bloquea** |
| Millas imposibles: 0, más de 3000, o fuera del rango de su zona (−25 % / +25 %) | **bloquea** |
| Cambios de más del 30 % en precio, piso o millas frente a lo guardado, o un tamaño que deja de venir | aviso (puede ser real) |

Si algo bloquea, no se guarda nada. Nota: la tabla oficial actual de FL trae
Lake Worth Beach repetida (filas 81 y 82, mismos valores); hay que dejar una sola
antes de la próxima carga.

## Puesta en marcha

1. Publicar. Con las tablas vacías el chat responde igual que hoy.
2. Entrar a **Panel Admin → Tarifas**: la primera vez se cargan solas las tarifas actuales y aparece *0 diferencias*. Desde ahí el chat lee la base.
3. Si aparece el aviso de tarifas antiguas (`ContainerRoute`), decidir qué hacer con ellas: el cotizador las consulta primero.

## Fuera de alcance

Factores de tamaño de TX y tramos cortos (lógica del cotizador, sin cambios).
`ContainerRoute` (cargas antiguas del panel `/admin`) sigue funcionando igual y
**el cotizador la consulta antes que la tabla de rutas**: si tiene una fila para la
misma ciudad, esa gana. Revisar en Base44 → Data → ContainerRoute que esté vacía
(o decidir qué hacer con esas filas) para que lo editado en Tarifas sea lo que use el chat.

## Nota de despliegue (Base44)

Base44 publica cada función con **su carpeta y `base44/shared/`**, nada más. Por eso
los datos de tarifas (`shared/rateData/*.json`) y el conversor de Excel
(`shared/rateExcel.ts`) viven en `shared/`: así los reciben `marketChat`,
`adminSaveRates` y `adminMigrateRates`. Una función nunca debe importar archivos
de la carpeta de otra función.
