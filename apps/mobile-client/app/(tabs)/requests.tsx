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

type RequestStatus =
  | 'draft'
  | 'requested'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

interface ServiceRequest {
  id: string;
  category: string;
  description: string;
  status: RequestStatus;
  city: string;
  budget_min: number | null;
  budget_max: number | null;
  quote_amount: number | null;
  created_at: string;
  payment_status: string | null;
  client_rating: number | null;
}

const STATUS_CONFIG: Record<
  RequestStatus,
  { label: string; color: string; bg: string; icon: string }
> = {
  draft: { label: 'Rascunho', color: Colors.textSecondary, bg: '#F3F4F6', icon: 'document-outline' },
  requested: { label: 'Aguardando', color: Colors.warningAmber, bg: '#FFFBEB', icon: 'time-outline' },
  accepted: { label: 'Aceito', color: Colors.successGreen, bg: '#ECFDF5', icon: 'checkmark-circle-outline' },
  in_progress: { label: 'Em andamento', color: '#3B82F6', bg: '#EFF6FF', icon: 'navigate-outline' },
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
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatBudget(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'A combinar';
  if (min !== null && max !== null) {
    return `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`;
  }
  if (min !== null) return `A partir de R$ ${min.toLocaleString('pt-BR')}`;
  return `Até R$ ${max!.toLocaleString('pt-BR')}`;
}

export default function RequestsScreen() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [photosByRequest, setPhotosByRequest] = useState<Record<string, string[]>>({});
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRequests = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, status, city, budget_min, budget_max, quote_amount, created_at, payment_status, client_rating')
      .eq('client_user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRequests(data as ServiceRequest[]);

      const ids = data.map((r: any) => r.id);
      if (ids.length > 0) {
        const { data: photos } = await supabase
          .from('request_photos')
          .select('request_id, url')
          .in('request_id', ids);
        if (photos) {
          const map: Record<string, string[]> = {};
          for (const p of photos as { request_id: string; url: string }[]) {
            if (!map[p.request_id]) map[p.request_id] = [];
            map[p.request_id].push(p.url);
          }
          setPhotosByRequest(map);
        }
      }
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRequests().finally(() => setLoading(false));
  }, [fetchRequests]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }

  function handleRequestPress(req: ServiceRequest) {
    const paymentDone = req.payment_status === 'confirmed';
    if (req.status !== 'cancelled' && req.status !== 'draft') {
      if (req.status === 'completed' && paymentDone) return;
      router.push(`/tracking/${req.id}`);
    }
  }

  function renderItem({ item }: { item: ServiceRequest }) {
    const statusConf = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.draft;
    const paymentDone = item.payment_status === 'confirmed';
    const canTrack = item.status !== 'cancelled' && item.status !== 'draft' && !(item.status === 'completed' && paymentDone);
    const itemPhotos = photosByRequest[item.id] ?? [];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleRequestPress(item)}
        activeOpacity={canTrack ? 0.7 : 1}
      >
        <View style={styles.cardHeader}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>
              {CATEGORY_LABELS[item.category] ?? item.category}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConf.bg }]}>
            <Ionicons name={statusConf.icon as 'time-outline'} size={13} color={statusConf.color} />
            <Text style={[styles.statusText, { color: statusConf.color }]}>
              {statusConf.label}
            </Text>
          </View>
        </View>

        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.infoText}>{item.city || 'Cidade não informada'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.infoText}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        <View style={styles.budgetRow}>
          <Ionicons name="cash-outline" size={14} color={Colors.successGreen} />
          <Text style={styles.budgetText}>
            {item.quote_amount != null && Number(item.quote_amount) > 0
              ? `R$ ${Number(item.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (acordado)`
              : formatBudget(item.budget_min, item.budget_max)}
          </Text>
        </View>

        {item.payment_status === 'confirmed' && (
          <View style={styles.historyChip}>
            <Ionicons name="checkmark-circle" size={13} color={Colors.successGreen} />
            <Text style={[styles.historyChipText, { color: Colors.successGreen }]}>Pagamento confirmado</Text>
          </View>
        )}
        {item.payment_status === 'client_paid' && (
          <View style={[styles.historyChip, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            <Ionicons name="hourglass-outline" size={13} color={Colors.warningAmber} />
            <Text style={[styles.historyChipText, { color: Colors.warningAmber }]}>Aguardando confirmação do pagamento</Text>
          </View>
        )}
        {item.client_rating != null && (
          <View style={[styles.historyChip, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
            {[1,2,3,4,5].map(s => (
              <Ionicons key={s} name={s <= item.client_rating! ? 'star' : 'star-outline'} size={13} color={Colors.warningAmber} />
            ))}
            <Text style={[styles.historyChipText, { color: Colors.textSecondary }]}>Sua avaliação</Text>
          </View>
        )}

        {itemPhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow} style={styles.photosScroll}>
            {itemPhotos.map((url, i) => (
              <TouchableOpacity key={i} onPress={() => setPhotoViewer(url)} activeOpacity={0.85}>
                <Image source={{ uri: url }} style={styles.photoThumb} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {canTrack && (
          <View style={styles.trackingRow}>
            <Ionicons name="navigate" size={14} color={Colors.primary} />
            <Text style={styles.trackingText}>
              {item.status === 'requested'
                ? 'Ver pedido / negociar orçamento'
                : item.status === 'completed'
                ? item.payment_status === 'client_paid'
                  ? 'Pagamento enviado — aguardando confirmação'
                  : 'Realizar pagamento'
                : 'Acompanhar em tempo real'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Meus Pedidos</Text>
        <Text style={styles.headerSubtitle}>Histórico de solicitações</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando pedidos...</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
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
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="receipt-outline" size={40} color={Colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum pedido ainda</Text>
              <Text style={styles.emptySubtitle}>
                Vá para a tela inicial e solicite um serviço para ver seu histórico aqui.
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cardWhite,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    backgroundColor: '#FFF4EE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  budgetText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.successGreen,
  },
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: Colors.successGreen,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  historyChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  trackingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  trackingText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
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
  },
  photosScroll: { marginTop: 10 },
  photosRow: { gap: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.border },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  viewerImage: { width: '100%', height: '80%' },
});
