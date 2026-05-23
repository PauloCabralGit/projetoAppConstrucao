import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

type JobStatus = 'accepted' | 'in_progress' | 'completed' | 'cancelled';

interface HistoryJob {
  id: string;
  category: string;
  description: string;
  status: JobStatus;
  city: string;
  quote_amount: number | null;
  created_at: string;
  payment_status: string | null;
  client_rating: number | null;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bg: string; icon: string }> = {
  accepted: { label: 'Aceito', color: '#3B82F6', bg: '#EFF6FF', icon: 'checkmark-circle-outline' },
  in_progress: { label: 'Em andamento', color: Colors.primary, bg: '#FFF4EE', icon: 'navigate-outline' },
  completed: { label: 'Concluído', color: Colors.successGreen, bg: '#ECFDF5', icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelado', color: Colors.dangerRed, bg: '#FEF2F2', icon: 'close-circle-outline' },
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function photoTypeLabel(type: string): string {
  if (type === 'client_request') return 'Cliente';
  if (type === 'provider_start') return 'Início';
  if (type === 'provider_end') return 'Conclusão';
  return '';
}

export default function HistoryScreen() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [photosByJob, setPhotosByJob] = useState<Record<string, { url: string; type: string }[]>>({});
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, status, city, quote_amount, created_at, payment_status, client_rating')
      .eq('provider_user_id', user.id)
      .in('status', ['accepted', 'in_progress', 'completed', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      setJobs(data as HistoryJob[]);

      const ids = data.map((r: any) => r.id);
      if (ids.length > 0) {
        const { data: photos } = await supabase
          .from('request_photos')
          .select('request_id, url, photo_type')
          .in('request_id', ids);
        if (photos) {
          const map: Record<string, { url: string; type: string }[]> = {};
          for (const p of photos as { request_id: string; url: string; photo_type: string }[]) {
            if (!map[p.request_id]) map[p.request_id] = [];
            map[p.request_id].push({ url: p.url, type: p.photo_type ?? '' });
          }
          setPhotosByJob(map);
        }
      }
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchHistory().finally(() => setLoading(false));
  }, [fetchHistory]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  }

  const completed = jobs.filter(j => j.status === 'completed').length;
  const totalEarned = jobs
    .filter(j => j.status === 'completed' && j.payment_status === 'confirmed')
    .reduce((acc, j) => acc + Number(j.quote_amount ?? 0), 0);
  const avgRating = (() => {
    const rated = jobs.filter(j => j.client_rating != null);
    if (rated.length === 0) return null;
    return (rated.reduce((acc, j) => acc + j.client_rating!, 0) / rated.length).toFixed(1);
  })();

  function renderItem({ item }: { item: HistoryJob }) {
    const conf = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.completed;
    const canOpen = item.status !== 'cancelled';
    const itemPhotos = photosByJob[item.id] ?? [];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => canOpen && router.push(`/job/${item.id}`)}
        activeOpacity={canOpen ? 0.7 : 1}
      >
        <View style={styles.cardHeader}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{CATEGORY_LABELS[item.category] ?? item.category}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: conf.bg }]}>
            <Ionicons name={conf.icon as 'navigate-outline'} size={12} color={conf.color} />
            <Text style={[styles.statusText, { color: conf.color }]}>{conf.label}</Text>
          </View>
        </View>

        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        ) : null}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{item.city || 'Cidade não informada'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        {item.quote_amount != null && Number(item.quote_amount) > 0 && (
          <View style={styles.valueRow}>
            <Ionicons name="cash-outline" size={14} color={Colors.successGreen} />
            <Text style={styles.valueText}>
              R$ {Number(item.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </Text>
            {item.payment_status === 'confirmed' && (
              <View style={styles.paidBadge}>
                <Text style={styles.paidBadgeText}>Pago</Text>
              </View>
            )}
            {item.payment_status === 'client_paid' && (
              <View style={[styles.paidBadge, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                <Text style={[styles.paidBadgeText, { color: Colors.warningAmber }]}>Aguardando</Text>
              </View>
            )}
          </View>
        )}

        {item.client_rating != null && (
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map(s => (
              <Ionicons
                key={s}
                name={s <= item.client_rating! ? 'star' : 'star-outline'}
                size={14}
                color={Colors.warningAmber}
              />
            ))}
            <Text style={styles.ratingText}>{item.client_rating}.0 — avaliação do cliente</Text>
          </View>
        )}

        {itemPhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow} style={styles.photosScroll}>
            {itemPhotos.map((photo, i) => {
              const label = photoTypeLabel(photo.type);
              return (
                <TouchableOpacity key={i} onPress={() => setPhotoViewer(photo.url)} activeOpacity={0.85}>
                  <View>
                    <Image source={{ uri: photo.url }} style={styles.photoThumb} />
                    {label ? (
                      <View style={styles.photoTypeBadge}>
                        <Text style={styles.photoTypeText}>{label}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {canOpen && (
          <View style={styles.openRow}>
            <Ionicons name={item.status === 'completed' ? 'document-text-outline' : 'navigate'} size={13} color={Colors.primary} />
            <Text style={styles.openText}>
              {item.status === 'completed' ? 'Ver detalhes' : 'Toque para acompanhar'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerBanner}>
        <Text style={styles.headerTitle}>Histórico</Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{jobs.length}</Text>
            <Text style={styles.statLabel}>Total de serviços</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{completed}</Text>
            <Text style={styles.statLabel}>Concluídos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{avgRating ? `${avgRating}⭐` : '—'}</Text>
            <Text style={styles.statLabel}>Nota média</Text>
          </View>
        </View>

        {totalEarned > 0 && (
          <View style={styles.totalEarned}>
            <Ionicons name="wallet-outline" size={16} color={Colors.primary} />
            <Text style={styles.totalEarnedText}>
              Total recebido: R$ {totalEarned.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando histórico...</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="time-outline" size={40} color={Colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum serviço ainda</Text>
              <Text style={styles.emptySubtitle}>
                Aceite chamados na aba Chamados para ver seu histórico aqui.
              </Text>
            </View>
          }
        />
      )}

      <Modal visible={photoViewer !== null} transparent animationType="fade" onRequestClose={() => setPhotoViewer(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setPhotoViewer(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photoViewer && (
            <Image source={{ uri: photoViewer }} style={styles.viewerImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  headerBanner: {
    backgroundColor: Colors.darkNavy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.cardWhite, marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.cardWhite, marginBottom: 4 },
  statLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500', textAlign: 'center' },
  totalEarned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,53,0.2)',
    borderRadius: 10,
    padding: 10,
  },
  totalEarnedText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  listContent: { padding: 16, flexGrow: 1 },
  separator: { height: 12 },
  card: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  categoryBadge: { backgroundColor: '#FFF4EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  categoryText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
  description: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20, marginBottom: 10 },
  metaRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  valueText: { fontSize: 14, fontWeight: '700', color: Colors.successGreen, flex: 1 },
  paidBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: Colors.successGreen,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  paidBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.successGreen },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 },
  ratingText: { fontSize: 12, color: Colors.textSecondary, marginLeft: 4 },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  openText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
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
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  photosScroll: { marginTop: 10 },
  photosRow: { gap: 8 },
  photoThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: Colors.border },
  photoTypeBadge: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    alignItems: 'center',
    paddingVertical: 2,
  },
  photoTypeText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  viewerImage: { width: '100%', height: '80%' },
});
