---
type: Área de trabajo
title: "Área 4: producto, onboarding y canal humano"
description: "Objetivo, entregables y tareas T4.1 a T4.10: onboarding, diff legible, bot de Telegram, firma sin llave en servidor, cosignatario, avisos, bitácora, perfiles y disputa."
tags: [area-4, app, bot, ux, t4]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Perfil sugerido:** frontend o full stack con criterio de producto y UX.
**Objetivo:** que cada persona entienda lo que firma sin leer hexadecimal, que el primer registro de un beneficiario o de un proveedor no sea confianza ciega y que el cosignatario pueda frenar sin poder robar.

# Entregables

* App con dos tipos de cuenta:
  * **Personal:** onboarding, libreta de beneficiarios, diff legible de cambios, bitácora y panel de niveles.
  * **Empresa (Trade):** perfiles de importador y exportador, creación y firma de la orden, diff legible, estado del escrow y disputa.
  * Vista del cosignatario en los dos.
* Bot de Telegram con mensajes de plantilla y enlaces a la app.
* Firma de cada persona desde su propia billetera, sin llaves en el servidor.

# Tareas

**T4.1 Onboarding con verificación fuera de banda (crítica 9).**
1. Se registra la contraparte.
   * **Personal (base):** el usuario registra un beneficiario: alias, nombre, RUT, dominio de correo esperado y dirección de pago.
   * **Trade (agregado):** el importador registra un proveedor: nombre, identificador y cuenta de cobro.
2. Keel envía una **transferencia de prueba** de un monto aleatorio pequeño, por ejemplo 0,37.
3. El usuario le pide a la contraparte, por un canal distinto (teléfono o en persona), que le confirme el monto exacto recibido, y lo ingresa en la app.
4. Solo si coincide, la dirección queda verificada y su alta se encola a través del Delay: en la lista blanca (Personal) o como proveedor conocido (Trade).

El resultado de la verificación (monto, fecha y canal) se guarda como hash en la bitácora. En el deck esto se compara con los microdepósitos que usan los bancos. En Trade, un proveedor no conocido no impide firmar una orden, pero su primer depósito es de nivel 2.

**T4.2 Diff legible antes de firmar (crítica 17).**
* **Personal (base):** diff de un cambio de beneficiario. Pantalla con:
  * alias y nombre;
  * **cuenta anterior** en grupos cortos con identicon, fecha de verificación y pagos realizados;
  * **cuenta nueva** con identicon, "vista por primera vez hoy", fuente (correo de X) y resultado de SPF/DKIM;
  * qué cambia en el contrato y cuándo termina el enfriamiento.

  Antes de firmar, exige el paso de verificación por otro canal (T4.1).
* **Trade (agregado):** diff de la orden. Pantalla con:
  * partes, con nombre e identificador tomados del registro;
  * **cuenta de cobro** en grupos cortos con identicon, y si es la misma de órdenes anteriores con ese proveedor o "vista por primera vez hoy";
  * monto total, anticipo y saldo, fecha límite de embarque, naviera, árbitro e incoterm;
  * qué puede y qué no puede hacer el contrato con esos fondos.

En los dos, el botón por defecto es "Rechazar", no "Aprobar" ni "Firmar".

**T4.3 Bot de Telegram seguro (crítica 8).**
* Solo envía mensajes armados con plantillas y campos tipados: enums, montos y fechas. Nunca reenvía texto de un correo, un PDF u otro documento.
* Responde solo a una lista de chats registrados.
* No firma nada: los botones abren la app, donde firma la billetera de la persona.
* El token se guarda como se define en T2.7.

**T4.4 Firma sin llave en el servidor.**
* **Personal (base):** el dueño firma desde su billetera (WalletConnect o una billetera de navegador) y propone transacciones al Delay con el SDK de Safe.
* **Trade (agregado):** importador y exportador firman la orden desde su billetera, y los dueños proponen cambios al Delay de la misma forma.
* En la demo pueden ser billeteras de prueba, pero **nunca** una llave en el servidor. Esto separa a Keel del competidor, que reconoce tener la llave del dueño en el servidor.

**T4.5 Vista del cosignatario.**
* Lista de cambios en cola, con el diff legible y su cuenta regresiva.
* Botón "Vetar" y botón de pánico "Revocar al agente": cada uno es una sola transacción con el rol COSIGNATARIO (T1.3).
* Solicitudes de nivel 3 para cofirmar: pagos en Personal, depósitos en Trade.
* No hay ningún botón para iniciar pagos, porque el rol no lo permite.

**T4.6 Avisos de retenciones y de plazos (crítica 19).**
Diseñar los mensajes de T2.6.
* **Personal (base):** qué pasó, por qué, cuánto falta para el vencimiento y cómo pagar manualmente si es urgente. Probarlos con 2 personas ajenas al equipo.
* **Trade (agregado):** qué pasó, por qué, cuánto falta para la fecha límite y qué puede hacer la persona. Incluye los avisos de depósito, anticipo, embarque, saldo, reembolso y alerta de cambio de cuenta.

**T4.7 Bitácora y panel de niveles.**
* **Personal (base):** una línea por intento: estado (pagado, retenido, en cola, vetado, revertido en cadena), regla que decidió, nivel, enlace al PDR y a la transacción. Contador "facturas pagadas, ataques bloqueados, fondos perdidos: 0".
* **Trade (agregado):** una línea por evento: estado, regla que decidió, nivel, enlace al PDR y a la transacción. Contador "órdenes liquidadas, ataques bloqueados, fondos perdidos: 0".
* Panel con los niveles 0 a 4, común a los dos.
* Se usa en la demo y en las capturas.

**T4.8 Textos en inglés y diseño de la demo.**
* Todos los textos de la interfaz en inglés, claros, sin jerga cripto. En Personal, montos en pesos con su equivalente en el token.
* Coordinar con el Área 5 que cada acto de la demo se vea en una sola pantalla.

**T4.9 Perfiles y flujo de la orden (agregada por Trade).**
* Selección del tipo de cuenta al entrar: Personal o Empresa.
* Perfil de importador: crear una orden a partir de la proforma, firmarla, ver el depósito y el estado.
* Perfil de exportador: revisar y firmar la orden, ver que los fondos están depositados, subir el BL y la factura, ver el cobro.
* Vista de la orden con su estado en el escrow y la línea de tiempo: firmada, depositada, anticipo, embarcada, liquidada o reembolsada.

**T4.10 Disputa y cancelación (agregada por Trade, se recorta si falta tiempo).**
Botones para abrir una disputa y para cancelar de mutuo acuerdo, y una vista mínima para que el árbitro firme el reparto.

# Listo cuando

* Los cuatro actos de la demo se recorren desde la interfaz sin tocar la consola.
* Ninguna pantalla muestra una dirección completa sin identicon y sin alias o nombre.
* El bot pasa la prueba de inyección del Área 5: un emisor o un documento con instrucciones no aparece en ningún mensaje.

# Dependencias

* Recibe direcciones y ABIs del Área 1, estados del Área 2, y solicitudes de cambio y alertas del Área 3.
* Entrega capturas y la grabación al Área 5.

# Si falta tiempo

Se recortan la prueba con personas externas, la vista del árbitro (la disputa se muestra por script), la vista móvil y el alta de proveedor con transferencia de prueba (queda una lista precargada, y se declara). **Nunca** se recortan el diff legible, la verificación fuera de banda de Personal, los dos perfiles de Trade ni la firma sin llave en el servidor.
