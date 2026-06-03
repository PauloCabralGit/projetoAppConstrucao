import { useState, useCallback } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

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
  payment_method: string | null;
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
  acessibilidade: 'Adaptações de Acessibilidade',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function paymentMethodLabel(method: string | null): string {
  if (!method || method === 'pix') return 'Pix';
  if (method === 'cash') return 'Dinheiro';
  if (method === 'card') return 'Cartão';
  return method;
}

function photoTypeLabel(type: string): string {
  if (type === 'client_request') return 'Cliente';
  if (type === 'provider_start') return 'Início';
  if (type === 'provider_end') return 'Conclusão';
  return '';
}

function formatBudget(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'A combinar';
  if (min !== null && max !== null) {
    return `R$ ${min.toLocaleString('pt-BR')} – R$ ${max.toLocaleString('pt-BR')}`;
  }
  if (min !== null) return `A partir de R$ ${min.toLocaleString('pt-BR')}`;
  return `Até R$ ${max!.toLocaleString('pt-BR')}`;
}

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function isThisMonth(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function buildSpendingChart(reqs: ServiceRequest[]) {
  const now = new Date();
  const months: { label: string; total: number; key: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: MONTH_NAMES[d.getMonth()],
      key: `${d.getFullYear()}-${d.getMonth()}`,
      total: 0,
    });
  }
  for (const r of reqs) {
    if (r.status !== 'completed' || !r.quote_amount) continue;
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const m = months.find((mo) => mo.key === key);
    if (m) m.total += Number(r.quote_amount);
  }
  return months;
}

export default function RequestsScreen() {
  const { colors } = useTheme();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [photosByRequest, setPhotosByRequest] = useState<Record<string, { url: string; type: string }[]>>({});
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  const fetchRequests = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, status, city, budget_min, budget_max, quote_amount, created_at, payment_status, payment_method, client_rating')
      .eq('client_user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRequests(data as ServiceRequest[]);

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
          setPhotosByRequest(map);
        }
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchRequests().finally(() => setLoading(false));
    }, [fetchRequests])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await fetchRequests();
    setRefreshing(false);
  }

  async function handleGeneratePDF() {
    const thisMonth = requests.filter((r) => r.status === 'completed' && isThisMonth(r.created_at));
    if (thisMonth.length === 0) {
      const { Alert } = require('react-native');
      Alert.alert('Sem dados', 'Nenhum serviço concluído este mês para gerar o relatório.');
      return;
    }
    setGeneratingPDF(true);
    try {
      const now = new Date();
      const mesAno = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
      const totalMes = thisMonth.reduce((s, r) => s + Number(r.quote_amount ?? 0), 0);
      const rows = thisMonth.map((r) => `
        <tr>
          <td>${CATEGORY_LABELS[r.category] ?? r.category}</td>
          <td>${r.description?.slice(0, 60) ?? '—'}</td>
          <td>${formatDate(r.created_at)}</td>
          <td>R$ ${Number(r.quote_amount ?? 0).toFixed(2).replace('.', ',')}</td>
        </tr>`).join('');
      const html = `<html><head><meta charset="utf-8">
        <style>body{font-family:sans-serif;padding:24px;color:#101828}h1{color:#FF6B35;font-size:20px}h2{color:#6B7280;font-size:14px;margin-top:0}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#F7F8FA;padding:8px 12px;text-align:left;font-size:12px;color:#6B7280;border-bottom:2px solid #E5E7EB}td{padding:10px 12px;font-size:13px;border-bottom:1px solid #E5E7EB}.total{margin-top:16px;font-size:15px;font-weight:bold;color:#101828}</style>
      </head><body>
        <h1>Relatório de Gastos — ${mesAno}</h1>
        <h2>ConstruConnect | Gerado em ${new Date().toLocaleDateString('pt-BR')}</h2>
        <table><thead><tr><th>Categoria</th><th>Descrição</th><th>Data</th><th>Valor</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <p class="total">Total gasto no mês: R$ ${totalMes.toFixed(2).replace('.', ',')}</p>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Relatório ${mesAno}` });
      }
    } catch {}
    setGeneratingPDF(false);
  }

  function handleRequestPress(req: ServiceRequest) {
    if (req.status === 'cancelled' || req.status === 'draft') return;
    // Serviço concluído e ainda não pago → ir para tela de pagamento
    if (req.status === 'completed' && !req.payment_status) {
      router.push(`/payment/${req.id}`);
      return;
    }
    router.push(`/tracking/${req.id}`);
  }

  function renderItem({ item }: { item: ServiceRequest }) {
    const statusConf = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.draft;
    const canTrack = item.status !== 'cancelled' && item.status !== 'draft';
    const itemPhotos = photosByRequest[item.id] ?? [];

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.cardWhite }]}
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
          <Text style={[styles.description, { color: colors.textPrimary }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>{item.city || 'Cidade não informada'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>{formatDate(item.created_at)}</Text>
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
            <Text style={[styles.historyChipText, { color: Colors.successGreen }]}>
              Pago via {paymentMethodLabel(item.payment_method)}
            </Text>
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

        {canTrack && (
          <View style={[styles.trackingRow, { borderTopColor: colors.border }]}>
            <Ionicons name="navigate" size={14} color={Colors.primary} />
            <Text style={styles.trackingText}>
              {item.status === 'requested'
                ? 'Ver pedido / negociar orçamento'
                : item.status === 'completed'
                ? item.payment_status === 'confirmed'
                  ? 'Ver resumo completo'
                  : item.payment_status === 'client_paid'
                  ? 'Pagamento enviado — aguardando confirmação'
                  : 'Realizar pagamento'
                : 'Acompanhar em tempo real'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  const chartData = buildSpendingChart(requests);
  const maxVal = Math.max(...chartData.map((m) => m.total), 1);
  const thisMonthTotal = chartData[chartData.length - 1]?.total ?? 0;
  const completedCount = requests.filter((r) => r.status === 'completed').length;

  const SpendingHeader = (
    <View style={[styles.chartCard, { backgroundColor: colors.cardWhite, borderColor: colors.border }]}>
      <View style={styles.chartTop}>
        <View>
          <Text style={[styles.chartTitle, { color: colors.textSecondary }]}>Gastos este mês</Text>
          <Text style={[styles.chartValue, { color: colors.textPrimary }]}>
            R$ {thisMonthTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.pdfBtn, generatingPDF && { opacity: 0.6 }]}
          onPress={handleGeneratePDF}
          disabled={generatingPDF}
        >
          {generatingPDF
            ? <ActivityIndicator size="small" color="#fff" />
            : <><Ionicons name="document-text-outline" size={16} color="#fff" /><Text style={styles.pdfBtnText}>PDF</Text></>}
        </TouchableOpacity>
      </View>

      <View style={styles.chartBars}>
        {chartData.map((m, i) => {
          const pct = maxVal > 0 ? m.total / maxVal : 0;
          const isLast = i === chartData.length - 1;
          return (
            <View key={m.key} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    { height: `${Math.max(pct * 100, 2)}%` as any, backgroundColor: isLast ? Colors.primary : colors.border },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: isLast ? Colors.primary : colors.textSecondary, fontWeight: isLast ? '700' : '400' }]}>
                {m.label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.chartFooter, { borderTopColor: colors.border }]}>
        <Text style={[styles.chartFooterText, { color: colors.textSecondary }]}>
          {completedCount} serviço{completedCount !== 1 ? 's' : ''} concluído{completedCount !== 1 ? 's' : ''} no total
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: colors.cardWhite, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Meus Pedidos</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Histórico de solicitações</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando pedidos...</Text>
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
          ListHeaderComponent={SpendingHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.border }]}>
                <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Nenhum pedido ainda</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
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
  safeArea: { flex: 1 },
  chartCard: {
    margin: 16, marginBottom: 8, borderRadius: 16, padding: 16, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  chartTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  chartTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  chartValue: { fontSize: 22, fontWeight: '800' },
  pdfBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
  },
  pdfBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  chartBars: { flexDirection: 'row', gap: 8, height: 80, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, minHeight: 4 },
  barLabel: { fontSize: 10 },
  chartFooter: { marginTop: 12, paddingTop: 10, borderTopWidth: 1 },
  chartFooterText: { fontSize: 12 },
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
