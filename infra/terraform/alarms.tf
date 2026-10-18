# Alarmas y presupuesto. Cuatro alarmas caben en las diez que son gratuitas.

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each = var.enable_alarms ? {
    extraction = { queue = aws_sqs_queue.extraction_dlq.name, text = "Hay documentos que no se pudieron leer" }
    agent      = { queue = aws_sqs_queue.agent_dlq.name, text = "Una vuelta del agente fallo tres veces" }
    notices    = { queue = aws_sqs_queue.notices_dlq.name, text = "Hay avisos que no se pudieron enviar" }
  } : {}

  alarm_name          = "${local.name}-${each.key}-dlq"
  alarm_description   = each.value.text
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value.queue }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_log_metric_filter" "agent_error" {
  count = var.enable_alarms ? 1 : 0

  name           = "${local.name}-agent-error"
  log_group_name = aws_cloudwatch_log_group.fn["agent"].name
  pattern        = "\"AGENT_ERROR\""

  metric_transformation {
    name      = "AgentError"
    namespace = "Keel"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "agent_error" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${local.name}-agent-error"
  alarm_description   = "El agente registro AGENT_ERROR"
  namespace           = "Keel"
  metric_name         = "AgentError"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Pendiente: alarma del saldo de gas del relayer, que el agente tendria que publicar como metrica propia.

resource "aws_budgets_budget" "monthly" {
  count = var.alert_email == "" ? 0 : 1

  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
