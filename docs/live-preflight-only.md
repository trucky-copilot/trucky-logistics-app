# Read-only live Stripe preflight

Deploy only checkLiveBillingConfiguration (entry.ts) after review. No schema, RLS, native-login or access changes. No Stripe creation, updates, payments or refunds.

Protected Base44 secrets: existing TRUCKY_SERVER_SECRET, new STRIPE_LIVE_SECRET_KEY. Keep live payment/sync/access flags disabled. Calls require S2S Authorization Bearer and body {prices:[ownerOpPriceId,fleetPriceId]}. Checks live, active, USD 29/99, fixed per-unit monthly interval=1. Response LIVE_CONFIGURATION_VALID proves only price/key compatibility, not delivery of paid access or webhook correctness.

Do not include secret values in chat or screenshots. Website live preflight code is still pending deployment; this endpoint can be verified independently by the developer through protected server inputs. Use the same live account as the real webhook destination.

After deployment report exact code (LIVE_CONFIGURATION_VALID, LIVE_KEY_REQUIRED, LIVE_PRICE_MISMATCH, LIVE_CONFIGURATION_UNAVAILABLE), never credentials. No real purchase should be attempted at this stage. Draft #23 remains separate and incomplete.
