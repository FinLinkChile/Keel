---
type: Arquitectura
title: "Piezas de la billetera y qué es el agente"
description: "Safe, Zodiac Roles y Delay, PDRGate, PDR, motor, extractor y cosignatario: qué hace cada pieza, qué es 'el agente' y cómo opera una empresa desde su Safe."
tags: [safe, zodiac, pdrgate, agente, cosignatario]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Keel no es solo un contrato de escrow. Es una billetera en la que un agente hace el trabajo operativo (leer documentos, preparar pagos, vigilar plazos) con permisos acotados, mientras las reglas viven en contratos que ni el agente ni un atacante pueden cambiar.

# Las piezas

Vienen de Keel Personal y las comparten los dos modos:

| Pieza | Qué hace |
| --- | --- |
| Safe | La cuenta de la empresa. Los dueños son personas, nunca el agente |
| Zodiac Roles Modifier v2 | Limita al agente: a qué contrato puede llamar, qué función y con qué cupo |
| Zodiac Delay Modifier | Los cambios de configuración esperan N horas, con aviso y ventana de veto |
| Gate (PDRGate en Personal, gate de Trade en Trade) | Único miembro del rol del agente (D4). Sin un PDR válido no se mueve nada. Hay un gate por modo; su estructura interna la define el Área 1 |
| PDR (Registro de Decisión de Política) | Decisión firmada con EIP-712 que ata la intención, la política y el calldata exacto |
| Motor de política | Función determinista, sin LLM ni red. Decide el nivel y firma el PDR |
| Extractor en cuarentena | El único LLM. Lee documentos no confiables y devuelve un esquema sin texto libre (D2, D3) |
| Cosignatario | Persona de confianza. Puede frenar, vetar y pausar. No puede enviar fondos |

# Qué es "el agente"

El agente es la cadena completa: extractor en cuarentena, parser determinista, motor de política, PDR y relayer. No existe un LLM operativo que decida pagos (D2).

- **La IA lee.** Extrae datos de proformas, órdenes de compra, BL y facturas.
- **El motor decide.** Compara lo extraído con lo pactado y define el nivel de permiso.
- **Las personas autorizan.** Firman la orden de compra y cofirman lo que supera los límites.
- **El contrato ejecuta.** Custodia los fondos y solo los mueve por las transiciones permitidas.

# Billetera de la empresa

- Cada empresa opera desde su Safe. Los dueños son personas (por ejemplo 2 de 3 socios), nunca el agente.
- Rol del agente: solo puede llamar al contrato de escrow para depositar una orden ya firmada, con cupo por periodo. El único miembro del rol es el gate de Trade (D4): la llave del agente sola no mueve fondos.
- El Roles Modifier intercepta la llamada y valida destino, selector de cuatro bytes y argumentos contra las condiciones configuradas.
- El dueño del Roles Modifier es la Safe de la empresa, nunca el agente. Nada externo puede ampliar permisos (la lección Bankr).
- Los cambios de configuración (cupos, quién puede comprar, firmante de la política) pasan por el Delay Modifier, con espera y veto.
- Módulos auditados. No se escribe el control de permisos desde cero. Nota de diligencia: auditorías independientes ya identificaron y mitigaron una falla de trailing bytes padding en el desensamblador MultiSend del Roles Modifier; citarla en el informe demuestra que el equipo conoce la historia de seguridad de su propia base.
- **Abierto:** la red es cerrada y todavía no está elegida. Hay que confirmar que Safe y los módulos de Zodiac se pueden desplegar en ella y qué herramientas (SDK, servicios de transacciones) quedan disponibles.

# Empresas: representación y permisos

El importador pidió que el dueño tenga la llave principal y delegue a quien opera las compras. En Keel Trade:

- Cada empresa opera desde una **Safe de empresa**, con sus socios como dueños (por ejemplo 2 de 3).
- El encargado de compras recibe un **rol de Zodiac Roles** que le permite firmar órdenes de compra y depositar, con un cupo mensual y solo hacia el contrato TradeEscrow.
- Cambiar quién puede comprar, o los cupos, pasa por el **Delay**, con espera y veto, igual que en Keel Personal.

Así se reutilizan las mismas piezas auditadas del modo personal.

Los niveles con que opera el agente están en [niveles de permiso](niveles-de-permiso.md). La configuración de roles, Delay y PDRGate es trabajo del [Área 1](../trabajo/area-1-contratos.md) (T1.1 a T1.6).
