locals {
  name           = "keel-${var.stage}"
  cfg_prefix     = "/keel/${var.chain_id}"
  secrets_prefix = "/keel-secrets/${var.chain_id}/"

  # Cada secreto es un SecureString que se crea a mano (aws ssm put-parameter, README.md): Terraform
  # no los gestiona para que su valor nunca quede en el estado. Cada funcion lee solo los suyos.
  secret_names = [
    "rpc_url",                   # URL completa del proveedor de RPC: agente, monitor, indexador y API de ordenes (ERC-1271)
    "relayer_private_key",       # solo si key_source_relayer = "ssm"
    "policy_signer_private_key", # solo si key_source_policy_signer = "ssm"
    "pauser_private_key",        # solo si key_source_pauser = "ssm"
    "telegram_bot_token",
    "bot_inbound_token",     # POST /notices y /ingest/outcomes
    "bot_admin_token",       # GET y PUT /bot/recipients
    "directory_admin_token", # POST /suppliers, POST y GET /importers
    "ingest_webhook_token",  # POST /inbound (reenviador de correo)
    "ingest_admin_token",    # GET y PUT /admin/settings
    "llm_keys",              # JSON {anthropic?, openai?, gemini?, compat?}
    "carrier_private_key",   # solo si demo_auto_attest = true: llave de prueba de la naviera
  ]
  secret_arn = { for n in local.secret_names : n => "arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter${local.secrets_prefix}${n}" }

  # ---------- Tablas (las formas de cada item estan en aws/src/tables.ts) ----------
  tables = {
    proposals = {
      hash   = "orderId"
      range  = null
      attrs  = { orderId = "S", importer = "S", exporter = "S" }
      gsis   = { byImporter = "importer", byExporter = "exporter" }
      stream = true
      ttl    = false
    }
    orders = {
      hash   = "orderId"
      range  = null
      attrs  = { orderId = "S", safe = "S" }
      gsis   = { bySafe = "safe" }
      stream = false
      ttl    = false
    }
    parties = {
      hash   = "address"
      range  = null
      attrs  = { address = "S" }
      gsis   = {}
      stream = false
      ttl    = false
    }
    agent_state = {
      hash   = "id"
      range  = null
      attrs  = { id = "S" }
      gsis   = {}
      stream = false
      ttl    = true
    }
    ingest = {
      hash   = "pk"
      range  = "sk"
      attrs  = { pk = "S", sk = "S" }
      gsis   = {}
      stream = false
      ttl    = true
    }
    bot = {
      hash   = "pk"
      range  = "sk"
      attrs  = { pk = "S", sk = "S" }
      gsis   = {}
      stream = false
      ttl    = true
    }
  }
  tbl     = { for k, t in aws_dynamodb_table.t : k => t.arn }
  tbl_idx = { for k, t in aws_dynamodb_table.t : k => "${t.arn}/index/*" }

  # ---------- Funciones: una por archivo de aws/src/handlers ----------
  # role: rol de IAM. reserve: concurrencia reservada de 1 si use_reserved_concurrency (el candado
  # en DynamoDB ya evita vueltas simultaneas; la reserva es una segunda barrera opcional).
  # URL del proxy de Anthropic (vacia: la API de Anthropic). Va en el entorno y nunca en llm_keys
  # ni por la API de administracion. La reciben las funciones que arman el extractor.
  # ATAJO DE DEMO, apagado por defecto: el extractor firma la prueba de embarque con la llave de la
  # naviera al tener BL y factura (aws/src/orders/autoAttest.ts). Rompe la separacion de poderes.
  demo_attest_env = { for k, v in { KEEL_DEMO_AUTO_ATTEST = "1" } : k => v if var.demo_auto_attest }

  llm_env = { for k, v in { ANTHROPIC_BASE_URL = var.anthropic_base_url } : k => v if v != "" }

  # Funciones: 20 desde el analisis de compras (insights).
  # El agente retiene su candado 110 s: su timeout tiene que ser menor. Monitor e indexador, 55 s.
  # El extractor puede tardar 3 intentos de 60 s del LLM (LLM_TIMEOUT_MS); la cola le da 720 s de visibilidad.
  # Proforma e inbound llaman al LLM dentro de la peticion (API Gateway corta a los 29 s): su
  # LLM_TIMEOUT_MS es 20 s, para que el SDK falle antes que la funcion y se registre la transferencia.
  functions = {
    proposals  = { role = "orders_write", timeout = 28, memory = 512, reserve = false }
    orders     = { role = "orders_read", timeout = 28, memory = 512, reserve = false }
    signatures = { role = "orders_write", timeout = 28, memory = 512, reserve = false }
    directory  = { role = "directory", timeout = 28, memory = 512, reserve = false }
    attest     = { role = "orders_write", timeout = 28, memory = 512, reserve = false }
    registrar  = { role = "registrar", timeout = 28, memory = 512, reserve = false }
    upload     = { role = "upload", timeout = 28, memory = 512, reserve = false }
    inbound    = { role = "inbound", timeout = 28, memory = 512, reserve = false }
    proforma   = { role = "proforma", timeout = 28, memory = 1024, reserve = false }
    insights   = { role = "insights", timeout = 28, memory = 512, reserve = false }
    admin      = { role = "admin", timeout = 28, memory = 512, reserve = false }
    extractor  = { role = "extractor", timeout = 300, memory = 1536, reserve = false }
    digest     = { role = "digest", timeout = 60, memory = 512, reserve = true }
    fanout     = { role = "fanout", timeout = 28, memory = 512, reserve = true }
    agent      = { role = "agent", timeout = 100, memory = 512, reserve = true }
    indexer    = { role = "indexer", timeout = 50, memory = 512, reserve = true }
    monitor    = { role = "monitor", timeout = 50, memory = 512, reserve = true }
    noticesIn  = { role = "notices_in", timeout = 28, memory = 512, reserve = false }
    botNotify  = { role = "bot_notify", timeout = 60, memory = 512, reserve = false }
    botAdmin   = { role = "bot_admin", timeout = 28, memory = 512, reserve = false }
  }

  common_env = {
    KEEL_CHAIN_ID       = var.chain_id
    KEEL_CONFIG_PREFIX  = "${local.cfg_prefix}/"
    KEEL_SECRETS_PREFIX = local.secrets_prefix
    KEEL_STAGE          = var.stage
    KEEL_LOG_RANGE      = tostring(var.log_block_range)
  }

  t = { for k, v in aws_dynamodb_table.t : k => v.name }

  orders_api_env = {
    PROPOSALS_TABLE = local.t["proposals"]
    ORDERS_TABLE    = local.t["orders"]
    PARTIES_TABLE   = local.t["parties"]
  }

  function_env = {
    proposals  = local.orders_api_env
    orders     = local.orders_api_env
    signatures = local.orders_api_env
    directory  = local.orders_api_env
    attest     = local.orders_api_env
    registrar = {
      PROPOSALS_TABLE = local.t["proposals"]
      ORDERS_TABLE    = local.t["orders"]
      PARTIES_TABLE   = local.t["parties"]
      INGEST_TABLE    = local.t["ingest"]
    }
    upload   = { INGEST_TABLE = local.t["ingest"], DOCS_BUCKET = aws_s3_bucket.docs.bucket }
    inbound  = merge(local.llm_env, { INGEST_TABLE = local.t["ingest"], DOCS_BUCKET = aws_s3_bucket.docs.bucket, NOTICES_QUEUE_URL = aws_sqs_queue.notices.url, LLM_TIMEOUT_MS = "20000" })
    proforma = merge(local.llm_env, { INGEST_TABLE = local.t["ingest"], PARTIES_TABLE = local.t["parties"], LLM_TIMEOUT_MS = "20000" })
    # El analisis de compras llama al modelo dentro de la peticion, igual que la proforma
    insights  = merge(local.llm_env, { INGEST_TABLE = local.t["ingest"], PARTIES_TABLE = local.t["parties"], LLM_TIMEOUT_MS = "20000" })
    admin     = merge(local.llm_env, { INGEST_TABLE = local.t["ingest"] })
    extractor = merge(local.llm_env, local.demo_attest_env, { INGEST_TABLE = local.t["ingest"], ORDERS_TABLE = local.t["orders"], DOCS_BUCKET = aws_s3_bucket.docs.bucket, NOTICES_QUEUE_URL = aws_sqs_queue.notices.url })
    digest    = { INGEST_TABLE = local.t["ingest"], NOTICES_QUEUE_URL = aws_sqs_queue.notices.url }
    fanout    = { ORDERS_TABLE = local.t["orders"], AGENT_QUEUE_URL = aws_sqs_queue.agent.url }
    agent = {
      KEY_SOURCE_RELAYER       = var.key_source_relayer
      KEY_SOURCE_POLICY_SIGNER = var.key_source_policy_signer
      RELAYER_KEY_ID           = aws_kms_key.relayer.key_id
      POLICY_KEY_ID            = aws_kms_key.policy.key_id
      ORDERS_TABLE             = local.t["orders"]
      PARTIES_TABLE            = local.t["parties"]
      AGENT_STATE_TABLE        = local.t["agent_state"]
      EVIDENCE_BUCKET          = aws_s3_bucket.evidence.bucket
      NOTICES_QUEUE_URL        = aws_sqs_queue.notices.url
    }
    indexer = { ORDERS_TABLE = local.t["orders"], AGENT_STATE_TABLE = local.t["agent_state"] }
    # Sin KEY_SOURCE_PAUSER el monitor solo alerta: no carga ninguna llave de pausa
    monitor = merge(
      { AGENT_STATE_TABLE = local.t["agent_state"], PARTIES_TABLE = local.t["parties"], EVIDENCE_BUCKET = aws_s3_bucket.evidence.bucket, NOTICES_QUEUE_URL = aws_sqs_queue.notices.url },
      var.key_source_pauser == "" ? {} : { KEY_SOURCE_PAUSER = var.key_source_pauser, PAUSER_KEY_ID = aws_kms_key.pauser.key_id },
    )
    noticesIn = { NOTICES_QUEUE_URL = aws_sqs_queue.notices.url }
    # Sin cuenta personal, los resultados de ingesta de Keel Personal (correo, resumen diario) no se envian
    botNotify = merge(
      { BOT_TABLE = local.t["bot"], APP_BASE_URL = var.app_origin },
      var.bot_personal_account_id == "" ? {} : { BOT_PERSONAL_ACCOUNT_ID = var.bot_personal_account_id },
    )
    botAdmin = { BOT_TABLE = local.t["bot"] }
  }

  # ---------- Rutas de la API HTTP ----------
  routes = {
    proposals = [
      "POST /proposals",
      "GET /proposals",
      "GET /proposals/{orderId}",
      "POST /proposals/{orderId}/exporter-signature",
      "POST /proposals/{orderId}/importer-signature",
      "POST /proposals/{orderId}/reject",
    ]
    orders     = ["GET /orders", "GET /orders/{orderId}", "GET /needs-you", "GET /wallet"]
    signatures = ["POST /orders/{orderId}/approve-balance", "POST /orders/{orderId}/cancel-signature", "POST /disputes/{orderId}/resolution"]
    directory  = ["GET /suppliers", "GET /trade-setup", "POST /suppliers", "POST /importers", "GET /importers/{safe}"]
    attest     = ["POST /shipments"]
    upload     = ["POST /trade/uploads", "POST /trade/documents"]
    inbound    = ["POST /inbound"]
    proforma   = ["POST /trade/proforma"]
    insights   = ["POST /trade/insights"]
    admin      = ["GET /admin/settings", "PUT /admin/settings"]
    noticesIn  = ["POST /notices", "POST /ingest/outcomes"]
    botAdmin   = ["GET /bot/recipients", "PUT /bot/recipients"]
  }
  route_map = merge([for fn, rs in local.routes : { for r in rs : r => fn }]...)

  # ---------- Programadores ----------
  schedules = {
    fanout  = "rate(1 minute)"
    indexer = "rate(1 minute)"
    monitor = "rate(1 minute)"
    digest  = "cron(0 12 * * ? *)"
  }

  # ---------- Permisos: un rol por funcion que toca llaves, secretos o el LLM ----------
  ddb_rw   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:ConditionCheckItem"]
  ddb_read = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem"]
  # Escritura sin borrar ni recorrer la tabla, para las tablas que una funcion solo crea o actualiza
  ddb_write   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:ConditionCheckItem"]
  sqs_consume = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]

  # Todas las funciones leen la configuracion publica del despliegue (aws/src/config.ts)
  ssm_read = {
    actions   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter${local.cfg_prefix}", "arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter${local.cfg_prefix}/*"]
  }
  secrets = { for n in local.secret_names : n => { actions = ["ssm:GetParameter"], resources = [local.secret_arn[n]] } }

  role_statements = {
    # Consultas de ordenes: solo lectura, sin secretos
    orders_read = [
      { actions = local.ddb_read, resources = [local.tbl["proposals"], local.tbl_idx["proposals"], local.tbl["orders"], local.tbl_idx["orders"], local.tbl["parties"]] },
      local.ssm_read,
      # GET /wallet lee el saldo del token de la Safe en la cadena
      local.secrets["rpc_url"],
    ]
    # Propuestas, firmas de cierre y atestaciones: escriben propuestas y ordenes, leen partes, y
    # consultan la cadena para ERC-1271 y cancelNonceOf
    orders_write = [
      { actions = local.ddb_write, resources = [local.tbl["proposals"], local.tbl_idx["proposals"], local.tbl["orders"], local.tbl_idx["orders"]] },
      { actions = local.ddb_read, resources = [local.tbl["parties"]] },
      local.ssm_read,
      local.secrets["rpc_url"],
    ]
    # Directorio: el unico que escribe partes (proveedores, Safes y representantes), con token de operador
    directory = [
      { actions = local.ddb_rw, resources = [local.tbl["parties"]] },
      local.ssm_read,
      local.secrets["directory_admin_token"],
    ]
    registrar = [
      { actions = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"], resources = [aws_dynamodb_table.t["proposals"].stream_arn] },
      { actions = local.ddb_read, resources = [local.tbl["proposals"]] },
      { actions = local.ddb_write, resources = [local.tbl["orders"], local.tbl["parties"], local.tbl["ingest"]] },
      # Destino de los registros del Stream que fallan tras los reintentos (lambda.tf)
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.registrar_dlq.arn] },
      local.ssm_read,
    ]
    upload = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.docs.arn}/orders/*"] },
      local.ssm_read,
    ]
    inbound = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.docs.arn}/inbound/*"] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
      local.secrets["ingest_webhook_token"],
      local.secrets["llm_keys"],
    ]
    proforma = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = local.ddb_read, resources = [local.tbl["parties"]] },
      local.ssm_read,
      local.secrets["llm_keys"],
    ]
    # Analisis de compras: el cupo diario por importador vive en la tabla de ingesta; lee partes
    # para saber si quien firma es importador; solo ve las metricas que la app firmo
    insights = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = local.ddb_read, resources = [local.tbl["parties"]] },
      local.ssm_read,
      local.secrets["llm_keys"],
    ]
    admin = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      local.ssm_read,
      local.secrets["ingest_admin_token"],
      # Los ajustes validan el proveedor contra las llaves disponibles (availableProviders); nunca las devuelven
      local.secrets["llm_keys"],
    ]
    extractor = concat([
      { actions = local.sqs_consume, resources = [aws_sqs_queue.extraction.arn] },
      { actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${aws_s3_bucket.docs.arn}/orders/*"] },
      # Sin ListBucket, S3 responde 403 en vez de NoSuchKey a un objeto ausente
      { actions = ["s3:ListBucket"], resources = [aws_s3_bucket.docs.arn] },
      { actions = local.ddb_rw, resources = [local.tbl["ingest"], local.tbl["orders"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
      local.secrets["llm_keys"],
    ], var.demo_auto_attest ? [local.secrets["carrier_private_key"]] : [])
    digest = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
    ]
    fanout = [
      { actions = local.ddb_read, resources = [local.tbl["orders"], local.tbl_idx["orders"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.agent.arn] },
      local.ssm_read,
    ]
    agent = [
      { actions = ["kms:Sign", "kms:GetPublicKey"], resources = [aws_kms_key.relayer.arn, aws_kms_key.policy.arn] },
      { actions = local.sqs_consume, resources = [aws_sqs_queue.agent.arn] },
      # El agente solo lee ordenes y partes; escribe solo su candado y sus avisos ya enviados
      { actions = local.ddb_read, resources = [local.tbl["orders"], local.tbl_idx["orders"], local.tbl["parties"]] },
      { actions = local.ddb_rw, resources = [local.tbl["agent_state"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.evidence.arn}/*"] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
      local.secrets["rpc_url"],
      local.secrets["relayer_private_key"],
      local.secrets["policy_signer_private_key"],
    ]
    indexer = [
      { actions = local.ddb_write, resources = [local.tbl["orders"]] },
      { actions = local.ddb_rw, resources = [local.tbl["agent_state"]] },
      local.ssm_read,
      local.secrets["rpc_url"],
    ]
    monitor = [
      { actions = ["kms:Sign", "kms:GetPublicKey"], resources = [aws_kms_key.pauser.arn] },
      { actions = ["s3:GetObject", "s3:ListBucket"], resources = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"] },
      { actions = local.ddb_rw, resources = [local.tbl["agent_state"]] },
      # La cuenta del bot de la Safe, para avisar un incidente
      { actions = ["dynamodb:GetItem"], resources = [local.tbl["parties"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
      local.secrets["rpc_url"],
      local.secrets["pauser_private_key"],
    ]
    notices_in = [
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      local.ssm_read,
      local.secrets["bot_inbound_token"],
    ]
    bot_notify = [
      { actions = local.sqs_consume, resources = [aws_sqs_queue.notices.arn] },
      { actions = local.ddb_rw, resources = [local.tbl["bot"]] },
      local.ssm_read,
      local.secrets["telegram_bot_token"],
    ]
    bot_admin = [
      { actions = local.ddb_rw, resources = [local.tbl["bot"]] },
      local.ssm_read,
      local.secrets["bot_admin_token"],
    ]
  }
}
