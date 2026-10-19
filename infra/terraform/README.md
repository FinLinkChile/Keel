# Keel en AWS (Terraform)

Crea la arquitectura de [despliegue en AWS](../../docs/arquitectura/despliegue-aws.md): 20 funciones Lambda, API HTTP con 30 rutas, 6 tablas de DynamoDB, buckets de documentos y de evidencia (Object Lock), colas SQS con cola de fallidos, 3 llaves KMS secp256k1, parámetros de configuración de Systems Manager, programadores, alarmas y presupuesto. **[PROPUESTA]**: nunca se ha aplicado a una cuenta real.

La llave de los dueños de la Safe nunca entra aquí. Terraform no crea ni lee los secretos: un parámetro gestionado por Terraform guarda su valor descifrado en `terraform.tfstate`, así que se crean a mano (paso 3) y Terraform solo da permiso a cada función para leer los suyos. El estado queda sin llaves ni tokens, pero igual conviene guardarlo fuera de carpetas sincronizadas (OneDrive) o en el backend S3 comentado en `versions.tf`.

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

3. Crear los secretos que lista la salida `secrets_to_load`, uno por uno, desde tu terminal (nunca en un chat ni en un archivo del repositorio). La primera vez sin `--overwrite`; para cambiar un valor, con `--overwrite`:

   ```bash
   aws ssm put-parameter --type SecureString --name /keel-secrets/84532/rpc_url --value "https://…"
   ```

   | Secreto | Qué es |
   | --- | --- |
   | `rpc_url` | URL completa del proveedor de RPC de Base Sepolia |
   | `relayer_private_key`, `policy_signer_private_key`, `pauser_private_key` | Solo con `key_source_* = "ssm"`: las llaves actuales, cuyas direcciones están registradas en `contracts/deployments/84532.json` |
   | `telegram_bot_token` | Token del bot. Sin webhook: si alguna vez se configuró uno, borrarlo con `deleteWebhook` |
   | `bot_inbound_token`, `bot_admin_token`, `directory_admin_token`, `ingest_webhook_token`, `ingest_admin_token` | Tokens de al menos 32 caracteres, todos distintos |
   | `llm_keys` | JSON `{"anthropic": "…", "openai": "…", "gemini": "…", "compat": "…"}` con las que existan. Con un proxy de Anthropic, `anthropic` es el token del proxy y su URL va en la variable `anthropic_base_url` de Terraform, nunca en el secreto |

   Hasta que un secreto exista, la función que lo usa falla al leerlo (`ParameterNotFound`) en vez de seguir sin él.

4. Registrar quién representa a la Safe del importador con `POST /importers`, los proveedores con `POST /suppliers` (los dos con el token `directory_admin_token`) y el directorio del bot con `PUT /bot/recipients` (ver [avisos al bot](../../docs/interfaces/avisos-al-bot.md)). Sin el primer paso, toda ruta del importador responde `not_importer`.

5. En la app, `EXPO_PUBLIC_API_URL` igual a la salida `api_endpoint`.

## Para pasar las llaves a KMS

Las direcciones de las llaves KMS se leen con `aws kms get-public-key --key-id <id>` (salida `kms_key_ids`). El Área 1 las registra en los contratos (`setPolicySigner` por el Delay, `setGuardian`, y el relayer en su rol); después se cambia `key_source_*` a `kms` y se aplica de nuevo.
