// First, before anything that loads viem
import '@/polyfills';

import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
  Figtree_800ExtraBold_Italic,
} from '@expo-google-fonts/figtree';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';

import { syncOrdersWithIngest } from '@/data';
import { LanguageProvider } from '@/i18n';
import { SessionProvider } from '@/session';
import { Splash } from '@/ui/Splash';
import { colors } from '@/ui/theme';
import { ThemeProvider, useTheme } from '@/ui/ThemeProvider';

SplashScreen.preventAutoHideAsync();

// The opening animation plays once per launch, even if the layout mounts again
let openingPlayed = false;

export default function RootLayout() {
  const [opening, setOpening] = useState(!openingPlayed);
  const [loaded, error] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
    Figtree_800ExtraBold_Italic,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <LanguageProvider>
      <SessionProvider>
        <ThemeProvider>
          <Shell
            opening={opening}
            onOpened={() => {
              openingPlayed = true;
              setOpening(false);
            }}
          />
        </ThemeProvider>
      </SessionProvider>
    </LanguageProvider>
  );
}

// Drawn again whenever the theme changes, so it reads the new palette
function Shell({ opening, onOpened }: { opening: boolean; onOpened: () => void }) {
  const { mode } = useTheme();
  // Signed orders ingest has not taken yet go again when the app opens or comes back
  useEffect(() => {
    void syncOrdersWithIngest();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncOrdersWithIngest();
    });
    return () => sub.remove();
  }, []);
  return (
    <>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        {opening ? <Splash onDone={onOpened} /> : null}
      </View>
    </>
  );
}
