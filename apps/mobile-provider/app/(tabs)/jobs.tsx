import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Switch,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { rejectedJobIds } from '@/lib/rejectedJobs';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

interface ServiceRequest {
  id: string;
  category: string;
  description: string;
  city: string;
  budget_min: number | null;
  budget_max: number | null;
  created_at: string;
  status: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  alvenaria: 'layers-outline',
  hidraulica: 'water-outline',
  eletrica: 'flash-outline',
  pintura: 'color-palette-outline',
  piso: 'grid-outline',
  acabamento: 'hammer-outline',
};

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
  acessibilidade: 'Adaptações de Acessibilidade',
};

function formatBudget(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'A combinar';
  if (min !== null && max !== null) {
    return `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`;
  }
  if (min !== null) return `A partir de R$ ${min.toLocaleString('pt-BR')}`;
  return `Até R$ ${max!.toLocaleString('pt-BR')}`;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return `há ${Math.floor(diffH / 24)}d`;
}

export default function JobsScreen() {
  const [jobs, setJobs] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(false);
  const [providerName, setProviderName] = useState('Prestador');
  const [userId, setUserId] = useState<string>('');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [biddingJob, setBiddingJob] = useState<string | null>(null);
  const [submittedBids, setSubmittedBids] = useState<Set<string>>(new Set());
  const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

  const fetchJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, city, budget_min, budget_max, created_at, status')
      .eq('status', 'requested')
      .is('provider_user_id', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setJobs((data as ServiceRequest[]).filter(j => !rejectedJobIds.has(j.id)));
    }
  }, []);

  useEffect(() => {
    loadProvider();
    setLoading(true);
    fetchJobs().finally(() => setLoading(false));
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchJobs]);

  // Re-fetch when screen regains focus (e.g. coming back from job detail after rejecting)
  useFocusEffect(
    useCallback(() => {
      fetchJobs();
    }, [fetchJobs])
  );

  useEffect(() => {
    if (online) {
      startListening();
    } else {
      stopListening();
    }
  }, [online]);

  async function loadProvider() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data } = await supabase
      .from('app_users')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (data) setProviderName(data.full_name);
  }

  async function handleSubmitBid(jobId: string) {
    const amountStr = bidAmounts[jobId] ?? '';
    const amount = parseFloat(amountStr.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Valor inválido', 'Informe um valor válido para o orçamento.');
      return;
    }
    if (!userId) return;
    setBiddingJob(jobId);
    try {
      const { error: bidError } = await supabase
        .from('bids')
        .upsert(
          { request_id: jobId, provider_user_id: userId, amount, status: 'pending' },
          { onConflict: 'request_id,provider_user_id' }
        );

      if (bidError) {
        Alert.alert('Erro', bidError.message);
        return;
      }

      const amtStr = `R$ ${amount.toFixed(2).replace('.', ',')}`;
      fetch(`${API_BASE}/service-requests/${jobId}/notify-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '💰 Novo orçamento recebido!',
          body: `Um profissional enviou um orçamento de ${amtStr}. Toque para comparar.`,
        }),
      }).catch(() => {});

      setSubmittedBids((prev) => new Set([...prev, jobId]));
      setBidAmounts((prev) => ({ ...prev, [jobId]: '' }));
      Alert.alert('Orçamento enviado!', 'O cliente receberá uma notificação.');
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet.');
    }
    setBiddingJob(null);
  }

  function startListening() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    const channel = supabase
      .channel('new_service_requests')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'service_requests',
          filter: "status=eq.requested",
        },
        (payload) => {
          const newJob = payload.new as ServiceRequest;
          setJobs((prev) => {
            const exists = prev.some((j) => j.id === newJob.id);
            if (exists) return prev;
            return [newJob, ...prev];
          });
          Alert.alert(
            'Novo chamado!',
            `${CATEGORY_LABELS[newJob.category] ?? newJob.category} em ${newJob.city}`,
            [
              { text: 'Ver depois', style: 'cancel' },
              { text: 'Ver agora', onPress: () => router.push(`/job/${newJob.id}`) },
            ]
          );
        }
      )
      .subscribe();
    channelRef.current = channel;
  }

  function stopListening() {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchJobs();
    setRefreshing(false);
  }

  function renderItem({ item }: { item: ServiceRequest }) {
    const icon = CATEGORY_ICONS[item.category] ?? 'construct-outline';
    const label = CATEGORY_LABELS[item.category] ?? item.category;

    return (
      <View style={styles.jobCard}>
        <View style={styles.jobCardHeader}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name={icon as 'layers-outline'} size={20} color={Colors.primary} />
          </View>
          <View style={styles.jobCardHeaderInfo}>
            <Text style={styles.jobCategory}>{label}</Text>
            <Text style={styles.jobTime}>{timeAgo(item.created_at)}</Text>
          </View>
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NOVO</Text>
          </View>
        </View>

        {item.description ? (
          <Text style={styles.jobDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.jobMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{item.city || 'Não informado'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={14} color={Colors.successGreen} />
            <Text style={[styles.metaText, styles.budgetText]}>
              {formatBudget(item.budget_min, item.budget_max)}
            </Text>
          </View>
        </View>

        {submittedBids.has(item.id) ? (
          <View style={styles.bidSentBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.successGreen} />
            <Text style={styles.bidSentText}>Orçamento enviado — aguardando cliente</Text>
          </View>
        ) : (
          <View style={styles.bidRow}>
            <View style={styles.bidInputWrap}>
              <Text style={styles.bidCurrency}>R$</Text>
              <TextInput
                style={styles.bidInput}
                placeholder="Seu valor"
                placeholderTextColor={Colors.textSecondary}
                value={bidAmounts[item.id] ?? ''}
                onChangeText={(v) => setBidAmounts((prev) => ({ ...prev, [item.id]: v }))}
                keyboardType="numeric"
              />
            </View>
            <TouchableOpacity
              style={[styles.bidSubmitBtn, (biddingJob === item.id || !(bidAmounts[item.id])) && { opacity: 0.5 }]}
              onPress={() => handleSubmitBid(item.id)}
              disabled={biddingJob === item.id || !bidAmounts[item.id]}
            >
              {biddingJob === item.id
                ? <ActivityIndicator color={Colors.cardWhite} size="small" />
                : <Text style={styles.bidSubmitText}>Enviar</Text>}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.viewButton}
          onPress={() => router.push(`/job/${item.id}`)}
        >
          <Text style={styles.viewButtonText}>Ver detalhes</Text>
          <Ionicons name="arrow-forward" size={16} color={Colors.darkNavy} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>Olá, {providerName.split(' ')[0]}</Text>
            <Text style={styles.headerSubtitle}>
              {jobs.length} chamado{jobs.length !== 1 ? 's' : ''} disponível{jobs.length !== 1 ? 'is' : ''}
            </Text>
          </View>
          <View style={styles.onlineToggle}>
            <Text style={[styles.onlineLabel, online && styles.onlineLabelActive]}>
              {online ? 'Online' : 'Offline'}
            </Text>
            <Switch
              value={online}
              onValueChange={setOnline}
              trackColor={{ false: Colors.border, true: Colors.successGreen }}
              thumbColor={Colors.cardWhite}
            />
          </View>
        </View>

        {online && (
          <View style={styles.listeningBanner}>
            <View style={styles.pulsingDot} />
            <Text style={styles.listeningText}>Recebendo novos chamados em tempo real</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando chamados...</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="briefcase-outline" size={40} color={Colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum chamado disponível</Text>
              <Text style={styles.emptySubtitle}>
                {online
                  ? 'Você receberá uma notificação quando surgir um novo chamado.'
                  : 'Fique online para receber chamados em tempo real.'}
              </Text>
              {!online && (
                <TouchableOpacity style={styles.goOnlineButton} onPress={() => setOnline(true)}>
                  <Text style={styles.goOnlineButtonText}>Ficar online</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.darkNavy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  onlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onlineLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  onlineLabelActive: {
    color: Colors.successGreen,
  },
  listeningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'rgba(18, 183, 106, 0.15)',
    borderRadius: 8,
    padding: 10,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.successGreen,
  },
  listeningText: {
    fontSize: 12,
    color: Colors.successGreen,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  separator: {
    height: 12,
  },
  jobCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  jobCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF4EE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  jobCardHeaderInfo: {
    flex: 1,
  },
  jobCategory: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  jobTime: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  newBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.cardWhite,
    letterSpacing: 0.5,
  },
  jobDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  jobMeta: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  budgetText: {
    fontWeight: '600',
    color: Colors.successGreen,
  },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  viewButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.darkNavy,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  goOnlineButton: {
    backgroundColor: Colors.darkNavy,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goOnlineButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  bidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  bidInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    backgroundColor: '#FFF4EE',
  },
  bidCurrency: { fontSize: 16, fontWeight: '700', color: Colors.primary, marginRight: 4 },
  bidInput: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  bidSubmitBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidSubmitText: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
  bidSentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  bidSentText: { fontSize: 13, fontWeight: '600', color: Colors.successGreen },
});
