---
type: Contexto
title: "Posicionamiento y hueco de mercado"
description: "Cómo se presenta Keel y cómo no, los dos modelos de amenaza del pitch y qué existe hoy en wallets de agentes."
tags: [posicionamiento, competencia, pitch, mercado]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Keel NO se presenta como "wallet de agente con límites de gasto". Ese concepto está saturado: Coinbase Agentic Wallets (feb 2026), Cobo Agentic Wallet con sus Pacts (abr 2026), Crossmint, Privy, Turnkey, MetaMask Advanced Permissions (ERC-7715), y al menos cinco proyectos solo en ETHGlobal Tokyo 2026 (DSAP, Proviso, Izanagi, Axis, Surety). Un juez ya lo vio.

Keel tampoco se presenta como "un escrow en blockchain". Un escrow por sí solo no necesita un agente.

Keel se presenta como un agente que opera la billetera de una empresa importadora: lee proformas, órdenes de compra, conocimientos de embarque y facturas, prepara los pagos y vigila los plazos, bajo dos modelos de amenaza concretos:

1. **El correo del "proveedor" que avisa que cambió su cuenta** justo antes del pago. Es el fraude más común del comercio exterior.
2. **El documento de embarque falso o manipulado** que intenta gatillar un pago por una carga que no se embarcó.

La respuesta de Keel: la cuenta de cobro va dentro de la orden de compra firmada por ambas partes, la prueba de embarque la firma un tercero (la naviera) y los fondos viven en un contrato de escrow que solo puede pagar a las partes de la orden.

Apertura del pitch: el 4 de mayo de 2026 un tuit en código Morse hizo que Grok/Bankrbot drenara unos 3.000 millones de tokens DRB en Base, valorados entre 150 y 200 mil dólares según el OECD AI Incidents Monitor. El ataque funcionó por dos fallas que Keel prohíbe por diseño: un evento externo pudo ampliar los permisos de la wallet, y el LLM que leía contenido público podía disparar transferencias. Trasladado al comercio exterior: un agente que lee un PDF y paga a la cuenta que el PDF indica es el mismo error.

# Lo que hay hoy en wallets de agentes

**(a) Políticas fuera de la cadena (MPC, TEE, enclaves):** Coinbase, Cobo, Privy, Turnkey, Skyfire. La regla la hace cumplir el proveedor, no un contrato público que el usuario controle y audite.

**(b) Permisos en la cadena:** Safe + Zodiac Roles v2, MetaMask ERC-7715 con caveat enforcers (estándar aún en borrador), Crossmint. Granulares y auditables, pero sin capa de IA ni modelo de amenaza documental.

**(c) Rieles de tarjetas (Visa Intelligent Commerce, Mastercard Agent Pay, Google AP2, Stripe ACP):** resuelven comercio electrónico y dejan la regla en el emisor. No sirven para un pago entre empresas contra documentos de embarque.

# El hueco

Pagos entre empresas condicionados a hechos verificables (orden firmada, embarque atestado), con la regla en un contrato que ambas partes pueden leer, operados por un agente que no puede desviar fondos aunque lo engañen.

**Por verificar antes del deck (D9):** qué plataformas de financiamiento de comercio exterior sobre blockchain y de BL electrónico existen hoy y cómo se comparan. No afirmar que "nadie lo hace".

Lo que hay hoy en comercio exterior está en [el problema](../flujo/problema.md).
