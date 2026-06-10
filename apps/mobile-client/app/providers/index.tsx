import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface OnlineProvider {
  id: string;
  full_name: string;
  city: string;
  specialties: string;
  average_rating: number | null;
  accepts_emergency_jobs: boolean;
}

export default function OnlineProvidersScreen() {
  const [providers, setProviders] = useState<OnlineProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`${API_BASE}/providers/available`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProviders(data?.providers ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 20000);
    return () => clearInterval(poll);
  }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  function handleSelect(p: OnlineProvider) {
    // Abre o formulário de chamado (home) já filtrado pelo prestador escolhido.
    router.push({
      pathname: '/(tabs)/home',
      params: { providerId: p.id, providerName: p.full_name },
    });
  }

  function renderItem({ item }: { item: OnlineProvider }) {
    const initial = (item.full_name?.trim()?.[0] ?? '?').toUpperCase();
    const hasRating = typeof item.average_rating === 'number' && item.average_rating > 0;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color={Colors.warningAmber} />
                <Text style={styles.ratingText}>{hasRating ? item.average_rating!.toFixed(1) : 'Novo'}</Text>
              </View>
            </View>
            {!!item.specialties && (
              <Text style={styles.specialties} numberOfLines={1}>{item.specialties}</Text>
            )}
            {item.accepts_emergency_jobs && (
              <View style={styles.emergencyChip}>
                <Ionicons name="flash" size={11} color={Colors.dangerRed} />
                <Text style={styles.emergencyText}>Atende emergência</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={styles.requestBtn}
          onPress={() => handleSelect(item)}
          accessibilityRole="button"
          accessibilityLabel={`Solicitar serviço para ${item.full_name}`}
        >
          <Text style={styles.requestBtnText}>Solicitar</Text>
          <Ionicons name="arrow-forward" size={16} color={Colors.cardWhite} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => router.back()} accessibilityLabel="Voltar">
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle}>Profissionais disponíveis</Text>
          {!loading && !error && (
            <View style={styles.onlineRow}>
              <View style={[styles.dot, providers.length === 0 && { backgroundColor: Colors.textSecondary }]} />
              <Text style={styles.onlineText}>
                {providers.length > 0 ? `${providers.length} online agora` : 'Ninguém online agora'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.centeredText}>Carregando profissionais...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.textSecondary} />
          <Text style={styles.centeredTitle}>Não foi possível carregar</Text>
          <Text style={styles.centeredText}>Verifique sua conexão e tente de novo.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={providers}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={48} color={Colors.textSecondary} />
              <Text style={styles.centeredTitle}>Nenhum profissional disponível agora</Text>
              <Text style={styles.centeredText}>
                Crie um chamado e avisamos os profissionais assim que entrarem.
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => router.push('/(tabs)/home')}>
                <Text style={styles.retryBtnText}>Criar chamado</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.cardWhite, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitles: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.successGreen },
  onlineText: { fontSize: 12, color: Colors.textSecondary },
  list: { padding: 16, flexGrow: 1 },
  card: {
    backgroundColor: Colors.cardWhite, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  cardTop: { flexDirection: 'row', gap: 12 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF4EE',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  cardInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  specialties: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  emergencyChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  emergencyText: { fontSize: 11, fontWeight: '600', color: Colors.dangerRed },
  requestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 12,
  },
  requestBtnText: { color: Colors.cardWhite, fontWeight: '700', fontSize: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centeredTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginTop: 4 },
  centeredText: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    marginTop: 12, backgroundColor: Colors.primary, borderRadius: 10,
    paddingVertical: 11, paddingHorizontal: 24,
  },
  retryBtnText: { color: Colors.cardWhite, fontWeight: '700', fontSize: 14 },
});
