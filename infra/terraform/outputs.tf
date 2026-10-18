output "api_endpoint" {
  description = "URL base de la API, para EXPO_PUBLIC_API_URL"
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "kms_key_ids" {
  description = "Para obtener la direccion Ethereum de cada llave: aws kms get-public-key --key-id <id>"
  value = {
    relayer = aws_kms_key.relayer.key_id
    policy  = aws_kms_key.policy.key_id
    pauser  = aws_kms_key.pauser.key_id
  }
}

output "docs_bucket" {
  value = aws_s3_bucket.docs.bucket
}

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
}

output "queues" {
  value = {
    extraction = aws_sqs_queue.extraction.url
    agent      = aws_sqs_queue.agent.url
    notices    = aws_sqs_queue.notices.url
  }
}

output "secrets_to_load" {
  description = "Secretos creados vacios: hay que cargar su valor real, que nunca va en git"
  value       = [for s in aws_ssm_parameter.secret : s.name]
}
