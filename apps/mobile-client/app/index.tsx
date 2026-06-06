import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { ONBOARDING_KEY } from './onboarding';

// Tela da rota "/" — decide o destino inicial (onboarding / login / tabs) e
// faz o redirect. Ter um index.tsx também evita que o expo-router renderize o
// Sitemap automático, que acessa `window.location.origin` (undefined no React
// Native) e quebra no iOS com "Cannot read property 'origin' of undefined".
export default function Index() {
  useEffect(() => {
    let active = true;
    (async () => {
      let onboardingDone: string | null = null;
      try {
        onboardingDone = await SecureStore.getItemAsync(ONBOARDING_KEY);
      } catch {
        onboardingDone = null;
      }
      if (!active) return;
      if (!onboardingDone) {
        router.replace('/onboarding');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      router.replace(session ? '/(tabs)/home' : '/(auth)/login');
    })();
    return () => { active = false; };
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
