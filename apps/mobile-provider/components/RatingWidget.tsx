import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface ProviderStats {
  avg_score: number;
  total_count: number;
  distribution: {
    [key: string]: number;
  };
}

interface RatingWidgetProps {
  providerId: string;
  onNavigateToDetails?: () => void;
}

export function RatingWidget({ providerId, onNavigateToDetails }: RatingWidgetProps) {
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, [providerId]);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/providers/${providerId}/ratings?limit=1`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setStats(data.data);
    } catch (err) {
      const errorMsg = (err as Error).message || 'Erro ao carregar avaliações';
      setError(errorMsg);
      console.error('Failed to load rating stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.widget, { backgroundColor: Colors.background }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!stats || stats.total_count === 0) {
    return (
      <View style={[styles.widget, { backgroundColor: Colors.background }]}>
        <Text style={[styles.emptyText, { color: Colors.textSecondary }]}>
          Nenhuma avaliação ainda
        </Text>
        <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>
          Realize serviços para receber avaliações
        </Text>
      </View>
    );
  }

  const renderDistributionBar = (score: number) => {
    const count = stats?.distribution[score] || 0;
    const total = stats?.total_count || 1;
    const percentage = (count / total) * 100;

    return (
      <View key={score} style={styles.distributionRow}>
        <Text style={[styles.scoreLabel, { color: Colors.textSecondary }]}>
          {score}⭐
        </Text>
        <View style={[styles.barContainer, { backgroundColor: Colors.background }]}>
          <View
            style={[
              styles.bar,
              {
                width: `${percentage}%`,
                backgroundColor: Colors.primary,
              },
            ]}
          />
        </View>
        <Text style={[styles.countLabel, { color: Colors.textSecondary }]}>
          {count}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.widget, { backgroundColor: Colors.cardWhite }]}>
      {/* Header with score */}
      <View style={styles.headerSection}>
        <View style={styles.scoreDisplay}>
          <Text style={[styles.mainScore, { color: Colors.primary }]}>
            {stats.avg_score.toFixed(1)}
          </Text>
          <Text style={styles.starBig}>⭐</Text>
        </View>
        <View style={styles.scoreInfo}>
          <Text style={[styles.scoreDescription, { color: Colors.textPrimary }]}>
            Sua nota
          </Text>
          <Text style={[styles.countText, { color: Colors.textSecondary }]}>
            {stats.total_count} {stats.total_count === 1 ? 'avaliação' : 'avaliações'}
          </Text>
        </View>
      </View>

      {/* Distribution */}
      <View style={styles.divider} />

      <Text style={[styles.distributionTitle, { color: Colors.textSecondary }]}>
        Distribuição de avaliações
      </Text>

      {[5, 4, 3, 2, 1].map((score) => renderDistributionBar(score))}

      {/* View all button */}
      <TouchableOpacity
        style={[styles.viewAllButton, { borderTopColor: Colors.border }]}
        onPress={() => {
          if (onNavigateToDetails) {
            onNavigateToDetails();
          } else {
            router.push('/ratings-received');
          }
        }}
      >
        <Text style={[styles.viewAllText, { color: Colors.primary }]}>
          Ver todas as avaliações
        </Text>
        <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  widget: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  headerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  scoreDisplay: {
    alignItems: 'center',
    gap: 2,
  },
  mainScore: {
    fontSize: 32,
    fontWeight: '700',
  },
  starBig: {
    fontSize: 24,
  },
  scoreInfo: {
    flex: 1,
  },
  scoreDescription: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  countText: {
    fontSize: 12,
    fontWeight: '400',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 12,
  },
  distributionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '500',
    width: 30,
  },
  barContainer: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 3,
  },
  countLabel: {
    fontSize: 11,
    fontWeight: '500',
    width: 25,
    textAlign: 'right',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginLeft: -16,
    marginRight: -16,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'center',
  },
});
