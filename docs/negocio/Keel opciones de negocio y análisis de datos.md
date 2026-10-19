# Keel: opciones de negocio y análisis de datos

Oct 16, 2026 · @Daniela Ávila · actualizado el 18 de octubre de 2026

## Decisión: Keel es rentista, asociado a un banco

**[PROPUESTA, por evaluar]** El banco socio es una propuesta del equipo para hacer rentable el proyecto, con un banco como WeBank como socio posible y respaldo. **No hay ningún acuerdo ni conversación con WeBank ni con otro banco**, y la integración bancaria no está construida: queda como evaluación en los próximos pasos ([alcance](../flujo/alcance.md)). Los ingresos pueden venir del rendimiento del dinero retenido en el escrow, de comisiones por servicio (por ejemplo en el caso híbrido de crédito) o de ambos. Lo que Keel sí propone eliminar son las comisiones de los bancos intermediarios en cada transferencia, dejando un solo banco que garantiza que el dinero existe.

**Modelo elegido (18 de octubre de 2026):** Keel gana con la plata que queda depositada y bloqueada en las órdenes. Esa plata se trabaja en instrumentos de inversión seguros y Keel se queda con la utilidad. **El cliente no paga comisión**: ese es el beneficio que lo atrae.

**Siempre a través de un banco socio.** El banco recibe y mantiene los fondos bajo su licencia (cuenta segregada o depósito tokenizado), los invierte y comparte la utilidad con Keel. Keel no capta dinero del público ni invierte por su cuenta: aporta la orden firmada, el control del bloqueo y los datos verificados.

**Dos formas de usar el crédito del banco:**

| Caso | Cómo funciona | Quién pone la plata bloqueada |
| --- | --- | --- |
| A. Crédito al importador | El banco presta el total al importador, y el importador lo deposita en Keel con el flujo de hoy: la orden firmada, el depósito y el bloqueo hasta el embarque | El importador, con el crédito del banco |
| B. Crédito directo a Keel | El banco deposita el crédito directamente en Keel, que gestiona el bloqueo de la orden; el importador le paga al banco después | El banco |

En los dos casos la plata solo puede ir al exportador (anticipo al firmar, saldo al probarse el embarque) o volver a quien la puso si vence el plazo, como en el [flujo](../flujo/flujo-clave.md). El banco además puede usar el historial de cumplimiento de Keel para decidir a quién prestar (análisis 8).

**Lo que hay que resolver antes del piloto [ABIERTO]:**

* **Qué banco**, cómo se reparte la utilidad y en qué instrumentos se invierte. Tienen que ser de bajo riesgo y líquidos: la plata es del importador (o del banco en el caso B) y la promesa de Keel es que está visible, bloqueada y disponible cuando la orden la libera.
* **Opinión legal:** sin el banco, invertir la plata del cliente podría ser captación de dinero del público, reservada a los bancos (art. 39 de la Ley General de Bancos). Con el banco es él quien custodia e invierte bajo su licencia, pero hay que confirmarlo.
* **Cómo se une con la cadena:** hoy el depósito es un token en el contrato de escrow. Si el token es un depósito tokenizado del banco, el rendimiento lo genera el banco con las reservas que lo respaldan y el contrato no cambia; un token que no rinde no genera utilidad. En Hong Kong, las stablecoins reguladas no pueden pagar interés al tenedor.
* **Volumen:** el rendimiento por orden es bajo (unos 82 USD en una orden de 50.000 USD con la mitad retenida 30 días a 4%, ver la opción 2), así que el modelo depende del volumen de plata bloqueada.
* **En la demo** el modelo se muestra como narrativa: la integración con un banco sigue fuera del alcance de la competencia ([alcance](../flujo/alcance.md)).

Las secciones 1 a 3 comparan las opciones que se evaluaron antes de decidir.

## 1. Cobrar comisión por orden

Cobrar un porcentaje chico por cada orden protegida es la opción más simple y la más segura de partir. Idea de partida (sin validar): 0,3% a 0,5% del valor de la orden, con mínimo y tope, pagado por el importador.

**Pros**

- Fácil de explicar y de calcular: más órdenes, más ingresos.
- No toca la plata de los clientes, así que no hay riesgo legal de captación.
- Tiene referencias reales: Alibaba Trade Assurance cobra 2% a 3% al vendedor con tope, y Escrow.com cobra entre 1,9% y 2,6% (fuentes secundarias).
- Se puede mostrar en el demo con números claros.

**Contras**

- Un banco también cobra comisiones, así que por sí sola no nos diferencia.
- No es necesariamente más barata que hoy. El entrevistado paga unos 70.000 CLP por transferencia, dos por orden (anticipo y saldo). En una orden de 50.000 USD, 0,4% son 200 USD. Se vende por la garantía y el fraude evitado, no por precio.
- Depende del volumen: pocas órdenes, pocos ingresos.
- Cuánto pagaría una pyme chilena no está validado. Hay una sola entrevista.

## 2. Manejar la plata detenida (float)

Invertir el saldo bloqueado rinde poco y es la opción con más riesgo legal, así que la dejaríamos para la fase 2 y solo a través de un banco. El saldo queda detenido entre el depósito y el embarque: 1 a 2 semanas en aéreo y varias semanas en marítimo. La idea es invertirlo en algo seguro y de baja tasa, como hace un banco.

**Pros**

- Es un ingreso extra que no depende de cobrar más al cliente.
- Se puede devolver al importador como descuento en la comisión.
- Con un banco socio (cuenta segregada o depósito tokenizado) es legal, porque lo remunera el banco bajo su licencia y Keel recibe una parte.

**Contras**

- Rinde poco: entre 0,08% y 0,46% del valor de la orden, con tasas cercanas a 4%. En una orden de 50.000 USD con 50% retenido por 30 días son unos 82 USD, contra 250 USD de una comisión de 0,5%. Con una tasa de 2,5%, parecida a los depósitos de Hong Kong, bajan a unos 51 USD.
- En Chile podría ser captación de dinero del público, que está reservada a los bancos (art. 39 de la Ley General de Bancos). Hace falta opinión legal.
- En Hong Kong, las stablecoins reguladas no pueden pagar interés al tenedor.
- La plata es del importador. Si la inversión cae o no se puede sacar a tiempo, se rompe la promesa de dinero visible y bloqueado.
- En marítimo con pago a 30 días desde el on board, el importador hoy conserva su plata. Si el escrow le exige depositar todo al inicio, paga antes que hoy: el float sería capital de trabajo que le quitamos.
- Opciones como DeFi no las aceptaría un jurado bancario.

## 3. Financiamiento (la opción que más se parece a generar liquidez)

Es lo que gana el banco con la carta de crédito: prestar, no invertir la plata del cliente. Un banco o fondo pone el capital, el exportador cobra al embarcar y el importador paga a 30 o 60 días con un interés. Keel decide a quién financiar con datos verificados y se queda con una parte del interés. Recomendamos esta opción como motor de ingresos de la fase 2, junto con la comisión.

**Pros**

- Tiene la mayor disposición a pagar: el importador gana plazo y el exportador cobra rápido.
- Usa capital de un tercero con licencia, así que no hay problema de captación.
- Encaja con el pago a 30 días desde el on board que ya existe en marítimo.
- Calza con un banco como WeBank, que presta a pymes y puede usar nuestros datos para decidir.
- Evita ser un banco más: el banco pone la plata y Keel pone la información y el control.

**Contras**

- Hoy está fuera de alcance y exige un financista regulado.
- Si el banco ve que Keel solo lo conecta con clientes, podría hacerlo solo. Por eso importa que los datos y la verificación sean nuestros.
- Necesita volumen y un historial de órdenes para que el financista confíe.

## Recomendación anterior (reemplazada)

Antes de decidir, la recomendación era partir cobrando comisión en la demo y el piloto, y dejar el float y el financiamiento para la fase con bancos. **La reemplaza la decisión de arriba:** sin comisión, con la utilidad de los fondos bloqueados a través de un banco socio y con el crédito del banco en los casos A y B.

## 4. Datos que tendremos

Cada orden deja ocho grupos de datos, y casi todos salen de documentos y de la cadena, no de lo que alguien declara.

| Grupo | Datos | De dónde salen |
| --- | --- | --- |
| Empresa y usuarios | Razón social, rol (importa o exporta), representante legal, usuarios y permisos, cosignatario | Registro en la app |
| Proveedores | Nombre, país, cuenta de cobro verificada, resultado del test de transferencia, estado (conocido o sin verificar), historial de órdenes | Pantallas de proveedores y verificación |
| Orden de compra | Producto, cantidad, precio por unidad, monto total, moneda, % de anticipo, incoterm, fecha límite de embarque, árbitro, forma de pago | Proforma leída por el agente |
| Firmas y aprobaciones | Firma de ambas partes, quién aprobó, cuándo, decisión de las reglas | Firma en la wallet |
| Documentos de embarque | Número de BL o guía aérea, fecha on board, naviera, puerto de carga, factura (número y monto), packing list, certificado de origen, certificados sanitarios o de Sernapesca si aplican | Documentos subidos y atestación de la naviera |
| Pagos y escrow | Monto depositado, anticipo, saldo, fechas, estado, hash de cada transacción | Contrato de escrow |
| Eventos de riesgo | Cambios de cuenta bloqueados, documentos rechazados, disputas, cancelaciones, reembolsos | Motor de reglas y árbitro |
| Agente y reglas | Límite mensual, reglas activas, cambios propuestos y vetos, actividad | Pantallas del agente y del cosignatario |

No se guardan las llaves privadas: el usuario las conserva. Como propuesta de diseño, nada personal iría en la cadena, solo hashes de los documentos. Los datos de personas, como representantes y firmantes, caerían bajo la Ley 21.719, que entra en vigencia el 1 de diciembre de 2026, aunque hay un proyecto para postergarla a 2027.

## 5. Análisis posibles con esos datos

Son ocho análisis, y el que más valor puede tener, con el banco socio, es el puntaje de crédito para financiar. En todos, la IA recomienda, las reglas deciden y la persona autoriza.

### Cómo quedó el agente (18 de octubre de 2026)

El agente es un **analista de las compras** en la pestaña Agent de la app, no un aviso al firmar: las notas antes de firmar se probaron y se quitaron. Hoy tiene:

* **"What the agent sees" [PROPUESTA]:** un modelo lee métricas calculadas en el teléfono (tendencias de gasto, dependencia de proveedores, caja y anticipos comprometidos, ritmo de compra, precios por unidad, negociación) y el rubro y tamaño de la empresa, y escribe hasta 5 hallazgos con recomendaciones. No ve documentos ni nombres y no puede firmar ni mover dinero. Amplía D2, así que lo tiene que confirmar el equipo ([analista](../arquitectura/analista.md)).
* **Los números detrás:** lo comprado o vendido, lo bloqueado en el escrow, el anticipo antes del embarque, embarques a tiempo, reembolsos, gasto por proveedor y producto, y lo negociado frente a cada proforma.
* **Puntaje del proveedor** en su perfil: estrellas por embarques a tiempo, días de margen, documentos aceptados y cuánto tarda en firmar.

Para el modelo rentista, lo que más vale es lo que el banco no tiene de las pymes: el historial verificado de órdenes, pagos y cumplimiento, que sale de documentos y de la cadena. Los modelos predictivos entrenados con esos datos quedan como trabajo futuro.

| Análisis | Qué hace | Datos que usa | Quién lo valora | Cuándo |
| --- | --- | --- | --- | --- |
| Analista de compras (pestaña Agent) | Lee tendencias, dependencia, caja y ritmo de la empresa y aconseja | Métricas de las órdenes, perfil de la empresa | Importador | Demo y piloto |
| Alerta de fraude | Detecta cambio de cuenta o documentos con datos que no calzan | Proveedores, documentos, eventos de riesgo | Importador | Demo (ya está en el mockup) |
| Puntaje del proveedor | Mide plazos cumplidos, documentos correctos y disputas | Proveedores, documentos de embarque, eventos de riesgo | Importador y banco | Piloto |
| Plan de caja | Muestra cuándo hay que pagar anticipo, saldo (30 días desde el on board), flete e impuestos | Orden de compra, fecha on board, incoterm | Importador | Piloto |
| Plazos de entrega | Predice cuándo llega la carga según naviera y ruta | Fecha on board, naviera, puerto, historial | Importador | Piloto y fase 2 |
| Costo real de importar | Suma flete, arancel, IVA y cambio por proveedor | Orden, documentos, certificado de origen | Importador | Fase 2, porque aduanas está fuera de alcance |
| Comparación con empresas parecidas | Muestra cuánto pagas tú frente a tu rubro, con datos anónimos | Todos los grupos, de muchos usuarios | Importador | Fase 2 |
| Puntaje de crédito para financiar | Evalúa a quién prestar según cumplimiento e historial de pagos | Pagos y escrow, proveedores, eventos de riesgo | Banco socio | Piloto con el banco |

### Cada análisis, con un ejemplo

Los ejemplos usan nombres y montos del mockup, y son ilustrativos.

#### 1. Analista de compras

Lee cómo cambian tus compras y qué viene, y te aconseja según el tamaño de tu empresa. Reemplaza a las notas antes de firmar, que se probaron y se quitaron.

**Ejemplo:** Pacífico Foods, pequeña empresa de alimentos, abre la pestaña Agent. El agente muestra: "Lingnan concentra el 71% de tu gasto: valida un segundo proveedor para que un atraso no te deje sin stock", "Tu gasto en agar subió 40% en 90 días: con ese volumen puedes negociar precio o un anticipo menor", "Tu próxima compra de agar sería en unos 37 días: reserva para el anticipo".

**Qué necesita:** las órdenes de la empresa y su rubro y tamaño. Al inicio compara solo contra tus propias órdenes; compararse con el mercado exigiría datos de otras empresas.

#### 2. Alerta de fraude

Detecta cuando algo no calza con lo que ambas partes firmaron.

**Ejemplo:** llega un correo del "proveedor" avisando que cambió su cuenta. Keel lo compara con la cuenta firmada en la orden: es distinta, el pago se bloquea y se avisa al dueño y al cosignatario (pantalla 07). Lo mismo pasa con un BL falsificado o con una factura cuyo monto no coincide con la orden.

**Qué necesita:** la cuenta firmada, los documentos de embarque y el historial de eventos.

#### 3. Puntaje del proveedor

Resume cuánto cumple cada proveedor.

**Ejemplo:** Lingnan Hydrocolloids tiene 4 órdenes, 4 embarques a tiempo, documentos correctos en las 4 y ninguna disputa. Puntaje alto, y el agente acepta un anticipo de 50%. Kowloon Food Ingredients no tiene órdenes y por eso no tiene puntaje: el agente sugiere el test de transferencia y un anticipo menor.

**Qué necesita:** el historial de órdenes por proveedor. Mejora cuando varias empresas de Keel aportan su experiencia con el mismo proveedor, sin mostrar quiénes son.

#### 4. Plan de caja

Muestra cuándo hay que tener la plata.

**Ejemplo:** orden de 48.000 USD con 50% de anticipo, firmada el 2 de octubre. Se paga el anticipo de 24.000 USD ese día. La carga se embarca (on board) el 20 de noviembre. Si el saldo se paga a 30 días desde el on board, que es una decisión pendiente, vence el 20 de diciembre por 24.000 USD. Antes de retirar la carga hay que pagar el flete a la naviera y los derechos e impuestos a Tesorería. El plan dice: "Necesitas 24.000 USD el 2 de octubre, 24.000 USD el 20 de diciembre, y reservar para flete e impuestos antes de que llegue la carga."

**Qué necesita:** la orden, la fecha on board y el incoterm.

#### 5. Plazos de entrega

Predice cuándo llega la carga.

**Ejemplo:** en tus órdenes anteriores con Evergreen, de Hong Kong a San Antonio, pasaron unos 55 días entre el on board y la llegada. Esta salió el 20 de noviembre, así que el agente estima la llegada hacia el 14 de enero y avisa cuándo mandar los documentos al agente de aduana.

**Qué necesita:** fecha on board, naviera, puertos e historial. Sirve cuando hay varias órdenes en la misma ruta.

#### 6. Costo real de importar

Suma todo lo que cuesta traer la carga, no solo el precio del proveedor.

**Ejemplo, con el caso que contó el importador entrevistado (carga aérea):** valor CIF de 10.000 USD, arancel de 6% (600 USD) e IVA de 19% sobre 10.600 USD (2.014 USD). Total de derechos e impuestos: 2.614 USD, que se pagan a Tesorería antes de retirar la carga. El certificado de origen puede dar beneficios si hay tratado con el país. Keel mostraría ese total antes de comprar y compararía el costo por kilo entre proveedores, sumando flete, impuestos y cambio.

**Qué necesita:** la orden, los documentos y el certificado de origen. Como pagar aduanas está fuera de alcance, partiría como una estimación.

#### 7. Comparación con empresas parecidas

Te dice cómo estás frente a tu rubro, con datos agregados y anónimos.

**Ejemplo:** "Tu flete de Hong Kong a San Antonio salió 12% más caro que el de empresas parecidas este trimestre" o "tu proveedor tarda 9 días más en embarcar que el promedio".

**Qué necesita:** datos de muchas empresas. Con pocas, se podría identificar a alguien, así que parte en la fase 2.

#### 8. Puntaje de crédito para financiar

Evalúa a quién prestarle, y es el análisis que más valor tiene para un banco.

**Ejemplo:** Pacifico Foods tiene 12 órdenes cerradas, ninguna disputa, todos los pagos a tiempo y ningún cambio de cuenta aceptado. Con eso, un banco o fondo podría ofrecerle pagar a 60 días con un tope de 50.000 USD, y Keel recibe parte del interés. El banco no tiene estos datos de las pymes, y los nuestros salen de documentos y de la cadena, no de lo que ellas declaran.

**Qué necesita:** pagos, proveedores, eventos de riesgo y varios meses de historial.

Los análisis de plazos, comparación y crédito mejoran con volumen: con pocas órdenes sirven poco. Una posible forma de cobrarlos es un plan gratis para pagar y proteger, un plan Pro con los análisis del importador, y una licencia para bancos con el puntaje de crédito. Falta validar con importadores cuánto pagarían por cada uno.
