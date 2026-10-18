locals {
  name       = "keel-${var.stage}"
  cfg_prefix = "/keel/${var.chain_id}"

  secret_names = [
    "rpc_api_key",
    "telegram_bot_token",
    "telegram_webhook_secret",
    "bot_inbound_token",
    "ingest_webhook_token",
    "ingest_admin_token",
    "llm_keys",
  ]

  # Referencia que recibe cada funcion (ARN en Secrets Manager, nombre en Systems Manager) y su ARN para IAM
  secret_id  = { for n in local.secret_names : n => (var.use_secrets_manager ? try(aws_secretsmanager_secret.secret[n].arn, "") : try(aws_ssm_parameter.secret[n].name, "")) }
  secret_arn = { for n in local.secret_names : n => (var.use_secrets_manager ? try(aws_secretsmanager_secret.secret[n].arn, "") : try(aws_ssm_parameter.secret[n].arn, "")) }
  secret_action = var.use_secrets_manager ? "secretsmanager:GetSecretValue" : "ssm:GetParameter"

  # ---------- Tablas ----------
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

  # ---------- Funciones ----------
  # role: a que rol IAM pertenece. reserve: si pide concurrencia reservada de 1 (ver use_reserved_concurrency)
  functions = {
    proposals  = { role = "orders_api", timeout = 28, memory = 512, reserve = false }
    orders     = { role = "orders_api", timeout = 28, memory = 512, reserve = false }
    signatures = { role = "orders_api", timeout = 28, memory = 512, reserve = false }
    directory  = { role = "orders_api", timeout = 28, memory = 512, reserve = false }
    attest     = { role = "orders_api", timeout = 28, memory = 512, reserve = false }
    registrar  = { role = "registrar", timeout = 28, memory = 512, reserve = false }
    upload     = { role = "upload", timeout = 28, memory = 512, reserve = false }
    inbound    = { role = "inbound", timeout = 28, memory = 512, reserve = false }
    proforma   = { role = "proforma", timeout = 28, memory = 512, reserve = false }
    admin      = { role = "admin", timeout = 28, memory = 512, reserve = false }
    extractor  = { role = "extractor", timeout = 120, memory = 1024, reserve = false }
    digest     = { role = "digest", timeout = 28, memory = 512, reserve = true }
    fanout     = { role = "fanout", timeout = 28, memory = 512, reserve = true }
    agent      = { role = "agent", timeout = 120, memory = 512, reserve = true }
    indexer    = { role = "indexer", timeout = 60, memory = 512, reserve = true }
    monitor    = { role = "monitor", timeout = 60, memory = 512, reserve = true }
    noticesIn  = { role = "notices_in", timeout = 28, memory = 512, reserve = false }
    botNotify  = { role = "bot_notify", timeout = 28, memory = 512, reserve = false }
    botHook    = { role = "bot_hook", timeout = 28, memory = 512, reserve = false }
  }

  common_env = {
    KEEL_CHAIN_ID      = var.chain_id
    KEEL_CONFIG_PREFIX = local.cfg_prefix
    KEEL_STAGE         = var.stage
  }

  function_env = {
    proposals  = { PROPOSALS_TABLE = aws_dynamodb_table.t["proposals"].name }
    orders     = { ORDERS_TABLE = aws_dynamodb_table.t["orders"].name, PROPOSALS_TABLE = aws_dynamodb_table.t["proposals"].name }
    signatures = { ORDERS_TABLE = aws_dynamodb_table.t["orders"].name }
    directory  = { PARTIES_TABLE = aws_dynamodb_table.t["parties"].name }
    attest     = { ORDERS_TABLE = aws_dynamodb_table.t["orders"].name, PARTIES_TABLE = aws_dynamodb_table.t["parties"].name }
    registrar = {
      ORDERS_TABLE      = aws_dynamodb_table.t["orders"].name
      PARTIES_TABLE     = aws_dynamodb_table.t["parties"].name
      INGEST_TABLE      = aws_dynamodb_table.t["ingest"].name
      NOTICES_QUEUE_URL = aws_sqs_queue.notices.url
    }
    upload  = { INGEST_TABLE = aws_dynamodb_table.t["ingest"].name, DOCS_BUCKET = aws_s3_bucket.docs.bucket }
    inbound = { INGEST_TABLE = aws_dynamodb_table.t["ingest"].name, DOCS_BUCKET = aws_s3_bucket.docs.bucket, WEBHOOK_TOKEN_SECRET = local.secret_id["ingest_webhook_token"] }
    proforma = { INGEST_TABLE = aws_dynamodb_table.t["ingest"].name, LLM_SECRET = local.secret_id["llm_keys"] }
    admin    = { INGEST_TABLE = aws_dynamodb_table.t["ingest"].name, ADMIN_TOKEN_SECRET = local.secret_id["ingest_admin_token"] }
    extractor = {
      INGEST_TABLE      = aws_dynamodb_table.t["ingest"].name
      ORDERS_TABLE      = aws_dynamodb_table.t["orders"].name
      DOCS_BUCKET       = aws_s3_bucket.docs.bucket
      LLM_SECRET        = local.secret_id["llm_keys"]
      NOTICES_QUEUE_URL = aws_sqs_queue.notices.url
    }
    digest = { INGEST_TABLE = aws_dynamodb_table.t["ingest"].name, NOTICES_QUEUE_URL = aws_sqs_queue.notices.url }
    fanout = { ORDERS_TABLE = aws_dynamodb_table.t["orders"].name, AGENT_QUEUE_URL = aws_sqs_queue.agent.url }
    agent = {
      RELAYER_KEY_ID    = aws_kms_key.relayer.key_id
      POLICY_KEY_ID     = aws_kms_key.policy.key_id
      ORDERS_TABLE      = aws_dynamodb_table.t["orders"].name
      PARTIES_TABLE     = aws_dynamodb_table.t["parties"].name
      AGENT_STATE_TABLE = aws_dynamodb_table.t["agent_state"].name
      EVIDENCE_BUCKET   = aws_s3_bucket.evidence.bucket
      NOTICES_QUEUE_URL = aws_sqs_queue.notices.url
      RPC_SECRET        = local.secret_id["rpc_api_key"]
    }
    indexer = {
      ORDERS_TABLE      = aws_dynamodb_table.t["orders"].name
      AGENT_STATE_TABLE = aws_dynamodb_table.t["agent_state"].name
      NOTICES_QUEUE_URL = aws_sqs_queue.notices.url
      RPC_SECRET        = local.secret_id["rpc_api_key"]
    }
    monitor = {
      PAUSER_KEY_ID     = aws_kms_key.pauser.key_id
      AGENT_STATE_TABLE = aws_dynamodb_table.t["agent_state"].name
      EVIDENCE_BUCKET   = aws_s3_bucket.evidence.bucket
      NOTICES_QUEUE_URL = aws_sqs_queue.notices.url
      RPC_SECRET        = local.secret_id["rpc_api_key"]
    }
    noticesIn = { NOTICES_QUEUE_URL = aws_sqs_queue.notices.url, INBOUND_TOKEN_SECRET = local.secret_id["bot_inbound_token"] }
    botNotify = { BOT_TABLE = aws_dynamodb_table.t["bot"].name, TELEGRAM_TOKEN_SECRET = local.secret_id["telegram_bot_token"] }
    botHook = {
      BOT_TABLE               = aws_dynamodb_table.t["bot"].name
      TELEGRAM_TOKEN_SECRET   = local.secret_id["telegram_bot_token"]
      TELEGRAM_WEBHOOK_SECRET = local.secret_id["telegram_webhook_secret"]
    }
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
    directory  = ["GET /suppliers", "GET /trade-setup", "POST /suppliers"]
    attest     = ["POST /shipments"]
    upload     = ["POST /trade/uploads", "POST /trade/documents"]
    inbound    = ["POST /inbound"]
    proforma   = ["POST /trade/proforma"]
    admin      = ["GET /admin/settings", "PUT /admin/settings"]
    noticesIn  = ["POST /notices", "POST /ingest/outcomes"]
    botHook    = ["POST /telegram"]
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
  ddb_rw      = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
  ddb_read    = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchGetItem"]
  sqs_consume = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]

  ssm_read = {
    actions   = ["ssm:GetParameter", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.me.account_id}:parameter${local.cfg_prefix}/*"]
  }

  role_statements = {
    orders_api = [
      {
        actions   = local.ddb_rw
        resources = [local.tbl["proposals"], local.tbl_idx["proposals"], local.tbl["orders"], local.tbl_idx["orders"], local.tbl["parties"]]
      },
      local.ssm_read,
    ]
    registrar = [
      { actions = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"], resources = [aws_dynamodb_table.t["proposals"].stream_arn] },
      { actions = local.ddb_rw, resources = [local.tbl["orders"], local.tbl["parties"], local.tbl["ingest"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
    ]
    upload = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.docs.arn}/*"] },
    ]
    inbound = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.docs.arn}/*"] },
      { actions = [local.secret_action], resources = [local.secret_arn["ingest_webhook_token"]] },
    ]
    proforma = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = [local.secret_action], resources = [local.secret_arn["llm_keys"]] },
    ]
    admin = [
      { actions = local.ddb_rw, resources = [local.tbl["ingest"]] },
      { actions = [local.secret_action], resources = [local.secret_arn["ingest_admin_token"]] },
    ]
    extractor = [
      { actions = local.sqs_consume, resources = [aws_sqs_queue.extraction.arn] },
      { actions = ["s3:GetObject"], resources = ["${aws_s3_bucket.docs.arn}/*"] },
      { actions = local.ddb_rw, resources = [local.tbl["ingest"], local.tbl["orders"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      { actions = [local.secret_action], resources = [local.secret_arn["llm_keys"]] },
    ]
    digest = [
      { actions = local.ddb_read, resources = [local.tbl["ingest"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
    ]
    fanout = [
      { actions = local.ddb_read, resources = [local.tbl["orders"], local.tbl_idx["orders"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.agent.arn] },
    ]
    agent = [
      { actions = ["kms:Sign", "kms:GetPublicKey"], resources = [aws_kms_key.relayer.arn, aws_kms_key.policy.arn] },
      { actions = local.sqs_consume, resources = [aws_sqs_queue.agent.arn] },
      { actions = local.ddb_rw, resources = [local.tbl["orders"], local.tbl["parties"], local.tbl["agent_state"]] },
      { actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.evidence.arn}/*"] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      { actions = [local.secret_action], resources = [local.secret_arn["rpc_api_key"]] },
      local.ssm_read,
    ]
    indexer = [
      { actions = local.ddb_rw, resources = [local.tbl["orders"], local.tbl["agent_state"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      { actions = [local.secret_action], resources = [local.secret_arn["rpc_api_key"]] },
      local.ssm_read,
    ]
    monitor = [
      { actions = ["kms:Sign", "kms:GetPublicKey"], resources = [aws_kms_key.pauser.arn] },
      { actions = ["s3:GetObject", "s3:ListBucket"], resources = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"] },
      { actions = local.ddb_rw, resources = [local.tbl["agent_state"]] },
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      { actions = [local.secret_action], resources = [local.secret_arn["rpc_api_key"]] },
      local.ssm_read,
    ]
    notices_in = [
      { actions = ["sqs:SendMessage"], resources = [aws_sqs_queue.notices.arn] },
      { actions = [local.secret_action], resources = [local.secret_arn["bot_inbound_token"]] },
    ]
    bot_notify = [
      { actions = local.sqs_consume, resources = [aws_sqs_queue.notices.arn] },
      { actions = local.ddb_rw, resources = [local.tbl["bot"]] },
      { actions = [local.secret_action], resources = [local.secret_arn["telegram_bot_token"]] },
    ]
    bot_hook = [
      { actions = local.ddb_rw, resources = [local.tbl["bot"]] },
      { actions = [local.secret_action], resources = [local.secret_arn["telegram_bot_token"], local.secret_arn["telegram_webhook_secret"]] },
    ]
  }
}
