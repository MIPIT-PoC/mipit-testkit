# MIPIT PoC — Resultados de Verificaciones E2E

**Fecha:** 2026-04-04
**Ambiente:** Docker Compose (11 contenedores) en macOS local
**Stack:** mipit-core (Fastify/TS), adapter-pix, adapter-spei, adapter-breb, PostgreSQL 16, RabbitMQ 3.13, Nginx, Grafana, Prometheus, Jaeger

---

## Resumen General

| # | Verificacion | Assertions | Resultado |
|---|---|---|---|
| 1 | Idempotencia bajo concurrencia | 4/4 | PASS |
| 2 | Validacion de alias invalidos | 6/6 | PASS |
| 3 | FX cross-currency | 6/6 | PASS |
| 4 | Traduccion round-trip fidelity | 12/12 | PASS |
| 5 | Limites exactos | 6/6 | PASS |
| 6 | Codigos de error por riel | 9/9 | PASS |
| 7 | Webhook delivery | 9/9 | PASS |
| 8 | Pipeline status progression + audit | 24/24 | PASS |
| **Total** | | **76/76** | **ALL PASS** |

---

## 1. Idempotencia bajo concurrencia

**Objetivo:** Verificar que 100 requests simultaneos con el mismo `Idempotency-Key` crean exactamente 1 pago.

**Mecanismo:** Claim atomico con `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` en PostgreSQL. El primer request que inserta la key gana; los demas reciben la respuesta cacheada (HTTP 200).

| Assertion | Resultado |
|---|---|
| 100 requests: 1 created (201) + 99 cached (200) = 100 | PASS |
| 0 errores de servidor (HTTP 5xx) | PASS |
| Todos devolvieron el mismo `payment_id` | PASS |
| Payload diferente + misma key -> 409 CONFLICT | PASS |

**Detalle tecnico:**
- Pre-generacion de `payment_id` antes del pipeline
- Idempotency claim atomico en la DB antes de ejecutar el pipeline
- Solo el ganador de la race condition ejecuta el pipeline completo

---

## 2. Validacion de alias invalidos

**Objetivo:** Verificar que aliases con formato incorrecto se rechazan antes de llegar al adapter.

| Caso | HTTP | Validacion |
|---|---|---|
| CLABE con check digit malo (`...785` vs `...784`) | 400 | Algoritmo BANXICO: pesos `[3,7,1,3,7,1...]`, check = `(10 - sum%10) % 10` |
| CLABE 17 digitos (necesita 18) | 400 | Regex `^\d{18}$` |
| CLABE con letras | 400 | Regex `^\d{18}$` |
| Telefono CO 9 digitos (`+57` necesita 10) | 400 | Regex `^\+57\d{10}$` |
| Prefijo desconocido (`UNKNOWN-`) | 400 | Whitelist: `PIX-`, `SPEI-`, `BREB-` |
| Alias vacio | 400 | `z.string().min(1)` |

---

## 3. FX cross-currency

**Objetivo:** Verificar que pagos en moneda diferente al riel destino incluyen metadata FX en el canonico.

| Caso | Resultado |
|---|---|
| USD -> PIX (BRL): pago creado | HTTP 201 |
| Canonico tiene `fx.source_currency` | PASS |
| Enrutado a PIX correctamente | PASS |
| MXN -> BRE_B (COP): pago creado | HTTP 201 |
| FX metadata preservada | PASS |

**Nota:** El FX service del PoC registra `source_currency` pero no aplica tasa en tiempo real (no hay API de cambio integrada). La arquitectura soporta `fx.rate`, `fx.target_currency`, y `fx.local_amount` para integracion futura.

---

## 4. Traduccion round-trip fidelity

**Objetivo:** Verificar que una traduccion PIX nativo -> Canonico -> N rieles preserva datos semanticos.

### Preview (PIX -> 6 rieles)

| Assertion | Resultado |
|---|---|
| HTTP 200 | PASS |
| `amount.value = 1500` (preservado) | PASS |
| `debtor.name = "Joao Silva"` (preservado) | PASS |
| `creditor.name = "Maria Santos"` (preservado) | PASS |
| `origin.rail = "PIX"` | PASS |
| SPEI back-translation tiene `monto` | PASS |
| SPEI translation exists | PASS |
| SWIFT MT103 translation exists | PASS |
| 6 rieles traducidos: SPEI, SWIFT_MT103, ISO20022_MX, ACH_NACHA, FEDNOW, BRE_B | PASS |

### Traduccion directa (PIX -> SPEI)

| Assertion | Resultado |
|---|---|
| HTTP 200 | PASS |
| SPEI `monto = 1500` | PASS |
| Campos SPEI-especificos presentes (`cuentaBeneficiario`, `claveRastreo`) | PASS |

**Payload PIX nativo usado:**
```json
{
  "endToEndId": "E2626422020260404120012345678901",
  "valor": {"original": "1500.00"},
  "pagador": {"ispb": "26264220", "nome": "Joao Silva", "cpf": "12345678901"},
  "recebedor": {"ispb": "60701190", "nome": "Maria Santos", "cpf": "98765432100"},
  "chave": "maria@email.com",
  "tipoChave": "EMAIL"
}
```

---

## 5. Limites exactos

**Objetivo:** Verificar que los limites de monto por riel se aplican correctamente.

| Caso | Resultado | Detalle |
|---|---|---|
| COP 19,999,999 (bajo limite natural) | 201 -> procesado | Mock BRE_B acepta |
| COP 20,000,001 (sobre limite natural) | 201 -> **REJECTED** | Error code `BREB003` |
| Monto 0 | 400 | Schema Zod: `z.number().positive()` |
| Monto negativo (-100) | 400 | Schema Zod: `z.number().positive()` |

**Nota:** Limite nocturno PIX (BRL 1,000) no probado en el test automatizado porque `MOCK_ENFORCE_HOURS=false` (evita rechazos por horario bancario fuera de horas BACEN SPI 07:00-20:00 BRT). La logica existe en el mock PIX y se activa con `MOCK_ENFORCE_HOURS=true`.

---

## 6. Codigos de error por riel

**Objetivo:** Verificar que cada riel produce los codigos de error esperados.

### Metodo
Se enviaron 40 pagos por riel con tasa de rechazo ~10% (mocks configurados). Codigos acumulados de multiples ejecuciones:

### PIX (BACEN SPI v2)

| Codigo | Significado | Ocurrencias |
|---|---|---|
| AM04 | Fondos insuficientes | 39 |
| RR04 | Regulatorio/compliance | 22 |
| AC01 | Cuenta inexistente | 11 |
| BE01 | Error tecnico | 11 |
| DS04 | Firma invalida | 9 |
| AB03 | Transaccion no soportada | 1,616* |

*AB03 elevado por pruebas tempranas con tasa de rechazo 100%.

### SPEI (CECOBAN)

| Codigo | Significado | Ocurrencias |
|---|---|---|
| R01 | Cuenta inexistente | 40 |
| R03 | Cuenta invalida | 18 |
| R02 | Cuenta cerrada | 13 |
| LIM | Limite excedido | 6 |
| R05 | Rechazo por beneficiario | 3 |
| BLQ | Cuenta bloqueada | 2 |
| R08 | Error tecnico | 1 |

### BRE_B (BanRep SPI Colombia)

| Codigo | Significado | Ocurrencias |
|---|---|---|
| BREB001 | Cuenta no encontrada | 86 |
| BREB004 | Error tecnico | 68 |
| BREB002 | Fondos insuficientes | 63 |
| BREB005 | Timeout | 29 |
| BREB003 | Limite excedido | 5 |

**Cobertura total: 18 codigos de error unicos observados** (5+ PIX, 7 SPEI, 5 BRE_B).

---

## 7. Webhook delivery

**Objetivo:** Verificar registro, listado, y entrega de webhooks con firma HMAC-SHA256.

| Assertion | Resultado |
|---|---|
| Pago creado | 201 |
| Webhook registrado | 201 |
| URL correcta (`httpbin.org/post`) | PASS |
| Events array correcto | PASS |
| Listado de webhooks | 200 |
| 1 webhook encontrado | PASS |
| Pago alcanzo estado terminal | PASS (COMPLETED/REJECTED) |
| Tracking de delivery intentos | PASS |
| 404 para payment inexistente | PASS |

### Evidencia de delivery en DB

```
payment_id                       | fired_at                       | attempts | http_status
PMT-01KNBK6TFAB49H774P0PBSE4MB  | 2026-04-04 06:34:41.658207+00 | 1        | 200
PMT-01KNBJSHW8TEBJ6J6GEEH5M414  | 2026-04-04 06:27:26.580968+00 | 1        | 200
PMT-01KNBFNG2GPG10JHT38AT096FM  | 2026-04-04 05:33:00.100792+00 | 1        | 200
```

**Firma:** Header `X-MIPIT-Signature: sha256=<hex>` usando `HMAC-SHA256(body, secret)`.

---

## 8. Pipeline status progression + audit

**Objetivo:** Verificar que cada etapa del pipeline genera timestamps y audit events en orden correcto.

### Timestamps (verificados en orden cronologico)

| Milestone | Ejemplo | Orden |
|---|---|---|
| `created_at` | 06:36:34.446Z | 1 |
| `validated_at` | 06:36:34.452Z | 2 |
| `canonicalized_at` | 06:36:34.459Z | 3 |
| `routed_at` | 06:36:34.468Z | 4 |
| `queued_at` | 06:36:34.478Z | 5 |
| `acked_at` | 06:36:34.814Z | 6 (async, post-adapter) |

**Latencia total pipeline (sync):** ~32ms (created -> queued)
**Latencia total incluyendo adapter:** ~368ms (created -> acked)

### Audit Trail (6 eventos en orden cronologico)

| # | Event Type | Actor |
|---|---|---|
| 1 | `PAYMENT_RECEIVED` | `system` |
| 2 | `PAYMENT_VALIDATED` | `system-validator` |
| 3 | `CANONICAL_UPDATED` | `system-translator` |
| 4 | `NORMALIZATION_COMPLETE` | `system` |
| 5 | `ROUTING_DECISION` | `system-router` |
| 6 | `STATUS_CHANGE` | `system` (ROUTED -> QUEUED) |

Todos los events tienen `trace_id` para correlacion distribuida.

### Datos almacenados

| Campo | Verificado |
|---|---|
| `canonical_payload` (pacs.008) | PASS |
| `translated_payload` (formato destino) | PASS |
| `route_rule_applied` (`pix_key_to_pix`) | PASS |
| `destination_rail` (PIX) | PASS |
| `origin_rail` (PIX) | PASS |
| `rail_ack.status` (ACCEPTED) | PASS |

---

## Pruebas previas (antes de las 8 verificaciones)

### Routing correctness (999 pagos)

**Fecha:** 2026-04-04 (sesion anterior)

| Riel | Enviados | Routing correcto | Completados | Rechazados (mock) |
|---|---|---|---|---|
| PIX | 333 | 333 (100%) | ~304 | ~29 |
| SPEI | 333 | 333 (100%) | ~304 | ~29 |
| BRE_B | 334 | 334 (100%) | ~300 | ~34 |
| **Total** | **999** | **999 (100%)** | ~908 | ~91 |

**0 pagos perdidos, 0 misrouted, 100% routing accuracy.**

### Round-trip tests (9 combinaciones)

Se verifico la traduccion entre todos los pares de rieles operativos:
- PIX -> SPEI, PIX -> BRE_B
- SPEI -> PIX, SPEI -> BRE_B
- BRE_B -> PIX, BRE_B -> SPEI
- (+ SWIFT_MT103, ISO20022_MX, ACH_NACHA, FEDNOW via `/translate/preview`)

### Frontend pages

| Pagina | HTTP | Estado |
|---|---|---|
| `/` (dashboard) | 200 | PASS |
| `/simulate` | 200 | PASS |
| `/history` | 200 | PASS |
| `/translator` | 200 | PASS |

---

## Infraestructura de pruebas

### Docker Compose Stack

```
mipit-core        :8080  — API REST + pipeline + consumer ACK
mipit-adapter-pix :9001  — Mock BACEN SPI v2
mipit-adapter-spei:9002  — Mock CECOBAN SPEI
mipit-adapter-breb:9003  — Mock BanRep SPI Colombia
mipit-postgres    :5432  — PostgreSQL 16 (pool max=50, max_connections=200)
mipit-rabbitmq    :5672  — RabbitMQ 3.13 (exchange topic + DLQ)
mipit-ui          :3001  — Next.js 14 dashboard
mipit-nginx       :80/443 — Reverse proxy + TLS
mipit-prometheus  :9090  — Metricas
mipit-grafana     :3000  — Dashboards
mipit-jaeger      :16686 — Tracing distribuido
```

### RabbitMQ Topology

```
Exchange: mipit.payments (topic)
  route.pix  -> payments.route.pix  (DLQ: dlq.pix)
  route.spei -> payments.route.spei (DLQ: dlq.spei)
  route.breb -> payments.route.breb (DLQ: dlq.breb)
  ack.pix  \
  ack.spei  |-> payments.ack (consumer en mipit-core)
  ack.breb /
```

### JWT Auth

```
Algorithm: HS256
Secret: mipit-poc-jwt-secret-change-in-production
Headers: Authorization: Bearer <token>
```

---

## Script de verificacion

Archivo: `mipit-testkit/e2e-verifications.mjs`

```bash
# Ejecutar
export TOKEN=$(node -e "...generar JWT...")
node e2e-verifications.mjs
```

**Duracion aproximada:** ~70 segundos (incluye 15s wait por riel para ACKs).
