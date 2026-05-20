import { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator, StyleSheet, Modal, Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ONBOARDING_KEY } from './onboarding';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ConstruConnect Prestador',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E2A38',
    });
  }
}

async function registerPushToken() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && token) {
      await supabase.from('app_users').update({ push_token: token }).eq('id', user.id);
    }
  } catch {
    // Push notifications unavailable (simulator or no EAS project)
  }
}

function BlockedOverlay({ blockedUntil }: { blockedUntil: string }) {
  const ms = new Date(blockedUntil).getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  const unlockDate = new Date(blockedUntil).toLocaleDateString('pt-BR');

  return (
    <Modal visible statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      <View style={bs.container}>
        <Text style={bs.icon}>🚫</Text>
        <Text style={bs.title}>Conta Suspensa</Text>
        <Text style={bs.body}>
          Sua conta foi suspensa pelo administrador da plataforma ConstruConnect.
          Você está offline e não pode aceitar novos chamados durante a suspensão.
        </Text>
        <View style={bs.daysBox}>
          <Text style={bs.daysNum}>{daysLeft}</Text>
          <Text style={bs.daysLabel}>
            {daysLeft === 1 ? 'dia restante' : 'dias restantes'}
          </Text>
        </View>
        <Text style={bs.unlockDate}>Liberação prevista: {unlockDate}</Text>
        <Text style={bs.contact}>
          Em caso de dúvidas, entre em contato com o suporte da plataforma.
        </Text>
      </View>
    </Modal>
  );
}

const bs = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E2A38',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon: { fontSize: 72, marginBottom: 24 },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#8da4be',
    textAlign: 'center',
    marginBottom: 36,
    lineHeight: 22,
  },
  daysBox: {
    backgroundColor: '#e74c3c',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 48,
    alignItems: 'center',
    marginBottom: 28,
  },
  daysNum: { fontSize: 64, fontWeight: 'bold', color: '#fff' },
  daysLabel: { fontSize: 16, color: '#ffcdd2', marginTop: 4 },
  unlockDate: { fontSize: 14, color: '#8da4be', marginBottom: 20, textAlign: 'center' },
  contact: { fontSize: 13, color: '#4a6070', textAlign: 'center' },
});

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(true);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);

  async function checkBlock(userId: string) {
    try {
      const { data } = await supabase
        .from('provider_profiles')
        .select('blocked_until')
        .eq('user_id', userId)
        .maybeSingle();
      if (data?.blocked_until && new Date(data.blocked_until) > new Date()) {
        setBlockedUntil(data.blocked_until);
      } else {
        setBlockedUntil(null);
      }
    } catch {}
  }

  useEffect(() => {
    setupNotificationChannel();

    SecureStore.getItemAsync(ONBOARDING_KEY).then((done) => {
      if (!done) {
        setOnboardingDone(false);
        setLoading(false);
        router.replace('/onboarding');
        return;
      }
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        setSession(s);
        setLoading(false);
        if (s) {
          registerPushToken();
          checkBlock(s.user.id);
        }
      });
    }).catch(() => {
      supabase.auth.getSession().then(({ data: { session: s } }) => {
        setSession(s);
        setLoading(false);
        if (s) {
          registerPushToken();
          checkBlock(s.user.id);
        }
      });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (_event === 'SIGNED_IN' && s) {
        registerPushToken();
        checkBlock(s.user.id);
      }
      if (_event === 'SIGNED_OUT') {
        setBlockedUntil(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (loading || !onboardingDone) return;
    if (session) {
      router.replace('/(tabs)/jobs');
    } else {
      router.replace('/(auth)/login');
    }
  }, [session, loading, onboardingDone]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <NotificationProvider>
        {blockedUntil && <BlockedOverlay blockedUntil={blockedUntil} />}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="job/[id]" />
          <Stack.Screen name="onboarding" />
        </Stack>
      </NotificationProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
