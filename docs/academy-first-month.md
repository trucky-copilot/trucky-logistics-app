# Academia: primera factura gratis, después precio mensual normal

Base: 7e365e87. No cambia la demo, bonos de demo, sincronización live, política de facturas pagadas normales ni identidades.

Publicar `base44/shared/academyPlanCredit.ts` y `livePlanRuntime.ts` con TODAS sus funciones consumidoras (getMyPlan y las que importan livePlanRuntime/liveChatQuota/entitlements, incluidas chat/documentos/correo). No activar la landing antes de este despliegue.

La landing valida el cupón en Stripe, reserva una vez por Google sub hasheado con SET NX/Lua y conserva la reserva sin TTL. El webhook de Vercel verifica la firma y enlaza la suscripción al recibo atómicamente antes de llamar a syncBillingSubscription. No se confía en un flag enviado por navegador. La sincronización existente proyecta `active` del modo habitual, no `trialing`: no hay trial Stripe.

La excepción de acceso de US$0 requiere TODO: suscripción live/active, recibo Redis emitido por landing y confirmado por webhook para ESA suscripción/empresa/intento/precio, factura inicial live/paid de total0 y amount_paid0 con una sola línea mensual29, un solo descuento del cupón del recibo y total de descuento2900. Solo durante el período de la línea inicial (mes de facturación de Stripe, no 30 días fijos). Da plan29 y crédito1000 asociado a ESA factura; visitas/reenvíos no lo renuevan. Renovación debe ser pagada (>0) y usa paidPlanCredit intacto. past_due/canceled no acceden.

Lectura de facturas añade `expand[]=data.discounts` SOLO en suscripciones con marcador ACADEMY. Usa formato Stripe nuevo discount.source.coupon y anterior discount.coupon. Requiere el permiso de lectura de facturas ya existente. Reconocimiento no depende de un flag de altas: apagar la promoción nunca corta a quienes ya recibieron el mes.

Landing: nuevo secreto `STRIPE_LIVE_ACADEMY_COUPON` (ID, no price ni código promocional). Nuevo interruptor `STRIPE_ACADEMY_ENABLED=true` SOLO tras publicar esta parte y configurar el cupón. No se necesitan nuevos secretos Base44.

Stripe real: cupón 100%, duración once, solo producto del plan29, sin redeem_by ni max_redemptions (sin caducidad ni tope global). El límite de una vez por cuenta lo impone Redis. No crear un precio0 ni modificar precio29. Captura de método de pago sigue always; renovación29/mes visible al confirmar. El viejo descuento automático US$1 deja de aplicarse: sin código se cobra normal; ACADEMY no se combina.

Recuperación: nunca borrar recibos/claims a mano. Si un usuario abandona y expira su sesión, el intento/código puede requerir revisión de operador; una reserva sin sessionId no prueba ausencia de sesión. Ante cualquier fallo se conserva el beneficio reservado, y NO se emite otra suscripción. El mismo intento se reintenta idempotentemente y los duplicados de webhook son seguros. Para reemplazar una reserva abandonada hace falta verificar la sesión anterior expirada y ningún sub/cobro existente, antes de diseñar una recuperación administrativa; NO lo hace este parche.

Aceptación de operador sin compra desde Agent: sin código29 normal; ACADEMY29 primera factura0 y renovación29; ACADEMY99 rechazado; inválido corregible; misma cuenta dos empresas concurrentes solo una reserva; webhook duplicado conserva recibo; otras facturas0 sin acceso; vencimiento del período cierra la excepción; factura de renovación pagada concede el nuevo cupo; demo intacta. La prueba con tarjeta debe hacerla el titular, nunca compartir datos.
