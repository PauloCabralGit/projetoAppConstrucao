import { useEffect, useState, useRef } from 'react';
import { Platform, Modal, View, Text, StyleSheet, TouchableOpacity, Linking, AppState, AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { FeatureFlagsProvider, useFlags } from '@/contexts/FeatureFlagsContext';
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

// ── Contato de suporte (altere conforme necessário) ────────────────────────
const SUPPORT_WHATSAPP = '5511999999999'; // Troque pelo número do suporte
const SUPPORT_EMAIL = 'suporte@construconnect.com.br'; // Troque pelo email do suporte

async function registerPushToken() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data: { user } } = await supabase.auth.getUser();
    if (user && token) {
      await supabase.from('app_users').update({ push_token: token }).eq('id', user.id);
    }
  } catch (err) {
    console.warn('[PushToken] Erro ao registrar token:', err);
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
          Entre em contato com o suporte para mais informações:
        </Text>
        <View style={bs.contactRow}>
          <TouchableOpacity
            style={[bs.contactBtn, bs.whatsappBtn]}
            onPress={() => Linking.openURL(
              `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Olá, minha conta foi suspensa na plataforma ConstruConnect e gostaria de ajuda.')}`
            )}
          >
            <Text style={bs.contactBtnText}>💬 WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[bs.contactBtn, bs.emailBtn]}
            onPress={() => Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Conta Suspensa - ConstruConnect')}&body=${encodeURIComponent('Olá, minha conta foi suspensa e gostaria de entrar em contato com o suporte.')}`
            )}
          >
            <Text style={bs.contactBtnText}>✉️ Email</Text>
          </TouchableOpacity>
        </View>
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
  unlockDate: { fontSize: 14, color: '#bbb', marginBottom: 12, textAlign: 'center' },
  contact: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 },
  contactRow: { flexDirection: 'row', gap: 12 },
  contactBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  whatsappBtn: { backgroundColor: '#25D366' },
  emailBtn: { backgroundColor: '#4a90e2' },
  contactBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});

function MaintenanceOverlay() {
  return (
    <Modal visible statusBarTranslucent animationType="fade" onRequestClose={() => {}}>
      <View style={bs.container}>
        <Text style={bs.icon}>🔧</Text>
        <Text style={bs.title}>Em Manutenção</Text>
        <Text style={bs.body}>
          A plataforma ConstruConnect está temporariamente em manutenção.{'\n\n'}Voltaremos em breve!
        </Text>
      </View>
    </Modal>
  );
}

function RootLayoutInner({ blockedUntil }: { blockedUntil: string | null }) {
  const { maintenance_mode } = useFlags();
  return (
    <>
      {maintenance_mode && <MaintenanceOverlay />}
      {!maintenance_mode && blockedUntil && <BlockedOverlay blockedUntil={blockedUntil} />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="tracking/[id]" />
        <Stack.Screen name="onboarding" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const currentUserId = useRef<string | null>(null);

  async function updateLastSeen(userId: string) {
    await supabase
      .from('app_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId);
  }

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
        currentUserId.current = user.id;
        registerPushToken();
        checkBlock(user.id);
        updateLastSeen(user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUserId.current = session.user.id;
        registerPushToken();
        checkBlock(session.user.id);
        updateLastSeen(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        currentUserId.current = null;
        setBlockedUntil(null);
      }
    });

    const handleAppState = async (nextState: AppStateStatus) => {
      if (!currentUserId.current) return;
      if (nextState === 'active') {
        await updateLastSeen(currentUserId.current);
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Marca offline imediatamente ao sair do app
        await supabase.from('app_users').update({ last_seen_at: null }).eq('id', currentUserId.current);
      }
    };
    const appStateSub = AppState.addEventListener('change', handleAppState);

    // Verifica bloqueio e atualiza last_seen a cada 20 segundos
    const pollInterval = setInterval(() => {
      if (currentUserId.current) {
        checkBlock(currentUserId.current);
        updateLastSeen(currentUserId.current);
      }
    }, 20000);

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
      clearInterval(pollInterval);
    };
  }, []);

  return (
    <FeatureFlagsProvider>
      <ThemeProvider>
        <NotificationProvider>
          <RootLayoutInner blockedUntil={blockedUntil} />
        </NotificationProvider>
      </ThemeProvider>
    </FeatureFlagsProvider>
  );
}
