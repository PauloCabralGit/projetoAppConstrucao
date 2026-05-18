import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

interface CompletedJob {
  id: string;
  category: string;
  budget_max: number | null;
  budget_min: number | null;
  quote_amount: number | null;
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
};

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getJobValue(job: CompletedJob): number {
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

export default function EarningsScreen() {
  const [jobs, setJobs] = useState<CompletedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCompletedJobs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, budget_min, budget_max, quote_amount, created_at, city')
      .eq('provider_user_id', user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      setJobs(data as CompletedJob[]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchCompletedJobs().finally(() => setLoading(false));
  }, [fetchCompletedJobs]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchCompletedJobs();
    setRefreshing(false);
  }

  const weekJobs = jobs.filter((j) => isThisWeek(j.created_at));
  const totalWeek = weekJobs.reduce((acc, j) => acc + getJobValue(j), 0);
  const totalAll = jobs.reduce((acc, j) => acc + getJobValue(j), 0);
  const jobsCount = jobs.length;

  function renderItem({ item }: { item: CompletedJob }) {
    const value = getJobValue(item);
    return (
      <View style={styles.jobCard}>
        <View style={styles.jobCardLeft}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name="construct-outline" size={18} color={Colors.darkNavy} />
          </View>
          <View style={styles.jobInfo}>
            <Text style={styles.jobCategory}>
              {CATEGORY_LABELS[item.category] ?? item.category}
            </Text>
            <Text style={styles.jobMeta}>
              {item.city || 'Cidade não informada'} • {formatDate(item.created_at)}
            </Text>
          </View>
        </View>
        <View style={styles.jobValue}>
          <Text style={styles.jobValueText}>
            {value > 0 ? formatCurrency(value) : 'A combinar'}
          </Text>
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
      <View style={styles.headerBanner}>
        <Text style={styles.headerTitle}>Ganhos</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Esta semana</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totalWeek)}</Text>
            <Text style={styles.summaryCount}>
              {weekJobs.length} serviço{weekJobs.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardAlt]}>
            <Text style={styles.summaryLabel}>Total acumulado</Text>
            <Text style={[styles.summaryValue, styles.summaryValueAlt]}>{formatCurrency(totalAll)}</Text>
            <Text style={styles.summaryCount}>
              {jobsCount} serviço{jobsCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="briefcase-outline" size={20} color={Colors.primary} />
            <Text style={styles.statValue}>{jobsCount}</Text>
            <Text style={styles.statLabel}>Serviços</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="star-outline" size={20} color={Colors.warningAmber} />
            <Text style={styles.statValue}>4.9</Text>
            <Text style={styles.statLabel}>Avaliação</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="trending-up-outline" size={20} color={Colors.successGreen} />
            <Text style={styles.statValue}>{weekJobs.length}</Text>
            <Text style={styles.statLabel}>Esta semana</Text>
          </View>
        </View>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listHeaderTitle}>Histórico de serviços</Text>
      </View>

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
              <Ionicons name="wallet-outline" size={40} color={Colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>Nenhum serviço concluído</Text>
            <Text style={styles.emptySubtitle}>
              Seus ganhos aparecerão aqui após concluir serviços.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
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
  headerBanner: {
    backgroundColor: Colors.darkNavy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.cardWhite,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 16,
  },
  summaryCardAlt: {
    backgroundColor: 'rgba(255, 107, 53, 0.2)',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.cardWhite,
    marginBottom: 4,
  },
  summaryValueAlt: {
    color: Colors.primary,
  },
  summaryCount: {
    fontSize: 12,
    color: '#94A3B8',
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  statLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  listHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  listHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    flexGrow: 1,
  },
  separator: {
    height: 10,
  },
  jobCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  jobCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  categoryIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  jobInfo: {
    flex: 1,
  },
  jobCategory: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  jobMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  jobValue: {
    alignItems: 'flex-end',
    gap: 4,
  },
  jobValueText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.successGreen,
  },
  completedBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  completedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.successGreen,
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
});
