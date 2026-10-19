# Keel demo video: execution evidence

The live part of the demo video (`keel-demo-video.mp4`, 4:18; the first cut, `keel-demo.mp4`, ran 3:49) is a real run of the Keel app against the Keel API on AWS (us-east-2) and the contracts on Base Sepolia (chain 84532), recorded on 19 Oct 2026. The order is one test dollar (test USDC).

Order PO-0002, `orderId 0xe5ab38216d9e80a1818245f35c95e690221766487d8d6ac27832efe357a7a3e2`
Importer Safe `0x366E72921895dBFD7688822418BE43E02551Ee82`, exporter payout `0xC419891eE6bdEfa7aE285961C743047E34E1320d`, carrier Harbor Line (demo key) `0xB4B5591aFF224D76dE4D59F9fD832f5aC26B7708`, TradeEscrow `0x8346c6F1AfbaFF8140D35116fAF5ec07e4232970`.

| Step | Event | Time (UTC) | Transaction |
| --- | --- | --- | --- |
| Order opened by the agent | OrderOpened | 04:32:44 | [0x83c535f82a648f79b403bb9bedb09e327906d9e2f552e953f5e550b021b92181](https://base-sepolia.blockscout.com/tx/0x83c535f82a648f79b403bb9bedb09e327906d9e2f552e953f5e550b021b92181) |
| Deposit 1.00 and advance 0.30, one transaction | OrderFunded, AdvanceReleased | 04:33:42 | [0x184fa3056f0ff969c6d5db734be7a10f2bf2733a673d435183f6f69a4215fe12](https://base-sepolia.blockscout.com/tx/0x184fa3056f0ff969c6d5db734be7a10f2bf2733a673d435183f6f69a4215fe12) |
| Carrier attestation submitted | ShipmentAccepted | 04:56:44 | [0x7ee3d74a4f748680e3ebe47ddfd1d6a305368f6606eee321a3f9766be6867a3d](https://base-sepolia.blockscout.com/tx/0x7ee3d74a4f748680e3ebe47ddfd1d6a305368f6606eee321a3f9766be6867a3d) |
| Balance 0.70 after the importer's approval | BalanceReleased | 05:01:42 | [0x7d7cbba8382dd7add370e0302777e2db39348074ad3bf577336a7939e3680761](https://base-sepolia.blockscout.com/tx/0x7d7cbba8382dd7add370e0302777e2db39348074ad3bf577336a7939e3680761) |

Rejected on chain, shown in the video (red team case 1.3, Area 1 evidence): a deposit to an account the company never approved, `UnknownSupplier()`, [0x66af984a30522715feb145d91c55c309213ba21035d7ab8e57e7dcae37fccf1e](https://base-sepolia.blockscout.com/tx/0x66af984a30522715feb145d91c55c309213ba21035d7ab8e57e7dcae37fccf1e).

API calls of the run, all answered by the AWS deployment: `POST /trade/proforma`, `POST /proposals`, `POST /proposals/{id}/exporter-signature`, `POST /proposals/{id}/importer-signature`, `POST /trade/uploads` with S3 presigned `PUT` (bill of lading and invoice), `POST /shipments` (carrier tool), `POST /orders/{id}/approve-balance`.

During the run the contract also refused a reused bill of lading: the first attestation named B/L `HLIN26100142`, already used by order PO-0001, so the agent's simulation reverted with `BillOfLadingAlreadyUsed` and nothing was sent. A new B/L number (`HLIN26100002`) went through.
