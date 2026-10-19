# ===== Llaves de firma: secp256k1, no exportables. prevent_destroy protege las direcciones registradas en la cadena =====
# Para destruir el entorno hay que quitar a mano el prevent_destroy: es a proposito.

resource "aws_kms_key" "relayer" {
  description              = "Keel relayer: firma las transacciones y paga el gas"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"
  deletion_window_in_days  = 30
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_key" "policy" {
  description              = "Keel firmante de politica: PolicyDecision y DocumentDecision"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"
  deletion_window_in_days  = 30
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_key" "pauser" {
  description              = "Keel guardian: solo emergencyPause"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"
  deletion_window_in_days  = 30
  lifecycle { prevent_destroy = true }
}

resource "aws_kms_alias" "relayer" {
  name          = "alias/${local.name}-relayer"
  target_key_id = aws_kms_key.relayer.key_id
}

resource "aws_kms_alias" "policy" {
  name          = "alias/${local.name}-policy"
  target_key_id = aws_kms_key.policy.key_id
}

resource "aws_kms_alias" "pauser" {
  name          = "alias/${local.name}-pauser"
  target_key_id = aws_kms_key.pauser.key_id
}

# ===== Tablas =====

resource "aws_dynamodb_table" "t" {
  for_each = local.tables

  name         = "${local.name}-${each.key}"
  billing_mode = var.dynamodb_billing_mode
  hash_key     = each.value.hash
  range_key    = each.value.range

  read_capacity  = var.dynamodb_billing_mode == "PROVISIONED" ? 1 : null
  write_capacity = var.dynamodb_billing_mode == "PROVISIONED" ? 1 : null

  dynamic "attribute" {
    for_each = each.value.attrs
    content {
      name = attribute.key
      type = attribute.value
    }
  }

  dynamic "global_secondary_index" {
    for_each = each.value.gsis
    content {
      name            = global_secondary_index.key
      hash_key        = global_secondary_index.value
      projection_type = "ALL"
      read_capacity   = var.dynamodb_billing_mode == "PROVISIONED" ? 1 : null
      write_capacity  = var.dynamodb_billing_mode == "PROVISIONED" ? 1 : null
    }
  }

  dynamic "ttl" {
    for_each = each.value.ttl ? [1] : []
    content {
      attribute_name = "ttl"
      enabled        = true
    }
  }

  stream_enabled   = each.value.stream
  stream_view_type = each.value.stream ? "NEW_IMAGE" : null

  point_in_time_recovery {
    enabled = var.enable_pitr
  }
  # Cifrado en reposo con la clave que AWS administra por defecto, sin costo ni permisos de KMS.
}

# ===== S3 =====

resource "aws_s3_bucket" "docs" {
  bucket = "${local.name}-docs-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  cors_rule {
    allowed_origins = local.app_origins
    allowed_methods = ["PUT"]
    allowed_headers = ["*"]
    max_age_seconds = 600
  }
}

resource "aws_s3_bucket_notification" "docs" {
  bucket     = aws_s3_bucket.docs.id
  depends_on = [aws_sqs_queue_policy.extraction]

  queue {
    queue_arn     = aws_sqs_queue.extraction.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "orders/" # solo las cargas firmadas; el correo crudo (inbound/) no se lee de nuevo
  }
}

# El correo crudo se guarda para revisar un caso, no para siempre (datos personales)
resource "aws_s3_bucket_lifecycle_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    id     = "inbound-90-days"
    status = "Enabled"
    filter { prefix = "inbound/" }
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 1 }
  }

  # Los documentos de una orden se guardan para revisar una disputa, no para siempre (datos
  # personales, docs/arquitectura/datos-personales.md). Un objeto borrado o reemplazado (archivo que
  # no coincide con su hash) deja una version no vigente: tambien se elimina.
  rule {
    id     = "orders-retention"
    status = "Enabled"
    filter { prefix = "orders/" }
    expiration { days = var.document_retention_days }
    noncurrent_version_expiration { noncurrent_days = 1 }
  }
}

resource "aws_s3_bucket" "evidence" {
  bucket              = "${local.name}-evidence-${data.aws_caller_identity.me.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket     = aws_s3_bucket.evidence.id
  depends_on = [aws_s3_bucket_versioning.evidence]

  rule {
    default_retention {
      mode = var.evidence_lock_mode
      days = var.evidence_lock_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ===== Colas, cada una con su cola de fallidos =====

resource "aws_sqs_queue" "extraction_dlq" {
  name                    = "${local.name}-extraction-dlq"
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "extraction" {
  name                       = "${local.name}-extraction"
  visibility_timeout_seconds = 720
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.extraction_dlq.arn
    maxReceiveCount     = 3
  })
}

resource "aws_sqs_queue_policy" "extraction" {
  queue_url = aws_sqs_queue.extraction.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.extraction.arn
      Condition = {
        ArnLike      = { "aws:SourceArn" = "arn:aws:s3:::${local.name}-docs-${data.aws_caller_identity.me.account_id}" }
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.me.account_id }
      }
    }]
  })
}

resource "aws_sqs_queue" "agent_dlq" {
  name                    = "${local.name}-agent-dlq.fifo"
  fifo_queue              = true
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "agent" {
  name                        = "${local.name}-agent.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  # 3 veces el timeout del agente (100 s): un pase que muere retiene el carril de esa Safe 5 minutos,
  # no 12. El handler no lanza por errores de la vuelta: el pase siguiente es completo.
  visibility_timeout_seconds = 300
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.agent_dlq.arn
    maxReceiveCount     = 3
  })
}

# Destino de los registros del Stream de propuestas que el alta de orden no pudo procesar tras sus
# reintentos: sin el, un registro que siempre falla bloquea el fragmento hasta 24 horas.
resource "aws_sqs_queue" "registrar_dlq" {
  name                    = "${local.name}-registrar-dlq"
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "notices_dlq" {
  name                    = "${local.name}-notices-dlq"
  sqs_managed_sse_enabled = true
}

resource "aws_sqs_queue" "notices" {
  name                       = "${local.name}-notices"
  visibility_timeout_seconds = 360 # 6 veces el timeout de botNotify (60 s), como recomienda AWS
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notices_dlq.arn
    maxReceiveCount     = 5
  })
}

# ===== Secretos: Terraform no los crea ni los lee =====

# Un aws_ssm_parameter guarda su valor descifrado en el estado de Terraform al refrescarlo, aunque
# tenga ignore_changes. Para que ninguna llave privada ni token quede en terraform.tfstate, los
# secretos se crean a mano con `aws ssm put-parameter --type SecureString` (README.md) y aqui solo
# se arman sus ARN para dar a cada funcion permiso de leer los suyos (locals.tf, secret_arn).

# ===== Configuracion que no es secreta (la lee el agente, el monitor y el indexador) =====

resource "aws_ssm_parameter" "config" {
  for_each = {
    "chain-id"     = var.chain_id
    "deploy-block" = var.deploy_block
    "safe"         = var.safe_address
    "funding-gate" = var.funding_gate_address
    "escrow"       = var.escrow_address
    "token"        = var.token_address
  }

  name  = "${local.cfg_prefix}/${each.key}"
  type  = "String"
  value = each.value
}
