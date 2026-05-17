import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

interface JobDetail {
  id: string;
  category: string;
  description: string;
  status: string;
  client_user_id: string;
  client_latitude: number | null;
  client_longitude: number | null;
  client_address: string | null;
  city: string;
  neighborhood: string | null;
  budget_min: number | null;
  budget_max: number | null;
  scheduled_date: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
};

const CATEGORY_ICONS: Record<string, string> = {
  alvenaria: 'layers-outline',
  hidraulica: 'water-outline',
  eletrica: 'flash-outline',
  pintura: 'color-palette-outline',
  piso: 'grid-outline',
  acabamento: 'hammer-outline',
};

function formatBudget(min: number | null, max: number | null): string {
  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR')}`;
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return `A partir de ${fmt(min)}`;
  if (max !== null) return `Até ${fmt(max)}`;
  return 'A combinar';
}

function formatScheduledDate(dateStr: string | null): string {
  if (!dateStr) return 'A definir';
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function calcDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): string {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  const dist = R * c;
  if (dist < 1) return `${(dist * 1000).toFixed(0)} m de você`;
  return `${dist.toFixed(1)} km de você`;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

let locationUpdateInterval: ReturnType<typeof setInterval> | null = null;

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapRef = useRef<MapView>(null);

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [providerCoord, setProviderCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [distance, setDistance] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadJob();
    getProviderLocation();

    return () => {
      if (locationUpdateInterval) {
        clearInterval(locationUpdateInterval);
        locationUpdateInterval = null;
      }
    };
  }, [id]);

  async function getProviderLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setProviderCoord({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  async function loadJob() {
    setLoading(true);
    const { data, error } = await supabase
      .from('service_requests')
      .select(
        'id, category, description, status, client_user_id, client_latitude, client_longitude, client_address, city, neighborhood, budget_min, budget_max, scheduled_date'
      )
      .eq('id', id)
      .single();

    if (!error && data) {
      const jobData = data as JobDetail;
      setJob(jobData);

      const clientCoord =
        jobData.client_latitude && jobData.client_longitude
          ? { latitude: jobData.client_latitude, longitude: jobData.client_longitude }
          : null;

      if (clientCoord) {
        mapRef.current?.animateToRegion(
          { ...clientCoord, latitudeDelta: 0.03, longitudeDelta: 0.03 },
          800
        );

        if (providerCoord) {
          setDistance(calcDistance(providerCoord, clientCoord));
        }
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (providerCoord && job?.client_latitude && job?.client_longitude) {
      setDistance(
        calcDistance(providerCoord, {
          latitude: job.client_latitude,
          longitude: job.client_longitude,
        })
      );
    }
  }, [providerCoord, job]);

  async function startLocationTracking(userId: string, jobId: string) {
    if (locationUpdateInterval) clearInterval(locationUpdateInterval);

    async function updateLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      await supabase.from('provider_locations').upsert(
        {
          user_id: userId,
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          heading: loc.coords.heading ?? 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }

    await updateLocation();
    locationUpdateInterval = setInterval(updateLocation, 5000);
  }

  async function handleAccept() {
    if (!job) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Erro', 'Você precisa estar logado para aceitar chamados.');
      return;
    }

    if (job.status !== 'requested') {
      Alert.alert('Chamado indisponível', 'Este chamado já foi aceito por outro profissional.');
      return;
    }

    setAccepting(true);

    const { error } = await supabase
      .from('service_requests')
      .update({
        status: 'accepted',
        provider_user_id: user.id,
      })
      .eq('id', job.id)
      .eq('status', 'requested');

    if (error) {
      setAccepting(false);
      Alert.alert('Chamado indisponível', 'Este chamado não está mais disponível.');
      return;
    }

    await startLocationTracking(user.id, job.id);

    setAccepting(false);
    router.replace('/(tabs)/active');
  }

  function handleDecline() {
    router.back();
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando chamado...</Text>
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.dangerRed} />
        <Text style={styles.loadingText}>Chamado não encontrado.</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const clientCoord =
    job.client_latitude && job.client_longitude
      ? { latitude: job.client_latitude, longitude: job.client_longitude }
      : null;

  const categoryLabel = CATEGORY_LABELS[job.category] ?? job.category;
  const categoryIcon = CATEGORY_ICONS[job.category] ?? 'construct-outline';
  const isUnavailable = job.status !== 'requested';

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={
          clientCoord
            ? { ...clientCoord, latitudeDelta: 0.03, longitudeDelta: 0.03 }
            : DEFAULT_REGION
        }
        showsUserLocation={!!providerCoord}
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {clientCoord && (
          <Marker coordinate={clientCoord} title="Local do serviço" anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.clientMapMarker}>
              <Ionicons name="location" size={20} color={Colors.cardWhite} />
            </View>
          </Marker>
        )}
      </MapView>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
      </TouchableOpacity>

      {distance && (
        <View style={styles.distancePill}>
          <Ionicons name="navigate-outline" size={14} color={Colors.primary} />
          <Text style={styles.distancePillText}>{distance}</Text>
        </View>
      )}

      <ScrollView
        style={styles.bottomScrollContainer}
        contentContainerStyle={styles.bottomContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.bottomSheetHandle} />

        {isUnavailable && (
          <View style={styles.unavailableBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.dangerRed} />
            <Text style={styles.unavailableBannerText}>
              Este chamado não está mais disponível.
            </Text>
          </View>
        )}

        <View style={styles.categoryRow}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name={categoryIcon as 'layers-outline'} size={24} color={Colors.primary} />
          </View>
          <View style={styles.categoryInfo}>
            <Text style={styles.categoryLabel}>{categoryLabel}</Text>
            <Text style={styles.categorySubLabel}>Tipo de serviço</Text>
          </View>
        </View>

        <Text style={styles.descriptionText}>{job.description || 'Sem descrição adicional.'}</Text>

        <View style={styles.detailsGrid}>
          <View style={styles.detailCard}>
            <Ionicons name="location-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.detailLabel}>Localização</Text>
            <Text style={styles.detailValue}>
              {job.neighborhood ? `${job.neighborhood}, ` : ''}{job.city || 'Não informado'}
            </Text>
          </View>

          <View style={styles.detailCard}>
            <Ionicons name="calendar-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.detailLabel}>Data</Text>
            <Text style={styles.detailValue}>{formatScheduledDate(job.scheduled_date)}</Text>
          </View>
        </View>

        <View style={styles.budgetCard}>
          <Text style={styles.budgetLabel}>Orçamento estimado</Text>
          <Text style={styles.budgetValue}>{formatBudget(job.budget_min, job.budget_max)}</Text>
        </View>

        <View style={styles.buttonsRow}>
          <TouchableOpacity
            style={[styles.declineButton, (accepting || isUnavailable) && styles.buttonDisabled]}
            onPress={handleDecline}
            disabled={accepting}
          >
            <Text style={styles.declineButtonText}>RECUSAR</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.acceptButton,
              (accepting || isUnavailable) && styles.buttonDisabled,
            ]}
            onPress={handleAccept}
            disabled={accepting || isUnavailable}
          >
            {accepting ? (
              <ActivityIndicator color={Colors.cardWhite} />
            ) : (
              <Text style={styles.acceptButtonText}>ACEITAR</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  backLink: {
    marginTop: 8,
  },
  backLinkText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
  map: {
    height: '45%',
    width: '100%',
  },
  clientMapMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dangerRed,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: Colors.cardWhite,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 32,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.cardWhite,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  distancePill: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 32,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.cardWhite,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  distancePillText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  bottomScrollContainer: {
    flex: 1,
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
  },
  bottomContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 16,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  unavailableBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.dangerRed,
  },
  unavailableBannerText: {
    fontSize: 14,
    color: Colors.dangerRed,
    fontWeight: '600',
    flex: 1,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  categoryIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFF4EE',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  categorySubLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  descriptionText: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 22,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  detailCard: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 18,
  },
  budgetCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.successGreen,
  },
  budgetLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.successGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  budgetValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  declineButton: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.dangerRed,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
  },
  declineButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.dangerRed,
    letterSpacing: 1,
  },
  acceptButton: {
    flex: 2,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.successGreen,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.successGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  acceptButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.cardWhite,
    letterSpacing: 1.5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
