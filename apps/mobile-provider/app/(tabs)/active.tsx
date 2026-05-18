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
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface ActiveJob {
  id: string;
  category: string;
  description: string;
  status: string;
  client_user_id: string;
  latitude: number | null;
  longitude: number | null;
}

interface ClientProfile {
  full_name: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
};

function calcDistKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(km: number): string {
  return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`;
}

function formatETA(km: number): string {
  if (km < 0.05) return 'Chegou!';
  return `~${Math.max(1, Math.ceil((km / 25) * 60))} min`;
}

export default function ActiveScreen() {
  const mapRef = useRef<MapView>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const userIdRef = useRef<string | null>(null);
  const mapReadyRef = useRef(false);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [providerCoord, setProviderCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    loadActiveJob();
    return () => {
      locationSubRef.current?.remove();
    };
  }, []);

  // Animate map whenever providerCoord updates
  useEffect(() => {
    if (!providerCoord || !mapReadyRef.current) return;
    const clientCoord = activeJob?.latitude && activeJob?.longitude
      ? { latitude: activeJob.latitude, longitude: activeJob.longitude }
      : null;

    if (clientCoord) {
      const midLat = (providerCoord.latitude + clientCoord.latitude) / 2;
      const midLng = (providerCoord.longitude + clientCoord.longitude) / 2;
      const latDelta = Math.max(0.02, Math.abs(providerCoord.latitude - clientCoord.latitude) * 2.5);
      const lngDelta = Math.max(0.02, Math.abs(providerCoord.longitude - clientCoord.longitude) * 2.5);
      mapRef.current?.animateToRegion({ latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta }, 600);
    } else {
      mapRef.current?.animateToRegion({ ...providerCoord, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);
    }
  }, [providerCoord]);

  async function loadActiveJob() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    userIdRef.current = user.id;

    // Start GPS tracking immediately — don't wait for the job query
    startLocationTracking(user.id);

    const { data } = await supabase
      .from('service_requests')
      .select('id, category, description, status, client_user_id, latitude, longitude')
      .eq('provider_user_id', user.id)
      .in('status', ['accepted', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setActiveJob(data as ActiveJob);
      loadClientProfile(data.client_user_id);
    }
    setLoading(false);
  }

  async function startLocationTracking(userId: string) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permissão de localização',
        'Precisamos da sua localização para o rastreamento em tempo real. Ative nas configurações do dispositivo.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Remove any existing subscription
    locationSubRef.current?.remove();

    // watchPositionAsync gives continuous real-time updates (like Uber/99)
    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,    // no máximo a cada 3 segundos
        distanceInterval: 5,   // ou a cada 5 metros percorridos
      },
      async (loc) => {
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setProviderCoord(coords);

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
    );
  }

  async function loadClientProfile(clientUserId: string) {
    const { data } = await supabase
      .from('app_users')
      .select('full_name')
      .eq('id', clientUserId)
      .maybeSingle();
    if (data) setClientProfile(data as ClientProfile);
  }

  async function handleCompleteJob() {
    if (!activeJob || !userIdRef.current) return;
    Alert.alert('Concluir serviço', 'Confirme que o serviço foi concluído.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          setCompleting(true);
          try {
            const res = await fetch(`${API_BASE}/service-requests/${activeJob.id}/complete`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider_user_id: userIdRef.current }),
            });
            setCompleting(false);
            if (res.ok) {
              locationSubRef.current?.remove();
              locationSubRef.current = null;
              setActiveJob(null);
              setClientProfile(null);
              Alert.alert('Serviço concluído!', 'Parabéns! O serviço foi marcado como concluído.');
            } else {
              Alert.alert('Erro', 'Não foi possível concluir o serviço.');
            }
          } catch {
            setCompleting(false);
            Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
          }
        },
      },
    ]);
  }

  function handleOpenMaps() {
    if (!activeJob?.latitude || !activeJob?.longitude) return;
    const lat = activeJob.latitude;
    const lng = activeJob.longitude;
    const label = encodeURIComponent(clientProfile?.full_name ?? 'Cliente');
    const url = Platform.OS === 'ios'
      ? `maps:0,0?q=${label}@${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    });
  }

  const clientCoord =
    activeJob?.latitude && activeJob?.longitude
      ? { latitude: activeJob.latitude, longitude: activeJob.longitude }
      : null;

  const distKm = providerCoord && clientCoord ? calcDistKm(providerCoord, clientCoord) : null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando...</Text>
      </View>
    );
  }

  if (!activeJob) {
    return (
      <View style={styles.center}>
        <View style={styles.emptyIcon}>
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
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        onMapReady={() => { mapReadyRef.current = true; }}
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
        <View style={styles.handle} />

        <View style={styles.clientRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {clientProfile?.full_name?.charAt(0).toUpperCase() ?? 'C'}
            </Text>
          </View>
          <View style={styles.clientInfo}>
            <Text style={styles.clientName}>{clientProfile?.full_name ?? 'Cliente'}</Text>
            <Text style={styles.clientSub}>
              {CATEGORY_LABELS[activeJob.category] ?? activeJob.category}
            </Text>
          </View>
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>
              {activeJob.status === 'accepted' ? 'A caminho' : 'Em serviço'}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="navigate-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>Distância</Text>
            <Text style={styles.statValue}>
              {distKm !== null ? formatDistance(distKm) : '—'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Ionicons name="time-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>ETA</Text>
            <Text style={styles.statValue}>
              {distKm !== null ? formatETA(distKm) : '—'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Ionicons name="construct-outline" size={20} color={Colors.darkNavy} />
            <Text style={styles.statLabel}>Serviço</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {CATEGORY_LABELS[activeJob.category] ?? activeJob.category}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.completeBtn, completing && styles.disabled]}
          onPress={handleCompleteJob}
          disabled={completing}
        >
          {completing ? (
            <ActivityIndicator color={Colors.cardWhite} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.cardWhite} />
              <Text style={styles.completeBtnText}>Marcar como concluído</Text>
            </>
          )}
        </TouchableOpacity>

        {clientCoord && (
          <TouchableOpacity style={styles.mapsBtn} onPress={handleOpenMaps}>
            <Ionicons name="map-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.mapsBtnText}>Abrir rota no Maps</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: Colors.background, paddingHorizontal: 32 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  map: { flex: 1 },
  providerMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: Colors.cardWhite, elevation: 4 },
  clientMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.dangerRed, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: Colors.cardWhite, elevation: 4 },
  bottomSheet: { backgroundColor: Colors.cardWhite, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 36 : 20, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 16 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  clientRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.darkNavy, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '700', color: Colors.cardWhite },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  clientSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  statusChip: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipText: { fontSize: 12, fontWeight: '600', color: '#3B82F6' },
  statsRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 12, padding: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  divider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.successGreen, borderRadius: 12, height: 52 },
  completeBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  disabled: { opacity: 0.7 },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.background, borderRadius: 12, height: 46, borderWidth: 1.5, borderColor: Colors.darkNavy },
  mapsBtnText: { fontSize: 14, fontWeight: '700', color: Colors.darkNavy },
});
