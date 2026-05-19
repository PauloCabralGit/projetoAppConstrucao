import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';
const FAVORITES_KEY = 'client_favorite_providers';

interface Provider {
  id: string;
  name: string;
  role: string;
  city: string;
  rating: number;
  completedJobs: number;
  priceFrom: number;
  availability: string;
  bio: string;
  skills: { id: string; label: string }[];
}

interface PortfolioPhoto {
  id: string;
  url: string;
}

const ROLE_FILTER = [
  { key: 'all', label: 'Todos' },
  { key: 'builder', label: 'Pedreiros' },
  { key: 'contractor', label: 'Empreiteiros' },
];

const ROLE_LABEL: Record<string, string> = {
  builder: 'Pedreiro',
  contractor: 'Empreiteiro',
};

const AVAILABILITY_COLOR: Record<string, string> = {
  available: Colors.successGreen,
  busy: Colors.warningAmber,
  offline: Colors.textSecondary,
};

const AVAILABILITY_LABEL: Record<string, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  offline: 'Offline',
};

function mapProvider(raw: any): Provider {
  const user = Array.isArray(raw.app_users) ? raw.app_users[0] : raw.app_users;
  return {
    id: raw.user_id,
    name: user?.full_name ?? '',
    role: user?.role ?? 'builder',
    city: user?.city ?? '',
    rating: Number(raw.average_rating ?? 5.0),
    completedJobs: raw.completed_jobs ?? 0,
    priceFrom: Number(raw.price_from ?? 0),
    availability: raw.status ?? 'offline',
    bio: raw.description ?? '',
    skills: (raw.provider_skills ?? []).map((ps: any) => ({
      id: ps.skill_id,
      label: ps.skills?.label ?? '',
    })),
  };
}

async function getFavorites(): Promise<string[]> {
  try {
    const val = await SecureStore.getItemAsync(FAVORITES_KEY);
    return val ? JSON.parse(val) : [];
  } catch {
    return [];
  }
}

async function saveFavorites(ids: string[]) {
  try {
    await SecureStore.setItemAsync(FAVORITES_KEY, JSON.stringify(ids.slice(0, 30)));
  } catch {}
}

export default function SearchScreen() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [portfolios, setPortfolios] = useState<Record<string, PortfolioPhoto[]>>({});
  const [loadingPortfolio, setLoadingPortfolio] = useState<string | null>(null);
  const [expandedPortfolio, setExpandedPortfolio] = useState<string | null>(null);

  const loadFavorites = useCallback(async () => {
    const favs = await getFavorites();
    setFavorites(favs);
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const url = roleFilter !== 'all'
        ? `${API_BASE}/providers?role=${roleFilter}`
        : `${API_BASE}/providers`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const list = (data.data ?? data.providers ?? []).map(mapProvider);
        setProviders(list);
      }
    } catch {}
  }, [roleFilter]);

  useFocusEffect(useCallback(() => {
    loadFavorites();
  }, [loadFavorites]));

  useEffect(() => {
    setLoading(true);
    fetchProviders().finally(() => setLoading(false));
  }, [fetchProviders]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchProviders();
    setRefreshing(false);
  }

  async function togglePortfolio(providerId: string) {
    if (expandedPortfolio === providerId) {
      setExpandedPortfolio(null);
      return;
    }
    setExpandedPortfolio(providerId);
    if (portfolios[providerId]) return;
    setLoadingPortfolio(providerId);
    try {
      const res = await fetch(`${API_BASE}/providers/${providerId}/portfolio`);
      if (res.ok) {
        const data = await res.json();
        setPortfolios((prev) => ({ ...prev, [providerId]: data.photos ?? [] }));
      }
    } finally {
      setLoadingPortfolio(null);
    }
  }

  async function toggleFavorite(id: string) {
    const current = await getFavorites();
    const isFav = current.includes(id);
    const updated = isFav ? current.filter((f) => f !== id) : [...current, id];
    await saveFavorites(updated);
    setFavorites(updated);
  }

  const filtered = providers.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.skills.some((s) => s.label.toLowerCase().includes(q))
    );
  });

  const favProviders = filtered.filter((p) => favorites.includes(p.id));
  const otherProviders = filtered.filter((p) => !favorites.includes(p.id));
  const sortedProviders = [...favProviders, ...otherProviders];

  function renderProvider({ item }: { item: Provider }) {
    const isFav = favorites.includes(item.id);
    const availColor = AVAILABILITY_COLOR[item.availability] ?? Colors.textSecondary;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <TouchableOpacity onPress={() => toggleFavorite(item.id)} hitSlop={8}>
                <Ionicons
                  name={isFav ? 'heart' : 'heart-outline'}
                  size={22}
                  color={isFav ? Colors.dangerRed : Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <View style={styles.cardMeta}>
              <View style={[styles.roleBadge]}>
                <Text style={styles.roleBadgeText}>{ROLE_LABEL[item.role] ?? item.role}</Text>
              </View>
              <View style={[styles.availDot, { backgroundColor: availColor }]} />
              <Text style={[styles.availText, { color: availColor }]}>
                {AVAILABILITY_LABEL[item.availability] ?? item.availability}
              </Text>
            </View>
          </View>
        </View>

        {item.city ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={13} color={Colors.textSecondary} />
            <Text style={styles.locationText}>{item.city}</Text>
          </View>
        ) : null}

        {item.bio ? (
          <Text style={styles.bioText} numberOfLines={2}>{item.bio}</Text>
        ) : null}

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="star" size={14} color={Colors.warningAmber} />
            <Text style={styles.statText}>{item.rating.toFixed(1)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="briefcase-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.statText}>{item.completedJobs} serviços</Text>
          </View>
          {item.priceFrom > 0 && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Ionicons name="cash-outline" size={14} color={Colors.successGreen} />
                <Text style={[styles.statText, { color: Colors.successGreen }]}>
                  A partir de R$ {item.priceFrom.toLocaleString('pt-BR')}
                </Text>
              </View>
            </>
          )}
        </View>

        {item.skills.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.skillsRow}
          >
            {item.skills.filter((s) => s.label).map((skill) => (
              <View key={skill.id} style={styles.skillChip}>
                <Text style={styles.skillChipText}>{skill.label}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Portfolio toggle */}
        <TouchableOpacity style={styles.portfolioToggleBtn} onPress={() => togglePortfolio(item.id)}>
          <Ionicons name="images-outline" size={15} color={Colors.primary} />
          <Text style={styles.portfolioToggleText}>
            {expandedPortfolio === item.id ? 'Ocultar portfólio' : 'Ver portfólio'}
          </Text>
          <Ionicons
            name={expandedPortfolio === item.id ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>

        {expandedPortfolio === item.id && (
          loadingPortfolio === item.id ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 8 }} />
          ) : portfolios[item.id]?.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.portfolioRow}
            >
              {portfolios[item.id].map((photo) => (
                <Image key={photo.id} source={{ uri: photo.url }} style={styles.portfolioThumb} />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.portfolioEmpty}>Nenhuma foto no portfólio.</Text>
          )
        )}

        <TouchableOpacity
          style={styles.hireBtn}
          onPress={() => router.push('/(tabs)/home')}
        >
          <Ionicons name="add-circle-outline" size={16} color={Colors.cardWhite} />
          <Text style={styles.hireBtnText}>Solicitar serviço</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profissionais</Text>
        <Text style={styles.headerSubtitle}>Encontre o profissional ideal para seu serviço</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nome, cidade ou especialidade..."
          placeholderTextColor={Colors.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filterBar}>
        {ROLE_FILTER.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, roleFilter === f.key && styles.filterBtnActive]}
            onPress={() => setRoleFilter(f.key)}
          >
            <Text style={[styles.filterBtnText, roleFilter === f.key && styles.filterBtnTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
        {favorites.length > 0 && (
          <View style={styles.favCount}>
            <Ionicons name="heart" size={13} color={Colors.dangerRed} />
            <Text style={styles.favCountText}>{favorites.length}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Carregando profissionais...</Text>
        </View>
      ) : (
        <FlatList
          data={sortedProviders}
          keyExtractor={(item) => item.id}
          renderItem={renderProvider}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListHeaderComponent={
            sortedProviders.length > 0 ? (
              <Text style={styles.resultCount}>
                {sortedProviders.length} profissional{sortedProviders.length !== 1 ? 'is' : ''} encontrado{sortedProviders.length !== 1 ? 's' : ''}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="people-outline" size={40} color={Colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum profissional encontrado</Text>
              <Text style={styles.emptySubtitle}>
                Tente ajustar os filtros ou buscar por outro termo.
              </Text>
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
    backgroundColor: Colors.darkNavy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.cardWhite },
  headerSubtitle: { fontSize: 13, color: '#94A3B8', marginTop: 3 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    backgroundColor: Colors.cardWhite,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  filterBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.cardWhite,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.darkNavy,
    borderColor: Colors.darkNavy,
  },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  filterBtnTextActive: { color: Colors.cardWhite },
  favCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginLeft: 'auto',
  },
  favCountText: { fontSize: 13, fontWeight: '700', color: Colors.dangerRed },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  resultCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: Colors.cardWhite },
  cardInfo: { flex: 1, gap: 4 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, flex: 1, marginRight: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  roleBadgeText: { fontSize: 11, fontWeight: '700', color: '#3B82F6' },
  availDot: { width: 7, height: 7, borderRadius: 4 },
  availText: { fontSize: 12, fontWeight: '600' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: 12, color: Colors.textSecondary },
  bioText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  statDivider: { width: 1, height: 14, backgroundColor: Colors.border, marginHorizontal: 2 },
  skillsRow: { gap: 6 },
  skillChip: {
    backgroundColor: '#F0FDF4',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  skillChipText: { fontSize: 11, fontWeight: '600', color: Colors.successGreen },
  hireBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
  },
  hireBtnText: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
  emptyContainer: {
    paddingTop: 60,
    alignItems: 'center',
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
  portfolioToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  portfolioToggleText: { fontSize: 13, fontWeight: '600', color: Colors.primary, flex: 1 },
  portfolioRow: { gap: 8, paddingBottom: 8 },
  portfolioThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: Colors.border },
  portfolioEmpty: { fontSize: 13, color: Colors.textSecondary, fontStyle: 'italic', paddingVertical: 8 },
});
