data "archive_file" "fn" {
  for_each = local.functions

  type        = "zip"
  source_file = "${var.dist_dir}/${each.key}.mjs"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each = local.functions

  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.fn[each.value.role].arn
  handler          = "${each.key}.handler"
  runtime          = var.lambda_runtime
  architectures    = ["arm64"]
  memory_size      = each.value.memory
  timeout          = each.value.timeout
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256

  # -1 deja la funcion sin reserva. Reservar 1 evita que dos vueltas choquen en el nonce del relayer.
  reserved_concurrent_executions = var.use_reserved_concurrency && each.value.reserve ? 1 : -1

  environment {
    variables = merge(local.common_env, local.function_env[each.key])
  }

  depends_on = [
    aws_cloudwatch_log_group.fn,
    aws_iam_role_policy.fn,
    aws_iam_role_policy_attachment.logs,
  ]
}

# ---------- Disparadores: colas y Stream ----------

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = {
    agent     = aws_sqs_queue.agent.arn
    extractor = aws_sqs_queue.extraction.arn
    botNotify = aws_sqs_queue.notices.arn
  }

  event_source_arn = each.value
  function_name    = aws_lambda_function.fn[each.key].arn
  batch_size       = 1

  # botNotify y extractor reportan por mensaje lo que hay que reintentar (envio a Telegram, lectura tomada por otro)
  function_response_types = contains(["botNotify", "extractor"], each.key) ? ["ReportBatchItemFailures"] : null
}

resource "aws_lambda_event_source_mapping" "proposals_stream" {
  event_source_arn  = aws_dynamodb_table.t["proposals"].stream_arn
  function_name     = aws_lambda_function.fn["registrar"].arn
  starting_position = "LATEST"
  batch_size        = 1

  # Un registro que siempre falla no bloquea el fragmento: se reintenta pocas veces, se parte el lote
  # y, al final, va a la cola de fallidos del alta de orden, que tiene alarma (alarms.tf).
  maximum_retry_attempts         = 5
  maximum_record_age_in_seconds  = 3600
  bisect_batch_on_function_error = true
  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.registrar_dlq.arn
    }
  }

  # Solo las propuestas firmadas por las dos partes (ProposalItem.status, aws/src/tables.ts).
  filter_criteria {
    filter {
      pattern = jsonencode({ dynamodb = { NewImage = { status = { S = ["fully_signed"] } } } })
    }
  }
}

# ---------- Programadores ----------

resource "aws_cloudwatch_event_rule" "schedule" {
  for_each = local.schedules

  name                = "${local.name}-${each.key}"
  schedule_expression = each.value
}

resource "aws_cloudwatch_event_target" "schedule" {
  for_each = local.schedules

  rule = aws_cloudwatch_event_rule.schedule[each.key].name
  arn  = aws_lambda_function.fn[each.key].arn
}

resource "aws_lambda_permission" "schedule" {
  for_each = local.schedules

  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[each.key].arn
}

# Las funciones programadas corren de nuevo al minuto siguiente: si una falla, AWS no la reintenta
# (por defecto lo hace dos veces), para no triplicar los errores, los registros y el costo cuando
# falta algo que el reintento no arregla, como un secreto sin cargar.
resource "aws_lambda_function_event_invoke_config" "schedule" {
  for_each = local.schedules

  function_name          = aws_lambda_function.fn[each.key].function_name
  maximum_retry_attempts = 0
}
