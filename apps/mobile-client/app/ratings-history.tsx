import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
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
  provider_name: string;
  service_category: string;
  created_at: string;
  service_request_id: string;
}

interface PaginatedResponse {
  ratings: Rating[];
  total: number;
  offset: number;
  limit: number;
}

export default function RatingsHistoryScreen() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;

  const loadRatings = useCallback(async (pageOffset = 0) => {
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/ratings/given?limit=${limit}&offset=${pageOffset}`,
        {
          method: 'GET',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
        }
      );

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
      const errorMsg = (err as Error).message || 'Erro ao carregar histórico';
      setError(errorMsg);
      console.error('Failed to load ratings:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const renderRatingCard = ({ item }: { item: Rating }) => {
    const date = new Date(item.created_at);
    const formattedDate = date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });

    return (
      <View style={[styles.ratingCard, { borderBottomColor: Colors.border }]}>
        <View style={styles.ratingHeader}>
          <View style={styles.ratingInfo}>
            <Text style={[styles.providerName, { color: Colors.textPrimary }]}>
              {item.provider_name}
            </Text>
            <Text style={[styles.categoryBadge, { color: Colors.textSecondary }]}>
              {item.service_category}
            </Text>
          </View>
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreText}>{item.score}</Text>
            <Text style={styles.starIcon}>⭐</Text>
          </View>
        </View>

        {item.comment && (
          <View style={styles.commentWrapper}>
            <Text style={[styles.commentText, { color: Colors.textSecondary }]}>
              "{item.comment}"
            </Text>
          </View>
        )}

        <Text style={[styles.dateText, { color: Colors.textSecondary }]}>
          {formattedDate}
        </Text>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyStateIconContainer}>
        <Ionicons name="star-outline" size={48} color={Colors.textSecondary} />
      </View>
      <Text style={[styles.emptyStateTitle, { color: Colors.textPrimary }]}>
        Nenhuma avaliação ainda
      </Text>
      <Text style={[styles.emptyStateSubtitle, { color: Colors.textSecondary }]}>
        Quando você avaliar um prestador, suas avaliações aparecerão aqui
      </Text>
    </View>
  );

  const renderLoadingState = () => (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={[styles.loadingText, { color: Colors.textSecondary }]}>
        Carregando histórico...
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
          Minhas Avaliações
        </Text>
        <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
          {total > 0 ? `${total} ${total === 1 ? 'avaliação' : 'avaliações'} realizadas` : ''}
        </Text>
      </View>

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: '#FEF2F2' }]}>
          <Ionicons name="alert-circle" size={16} color={Colors.dangerRed} />
          <Text style={[styles.errorText, { color: Colors.dangerRed }]}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => loadRatings(0)}
            style={styles.retryButton}
          >
            <Text style={[styles.retryText, { color: Colors.primary }]}>
              Tentar novamente
            </Text>
          </TouchableOpacity>
        </View>
      )}

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
    paddingTop: 8,
    paddingBottom: 16,
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
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  retryButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ratingCard: {
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  ratingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  ratingInfo: {
    flex: 1,
    marginRight: 12,
  },
  providerName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  categoryBadge: {
    fontSize: 12,
    fontWeight: '500',
  },
  scoreContainer: {
    alignItems: 'center',
    gap: 4,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  starIcon: {
    fontSize: 16,
  },
  commentWrapper: {
    marginBottom: 8,
    paddingHorizontal: 0,
  },
  commentText: {
    fontSize: 13,
    fontWeight: '400',
    fontStyle: 'italic',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '400',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateIconContainer: {
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
