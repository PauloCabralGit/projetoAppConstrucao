import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const GOAL_KEY = 'provider_monthly_goal';

interface CompletedJob {
  id: string;
  category: string;
  budget_max: number | null;
  budget_min: number | null;
  quote_amount: number | null;
  provider_amount: number | null; // valor real após comissão (tabela payments)
  created_at: string;
  city: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
  acessibilidade: 'Adaptações de Acessibilidade',
};

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// US-018: usar provider_amount da tabela payments se disponível,
// senão cair para quote_amount (valor bruto)
function getJobValue(job: CompletedJob): number {
  if (job.provider_amount != null && Number(job.provider_amount) > 0) return Number(job.provider_amount);
  if (job.quote_amount != null && Number(job.quote_amount) > 0) return Number(job.quote_amount);
  if (job.budget_max !== null && job.budget_max > 0) return job.budget_max;
  if (job.budget_min !== null && job.budget_min > 0) return job.budget_min;
  return 0;
}

function isThisWeek(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return date >= weekStart;
}

function isThisMonth(dateStr: string): boolean {
  const date = new Date(dateStr);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export default function EarningsScreen() {
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthlyGoal, setMonthlyGoal] = useState(0);
  const [goalInput, setGoalInput] = useState('');
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const fetchCompletedJobs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [jobsRes, nameRes] = await Promise.all([
      supabase
        .from('service_requests')
        .select(`
          id, category, budget_min, budget_max, quote_amount, created_at, city,
          payments(provider_amount)
        `)
        .eq('provider_user_id', user.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('app_users').select('full_name').eq('id', user.id).single(),
    ]);

    if (!jobsRes.error && jobsRes.data) {
      // Normalizar: extrair provider_amount do join com payments
      const normalized = (jobsRes.data as any[]).map((r) => ({
        ...r,
        provider_amount: Array.isArray(r.payments) && r.payments.length > 0
          ? r.payments[0].provider_amount
          : null,
      }));
      setJobs(normalized as CompletedJob[]);
    }
    if (!nameRes.error && nameRes.data) setProviderName((nameRes.data as any).full_name ?? '');
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchCompletedJobs().finally(() => setLoading(false));
    SecureStore.getItemAsync(GOAL_KEY).then(val => {
      if (val) setMonthlyGoal(Number(val));
    }).catch(() => {});
  }, [fetchCompletedJobs]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchCompletedJobs();
    setRefreshing(false);
  }

  async function handleSaveGoal() {
    const val = parseFloat(goalInput.replace(',', '.'));
    if (isNaN(val) || val < 0) { Alert.alert('Valor inválido'); return; }
    setMonthlyGoal(val);
    await SecureStore.setItemAsync(GOAL_KEY, String(val)).catch(() => {});
    setShowGoalModal(false);
  }

  async function handleGenerateReport() {
    setGeneratingReport(true);
    const thisMonthJobs = jobs.filter(j => isThisMonth(j.created_at));
    const total = thisMonthJobs.reduce((acc, j) => acc + getJobValue(j), 0);
    const now = new Date();
    const monthName = MONTH_NAMES[now.getMonth()];

    const rows = thisMonthJobs.map(j => `
      <tr>
        <td>${formatDate(j.created_at)}</td>
        <td>${CATEGORY_LABELS[j.category] ?? j.category}</td>
        <td>${j.city || '—'}</td>
        <td style="text-align:right;color:#12B76A;font-weight:700">${getJobValue(j) > 0 ? formatCurrency(getJobValue(j)) : 'A combinar'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/>
<style>
  body{font-family:Arial,sans-serif;padding:32px;color:#101828}
  .logo{font-size:22px;font-weight:800;color:#1E2A38}
  .logo span{color:#FF6B35}
  .divider{border:none;border-top:2px solid #E5E7EB;margin:20px 0}
  h2{font-size:18px;color:#1E2A38;margin:0 0 4px}
  .sub{font-size:13px;color:#6B7280;margin:0 0 20px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:12px;font-weight:700;color:#6B7280;padding:8px 4px;border-bottom:2px solid #E5E7EB;text-transform:uppercase}
  td{padding:10px 4px;font-size:13px;border-bottom:1px solid #F3F4F6}
  .total-row td{font-weight:800;font-size:15px;border-top:2px solid #1E2A38;border-bottom:none;padding-top:14px}
  .footer{margin-top:32px;font-size:11px;color:#9CA3AF;text-align:center}
</style></head><body>
<div class="logo">Constru<span>Connect</span></div>
<hr class="divider"/>
<h2>Relatório de Ganhos — ${monthName} ${now.getFullYear()}</h2>
<p class="sub">Prestador: ${providerName || 'Não identificado'} &bull; Gerado em ${now.toLocaleDateString('pt-BR')}</p>
<table>
  <thead><tr><th>Data</th><th>Serviço</th><th>Cidade</th><th style="text-align:right">Valor</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#6B7280;padding:24px">Nenhum serviço neste mês</td></tr>'}</tbody>
  <tfoot><tr class="total-row"><td colspan="3">Total do mês</td><td style="text-align:right;color:#12B76A">${formatCurrency(total)}</td></tr></tfoot>
</table>
<div class="footer">ConstruConnect &bull; Relatório gerado automaticamente</div>
</body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const ok = await Sharing.isAvailableAsync();
      if (ok) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Relatório de ganhos', UTI: 'com.adobe.pdf' });
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o relatório.');
    }
    setGeneratingReport(false);
  }

  // ── Gráfico dos últimos 6 meses ────────────────────────────────────────────
  function buildChart() {
    const now = new Date();
    const months: { key: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const label = MONTH_NAMES[d.getMonth()];
      const total = jobs.filter(j => getMonthKey(j.created_at) === key).reduce((acc, j) => acc + getJobValue(j), 0);
      months.push({ key, label, total });
    }
    const maxVal = Math.max(...months.map(m => m.total), 1);
    return { months, maxVal };
  }

  const weekJobs = jobs.filter(j => isThisWeek(j.created_at));
  const monthJobs = jobs.filter(j => isThisMonth(j.created_at));
  const totalWeek = weekJobs.reduce((acc, j) => acc + getJobValue(j), 0);
  const totalMonth = monthJobs.reduce((acc, j) => acc + getJobValue(j), 0);
  const totalAll = jobs.reduce((acc, j) => acc + getJobValue(j), 0);
  const goalProgress = monthlyGoal > 0 ? Math.min(totalMonth / monthlyGoal, 1) : 0;
  const { months, maxVal } = buildChart();

  function renderItem({ item }: { item: CompletedJob }) {
    const value = getJobValue(item);
    return (
      <View style={styles.jobCard}>
        <View style={styles.jobCardLeft}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name="construct-outline" size={18} color={Colors.darkNavy} />
          </View>
          <View style={styles.jobInfo}>
            <Text style={styles.jobCategory}>{CATEGORY_LABELS[item.category] ?? item.category}</Text>
            <Text style={styles.jobMeta}>{item.city || 'Cidade não informada'} • {formatDate(item.created_at)}</Text>
          </View>
        </View>
        <View style={styles.jobValue}>
          <Text style={styles.jobValueText}>{value > 0 ? formatCurrency(value) : 'A combinar'}</Text>
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeText}>Concluído</Text>
          </View>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando ganhos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            {/* Header banner */}
            <View style={styles.headerBanner}>
              <View style={styles.headerTopRow}>
                <Text style={styles.headerTitle}>Ganhos</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.reportBtn, { backgroundColor: Colors.successGreen }]}
                    onPress={() => router.push('/withdrawal')}
                  >
                    <Ionicons name="cash-outline" size={15} color={Colors.cardWhite} />
                    <Text style={styles.reportBtnText}>Sacar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reportBtn, generatingReport && { opacity: 0.6 }]}
                    onPress={handleGenerateReport}
                    disabled={generatingReport}
                  >
                    {generatingReport
                      ? <ActivityIndicator size="small" color={Colors.cardWhite} />
                      : <><Ionicons name="document-text-outline" size={15} color={Colors.cardWhite} /><Text style={styles.reportBtnText}>PDF</Text></>}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Esta semana</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(totalWeek)}</Text>
                  <Text style={styles.summaryCount}>{weekJobs.length} serviço{weekJobs.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={[styles.summaryCard, styles.summaryCardAlt]}>
                  <Text style={styles.summaryLabel}>Este mês</Text>
                  <Text style={[styles.summaryValue, styles.summaryValueAlt]}>{formatCurrency(totalMonth)}</Text>
                  <Text style={styles.summaryCount}>{monthJobs.length} serviço{monthJobs.length !== 1 ? 's' : ''}</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Ionicons name="briefcase-outline" size={20} color={Colors.primary} />
                  <Text style={styles.statValue}>{jobs.length}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Ionicons name="trending-up-outline" size={20} color={Colors.successGreen} />
                  <Text style={styles.statValue}>{formatCurrency(totalAll)}</Text>
                  <Text style={styles.statLabel}>Acumulado</Text>
                </View>
              </View>
            </View>

            {/* Meta mensal */}
            <View style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <View>
                  <Text style={styles.goalTitle}>Meta do mês</Text>
                  <Text style={styles.goalSub}>
                    {monthlyGoal > 0 ? `${formatCurrency(totalMonth)} de ${formatCurrency(monthlyGoal)}` : 'Nenhuma meta definida'}
                  </Text>
                </View>
                <TouchableOpacity style={styles.goalEditBtn} onPress={() => { setGoalInput(monthlyGoal > 0 ? String(monthlyGoal) : ''); setShowGoalModal(true); }}>
                  <Ionicons name="create-outline" size={16} color={Colors.darkNavy} />
                  <Text style={styles.goalEditText}>{monthlyGoal > 0 ? 'Editar' : 'Definir meta'}</Text>
                </TouchableOpacity>
              </View>
              {monthlyGoal > 0 && (
                <View>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.round(goalProgress * 100)}%` as any, backgroundColor: goalProgress >= 1 ? Colors.successGreen : Colors.primary }]} />
                  </View>
                  <Text style={styles.progressLabel}>{Math.round(goalProgress * 100)}% da meta atingida</Text>
                </View>
              )}
            </View>

            {/* Gráfico dos últimos 6 meses - Interativo */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Últimos 6 meses</Text>
              <Text style={styles.chartSubtitle}>Toque em um mês para ver os detalhes</Text>
              <View style={styles.chartBars}>
                {months.map((m) => {
                  const heightPct = maxVal > 0 ? m.total / maxVal : 0;
                  const isCurrentMonth = m.key === getMonthKey(new Date().toISOString());
                  const isSelected = selectedMonthKey === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[
                        styles.chartBarCol,
                        isSelected && styles.chartBarColSelected,
                      ]}
                      onPress={() => setSelectedMonthKey(isSelected ? null : m.key)}
                    >
                      <Text style={styles.chartBarValue}>
                        {m.total > 0 ? (m.total >= 1000 ? `${(m.total / 1000).toFixed(1)}k` : `${m.total}`) : ''}
                      </Text>
                      <View style={[
                        styles.chartBarTrack,
                        isSelected && styles.chartBarTrackSelected,
                      ]}>
                        <View style={[
                          styles.chartBarFill,
                          { height: `${Math.max(heightPct * 100, m.total > 0 ? 5 : 0)}%` as any },
                          isCurrentMonth && { backgroundColor: Colors.primary },
                          isSelected && { backgroundColor: Colors.successGreen },
                        ]} />
                      </View>
                      <Text style={[
                        styles.chartBarLabel,
                        isCurrentMonth && { color: Colors.primary, fontWeight: '700' },
                        isSelected && { color: Colors.successGreen, fontWeight: '700' },
                      ]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Detalhes do mês selecionado */}
              {selectedMonthKey && (
                <View style={styles.monthDetailsCard}>
                  <Text style={styles.monthDetailsTitle}>
                    Detalhes de {MONTH_NAMES[parseInt(selectedMonthKey.split('-')[1])]}
                  </Text>
                  {(() => {
                    const monthJobs = jobs.filter(j => getMonthKey(j.created_at) === selectedMonthKey);
                    const monthTotal = monthJobs.reduce((acc, j) => acc + getJobValue(j), 0);
                    return (
                      <View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Serviços completos:</Text>
                          <Text style={styles.detailValue}>{monthJobs.length}</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Total ganho:</Text>
                          <Text style={[styles.detailValue, { color: Colors.successGreen, fontWeight: '700', fontSize: 16 }]}>{formatCurrency(monthTotal)}</Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Média por serviço:</Text>
                          <Text style={styles.detailValue}>{monthJobs.length > 0 ? formatCurrency(monthTotal / monthJobs.length) : 'N/A'}</Text>
                        </View>
                      </View>
                    );
                  })()}
                </View>
              )}
            </View>

            <View style={styles.listHeader}>
              <Text style={styles.listHeaderTitle}>Histórico de serviços</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="wallet-outline" size={40} color={Colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>Nenhum serviço concluído</Text>
            <Text style={styles.emptySubtitle}>Seus ganhos aparecerão aqui após concluir serviços.</Text>
          </View>
        }
      />

      {/* Modal meta */}
      <Modal visible={showGoalModal} transparent animationType="slide" onRequestClose={() => setShowGoalModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Meta mensal de ganhos</Text>
            <Text style={styles.modalSub}>Defina o quanto quer ganhar este mês</Text>
            <View style={styles.goalInputRow}>
              <Text style={styles.currencyPrefix}>R$</Text>
              <TextInput
                style={styles.goalInput}
                value={goalInput}
                onChangeText={setGoalInput}
                keyboardType="numeric"
                placeholder="0,00"
                placeholderTextColor={Colors.textSecondary}
                autoFocus
              />
            </View>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowGoalModal(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveGoal}>
                <Text style={styles.modalSaveText}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  headerBanner: { backgroundColor: Colors.darkNavy, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.cardWhite },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  reportBtnText: { fontSize: 13, fontWeight: '600', color: Colors.cardWhite },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 16 },
  summaryCardAlt: { backgroundColor: 'rgba(255, 107, 53, 0.2)' },
  summaryLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '500', marginBottom: 6 },
  summaryValue: { fontSize: 20, fontWeight: '800', color: Colors.cardWhite, marginBottom: 4 },
  summaryValueAlt: { color: Colors.primary },
  summaryCount: { fontSize: 12, color: '#94A3B8' },
  statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
  statValue: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  statLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '500' },
  goalCard: {
    marginHorizontal: 16, marginTop: 14, marginBottom: 4,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  goalSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  goalEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Colors.background, borderRadius: 8 },
  goalEditText: { fontSize: 12, fontWeight: '600', color: Colors.darkNavy },
  progressBar: { height: 8, backgroundColor: Colors.background, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: Colors.primary },
  progressLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },
  chartCard: {
    marginHorizontal: 16, marginVertical: 8,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  chartTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  chartSubtitle: { fontSize: 11, color: Colors.textSecondary, marginBottom: 12 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4, marginBottom: 12 },
  chartBarCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 8 },
  chartBarColSelected: { backgroundColor: Colors.background, borderWidth: 2, borderColor: Colors.successGreen },
  chartBarValue: { fontSize: 9, color: Colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  chartBarTrack: { width: '70%', height: 64, justifyContent: 'flex-end', backgroundColor: Colors.background, borderRadius: 4 },
  chartBarTrackSelected: { backgroundColor: '#F0FDF4' },
  chartBarFill: { width: '100%', borderRadius: 4, backgroundColor: Colors.darkNavy },
  chartBarLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center' },
  monthDetailsCard: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  monthDetailsTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  detailLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  detailValue: { fontSize: 13, color: Colors.textPrimary, fontWeight: '600' },
  listHeader: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  listHeaderTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  listContent: { paddingHorizontal: 16, paddingBottom: 20, flexGrow: 1 },
  separator: { height: 10 },
  jobCard: {
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  jobCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  categoryIconCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.background,
    justifyContent: 'center', alignItems: 'center', marginRight: 12, borderWidth: 1, borderColor: Colors.border,
  },
  jobInfo: { flex: 1 },
  jobCategory: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, marginBottom: 2 },
  jobMeta: { fontSize: 12, color: Colors.textSecondary },
  jobValue: { alignItems: 'flex-end', gap: 4 },
  jobValueText: { fontSize: 15, fontWeight: '700', color: Colors.successGreen },
  completedBadge: { backgroundColor: '#ECFDF5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  completedBadgeText: { fontSize: 10, fontWeight: '600', color: Colors.successGreen },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 64, paddingHorizontal: 32 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.cardWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalSub: { fontSize: 13, color: Colors.textSecondary },
  goalInputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 12, paddingHorizontal: 14, height: 52, backgroundColor: '#FFF4EE' },
  currencyPrefix: { fontSize: 18, fontWeight: '700', color: Colors.primary, marginRight: 6 },
  goalInput: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  modalSaveBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: Colors.darkNavy, justifyContent: 'center', alignItems: 'center' },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
});
