import { Redirect } from 'expo-router';

// Until the Connect screen exists, the app opens on the component gallery.
export default function Index() {
  return <Redirect href="/dev/components" />;
}
