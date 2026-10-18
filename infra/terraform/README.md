# Keel en AWS (Terraform)

Crea la arquitectura de [despliegue en AWS](../../docs/arquitectura/despliegue-aws.md): 19 funciones Lambda, API HTTP con 27 rutas, 6 tablas de DynamoDB, buckets de documentos y de evidencia (Object Lock), colas SQS con cola de fallidos, 3 llaves KMS secp256k1, parámetros y secretos de Systems Manager, programadores, alarmas y presupuesto. **[PROPUESTA]**: nunca se ha aplicado a una cuenta real.

La llave de los dueños de la Safe nunca entra aquí. Ningún valor secreto va en git ni en el estado: los secretos se crean con el valor `CAMBIAR` y se cargan a mano.

## Requisitos

- Terraform 1.6 o más nuevo y credenciales de AWS de la cuenta (perfil o variables de entorno).
- Node 24 y `npm ci` en la raíz del repositorio.
- En una cuenta nueva del plan gratuito: revisar que permita llaves KMS asimétricas y S3 Object Lock, y dejar `use_reserved_concurrency = false` (el agente usa un candado en DynamoDB).

## Orden

1. Empaquetar las funciones (escribe `dist/<funcion>.mjs`):

   ```bash
   npm run build -w aws
   ```

2. Revisar y aplicar desde esta carpeta:

   ```bash
   terraform init
   terraform plan -out plan.bin
   terraform apply plan.bin
   ```

   Variables útiles en un `terraform.tfvars` (fuera de git): `alert_email` (activa alarmas por correo y el presupuesto), `app_origin` (CORS), `key_source_*` (`ssm` en la demo, `kms` cuando el Área 1 haya registrado las direcciones de KMS en los contratos).

3. Cargar los secretos que lista la salida `secrets_to_load`, uno por uno:

   ```bash
   aws ssm put-parameter --overwrite --type SecureString --name /keel-secrets/84532/rpc_url --value "https://…"
   ```

   | Secreto | Qué es |
   | --- | --- |
   | `rpc_url` | URL completa del proveedor de RPC de Base Sepolia |
   | `relayer_private_key`, `policy_signer_private_key`, `pauser_private_key` | Solo con `key_source_* = "ssm"`: las llaves actuales, cuyas direcciones están registradas en `contracts/deployments/84532.json` |
   | `telegram_bot_token` | Token del bot. Sin webhook: si alguna vez se configuró uno, borrarlo con `deleteWebhook` |
   | `bot_inbound_token`, `bot_admin_token`, `directory_admin_token`, `ingest_webhook_token`, `ingest_admin_token` | Tokens de al menos 32 caracteres, todos distintos |
   | `llm_keys` | JSON `{"anthropic": "…", "openai": "…", "gemini": "…", "compat": "…"}` con las que existan |

4. Cargar el directorio del bot con `PUT /bot/recipients` y los proveedores con `POST /suppliers` (ver [avisos al bot](../../docs/interfaces/avisos-al-bot.md)).

5. En la app, `EXPO_PUBLIC_API_URL` igual a la salida `api_endpoint`.

## Para pasar las llaves a KMS

Las direcciones de las llaves KMS se leen con `aws kms get-public-key --key-id <id>` (salida `kms_key_ids`). El Área 1 las registra en los contratos (`setPolicySigner` por el Delay, `setGuardian`, y el relayer en su rol); después se cambia `key_source_*` a `kms` y se aplica de nuevo.
