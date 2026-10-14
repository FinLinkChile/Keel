---
type: Arquitectura
title: "Stack tecnológico"
description: "Tecnología de cada componente: cuenta, permisos, escrow, red, token, cliente, simulación, lectura de documentos, aplicación y avisos."
tags: [stack, tecnologia]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

| Componente | Tecnología |
|---|---|
| Cuenta de la empresa | Safe |
| Permisos del agente | Zodiac Roles Modifier v2 |
| Espera y veto de cambios | Zodiac Delay Modifier |
| Escrow | Contrato TradeEscrow (Solidity, Foundry) |
| Red | Red cerrada compatible con EVM, por definir |
| Token de pago | Stablecoin disponible en esa red, por definir |
| Cliente blockchain | viem sobre Node.js |
| Simulación | `eth_call` en ejecución; Anvil solo para pruebas |
| Registro de decisión | PDR firmado con EIP-712 (inspirado en PACE) |
| Lectura de documentos | Parser determinista más LLM en cuarentena |
| Aplicación | React Native con Expo |
| Canal de avisos | Bot de Telegram |

Por qué Zodiac Roles y no Smart Sessions está en [respaldo para el jurado](../contexto/respaldo-jurado.md).
