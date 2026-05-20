import { useEffect, useState } from 'react';
import { Platform, Modal, View, Text, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
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
      name: 'ConstruConnect',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B35',
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
          Você não pode solicitar serviços durante a suspensão.
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
    backgroundColor: '#1a1a2e',
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
    color: '#aaa',
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
  unlockDate: { fontSize: 14, color: '#bbb', marginBottom: 20, textAlign: 'center' },
  contact: { fontSize: 13, color: '#666', textAlign: 'center' },
});

export default function RootLayout() {
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);

  async function checkBlock(userId: string) {
    try {
      const { data } = await supabase
        .from('app_users')
        .select('blocked_until')
        .eq('id', userId)
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
      if (!done) router.replace('/onboarding');
    }).catch(() => {});

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        registerPushToken();
        checkBlock(user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        registerPushToken();
        checkBlock(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        setBlockedUntil(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <ThemeProvider>
      <NotificationProvider>
        {blockedUntil && <BlockedOverlay blockedUntil={blockedUntil} />}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="tracking/[id]" />
          <Stack.Screen name="onboarding" />
        </Stack>
      </NotificationProvider>
    </ThemeProvider>
  );
}
