# API HTTP. AWS WAF no se asocia a una API HTTP (la guia de API Gateway lo describe solo para APIs REST).
# Mientras tanto la proteccion es el limite de tasa por ruta, el CORS y la verificacion de firma en cada funcion.

resource "aws_apigatewayv2_api" "http" {
  name          = local.name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.app_origin]
    allow_methods = ["GET", "POST", "PUT", "OPTIONS"]
    allow_headers = ["content-type", "x-keel-signer", "x-keel-signature", "x-keel-timestamp"] # aws/src/auth.ts y schemas API_HEADERS
    max_age       = 600
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate
    throttling_burst_limit = var.api_throttle_burst
  }

  # La lectura de la proforma llama al LLM: el tope mas bajo (docs/arquitectura/despliegue-aws.md)
  route_settings {
    route_key              = "POST /trade/proforma"
    throttling_rate_limit  = var.proforma_throttle_rate
    throttling_burst_limit = var.proforma_throttle_burst
  }

  # El analisis de compras tambien llama al modelo: el mismo tope bajo
  route_settings {
    route_key              = "POST /trade/insights"
    throttling_rate_limit  = var.proforma_throttle_rate
    throttling_burst_limit = var.proforma_throttle_burst
  }

  depends_on = [aws_apigatewayv2_route.r]
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each = toset(distinct(values(local.route_map)))

  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "r" {
  for_each = local.route_map

  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.fn[each.value].id}"
}

resource "aws_lambda_permission" "api" {
  for_each = toset(distinct(values(local.route_map)))

  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
