import { ALIAS_IDS } from '@keel/schemas';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Placeholder shell. Screens to build: onboarding (#26), beneficiary diff (#27),
// cosigner view (#30), activity log and tier panel (#32).
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Keel</Text>
      <Text>Registered aliases: {ALIAS_IDS.join(', ')}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
});
