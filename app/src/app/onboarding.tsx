import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkStep, DEMO_DRAFT, STEPS, type Draft, type Problems, type Step } from '@/data/onboarding';
import { useT } from '@/i18n';
import { useSession } from '@/session';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { LanguageSwitch } from '@/ui/LanguageSwitch';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { colors, gutter, radius } from '@/ui/theme';

// Sign-up, before Connect: the country, the company and the person who represents it, as a
// Chilean bank asks for them. The identity validation is simulated and says so. The form comes
// filled with the demo company; every field can be changed.

const COUNTRIES = [
  { code: 'CL', name: 'Chile', available: true },
  { code: 'AR', name: 'Argentina', available: false },
  { code: 'PE', name: 'Peru', available: false },
  { code: 'CO', name: 'Colombia', available: false },
];

const TITLES: Record<Step, { title: string; body: string }> = {
  country: { title: 'Where is your company?', body: 'Keel opens first in Chile. More countries come later.' },
  company: { title: 'Your company', body: 'The data a bank asks to open an account for a company.' },
  representative: { title: 'Who represents it', body: 'The person who signs for the company, with the RUT on their ID card.' },
  identity: { title: 'Validate your identity', body: 'Banks ask for your ID card and a selfie before you can use the account.' },
};

export default function Onboarding() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useSession();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(DEMO_DRAFT);
  // Problems are shown after the person tries to continue, not while they type
  const [problems, setProblems] = useState<Problems>({});
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;
  const patch = (changes: Partial<Draft>) => {
    setDraft({ ...draft, ...changes });
    setProblems({});
  };

  async function next() {
    const found = checkStep(current, draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if (!last) return setStep(step + 1);
    await completeOnboarding(draft);
    router.replace('/connect');
  }

  const notice = (field: keyof Problems) => (problems[field] ? { tone: 'error' as const, text: problems[field]! } : undefined);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: Math.max(52, insets.top + 8),
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: gutter,
          gap: 22,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginHorizontal: -8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Back')}
                onPress={() => {
                  setProblems({});
                  setStep(step - 1);
                }}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="back" size={22} />
              </Pressable>
            ) : (
              <View style={{ width: 44 }} />
            )}
            <LanguageSwitch />
          </View>
          <Text mono size={13} color="textMuted" style={{ paddingRight: 8 }}>
            {t('Step {n} of {total}', { n: step + 1, total: STEPS.length })}
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          <Text size={30} weight={800} leading={1.1} tracking={-0.8} accessibilityRole="header">
            {t(TITLES[current].title)}
          </Text>
          <Text size={15} leading={1.5} color="textMuted">
            {t(TITLES[current].body)}
          </Text>
        </View>

        {current === 'country' ? (
          <View accessibilityRole="radiogroup" accessibilityLabel={t('Country')} style={{ gap: 10 }}>
            {COUNTRIES.map((c) => (
              <View
                key={c.code}
                accessibilityRole="radio"
                accessibilityState={{ checked: c.available, disabled: !c.available }}
                accessibilityLabel={t(c.name)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: colors.surface,
                  borderRadius: radius.card,
                  borderWidth: 1.5,
                  borderColor: c.available ? colors.accent : colors.surface,
                  padding: 18,
                }}
              >
                <Radio on={c.available} />
                <Text size={17} weight={700} color={c.available ? 'text' : 'textMuted'} style={{ flex: 1 }}>
                  {t(c.name)}
                </Text>
                {c.available ? null : (
                  <Text size={13} color="textFaint">
                    {t('Not available yet')}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {current === 'company' ? (
          <View style={{ gap: 16 }}>
            <Field label={t('Company RUT')} mono value={draft.companyRut} onChangeText={(companyRut) => patch({ companyRut })} autoCapitalize="characters" placeholder="76.123.456-7" notice={notice('companyRut')} />
            <Field label={t('Legal name')} value={draft.legalName} onChangeText={(legalName) => patch({ legalName })} autoCapitalize="words" placeholder="Importadora Ejemplo SpA" notice={notice('legalName')} />
            <Field label={t('Email')} value={draft.email} onChangeText={(email) => patch({ email })} keyboardType="email-address" autoCapitalize="none" placeholder="name@company.cl" notice={notice('email')} />
            <Field label={t('Mobile')} mono value={draft.phone} onChangeText={(phone) => patch({ phone })} keyboardType="phone-pad" placeholder="+56 9 1234 5678" notice={notice('phone')} />
            <Text size={13} leading={1.5} color="textFaint">
              {t('Filled in with the demo company, Pacífico Foods SpA. The documents of the test orders carry this RUT, so change it only to try the form.')}
            </Text>
          </View>
        ) : null}

        {current === 'representative' ? (
          <View style={{ gap: 16 }}>
            <Field label={t('Full name')} value={draft.repName} onChangeText={(repName) => patch({ repName })} autoCapitalize="words" placeholder={t('First name and surname')} notice={notice('repName')} />
            <Field label="RUT" mono value={draft.repRut} onChangeText={(repRut) => patch({ repRut })} autoCapitalize="characters" placeholder="12.345.678-5" notice={notice('repRut')} />
            <View style={{ gap: 6 }}>
              <Text size={14} weight={600}>
                {t('Are you a politically exposed person?')}
              </Text>
              <Segmented
                options={[
                  { value: 'no', label: t('No') },
                  { value: 'yes', label: t('Yes') },
                ]}
                value={draft.pep}
                onChange={(pep) => patch({ pep })}
                accessibilityLabel={t('Politically exposed person')}
                role="radiogroup"
              />
              <Text size={13} leading={1.5} color="textFaint">
                {t('Someone who holds or held a senior public office, or a close relative. Banks in Chile ask this by law.')}
              </Text>
            </View>
            <Text size={13} leading={1.5} color="textFaint">
              {t('Name and RUT are examples. They stay on this phone.')}
            </Text>
          </View>
        ) : null}

        {current === 'identity' ? (
          <View style={{ gap: 16 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, paddingVertical: 8 }}>
              <Requirement icon="orders" title={t('Photo of your ID card')} detail={t('Front and back')} />
              <Requirement icon="camera" title={t('A selfie')} detail={t('Compared with the photo of the card')} />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.identityChecked }}
              onPress={() => patch({ identityChecked: !draft.identityChecked })}
              style={{
                flexDirection: 'row',
                gap: 12,
                alignItems: 'flex-start',
                backgroundColor: colors.surface,
                borderRadius: radius.card,
                borderWidth: 1.5,
                borderColor: problems.identityChecked ? colors.danger : draft.identityChecked ? colors.accent : colors.surface,
                padding: 18,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  marginTop: 1,
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: draft.identityChecked ? colors.accent : colors.control,
                  backgroundColor: draft.identityChecked ? colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {draft.identityChecked ? <Icon name="check" size={14} strokeWidth={3} color="onAccent" /> : null}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text size={16} weight={700}>
                  {t('I validated my identity')}
                </Text>
                <Text size={14} leading={1.45} color="textMuted">
                  {t('Simulated in this version: nothing is captured or checked here. In production, a provider does it.')}
                </Text>
              </View>
            </Pressable>
            {problems.identityChecked ? (
              <Text size={13} style={{ color: colors.danger }}>
                {problems.identityChecked}
              </Text>
            ) : null}
            <Text size={13} leading={1.5} color="textFaint">
              {t('Your details stay on this phone. Keel does not send them to anyone in this version.')}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 'auto', paddingTop: 8 }}>
          <Button label={last ? t('Enter Keel') : t('Continue')} onPress={next} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: on ? colors.accent : colors.control,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
    </View>
  );
}

function Requirement({ icon, title, detail }: { icon: 'orders' | 'camera'; title: string; detail: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 20 }}>
      <Icon name={icon} size={22} color="textMuted" />
      <View style={{ flex: 1 }}>
        <Text size={16} weight={600}>
          {title}
        </Text>
        <Text size={13} color="textFaint">
          {detail}
        </Text>
      </View>
    </View>
  );
}
