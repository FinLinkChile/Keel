import type { Hex } from '@keel/schemas';
import { Link } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { keccak256, recoverTypedDataAddress, stringToBytes } from 'viem';

import { config } from '@/config';
import { useData } from '@/data';
import { UPLOAD_TYPES, uploadDomain, type DocumentUpload } from '@/ingest/upload';
import { useSession } from '@/session';
import { Address } from '@/ui/Address';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';
import { colors, gutter } from '@/ui/theme';
import { keyStorage } from '@/wallet';

// Development check of the device wallet: signs a DocumentUpload for PO-0142 and recovers
// the signer locally, the same way ingest does. Nothing is sent anywhere.

// Used only when EXPO_PUBLIC_CHAIN_ID is not set; ingest needs the real one
const LOCAL_CHAIN_ID = 31337;

type Result = { message: DocumentUpload; signature: Hex; recovered: Hex; ms: number } | { error: string };

export default function Signature() {
  const { signer, address, resetWallet, role } = useSession();
  // PO-0142 as the connected wallet sees it: its id depends on the wallets of the parties
  const orderId = useData(async (d) => (await d.orders()).find((o) => o.label === 'PO-0142')?.po.orderId, [role, address]);
  const [result, setResult] = useState<Result>();
  const chainId = config.chainId ?? LOCAL_CHAIN_ID;

  async function sign() {
    if (!signer || !orderId) return;
    try {
      const start = Date.now();
      const message: DocumentUpload = {
        orderId,
        docType: 'COMMERCIAL_INVOICE',
        fileHash: keccak256(stringToBytes('Keel test document')),
        issuedAt: BigInt(Math.floor(Date.now() / 1000)),
      };
      const signature = await signer.signTypedData(uploadDomain(chainId), UPLOAD_TYPES, 'DocumentUpload', message);
      const recovered = await recoverTypedDataAddress({
        domain: uploadDomain(chainId),
        types: UPLOAD_TYPES,
        primaryType: 'DocumentUpload',
        message,
        signature,
      });
      setResult({ message, signature, recovered, ms: Date.now() - start });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  const ok = result && 'recovered' in result && address && result.recovered.toLowerCase() === address.toLowerCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: gutter, gap: 24, paddingBottom: 64 }}>
        <Text size={28} weight={800}>
          Wallet check
        </Text>

        <Field label="Connected wallet">
          {address ? (
            <Address address={address} full size={15} color="text" />
          ) : (
            <Link href="/connect">
              <Text size={15} color="accent">
                No wallet yet. Set one up on Connect.
              </Text>
            </Link>
          )}
        </Field>
        <Field label="Key stored in">
          <Text mono size={14}>
            {keyStorage}
          </Text>
        </Field>
        <Field label="Domain">
          <Text mono size={14}>
            Keel Ingest, version 1, chain {chainId}
            {config.chainId ? '' : ' (EXPO_PUBLIC_CHAIN_ID not set)'}
          </Text>
        </Field>

        <Button label="Sign a test upload" onPress={sign} disabled={!signer} />
        {/* For tests against ingest: the next "Set up test wallet" makes a new key */}
        <Button
          label="Reset test wallet"
          variant="secondary"
          disabled={!signer}
          onPress={async () => {
            await resetWallet();
            setResult(undefined);
          }}
        />

        {result && 'error' in result ? (
          <Field label="Error">
            <Text size={14} color="danger">
              {result.error}
            </Text>
          </Field>
        ) : null}

        {result && 'recovered' in result ? (
          <View style={{ gap: 24 }}>
            <Field label="Signed DocumentUpload">
              <Text mono size={13} color="textMuted">
                orderId PO-0142{'\n'}docType {result.message.docType}
                {'\n'}fileHash {result.message.fileHash.slice(0, 18)}…{'\n'}issuedAt {String(result.message.issuedAt)}
              </Text>
            </Field>
            <Field label={`Signature, ${result.ms} ms`}>
              <Text mono size={13} color="textMuted">
                {result.signature.slice(0, 22)}…{result.signature.slice(-8)}
              </Text>
            </Field>
            <Field label="Recovered signer">
              <Address address={result.recovered} full size={15} color="text" />
            </Field>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ok ? colors.money : colors.danger }} />
              <Text size={15} weight={700}>
                {ok ? 'Matches the connected wallet' : 'Does not match the connected wallet'}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text mono size={12} color="textFaint">
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}
