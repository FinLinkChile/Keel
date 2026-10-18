# Keel Trade en AWS: Terraform de la arquitectura ampliada (docs/arquitectura/despliegue-aws.md).
# Las funciones salen de aws/src/handlers, empaquetadas en dist/ con npm run build -w aws.

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
  }

  # Estado remoto para trabajar en equipo. Se crea el bucket y la tabla a mano antes del primer init.
  # backend "s3" {
  #   bucket         = "keel-tfstate-<cuenta>"
  #   key            = "keel/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "keel-tfstate-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project    = "keel"
      stage      = var.stage
      managed_by = "terraform"
    }
  }
}

data "aws_caller_identity" "me" {}
