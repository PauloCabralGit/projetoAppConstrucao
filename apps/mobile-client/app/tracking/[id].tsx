import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useLocalSearchParams, router } from 'expo-router';
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
  provider_user_id: string | null;
  client_latitude: number | null;
  client_longitude: number | null;
}

interface ProviderLocation {
  latitude: number;
  longitude: number;
  heading: number;
}

interface ProviderProfile {
  full_name: string;
  specialties: string;
}

const STATUS_CONFIG: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Rascunho', color: Colors.textSecondary, bg: '#F3F4F6' },
  requested: { label: 'Aguardando profissional', color: Colors.warningAmber, bg: '#FFFBEB' },
  accepted: { label: 'Profissional a caminho', color: '#3B82F6', bg: '#EFF6FF' },
  in_progress: { label: 'Em andamento', color: Colors.primary, bg: '#FFF4EE' },
  completed: { label: 'Concluído', color: Colors.successGreen, bg: '#ECFDF5' },
  cancelled: { label: 'Cancelado', color: Colors.dangerRed, bg: '#FEF2F2' },
};

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function TrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapRef = useRef<MapView>(null);
  const markerAnim = useRef(new Animated.Value(0)).current;

  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [providerLocation, setProviderLocation] = useState<ProviderLocation | null>(null);
  const [providerProfile, setProviderProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadRequest();
    const cleanupRequest = subscribeToRequest();
    return () => {
      cleanupRequest();
    };
  }, [id]);

  useEffect(() => {
    if (!request?.provider_user_id) return;
    loadProviderProfile(request.provider_user_id);
    const cleanupLocation = subscribeToProviderLocation(request.provider_user_id);
    return () => {
      cleanupLocation();
    };
  }, [request?.provider_user_id]);

  useEffect(() => {
    if (providerLocation) {
      pulseMarker();
      if (request?.client_latitude && request?.client_longitude) {
        const midLat = (providerLocation.latitude + request.client_latitude) / 2;
        const midLng = (providerLocation.longitude + request.client_longitude) / 2;
        const latDelta = Math.abs(providerLocation.latitude - request.client_latitude) * 2 + 0.01;
        const lngDelta = Math.abs(providerLocation.longitude - request.client_longitude) * 2 + 0.01;
        mapRef.current?.animateToRegion(
          { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta },
          800
        );
      } else {
        mapRef.current?.animateToRegion(
          { latitude: providerLocation.latitude, longitude: providerLocation.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 },
          800
        );
      }
    }
  }, [providerLocation]);

  function pulseMarker() {
    Animated.sequence([
      Animated.timing(markerAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(markerAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  async function loadRequest() {
    setLoading(true);
    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, status, provider_user_id, client_latitude, client_longitude')
      .eq('id', id)
      .single();

    if (!error && data) {
      setRequest(data as ServiceRequest);
    }
    setLoading(false);
  }

  async function loadProviderProfile(providerUserId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, specialties')
      .eq('id', providerUserId)
      .single();
    if (data) setProviderProfile(data as ProviderProfile);
  }

  function subscribeToRequest() {
    const channel = supabase
      .channel(`service_request_${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'service_requests',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          const updated = payload.new as ServiceRequest;
          setRequest(updated);
          if (updated.status === 'completed') {
            Alert.alert('Serviço concluído!', 'O profissional marcou o serviço como concluído.');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  function subscribeToProviderLocation(providerUserId: string) {
    supabase
      .from('provider_locations')
      .select('latitude, longitude, heading')
      .eq('user_id', providerUserId)
      .single()
      .then(({ data }) => {
        if (data) setProviderLocation(data as ProviderLocation);
      });

    const channel = supabase
      .channel(`provider_location_${providerUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'provider_locations',
          filter: `user_id=eq.${providerUserId}`,
        },
        (payload) => {
          const loc = payload.new as ProviderLocation;
          setProviderLocation(loc);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  async function handleCancel() {
    Alert.alert(
      'Cancelar pedido',
      'Tem certeza que deseja cancelar este pedido?',
      [
        { text: 'Não', style: 'cancel' },
        {
          text: 'Sim, cancelar',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            const { error } = await supabase
              .from('service_requests')
              .update({ status: 'cancelled' })
              .eq('id', id);
            setCancelling(false);
            if (!error) {
              router.back();
            } else {
              Alert.alert('Erro', 'Não foi possível cancelar o pedido.');
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando rastreamento...</Text>
      </View>
    );
  }

  const statusConf = request ? (STATUS_CONFIG[request.status] ?? STATUS_CONFIG.requested) : STATUS_CONFIG.requested;

  const clientCoord =
    request?.client_latitude && request?.client_longitude
      ? { latitude: request.client_latitude, longitude: request.client_longitude }
      : null;

  const providerCoord = providerLocation
    ? { latitude: providerLocation.latitude, longitude: providerLocation.longitude }
    : null;

  const mapRegion = providerCoord ?? clientCoord ?? DEFAULT_REGION;

  const markerScale = markerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.3],
  });

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={
          providerCoord
            ? { ...providerCoord, latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : clientCoord
            ? { ...clientCoord, latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : DEFAULT_REGION
        }
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {clientCoord && (
          <Marker coordinate={clientCoord} title="Sua localização" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.clientMarker}>
              <Ionicons name="home" size={16} color={Colors.cardWhite} />
            </View>
          </Marker>
        )}

        {providerCoord && (
          <Marker coordinate={providerCoord} title={providerProfile?.full_name ?? 'Profissional'} anchor={{ x: 0.5, y: 0.5 }}>
            <Animated.View style={[styles.providerMarker, { transform: [{ scale: markerScale }] }]}>
              <Ionicons name="construct" size={16} color={Colors.cardWhite} />
            </Animated.View>
          </Marker>
        )}

        {clientCoord && providerCoord && (
          <Polyline
            coordinates={[providerCoord, clientCoord]}
            strokeColor={Colors.primary}
            strokeWidth={3}
            lineDashPattern={[8, 4]}
          />
        )}
      </MapView>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.bottomSheet}>
        <View style={styles.bottomSheetHandle} />

        <View style={styles.providerRow}>
          <View style={styles.providerAvatar}>
            <Text style={styles.providerAvatarText}>
              {providerProfile
                ? providerProfile.full_name.charAt(0).toUpperCase()
                : '?'}
            </Text>
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>
              {providerProfile?.full_name ?? (request?.provider_user_id ? 'Profissional' : 'Aguardando...')}
            </Text>
            <Text style={styles.providerSpecialty}>
              {providerProfile?.specialties ?? request?.category ?? ''}
            </Text>
          </View>
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={13} color={Colors.warningAmber} />
            <Text style={styles.ratingText}>4.9</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>ETA</Text>
            <Text style={styles.statValue}>~18 min</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="navigate-outline" size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>Distância</Text>
            <Text style={styles.statValue}>
              {providerCoord && clientCoord
                ? calcDistance(providerCoord, clientCoord)
                : '—'}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="construct-outline" size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>Serviço</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {request?.category ?? '—'}
            </Text>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: statusConf.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: statusConf.color }]} />
          <Text style={[styles.statusLabel, { color: statusConf.color }]}>
            {statusConf.label}
          </Text>
        </View>

        {request?.status !== 'completed' && request?.status !== 'cancelled' && (
          <TouchableOpacity
            style={[styles.cancelButton, cancelling && styles.cancelButtonDisabled]}
            onPress={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <ActivityIndicator color={Colors.dangerRed} />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={18} color={Colors.dangerRed} />
                <Text style={styles.cancelButtonText}>Cancelar pedido</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
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
  if (dist < 1) return `${(dist * 1000).toFixed(0)} m`;
  return `${dist.toFixed(1)} km`;
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
    gap: 12,
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  map: {
    flex: 1,
  },
  clientMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.cardWhite,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  providerMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: Colors.cardWhite,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
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
  bottomSheet: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  providerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  providerAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  providerSpecialty: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.dangerRed,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    height: 48,
  },
  cancelButtonDisabled: {
    opacity: 0.7,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dangerRed,
  },
});
