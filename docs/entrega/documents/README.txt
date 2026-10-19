Keel test documents

Ready-made kits for the live test of the Keel app (see docs/entrega/user-manual.md, "The documents of
the test order"). Each kit is for one order of USD 1.00 (1 kg of agar powder, Lingnan Hydrocolloids to
Pacifico Foods, FOB Hong Kong, carrier Harbor Line) and has three files with the same order number:

  PO-04NN-1-proforma.pdf            the importer uploads it when it creates the order
  PO-04NN-2-bill-of-lading.pdf      the exporter uploads it after the advance is paid
  PO-04NN-3-commercial-invoice.pdf  the exporter uploads it after the advance is paid

Use the three files of ONE kit for ONE order, and never reuse a kit: the escrow contract accepts each
bill of lading number only once. Kit-N has the order number PO-04NN and the bill of lading
HLIN-2610-04NN (kit-1 is PO-0401, kit-10 is PO-0410).

The shipment deadline of the orders is 20 Nov 2026. The bill of lading is dated 19 Nov 2026 on purpose:
the demo shortcut that signs for the carrier uses the time of the signature when the printed date is in
the future, and the escrow does not accept an on-board date earlier than the deposit.

The companies, the account and the numbers are fictitious. The files are built from the proforma of
PO-0142 and the demo documents of ingest/src/testing/demoOrder.ts, with the quantity, the amount, the
order number and the bill of lading number changed.
