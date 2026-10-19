// Texto en español del deck y guion del orador (tecla N). Lo que va entre [corchetes] con
// subrayado amarillo es un marcador: reemplazarlo por cifras y hashes reales antes de presentar.
window.KEEL_TEXT = {
  lang: 'es',
  flowSteps: ['Firmar', 'Bloquear', 'Probar y pagar', 'Reembolsar'],
  slides: {
    title: {
      tag: 'Pagos que esperan la prueba.',
      sub: 'Un agente de IA opera la billetera de la empresa. Paga una orden internacional solo cuando existe la prueba.',
      chips: ['Tema F · Agent Wallet', 'Equipo FinLink'],
      notes: {
        time: '0:20',
        say: 'Hola, somos FinLink. Esto es Keel: pagos que esperan la prueba. Les contamos una historia corta.',
        tip: 'Sonreír, respirar y avanzar al terminar la frase.',
      },
    },
    problem: {
      kicker: 'El problema',
      title: 'Camila importa USD 87.000 en componentes electrónicos desde Hong Kong.',
      importer: 'Andes Tech', importerPlace: 'Chile',
      exporter: 'Lingnan', exporterPlace: 'Hong Kong',
      question: '¿Quién paga primero?',
      payFirst: 'Camila paga antes', payFirstRisk: 'El proveedor puede no embarcar nunca.',
      payLater: 'Camila paga después', payLaterRisk: 'El proveedor no embarca sin pago.',
      pains: ['Transferencias lentas', 'Comisión en cada transferencia', 'Órdenes en papel y correo'],
      mailFrom: 'De: accounts@lingnan-hk.co', mailSubject: 'Nueva cuenta bancaria', mailBody: 'Estimada Camila, cambiamos de banco. Por favor envíe el saldo a esta cuenta:', mailAccount: 'HK 0099 7731 4410', stamp: 'FRAUDE',
      notes: {
        time: '0:45',
        say: 'Ella es Camila. Compra para Andes Tech, una empresa de electrónica en Chile. Importa veinticuatro mil componentes electrónicos de Lingnan, un proveedor en Hong Kong. La orden es de ochenta y siete mil dólares. Entonces, ¿quién paga primero? Si Camila paga antes, el proveedor puede no embarcar nunca. Si espera, el proveedor no embarca sin pago. Hoy usa transferencias bancarias lentas y caras. Y un día llega un correo: "Cambiamos nuestra cuenta bancaria". Parece real. Es un fraude.',
        tip: 'Pausa después de "¿quién paga primero?". Dejar que aparezca el correo antes de decir "es un fraude".',
      },
    },
    meet: {
      kicker: 'Conozcan Keel',
      title: 'Una billetera de empresa operada por un agente de IA.',
      bullets: [
        { icon: 'key', text: '<b>El importador conserva su llave.</b> Keel nunca la tiene.' },
        { icon: 'bot', text: '<b>El agente</b> actúa solo dentro de los límites que fija su empresa.' },
        { icon: 'lock', text: '<b>El dinero espera</b> en un contrato inteligente hasta que existe la prueba.' },
      ],
      phoneLabel: 'App de Keel · importador',
      notes: {
        time: '0:30',
        say: 'Por eso construimos Keel. Keel es una billetera para empresas operada por un agente de IA. El importador conserva su propia llave. El agente solo actúa dentro de los límites que fija su empresa. Y el dinero espera en un contrato inteligente hasta que existe la prueba. Sigamos la orden.',
      },
    },
    sign: {
      title: 'Las dos empresas firman la orden.',
      lead: 'Firman <b>datos, no un PDF</b>. La cuenta del proveedor es parte de lo que firman.',
      bullets: [
        { icon: 'pen', text: 'Firma el exportador y el importador firma al final.' },
        { icon: 'lock', text: 'Desde aquí, <b>ningún correo ni documento</b> puede cambiar la cuenta.' },
      ],
      phoneLabel: 'Firma de la orden PO-0157',
      notes: {
        time: '0:40',
        say: 'Primero, las dos empresas firman la orden de compra en sus teléfonos. Firman datos, no un PDF. Miren esta tarjeta: la cuenta del proveedor está dentro de la orden firmada. Desde ahora, ningún documento ni correo puede cambiarla.',
        tip: 'Señalar la tarjeta destacada en el teléfono.',
      },
    },
    lock: {
      title: 'El dinero queda bloqueado. Se paga el anticipo.',
      lead: 'El agente deposita el total. En la <b>misma transacción</b>, el contrato paga el anticipo.',
      importer: 'Importador', exporter: 'Exportador',
      paid: 'Anticipo pagado', locked: 'Bloqueado en escrow', pending: 'Saldo pendiente',
      note: 'El exportador ve que el saldo está ahí. El importador no puede retirarlo por su cuenta.',
      phoneLabel: 'Orden PO-0142',
      notes: {
        time: '0:35',
        say: 'Cuando ambas firmaron, el agente deposita los ochenta y siete mil dólares en el contrato. En la misma transacción, el contrato paga el anticipo a Lingnan. Ahora el proveedor puede ver que el resto del dinero está ahí, y bloqueado.',
      },
    },
    prove: {
      title: 'El exportador embarca. Keel revisa la prueba.',
      nodes: [
        { icon: 'ship', title: 'La naviera firma: carga a bordo', sub: 'Harbor Line, un tercero. El exportador no puede firmarlo.' },
        { icon: 'doc', title: 'El exportador sube el BL y la factura', sub: 'La IA los lee. Solo lee.' },
        { icon: 'scale', title: 'El motor de reglas compara', sub: 'Contra la orden firmada, y luego firma el verificador.' },
      ],
      release: 'Dos firmas independientes liberan el saldo.',
      exporter: 'Exportador', pending: 'Saldo pendiente', received: 'Pagado completo',
      phoneLabel: 'Exportador, luego importador · PO-0131',
      notes: {
        time: '0:45',
        say: 'Ahora el exportador embarca la mercancía. La naviera, Harbor Line, firma que la carga está a bordo. El exportador sube el conocimiento de embarque y la factura. Nuestra IA los lee, y el motor de reglas los compara con la orden firmada. Si todo calza, se paga el saldo. Así, dos firmas independientes liberan el dinero: la de la naviera, y la del verificador o la aprobación de la propia Camila.',
        tip: 'Si preguntan: el importador tiene una ventana de disputa antes de que el verificador pueda liberar el saldo.',
      },
    },
    refund: {
      title: '¿No embarca? El dinero vuelve.',
      lead: 'Si no hay prueba antes de la fecha límite, el saldo vuelve al importador. <b>Cualquiera puede ejecutar el reembolso</b>, así que el importador no depende de nadie.',
      importer: 'Importador', exporter: 'Exportador', pending: 'Saldo pendiente', kept: 'Conserva el anticipo', back: 'Saldo devuelto',
      deadline: 'Embarque antes del 20 nov', daysLeft: 'días', expired: 'Plazo vencido', stamp: 'Sin prueba de embarque',
      phoneLabel: 'Orden PO-0128, reembolsada',
      notes: {
        time: '0:25',
        say: '¿Y si el exportador nunca embarca? Pasa la fecha límite, el candado se abre y el saldo vuelve al importador. Cualquiera puede ejecutar el reembolso, así que el importador no depende de nadie.',
        tip: 'El anticipo queda con el proveedor: solo vuelve el saldo. Decirlo si preguntan.',
      },
    },
    security: {
      kicker: 'Seguridad',
      title: '¿Y si engañan a la IA?',
      layers: [
        { who: 'IA', what: 'Lee', how: 'Sin herramientas. Salida cerrada, sin texto libre.' },
        { who: 'Motor', what: 'Decide', how: 'Reglas fijas contra la orden firmada.' },
        { who: 'Personas', what: 'Autorizan', how: 'Firman con sus propias llaves.' },
        { who: 'Contrato', what: 'Ejecuta', how: 'Solo paga a las partes de la orden.' },
      ],
      attacks: [
        { title: 'Correo de cuenta falsa', desc: 'La IA lee la cuenta nueva. Nada cambia: la cuenta sale de la orden firmada.', result: 'Ignorado', hash: 'Escenario <span class="ph">[ID]</span>' },
        { title: 'Llave del agente robada', desc: 'El ladrón intenta sacar el dinero. El módulo de permisos de la billetera lo rechaza.', result: 'Revertido', hash: 'tx <span class="ph">[0x… hash del revert]</span>' },
      ],
      punch: 'La IA puede fallar. <span class="money">El dinero no se mueve.</span>',
      phoneLabel: 'La app también lo dice',
      notes: {
        time: '1:05',
        say: 'Ahora, la pregunta importante: ¿y si engañan a la IA? Lo diseñamos para eso. La IA solo lee. El motor decide. Las personas autorizan. El contrato ejecuta. ¿Recuerdan el correo falso? La IA lee la cuenta nueva y no pasa nada, porque la cuenta sale de la orden firmada. La app incluso lo dice: una cuenta bancaria nueva en un documento se ignora. Ahora un ataque peor: alguien roba la llave del agente e intenta enviar el dinero a otra parte. El módulo de permisos de la billetera lo rechaza, y el rechazo tiene su propio hash. La IA puede fallar. El dinero no se mueve.',
        tip: 'Reemplazar los marcadores por el escenario del red team y el hash real del revert antes de presentar.',
      },
    },
    analyst: {
      kicker: 'Interacción',
      title: 'El agente también te ayuda a comprar mejor.',
      lead: 'Tendencias, dependencia de proveedores y la caja que viene, ajustado al tamaño de la empresa.',
      bullets: [
        { icon: 'eye', text: 'Ve <b>solo números</b>: los proveedores como S1, S2. Sin documentos ni nombres.' },
        { icon: 'x', text: '<b>No puede firmar</b> ni mover dinero.' },
        { icon: 'chart', text: '<b>A futuro:</b> modelos predictivos entrenados con los propios datos de la empresa, para tomar mejores decisiones.' },
      ],
      phoneLabel: 'Pestaña Agent',
      notes: {
        time: '0:25',
        say: 'El agente también ayuda a Camila a comprar mejor: tendencias, riesgo de proveedores y la caja que viene. Solo ve números, nunca documentos ni nombres, y no puede mover dinero. A futuro, entrenaremos modelos predictivos con los propios datos de cada empresa, para que tome mejores decisiones.',
        tip: 'El analista sigue como propuesta por confirmar por el equipo. Si no se confirma, saltar esta slide.',
      },
    },
    chain: {
      kicker: 'En la cadena',
      title: 'Cada pago, bloqueo y revert deja un hash.',
      lead: '<b>MVP:</b> desplegado en Base Sepolia, una red de prueba pública, con USDC de prueba. El piloto pasa a una red cerrada con participantes identificados.',
      contracts: [
        { name: 'Safe', role: 'La billetera de la empresa', addr: '0x366E72921895dBFD7688822418BE43E02551Ee82' },
        { name: 'Roles', role: 'Lo que el agente puede hacer', addr: '0xD60f4297ed883D9b567A5A511F0735b2A7b19592' },
        { name: 'Delay', role: 'Un proveedor nuevo espera; el dueño puede vetarlo', addr: '0x9dA7C60101D5988b56a6d76bF04E579C10cE2094' },
        { name: 'FundingGate', role: 'Revisa proveedor, naviera y política antes del depósito', addr: '0x2bc56bbB5B47B493009531e751C8Bd90513e927f' },
        { name: 'TradeEscrow', role: 'Retiene, paga y reembolsa', addr: '0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970' },
        { name: 'USDC (prueba)', role: 'Token de pago de Circle', addr: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      ],
      network: 'MVP · Base Sepolia · cadena 84532',
      hashes: 'Transacciones de la demo: <span class="ph">[enlaces a los hashes]</span>',
      notes: {
        time: '0:25',
        say: 'En este MVP, todo esto corre en la cadena, en Base Sepolia, una red de prueba pública. El piloto pasará a una red cerrada con participantes identificados. Cada pago, cada bloqueo y cada rechazo deja un hash que cualquiera puede verificar.',
      },
    },
    business: {
      kicker: 'Modelo de negocio', badge: 'Propuesta · no construida',
      title: 'Un banco garantiza los fondos. Las comisiones intermedias desaparecen.',
      importer: 'Importador', importerSub: 'Sin comisión a Keel',
      keelSub: 'Escrow y agente',
      exporter: 'Exportador', exporterSub: 'Cobra con la prueba',
      bank: 'Banco socio, p. ej. WeBank', bankSub: 'Garantiza que los fondos existen',
      fees: ['Comisiones intermedias', 'Comisiones intermedias'],
      revenue: [
        { title: 'Rendimiento de los fondos bloqueados', sub: 'El banco socio invierte el dinero bloqueado en instrumentos seguros y comparte la utilidad.' },
        { title: 'Comisión por servicio', sub: 'Por ejemplo, cuando el importador no tiene fondos y necesita crédito.' },
      ],
      notes: {
        time: '0:40',
        say: '¿Cómo gana dinero Keel? Esta es nuestra propuesta. Un banco socio, por ejemplo WeBank, garantiza que los fondos existen, y desaparecen las comisiones de los bancos intermediarios. Keel podría ganar con el rendimiento de los fondos bloqueados y con comisiones por servicio, por ejemplo cuando el importador necesita crédito. Es una propuesta: todavía no está construida.',
        tip: 'Nunca decir que WeBank acordó algo. Si preguntan por la legalidad: requiere opinión legal y un banco socio.',
      },
    },
    mvp: {
      kicker: 'Un MVP honesto',
      title: 'Hecho para Chile y Hong Kong. Diseñado para cualquier país.',
      lead: 'Cualquier empresa de cualquier país puede ser importadora o exportadora. Cada país suma sus reglas, su identidad y su seguridad.',
      phases: [
        { name: 'Hoy', title: 'MVP', items: ['Flujo de seis pasos en una red de prueba pública', 'Llaves de prueba para la naviera y el árbitro', 'Validación de identidad simulada'] },
        { name: 'Siguiente', title: 'Piloto', items: ['Reglas y proformas por empresa y por país', 'Identidad con proveedores reconocidos legalmente', 'Una naviera real firma el embarque'] },
        { name: 'Después', title: 'Banco socio', items: ['Banco socio y modelo de rendimiento', 'Stablecoin regulada', 'Firewall delante de la API, KYC y AML'] },
      ],
      notes: {
        time: '0:35',
        say: 'Para ser honestos: Keel es un MVP. Corre en una red de prueba con llaves de prueba. Chile y Hong Kong es nuestro primer caso, pero cualquier empresa de cualquier país puede ser importadora o exportadora. Lo siguiente es sumar las reglas, la identidad y la seguridad de cada país.',
      },
    },
    close: {
      title: 'Camila firmó una vez. <span class="accent">Su dinero esperó la prueba.</span>',
      stats: [
        { icon: 'shield', v: '7', l: 'ataques rechazados en Base Sepolia, cada uno con su hash público' },
        { icon: 'flask', v: '294', l: 'tests de los contratos, todos pasan' },
        { icon: 'key', v: '0', l: 'llaves del dueño en un servidor' },
      ],
      verify: 'Compruébalo tú mismo: un depósito a una cuenta que la empresa nunca aprobó, rechazado en la cadena',
      verifyUrl: 'https://sepolia.basescan.org/tx/0x66af984a30522715feb145d91c55c309213ba21035d7ab8e57e7dcae37fccf1e',
      thanks: 'Gracias.',
      repo: '<a href="https://github.com/FinLinkChile/Keel" target="_blank" rel="noopener">github.com/FinLinkChile/Keel</a>',
      notes: {
        time: '0:25',
        say: 'Camila firmó una vez. Su dinero esperó la prueba. Y lo probamos: siete ataques rechazados en la cadena, cada uno con su hash público, y doscientos noventa y cuatro tests de los contratos que pasan. Eso es Keel. Gracias. Con gusto respondemos sus preguntas.',
        tip: 'Los 7 rechazos son los casos 1.3 a 1.9 de la evidencia del Área 1 (rama area1/evidence). Si el jurado pregunta, abrir el enlace de la slide.',
      },
    },
  },
};
