---
type: Interfaz
title: "Autenticación de la API de Keel en AWS"
description: "Cómo prueba la app, la naviera o el árbitro quién hace cada petición a la API: mensaje EIP-712 ApiRequest, cabeceras, ventana de tiempo, respuestas y qué no autoriza."
tags: [api, autenticacion, eip-712, aws, app]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T03:30:00Z }
---

**[PROPUESTA]** Diseño de la rama `AWS` (Área 5 con Claude, sobre la arquitectura ampliada del Área 2). Código: `schemas/src/api.ts` y `aws/src/auth.ts` **[HECHO]**. Lo confirman el Área 2 (dueña de `schemas/`) y el Área 4 (la app lo firma).

# Qué se firma

Cada petición a una ruta autenticada lleva la firma EIP-712 de la billetera de la persona que la hace:

```
ApiRequest(string method,string path,bytes32 bodyHash,uint64 issuedAt)
```

| Campo | Valor |
| --- | --- |
| `method` | `GET`, `POST` o `PUT`, en mayúsculas |
| `path` | La ruta sin la consulta, tal como la recibe API Gateway: `/proposals/0x…` |
| `bodyHash` | keccak256 de los bytes exactos del cuerpo; para un `GET`, keccak256 de la cadena vacía |
| `issuedAt` | Segundos unix. Se acepta con hasta 10 minutos de diferencia con el reloj del servidor |

Dominio: `{ name: "Keel Ingest", version: "1", chainId }`, sin `verifyingContract`: el mismo patrón de la [carga de documentos](carga-de-documentos.md), como propone el Área 2 en [API y datos en AWS](../arquitectura/aws-api-y-datos.md). El dominio nunca es `"Keel"`, así que una firma de la API no sirve como orden, atestación ni decisión, y su tipo propio (`ApiRequest`) la separa de una carga.

# Cabeceras

| Cabecera | Valor |
| --- | --- |
| `x-keel-signer` | Dirección que firma |
| `x-keel-signature` | La firma |
| `x-keel-timestamp` | `issuedAt` |

| Respuesta | Cuándo |
| --- | --- |
| 401 `missing_signature` | Falta una cabecera |
| 401 `stale_signature` | `issuedAt` fuera de la ventana |
| 401 `bad_signature` | Firma ilegible |
| 401 `signer_mismatch` | La firma recupera otra dirección: otro firmante, o el cuerpo o la ruta cambiaron después de firmar |

# Qué prueba y qué no

Prueba quién pide, para quién vale y por cuánto tiempo. No autoriza nada por sí sola: cada ruta revisa además que quien firma sea la parte de la orden o un representante registrado de la Safe del importador (`represents` en `aws/src/auth.ts`). Una Safe no firma peticiones: firman sus dueños o representantes, que son EOA.

Ninguna petición mueve fondos. Lo que llega a la cadena son las firmas de las partes sobre los structs del escrow (orden, aprobación del saldo, cancelación, resolución), que el contrato verifica de nuevo.

Riesgo declarado: una firma capturada se puede repetir dentro de los 10 minutos sobre la misma ruta y el mismo cuerpo. Las rutas que escriben son idempotentes (escrituras condicionales), así que repetirla no duplica nada. Lo prueba `aws/src/auth.test.ts`.
