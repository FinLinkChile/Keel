# Un rol por funcion que toca llaves, secretos o el LLM. Las cinco rutas de ordenes comparten el rol orders_api,
# que no tiene S3 ni KMS y solo lee la URL de RPC y el token del directorio. Solo agent y monitor
# tienen permisos de KMS y de llaves en SSM, cada uno sobre las suyas.

resource "aws_iam_role" "fn" {
  for_each = local.role_statements

  name = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each = local.role_statements

  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.role_statements

  name = each.key
  role = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [for s in each.value : {
      Effect   = "Allow"
      Action   = s.actions
      Resource = s.resources
    }]
  })
}
