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
  Share,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';

import { API_BASE } from '@/lib/config';
const FAVORITES_KEY = 'client_favorite_providers';

interface SponsoredProvider {
  id: string;
  provider_id: string;
  categories: string[];
  cities: string[];
  priority: number;
}

interface Provider {
  id: string;
  name: string;
  role: string;
  city: string;
  rating: number;
  completedJobs: number;
  priceFrom: number;
  availability: string;
  lastSeenAt: string | null;
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

function formatLastSeen(lastSeenAt: string | null): string | null {
  if (!lastSeenAt) return null;
  const d = new Date(lastSeenAt);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 3) return null; // considera online, não mostra
  if (diffMin < 60) return `Visto há ${diffMin} min`;
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Visto hoje às ${time}`;
  return `Visto em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`;
}

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
    lastSeenAt: raw.last_seen_at ?? null,
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
  const { colors } = useTheme();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [minRating, setMinRating] = useState(0);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'rating' | 'price' | 'jobs'>('rating');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [portfolios, setPortfolios] = useState<Record<string, PortfolioPhoto[]>>({});
  const [loadingPortfolio, setLoadingPortfolio] = useState<string | null>(null);
  const [expandedPortfolio, setExpandedPortfolio] = useState<string | null>(null);
  const [sponsoredIds, setSponsoredIds] = useState<Set<string>>(new Set());
  const [showSponsoredInfo, setShowSponsoredInfo] = useState(false);

  const loadFavorites = useCallback(async () => {
    const favs = await getFavorites();
    setFavorites(favs);
  }, []);

  const fetchSponsored = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ads/sponsored-providers`);
      if (res.ok) {
        const data = await res.json();
        const ids = new Set<string>((data.data ?? []).map((s: SponsoredProvider) => s.provider_id));
        setSponsoredIds(ids);
      }
    } catch {}
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
    Promise.all([fetchProviders(), fetchSponsored()]).finally(() => setLoading(false));
  }, [fetchProviders, fetchSponsored]);

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
    if (search) {
      const q = search.toLowerCase();
      const matchesSearch = p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || p.skills.some((s) => s.label.toLowerCase().includes(q));
      if (!matchesSearch) return false;
    }
    if (minRating > 0 && p.rating < minRating) return false;
    if (availableOnly && p.availability !== 'available') return false;
    return true;
  });

  const sortedAll = [...filtered].sort((a, b) => {
    if (sortBy === 'rating') return b.rating - a.rating;
    if (sortBy === 'price') return a.priceFrom - b.priceFrom;
    if (sortBy === 'jobs') return b.completedJobs - a.completedJobs;
    return 0;
  });

  const favProviders = sortedAll.filter((p) => favorites.includes(p.id));
  const nonFavProviders = sortedAll.filter((p) => !favorites.includes(p.id));

  // Patrocinados: máx 2, excluindo favoritos (favorito sempre ganha posição natural)
  const sponsoredNonFav = nonFavProviders.filter((p) => sponsoredIds.has(p.id)).slice(0, 2);
  const organicProviders = nonFavProviders.filter((p) => !sponsoredIds.has(p.id));

  const sortedProviders = [...favProviders, ...sponsoredNonFav, ...organicProviders];

  const activeFilters = (minRating > 0 ? 1 : 0) + (availableOnly ? 1 : 0) + (sortBy !== 'rating' ? 1 : 0);

  function renderProvider({ item }: { item: Provider }) {
    const isFav = favorites.includes(item.id);
    const isSponsored = sponsoredIds.has(item.id) && !isFav;
    const availColor = AVAILABILITY_COLOR[item.availability] ?? Colors.textSecondary;
    const lastSeenLabel = formatLastSeen(item.lastSeenAt);

    return (
      <View style={[styles.card, { backgroundColor: colors.cardWhite }, isSponsored && styles.sponsoredCard]}>
        {isSponsored && (
          <View style={styles.sponsoredRow}>
            <View style={styles.sponsoredBadge}>
              <Text style={styles.sponsoredBadgeText}>Patrocinado</Text>
            </View>
            <TouchableOpacity onPress={() => setShowSponsoredInfo(true)} hitSlop={8}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <View style={styles.cardNameRow}>
              <Text style={[styles.cardName, { color: colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
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
            {lastSeenLabel ? (
              <Text style={styles.lastSeenText}>{lastSeenLabel}</Text>
            ) : item.availability === 'available' ? (
              <Text style={[styles.lastSeenText, { color: Colors.successGreen }]}>Online agora</Text>
            ) : null}
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

        <View style={[styles.statsRow, { backgroundColor: colors.background }]}>
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

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.hireBtn, { flex: 1 }]}
            onPress={() => router.navigate({
              pathname: '/(tabs)/home',
              params: { providerId: item.id, providerName: item.name },
            })}
          >
            <Ionicons name="add-circle-outline" size={16} color={Colors.cardWhite} />
            <Text style={styles.hireBtnText}>Solicitar serviço</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareProfileBtn}
            onPress={() => Share.share({
              message: `${item.name} — ${item.skills.map(s => s.label).join(', ') || item.role}\n⭐ ${item.rating.toFixed(1)} · ${item.completedJobs} serviços · ${item.city}\n\nContrate via ConstruConnect!`,
              title: item.name,
            })}
          >
            <Ionicons name="share-social-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profissionais</Text>
        <Text style={styles.headerSubtitle}>Encontre o profissional ideal para seu serviço</Text>
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.cardWhite, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.textPrimary }]}
          placeholder="Buscar por nome, cidade ou especialidade..."
          placeholderTextColor={colors.textSecondary}
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
        <TouchableOpacity
          style={[styles.filterBtn, (activeFilters > 0 || showAdvanced) && styles.filterBtnActive]}
          onPress={() => setShowAdvanced(v => !v)}
        >
          <Ionicons name="options-outline" size={14} color={activeFilters > 0 || showAdvanced ? Colors.cardWhite : Colors.textPrimary} />
          {activeFilters > 0 && <Text style={[styles.filterBtnText, styles.filterBtnTextActive]}>{activeFilters}</Text>}
        </TouchableOpacity>
        {favorites.length > 0 && (
          <View style={styles.favCount}>
            <Ionicons name="heart" size={13} color={Colors.dangerRed} />
            <Text style={styles.favCountText}>{favorites.length}</Text>
          </View>
        )}
      </View>

      {showAdvanced && (
        <View style={[styles.advancedPanel, { backgroundColor: colors.cardWhite, borderColor: colors.border }]}>
          <Text style={styles.advancedLabel}>Nota mínima</Text>
          <View style={styles.advancedRow}>
            {[0, 3, 4, 5].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.advancedChip, minRating === r && styles.advancedChipActive]}
                onPress={() => setMinRating(r)}
              >
                {r === 0 ? (
                  <Text style={[styles.advancedChipText, minRating === r && styles.advancedChipTextActive]}>Qualquer</Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="star" size={12} color={minRating === r ? Colors.cardWhite : Colors.warningAmber} />
                    <Text style={[styles.advancedChipText, minRating === r && styles.advancedChipTextActive]}>{r}+</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.advancedLabel}>Ordenar por</Text>
          <View style={styles.advancedRow}>
            {([['rating', 'Avaliação'], ['jobs', 'Serviços'], ['price', 'Menor preço']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.advancedChip, sortBy === key && styles.advancedChipActive]}
                onPress={() => setSortBy(key)}
              >
                <Text style={[styles.advancedChipText, sortBy === key && styles.advancedChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.advancedChip, availableOnly && styles.advancedChipActive, { alignSelf: 'flex-start' }]}
            onPress={() => setAvailableOnly(v => !v)}
          >
            <Ionicons name={availableOnly ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={availableOnly ? Colors.cardWhite : Colors.textSecondary} />
            <Text style={[styles.advancedChipText, availableOnly && styles.advancedChipTextActive]}>Somente disponíveis</Text>
          </TouchableOpacity>

          {activeFilters > 0 && (
            <TouchableOpacity onPress={() => { setMinRating(0); setAvailableOnly(false); setSortBy('rating'); }}>
              <Text style={styles.clearFilters}>Limpar filtros</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={showSponsoredInfo} transparent animationType="fade" onRequestClose={() => setShowSponsoredInfo(false)}>
        <TouchableOpacity style={styles.adInfoOverlay} activeOpacity={1} onPress={() => setShowSponsoredInfo(false)}>
          <View style={styles.adInfoSheet}>
            <Text style={styles.adInfoTitle}>Por que vejo isso?</Text>
            <Text style={styles.adInfoBody}>
              Este profissional está pagando para aparecer em destaque na busca. Isso não afeta sua avaliação ou qualidade do serviço.
            </Text>
            <TouchableOpacity style={styles.adInfoCloseBtn} onPress={() => setShowSponsoredInfo(false)}>
              <Text style={styles.adInfoCloseTxt}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando profissionais...</Text>
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
  advancedPanel: {
    marginHorizontal: 16, marginBottom: 10, padding: 14,
    backgroundColor: Colors.cardWhite, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  advancedLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  advancedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  advancedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  advancedChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  advancedChipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  advancedChipTextActive: { color: Colors.cardWhite },
  clearFilters: { fontSize: 12, fontWeight: '700', color: Colors.primary, textAlign: 'right' },
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
  lastSeenText: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
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
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  shareProfileBtn: {
    width: 42, height: 42, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.primary,
    backgroundColor: '#FFF4EE', justifyContent: 'center', alignItems: 'center',
  },
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
  sponsoredCard: {
    borderWidth: 1.5,
    borderColor: '#FED7AA',
    backgroundColor: '#FFFBF5',
  },
  sponsoredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sponsoredBadge: {
    backgroundColor: '#FFF4EE',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  sponsoredBadgeText: { fontSize: 10, fontWeight: '700', color: '#C2410C', letterSpacing: 0.3 },
  adInfoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  adInfoSheet: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 24,
    gap: 12,
    width: '100%',
  },
  adInfoTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  adInfoBody: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  adInfoCloseBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.primary,
    borderRadius: 10,
  },
  adInfoCloseTxt: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
});
