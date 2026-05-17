import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

interface ActiveJob {
  id: string;
  category: string;
  description: string;
  status: string;
  client_user_id: string;
  client_latitude: number | null;
  client_longitude: number | null;
  client_address: string | null;
}

interface ClientProfile {
  full_name: string;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
};

export default function ActiveScreen() {
  const mapRef = useRef<MapView>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [providerCoord, setProviderCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  useEffect(() => {
    loadActiveJob();
    requestProviderLocation();
  }, []);

  async function requestProviderLocation() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    setLocationGranted(true);
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setProviderCoord({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
  }

  async function loadActiveJob() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('service_requests')
      .select('id, category, description, status, client_user_id, client_latitude, client_longitude, client_address')
      .eq('provider_user_id', user.id)
      .in('status', ['accepted', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      setActiveJob(data as ActiveJob);
      loadClientProfile(data.client_user_id);

      const clientCoord =
        data.client_latitude && data.client_longitude
          ? { latitude: data.client_latitude, longitude: data.client_longitude }
          : null;

      if (clientCoord) {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
        const provider = loc ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude } : clientCoord;

        const midLat = (provider.latitude + clientCoord.latitude) / 2;
        const midLng = (provider.longitude + clientCoord.longitude) / 2;
        const latDelta = Math.abs(provider.latitude - clientCoord.latitude) * 2.5 + 0.01;
        const lngDelta = Math.abs(provider.longitude - clientCoord.longitude) * 2.5 + 0.01;

        setTimeout(() => {
          mapRef.current?.animateToRegion(
            { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta },
            800
          );
        }, 500);
      }
    }
    setLoading(false);
  }

  async function loadClientProfile(clientUserId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', clientUserId)
      .single();
    if (data) setClientProfile(data as ClientProfile);
  }

  async function handleCompleteJob() {
    if (!activeJob) return;
    Alert.alert(
      'Concluir serviço',
      'Confirme que o serviço foi concluído.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: 'default',
          onPress: async () => {
            setCompleting(true);
            const { error } = await supabase
              .from('service_requests')
              .update({ status: 'completed' })
              .eq('id', activeJob.id);
            setCompleting(false);
            if (!error) {
              setActiveJob(null);
              setClientProfile(null);
              Alert.alert('Serviço concluído!', 'Parabéns! O serviço foi marcado como concluído.');
            } else {
              Alert.alert('Erro', 'Não foi possível concluir o serviço. Tente novamente.');
            }
          },
        },
      ]
    );
  }

  function handleOpenMaps() {
    if (!activeJob?.client_latitude || !activeJob?.client_longitude) return;
    const lat = activeJob.client_latitude;
    const lng = activeJob.client_longitude;
    const label = encodeURIComponent(clientProfile?.full_name ?? 'Cliente');

    const url = Platform.OS === 'ios'
      ? `maps:0,0?q=${label}@${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;

    Linking.openURL(url).catch(() => {
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      Linking.openURL(googleMapsUrl);
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
    if (dist < 1) return `${(dist * 1000).toFixed(0)} m`;
    return `${dist.toFixed(1)} km`;
  }

  const clientCoord =
    activeJob?.client_latitude && activeJob?.client_longitude
      ? { latitude: activeJob.client_latitude, longitude: activeJob.client_longitude }
      : null;

  const distance =
    providerCoord && clientCoord ? calcDistance(providerCoord, clientCoord) : '—';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando...</Text>
      </View>
    );
  }

  if (!activeJob) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="navigate-outline" size={40} color={Colors.textSecondary} />
        </View>
        <Text style={styles.emptyTitle}>Nenhum serviço em andamento</Text>
        <Text style={styles.emptySubtitle}>
          Aceite um chamado na aba "Chamados" para ver o serviço aqui.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={
          providerCoord
            ? { ...providerCoord, latitudeDelta: 0.04, longitudeDelta: 0.04 }
            : clientCoord
            ? { ...clientCoord, latitudeDelta: 0.04, longitudeDelta: 0.04 }
            : DEFAULT_REGION
        }
        showsUserLocation={locationGranted}
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {providerCoord && (
          <Marker coordinate={providerCoord} title="Você" anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.providerMarker}>
              <Ionicons name="person" size={16} color={Colors.cardWhite} />
            </View>
          </Marker>
        )}

        {clientCoord && (
          <Marker coordinate={clientCoord} title={clientProfile?.full_name ?? 'Cliente'} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.clientMarker}>
              <Ionicons name="location" size={20} color={Colors.cardWhite} />
            </View>
          </Marker>
        )}

        {providerCoord && clientCoord && (
          <Polyline
            coordinates={[providerCoord, clientCoord]}
            strokeColor={Colors.darkNavy}
            strokeWidth={3}
            lineDashPattern={[8, 4]}
          />
        )}
      </MapView>

      <View style={styles.bottomSheet}>
        <View style={styles.bottomSheetHandle} />

        <View style={styles.clientRow}>
          <View style={styles.clientAvatar}>
            <Text style={styles.clientAvatarText}>
              {clientProfile?.full_name?.charAt(0).toUpperCase() ?? 'C'}
            </Text>
          </View>
          <View style={styles.clientInfo}>
            <Text style={styles.clientName}>{clientProfile?.full_name ?? 'Cliente'}</Text>
            <Text style={styles.clientAddress}>
              {activeJob.client_address ?? activeJob.category
                ? CATEGORY_LABELS[activeJob.category] ?? activeJob.category
                : 'Endereço não informado'}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: '#EFF6FF' }]}>
            <Text style={[styles.statusText, { color: '#3B82F6' }]}>
              {activeJob.status === 'accepted' ? 'A caminho' : 'Em serviço'}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="navigate-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>Distância</Text>
            <Text style={styles.statValue}>{distance}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="time-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>ETA</Text>
            <Text style={styles.statValue}>~18 min</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Ionicons name="construct-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>Serviço</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {CATEGORY_LABELS[activeJob.category] ?? activeJob.category}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.completeButton, completing && styles.buttonDisabled]}
            onPress={handleCompleteJob}
            disabled={completing}
          >
            {completing ? (
              <ActivityIndicator color={Colors.cardWhite} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={Colors.cardWhite} />
                <Text style={styles.completeButtonText}>Marcar como concluído</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {clientCoord && (
          <TouchableOpacity style={styles.mapsButton} onPress={handleOpenMaps}>
            <Ionicons name="map-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.mapsButtonText}>Ver rota no Maps</Text>
          </TouchableOpacity>
        )}
      </View>
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
    gap: 12,
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: Colors.background,
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
  map: {
    flex: 1,
  },
  providerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
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
  clientMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dangerRed,
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
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  clientAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  clientAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  clientInfo: {
    flex: 1,
  },
  clientName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  clientAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
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
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionsRow: {
    marginBottom: 10,
  },
  completeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.successGreen,
    borderRadius: 12,
    height: 52,
    shadowColor: Colors.successGreen,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  completeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  mapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.background,
    borderRadius: 12,
    height: 46,
    borderWidth: 1.5,
    borderColor: Colors.darkNavy,
  },
  mapsButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.darkNavy,
  },
});
