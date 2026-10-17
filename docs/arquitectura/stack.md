---
type: Arquitectura
title: "Stack tecnológico"
description: "Tecnología de cada componente: cuenta, permisos, escrow, red, token, cliente, simulación, lectura de documentos, aplicación y avisos."
tags: [stack, tecnologia]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T18:00:00Z }
---

| Componente | Tecnología |
|---|---|
| Cuenta de la empresa | Safe |
| Permisos del agente | Zodiac Roles Modifier v2 |
| Espera y veto de cambios | Zodiac Delay Modifier |
| Escrow | Contrato TradeEscrow (Solidity, Foundry) |
| Red | Red cerrada compatible con EVM, por definir ([decisión abierta 1](../decisiones/abiertas.md)). Para la arquitectura en AWS es solo una URL de RPC |
| Token de pago | Stablecoin disponible en esa red, por definir |
| Cliente blockchain | viem sobre Node.js |
| Simulación | `eth_call` en ejecución; Anvil solo para pruebas |
| Registro de decisión | PDR firmado con EIP-712 (inspirado en PACE) |
| Lectura de documentos | Parser determinista más LLM en cuarentena |
| Aplicación | React Native con Expo |
| Canal de avisos | Bot de Telegram |

**[PROPUESTA] La red como URL en AWS.** El equipo planea llevar los servicios a AWS con una arquitectura serverless. Desde esa arquitectura la red se abstrae: cada componente que habla con la cadena (agente, monitor, relayer, verificador) recibe una URL de RPC por configuración y no depende de qué red es ni de quién opera sus nodos. Así la arquitectura en AWS no incluye nodos propios (EC2 o ECS), y cambiar de red es cambiar la URL, el `chainId` y `contracts/deployments/<chainId>.json`. La única excepción sería que Keel operara su propia red privada, que queda fuera de esta arquitectura. Lo decidió el Área 2 (Darienn) el 17 de octubre; falta que el equipo lo confirme.

Por qué Zodiac Roles y no Smart Sessions está en [respaldo para el jurado](../contexto/respaldo-jurado.md).
