import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
  SectionList,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { authHeaders } from '@/lib/api';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface Rating {
  id: string;
  score: number;
  comment?: string;
  client_name: string;
  service_type: string;
  created_at: string;
}

interface PaginatedResponse {
  ratings: Rating[];
  total: number;
  offset: number;
  limit: number;
}

export default function RatingsReceivedScreen() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<number | null>(null);

  const limit = 50;

  const loadRatings = useCallback(async (pageOffset = 0) => {
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: pageOffset.toString(),
      });

      if (selectedFilter) {
        params.append('score', selectedFilter.toString());
      }

      const response = await fetch(`${API_BASE}/providers/me/ratings?${params}`, {
        method: 'GET',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as PaginatedResponse;

      if (pageOffset === 0) {
        setRatings(data.ratings);
      } else {
        setRatings((prev) => [...prev, ...data.ratings]);
      }

      setTotal(data.total);
      setOffset(data.offset);
    } catch (err) {
      const errorMsg = (err as Error).message || 'Erro ao carregar avaliações';
      setError(errorMsg);
      console.error('Failed to load ratings:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedFilter]);

  // Load initially
  useEffect(() => {
    loadRatings(0);
  }, [loadRatings]);

  // Reload on screen focus
  useFocusEffect(
    useCallback(() => {
      loadRatings(0);
    }, [loadRatings])
  );

  const handleLoadMore = () => {
    if (!loading && offset + limit < total) {
      loadRatings(offset + limit);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadRatings(0);
  };

  const handleFilterChange = (score: number | null) => {
    setSelectedFilter(score);
    setOffset(0);
    setRatings([]);
  };

  const renderFilterButton = (score: number | null, label: string) => {
    const isSelected = selectedFilter === score;
    return (
      <TouchableOpacity
        style={[
          styles.filterButton,
          isSelected && [styles.filterButtonActive, { backgroundColor: Colors.primary }],
        ]}
        onPress={() => handleFilterChange(score)}
      >
        <Text
          style={[
            styles.filterButtonText,
            isSelected && { color: Colors.cardWhite },
            !isSelected && { color: Colors.textSecondary },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderRatingCard = ({ item }: { item: Rating }) => {
    const date = new Date(item.created_at);
    const formattedDate = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });

    const getRatingColor = (score: number) => {
      if (score >= 4) return '#22C55E'; // green
      if (score === 3) return '#EABB00'; // yellow
      return Colors.dangerRed; // red
    };

    return (
      <View
        style={[
          styles.ratingCard,
          {
            borderLeftColor: getRatingColor(item.score),
            backgroundColor: Colors.cardWhite,
          },
        ]}
      >
        <View style={styles.ratingContent}>
          <View style={styles.ratingHeader}>
            <View style={styles.clientInfo}>
              <View
                style={[
                  styles.clientAvatar,
                  { backgroundColor: Colors.background },
                ]}
              >
                <Ionicons
                  name="person-circle-outline"
                  size={32}
                  color={Colors.textSecondary}
                />
              </View>
              <View style={styles.clientDetails}>
                <Text
                  style={[styles.clientName, { color: Colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.client_name}
                </Text>
                <Text
                  style={[styles.serviceType, { color: Colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {item.service_type}
                </Text>
              </View>
            </View>
            <View style={styles.scoreSection}>
              <Text style={[styles.score, { color: getRatingColor(item.score) }]}>
                {item.score}
              </Text>
              <Text style={styles.starSmall}>⭐</Text>
            </View>
          </View>

          {item.comment && (
            <View style={styles.commentSection}>
              <Text style={[styles.comment, { color: Colors.textSecondary }]}>
                "{item.comment}"
              </Text>
            </View>
          )}

          <Text style={[styles.date, { color: Colors.textSecondary }]}>
            {formattedDate}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyStateIcon}>
        <Ionicons name="star-outline" size={48} color={Colors.textSecondary} />
      </View>
      <Text style={[styles.emptyStateTitle, { color: Colors.textPrimary }]}>
        Nenhuma avaliação
      </Text>
      <Text style={[styles.emptyStateSubtitle, { color: Colors.textSecondary }]}>
        {selectedFilter
          ? `Nenhuma avaliação com ${selectedFilter} estrelas`
          : 'Quando clientes avaliarem você, elas aparecerão aqui'}
      </Text>
    </View>
  );

  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>
        Carregando avaliações...
      </Text>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: Colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: Colors.textPrimary }]}>
          Avaliações Recebidas
        </Text>
        <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
          {total > 0
            ? `${total} ${total === 1 ? 'avaliação' : 'avaliações'}`
            : 'Sem avaliações'}
        </Text>
      </View>

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: '#FEF2F2' }]}>
          <Ionicons name="alert-circle" size={16} color={Colors.dangerRed} />
          <Text style={[styles.errorText, { color: Colors.dangerRed }]}>
            {error}
          </Text>
        </View>
      )}

      {/* Filters */}
      <View style={styles.filterContainer}>
        <FlatList
          data={[
            { score: null, label: 'Todas' },
            { score: 5, label: '5⭐' },
            { score: 4, label: '4⭐' },
            { score: 3, label: '3⭐' },
            { score: 2, label: '2⭐' },
            { score: 1, label: '1⭐' },
          ]}
          renderItem={({ item }) =>
            renderFilterButton(item.score, item.label)
          }
          keyExtractor={(item) =>
            item.score === null ? 'all' : item.score.toString()
          }
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          scrollEnabled
        />
      </View>

      {/* Ratings List */}
      {loading ? (
        renderLoadingState()
      ) : (
        <FlatList
          data={ratings}
          keyExtractor={(item) => item.id}
          renderItem={renderRatingCard}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={renderEmptyState}
          scrollEnabled={!loading}
          contentContainerStyle={ratings.length === 0 ? styles.flatListEmpty : undefined}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={() => <View style={{ height: 8 }} />}
          ListFooterComponent={() => <View style={{ height: 8 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  filterContainer: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  filterList: {
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  filterButtonActive: {
    borderColor: Colors.primary,
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ratingCard: {
    backgroundColor: Colors.cardWhite,
    borderLeftWidth: 4,
    borderRadius: 8,
    marginHorizontal: 20,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  ratingContent: {
    gap: 8,
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clientInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clientAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clientDetails: {
    flex: 1,
  },
  clientName: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  serviceType: {
    fontSize: 11,
    fontWeight: '400',
  },
  scoreSection: {
    alignItems: 'center',
    gap: 2,
  },
  score: {
    fontSize: 16,
    fontWeight: '700',
  },
  starSmall: {
    fontSize: 12,
  },
  commentSection: {
    paddingVertical: 4,
  },
  comment: {
    fontSize: 12,
    fontWeight: '400',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  date: {
    fontSize: 10,
    fontWeight: '400',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateIcon: {
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  flatListEmpty: {
    flexGrow: 1,
  },
});
