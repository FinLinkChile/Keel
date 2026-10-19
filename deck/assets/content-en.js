// English text of the deck and the speaker script (N key). Yellow dashed [brackets] are
// placeholders: replace them with real numbers and hashes before presenting.
window.KEEL_TEXT = {
  lang: 'en',
  flowSteps: ['Sign', 'Lock', 'Prove and pay', 'Refund'],
  slides: {
    title: {
      tag: 'Payments that wait for proof.',
      sub: 'An AI agent runs the company wallet. It pays an international order only when the proof exists.',
      chips: ['Topic F · Agent Wallet', 'Team FinLink'],
      notes: {
        time: '0:20',
        say: 'Hello, we are FinLink. This is Keel: payments that wait for proof. Let us tell you a short story.',
        tip: 'Smile, breathe, click when you finish the sentence.',
      },
    },
    problem: {
      kicker: 'The problem',
      title: 'Camila imports USD 87,000 of electronic components from Hong Kong.',
      importer: 'Andes Tech', importerPlace: 'Chile',
      exporter: 'Lingnan', exporterPlace: 'Hong Kong',
      question: 'Who pays first?',
      payFirst: 'Camila pays first', payFirstRisk: 'The supplier may never ship.',
      payLater: 'Camila pays later', payLaterRisk: 'The supplier will not ship without payment.',
      pains: ['Slow bank transfers', '~USD 75 per transfer', 'Orders on paper and email'],
      mailFrom: 'From: accounts@lingnan-hk.co', mailSubject: 'New bank account', mailBody: 'Dear Camila, our bank changed. Please send the balance to this account:', mailAccount: 'HK 0099 7731 4410', stamp: 'FRAUD',
      source: 'Costs and pains from an interview with a Chilean importer. Fake account email: the most common fraud in foreign trade.',
      notes: {
        time: '0:45',
        say: 'This is Camila. She buys for Andes Tech, an electronics company in Chile. She imports twenty-four thousand electronic components from Lingnan, a supplier in Hong Kong. The order is eighty-seven thousand dollars. So, who pays first? If Camila pays first, the supplier may never ship. If she waits, the supplier will not ship without payment. Today she uses bank transfers that are slow and expensive. And one day, an email arrives: "We changed our bank account." It looks real. It is fraud.',
        tip: 'Pause after "Who pays first?". Let the email animation land before saying "It is fraud".',
      },
    },
    meet: {
      kicker: 'Meet Keel',
      title: 'A company wallet, run by an AI agent.',
      bullets: [
        { icon: 'key', text: '<b>The importer keeps its key.</b> Keel never holds it.' },
        { icon: 'bot', text: '<b>The agent</b> acts only inside the limits the company sets.' },
        { icon: 'lock', text: '<b>The money waits</b> in a smart contract until the proof exists.' },
      ],
      phoneLabel: 'Keel app · importer',
      notes: {
        time: '0:30',
        say: 'So we built Keel. Keel is a wallet for companies, run by an AI agent. The importer keeps its own key. The agent only acts inside the limits the company sets. And the money waits in a smart contract until the proof exists. Let us follow the order.',
      },
    },
    sign: {
      title: 'Both companies sign the order.',
      lead: 'They sign <b>data, not a PDF</b>. The supplier\'s account is part of what they sign.',
      bullets: [
        { icon: 'pen', text: 'The exporter signs, then the importer signs last.' },
        { icon: 'lock', text: 'From now on, <b>no email and no document</b> can change the account.' },
      ],
      phoneLabel: 'Signing order PO-0157',
      notes: {
        time: '0:40',
        say: 'First, both companies sign the purchase order on their phones. They sign data, not a PDF. Look at this card: the supplier\'s account is inside the signed order. From now on, no document and no email can change it.',
        tip: 'Point at the highlighted card on the phone.',
      },
    },
    lock: {
      title: 'The money is locked. The advance is paid.',
      lead: 'The agent deposits the total. In the <b>same transaction</b>, the contract pays the advance.',
      importer: 'Importer', exporter: 'Exporter',
      paid: 'Advance paid', locked: 'Locked in escrow', pending: 'Balance pending',
      note: 'The exporter sees the balance is there. The importer cannot take it back alone.',
      phoneLabel: 'Order PO-0142',
      notes: {
        time: '0:35',
        say: 'When both have signed, the agent deposits the eighty-seven thousand dollars in the contract. In the same transaction, the contract pays the advance to Lingnan. Now the supplier can see that the rest of the money is there, and locked.',
      },
    },
    prove: {
      title: 'The exporter ships. Keel checks the proof.',
      nodes: [
        { icon: 'ship', title: 'The carrier signs: cargo on board', sub: 'Harbor Line, a third party. The exporter cannot sign it.' },
        { icon: 'doc', title: 'The exporter uploads the B/L and invoice', sub: 'The AI reads them. It only reads.' },
        { icon: 'scale', title: 'The rules engine compares', sub: 'Against the signed order, then the verifier signs.' },
      ],
      release: 'Two independent signatures release the balance.',
      exporter: 'Exporter', pending: 'Balance pending', received: 'Paid in full',
      phoneLabel: 'Exporter, then importer · PO-0131',
      notes: {
        time: '0:45',
        say: 'Now the exporter ships the goods. The carrier, Harbor Line, signs that the cargo is on board. The exporter uploads the bill of lading and the invoice. Our AI reads them, and the rules engine compares them with the signed order. If everything matches, the balance is paid. So two independent signatures release the money: the carrier\'s, and the verifier\'s, or Camila\'s own approval.',
        tip: 'If asked: the importer has a dispute window before the verifier can release the balance.',
      },
    },
    refund: {
      title: 'No shipment? The money goes back.',
      lead: 'If there is no proof by the deadline, the balance returns to the importer. <b>Anyone can trigger the refund</b>, so the importer depends on no one.',
      importer: 'Importer', exporter: 'Exporter', pending: 'Balance pending', kept: 'Keeps the advance', back: 'Balance returned',
      deadline: 'Ship by Nov 20', daysLeft: 'days left', expired: 'Deadline passed', stamp: 'No proof of shipment',
      phoneLabel: 'Order PO-0128, refunded',
      notes: {
        time: '0:25',
        say: 'And if the exporter never ships? The deadline passes, the lock opens, and the balance goes back to the importer. Anyone can trigger the refund, so the importer does not depend on anyone.',
        tip: 'The advance stays with the supplier: only the balance returns. Say it if asked.',
      },
    },
    security: {
      kicker: 'Security',
      title: 'What if the AI is tricked?',
      layers: [
        { who: 'AI', what: 'Reads', how: 'No tools. Closed output, no free text.' },
        { who: 'Engine', what: 'Decides', how: 'Fixed rules against the signed order.' },
        { who: 'People', what: 'Authorize', how: 'They sign with their own keys.' },
        { who: 'Contract', what: 'Executes', how: 'Pays only the parties of the order.' },
      ],
      attacks: [
        { title: 'Fake account email', desc: 'The AI reads the new account. Nothing changes: the account comes from the signed order.', result: 'Ignored', hash: 'Scenario <span class="ph">[ID]</span>' },
        { title: 'Stolen agent key', desc: 'The thief tries to send the money out. The wallet\'s permission module rejects it.', result: 'Reverted', hash: 'tx <span class="ph">[0x… revert hash]</span>' },
      ],
      punch: 'The AI can fail. <span class="money">The money does not move.</span>',
      phoneLabel: 'The app says it too',
      notes: {
        time: '1:05',
        say: 'Now, the important question: what if the AI is tricked? We designed for that. The AI only reads. The engine decides. People authorize. The contract executes. Remember the fake email? The AI reads the new account, and nothing happens, because the account comes from the signed order. The app even says it: a new bank account in a document is ignored. Now a worse attack: someone steals the agent\'s key and tries to send the money away. The wallet\'s permission module rejects it, and the rejection has its own hash. The AI can fail. The money does not move.',
        tip: 'Replace the placeholders with the red team scenario and the real revert hash before presenting.',
      },
    },
    analyst: {
      kicker: 'Interaction',
      title: 'The agent also helps you buy better.',
      lead: 'Trends, supplier dependence and the cash coming up, fitted to the size of the company.',
      bullets: [
        { icon: 'eye', text: 'It sees <b>only numbers</b>: suppliers as S1, S2. No documents, no names.' },
        { icon: 'x', text: 'It <b>cannot sign</b> and cannot move money.' },
        { icon: 'chart', text: '<b>Next:</b> predictive models trained on the company\'s own data, to help it make better decisions.' },
      ],
      phoneLabel: 'Agent tab',
      notes: {
        time: '0:25',
        say: 'The agent also helps Camila buy better: trends, supplier risk, and the cash coming up. It only sees numbers, never documents or names, and it cannot move money. Next, we will train predictive models on each company\'s own data, to help it make better decisions.',
        tip: 'The analyst is still a proposal for the team to confirm. If it is not confirmed, skip this slide.',
      },
    },
    chain: {
      kicker: 'On chain',
      title: 'Every payment, block and revert leaves a hash.',
      lead: '<b>MVP:</b> deployed on Base Sepolia, a public test network, with test USDC. The pilot moves to a closed network with identified participants.',
      contracts: [
        { name: 'Safe', role: 'The company wallet', addr: '0x366E72921895dBFD7688822418BE43E02551Ee82' },
        { name: 'Roles', role: 'What the agent is allowed to do', addr: '0xD60f4297ed883D9b567A5A511F0735b2A7b19592' },
        { name: 'Delay', role: 'A new supplier waits; the owner can veto', addr: '0x9dA7C60101D5988b56a6d76bF04E579C10cE2094' },
        { name: 'FundingGate', role: 'Checks supplier, carrier and policy before a deposit', addr: '0x2bc56bbB5B47B493009531e751C8Bd90513e927f' },
        { name: 'TradeEscrow', role: 'Holds, pays and refunds', addr: '0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970' },
        { name: 'USDC (test)', role: 'Payment token by Circle', addr: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      ],
      network: 'MVP · Base Sepolia · chain 84532',
      hashes: 'Demo transactions: <span class="ph">[links to the hashes]</span>',
      notes: {
        time: '0:25',
        say: 'For this MVP, all of this runs on chain, on Base Sepolia, a public test network. The pilot will move to a closed network with identified participants. Every payment, every block and every rejection leaves a hash that anyone can verify.',
      },
    },
    business: {
      kicker: 'Business model', badge: 'Proposal · not built',
      title: 'One bank guarantees the funds. Intermediary fees disappear.',
      importer: 'Importer', importerSub: 'No fee to Keel',
      keelSub: 'Escrow and agent',
      exporter: 'Exporter', exporterSub: 'Paid on proof',
      bank: 'Partner bank, e.g. WeBank', bankSub: 'Guarantees the funds exist',
      fees: ['Intermediary fees', 'Intermediary fees'],
      revenue: [
        { title: 'Yield on locked funds', sub: 'The partner bank invests the locked money in safe instruments and shares the yield.' },
        { title: 'Service fees', sub: 'For example, when the importer has no funds and needs credit.' },
      ],
      notes: {
        time: '0:40',
        say: 'How does Keel make money? This is our proposal. One partner bank, for example WeBank, guarantees that the funds exist, and the fees of the intermediary banks disappear. Keel could earn from the yield of the locked funds, and from service fees, for example when the importer needs credit. It is a proposal: it is not built yet.',
        tip: 'Never say WeBank agreed to anything. If asked about legality: it needs a legal opinion and a bank partner.',
      },
    },
    mvp: {
      kicker: 'Honest MVP',
      title: 'Built for Chile and Hong Kong. Designed for any country.',
      lead: 'Any company in any country can be importer or exporter. Each country adds its own rules, identity and security.',
      phases: [
        { name: 'Today', title: 'MVP', items: ['Six-step flow on a public test network', 'Test keys for the carrier and the arbiter', 'Simulated identity check'] },
        { name: 'Next', title: 'Pilot', items: ['Rules and proformas set per company and per country', 'Identity with legally recognized providers', 'A real carrier signs the shipment'] },
        { name: 'Then', title: 'Bank partner', items: ['Partner bank and yield model', 'Regulated stablecoin', 'Firewall in front of the API, KYC and AML'] },
      ],
      notes: {
        time: '0:35',
        say: 'To be honest: Keel is an MVP. It runs on a test network with test keys. Chile and Hong Kong is our first case, but any company in any country can be an importer or an exporter. Next, we add each country\'s rules, identity and security.',
      },
    },
    close: {
      title: 'Camila signed once. <span class="accent">Her money waited for the proof.</span>',
      stats: [
        { icon: 'shield', v: '7', l: 'attacks rejected on Base Sepolia, each with a public hash' },
        { icon: 'flask', v: '294', l: 'contract tests, all passing' },
        { icon: 'key', v: '0', l: 'owner keys on a server' },
      ],
      verify: 'Check one yourself: a deposit to an account the company never approved, rejected on chain',
      verifyUrl: 'https://sepolia.basescan.org/tx/0x66af984a30522715feb145d91c55c309213ba21035d7ab8e57e7dcae37fccf1e',
      thanks: 'Thank you.',
      repo: '<a href="https://github.com/FinLinkChile/Keel" target="_blank" rel="noopener">github.com/FinLinkChile/Keel</a>',
      notes: {
        time: '0:25',
        say: 'Camila signed once. Her money waited for the proof. And we tested it: seven attacks rejected on chain, each with a public hash, and two hundred ninety-four contract tests passing. That is Keel. Thank you. We are happy to answer your questions.',
        tip: 'The 7 rejections are cases 1.3 to 1.9 of the Area 1 evidence (branch area1/evidence). If the jury asks, open the link on the slide.',
      },
    },
  },
};
