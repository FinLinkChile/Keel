variable "region" {
  description = "Region de AWS"
  type        = string
  default     = "us-east-1"
}

variable "stage" {
  description = "Nombre del entorno"
  type        = string
  default     = "dev"
}

variable "app_origin" {
  description = "Origen de la app, el unico que acepta CORS"
  type        = string
  default     = "https://app.keel.example"
}

# De contracts/deployments/84532.json. Si el archivo cambia, actualizar estos valores: el agente
# compara lo que publica Systems Manager con el archivo que lleva empaquetado y se detiene si difieren.
variable "chain_id" {
  type    = string
  default = "84532"
}

variable "deploy_block" {
  type    = string
  default = "48233746"
}

variable "safe_address" {
  type    = string
  default = "0x366E72921895dBFD7688822418BE43E02551Ee82"
}

variable "funding_gate_address" {
  type    = string
  default = "0x2bc56bbB5B47B493009531e751C8Bd90513e927f"
}

variable "escrow_address" {
  description = "TradeEscrow desplegado (tradeEscrow en el archivo de despliegue)"
  type        = string
  default     = "0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970"
}

variable "token_address" {
  description = "Token de pago del escrow (usdc en el archivo de despliegue: USDC de prueba de Circle)"
  type        = string
  default     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
}

variable "dist_dir" {
  description = "Carpeta con un <funcion>.mjs por funcion, generada por npm run build -w aws"
  type        = string
  default     = "./dist"
}

variable "lambda_runtime" {
  description = "Si el proveedor aun no conoce nodejs24.x, usar nodejs22.x"
  type        = string
  default     = "nodejs24.x"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

# ---- Opciones pensadas para una cuenta nueva del plan gratuito ----

variable "use_reserved_concurrency" {
  description = "Reserva 1 ejecucion para el agente, el monitor, el indexador, el reparto y el resumen. Las cuentas nuevas pueden tener un limite de concurrencia tan bajo que AWS la rechaza: revisar Service Quotas antes de activarlo"
  type        = bool
  default     = false
}

# De donde sale cada llave del servidor: "kms" (la llave nunca sale de KMS) o "ssm" (la llave
# privada actual, guardada como SecureString). La demo usa "ssm" porque las direcciones
# registradas en la cadena son las de las llaves actuales; para pasar a "kms" el Area 1 registra
# antes la direccion de la llave KMS (setPolicySigner, setGuardian, relayer).
variable "key_source_relayer" {
  type    = string
  default = "ssm"
  validation {
    condition     = contains(["kms", "ssm"], var.key_source_relayer)
    error_message = "kms o ssm"
  }
}

variable "key_source_policy_signer" {
  type    = string
  default = "ssm"
  validation {
    condition     = contains(["kms", "ssm"], var.key_source_policy_signer)
    error_message = "kms o ssm"
  }
}

variable "key_source_pauser" {
  description = "Vacio: el monitor solo alerta y no pausa"
  type        = string
  default     = "ssm"
  validation {
    condition     = contains(["kms", "ssm", ""], var.key_source_pauser)
    error_message = "kms, ssm o vacio"
  }
}

variable "telegram_bot_username" {
  description = "Usuario del bot sin @, para los enlaces t.me/<bot>?start=<codigo>"
  type        = string
  default     = "keel_demo_bot"
}

variable "dynamodb_billing_mode" {
  description = "PAY_PER_REQUEST o PROVISIONED. Con PROVISIONED cada tabla e indice usa 1 unidad de lectura y 1 de escritura, dentro de las 25 siempre gratuitas"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "enable_pitr" {
  description = "Recuperacion a un punto en el tiempo de DynamoDB. Tiene costo por GB"
  type        = bool
  default     = false
}

variable "enable_alarms" {
  type    = bool
  default = true
}

variable "alert_email" {
  description = "Correo para las alarmas y el presupuesto. Vacio no crea ni la suscripcion ni el presupuesto"
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 10
}

variable "api_throttle_rate" {
  description = "Solicitudes por segundo por ruta (sustituye a un WAF, que una API HTTP no admite)"
  type        = number
  default     = 20
}

variable "api_throttle_burst" {
  type    = number
  default = 40
}

variable "evidence_lock_mode" {
  type    = string
  default = "GOVERNANCE"
}

variable "evidence_lock_days" {
  type    = number
  default = 30
}
