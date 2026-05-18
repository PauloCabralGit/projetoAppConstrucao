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
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
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
  payment_status: string | null;
  quote_amount: number | null;
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

async function requestCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Câmera necessária',
      'Precisamos da câmera para tirar a foto de evidência. Ative nas configurações do dispositivo.'
    );
    return false;
  }
  return true;
}

export default function ActiveScreen() {
  const mapRef = useRef<MapView>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const userIdRef = useRef<string | null>(null);
  const mapReadyRef = useRef(false);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [providerCoord, setProviderCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [jobPhotos, setJobPhotos] = useState<string[]>([]);
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  useEffect(() => {
    loadActiveJob();
    return () => {
      locationSubRef.current?.remove();
    };
  }, []);

  // Load photos when job is completed
  useEffect(() => {
    if (!activeJob?.id || activeJob.status !== 'completed') return;
    supabase
      .from('request_photos')
      .select('url')
      .eq('request_id', activeJob.id)
      .then(({ data }) => {
        if (data) setJobPhotos(data.map((p: any) => p.url));
      });
  }, [activeJob?.id, activeJob?.status]);

  // Realtime subscription for the active job
  useEffect(() => {
    if (!activeJob?.id) return;
    const channel = supabase
      .channel(`active_job_${activeJob.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `id=eq.${activeJob.id}` },
        (payload) => {
          setActiveJob((prev) => (prev ? { ...prev, ...(payload.new as Partial<ActiveJob>) } : null));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeJob?.id]);

  // Animate map whenever providerCoord or activeJob updates
  useEffect(() => {
    if (!providerCoord || !mapReadyRef.current) return;
    const clientCoord =
      activeJob?.latitude && activeJob?.longitude
        ? { latitude: activeJob.latitude, longitude: activeJob.longitude }
        : null;

    if (clientCoord) {
      const midLat = (providerCoord.latitude + clientCoord.latitude) / 2;
      const midLng = (providerCoord.longitude + clientCoord.longitude) / 2;
      const latDelta = Math.max(0.02, Math.abs(providerCoord.latitude - clientCoord.latitude) * 2.5);
      const lngDelta = Math.max(0.02, Math.abs(providerCoord.longitude - clientCoord.longitude) * 2.5);
      mapRef.current?.animateToRegion(
        { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta },
        600
      );
    } else {
      mapRef.current?.animateToRegion({ ...providerCoord, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);
    }
  }, [providerCoord, activeJob]);

  async function loadActiveJob() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    userIdRef.current = user.id;

    startLocationTracking(user.id);

    const SELECT = 'id, category, description, status, client_user_id, latitude, longitude, payment_status, quote_amount';

    // First look for an active/in-progress job
    const { data: activeData } = await supabase
      .from('service_requests')
      .select(SELECT)
      .eq('provider_user_id', user.id)
      .in('status', ['accepted', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeData) {
      setActiveJob(activeData as ActiveJob);
      loadClientProfile(activeData.client_user_id);
    } else {
      // Check for most recent completed job with unconfirmed payment
      const { data: completedData } = await supabase
        .from('service_requests')
        .select(SELECT)
        .eq('provider_user_id', user.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (completedData && completedData.payment_status !== 'confirmed') {
        setActiveJob(completedData as ActiveJob);
        loadClientProfile(completedData.client_user_id);
      }
    }
    setLoading(false);
  }

  async function startLocationTracking(userId: string) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permissão de localização',
        'Ative a localização nas configurações do dispositivo para rastreamento em tempo real.',
        [{ text: 'OK' }]
      );
      return;
    }

    locationSubRef.current?.remove();

    locationSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
      async (loc) => {
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
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

  async function uploadJobPhoto(jobId: string, type: 'provider_start' | 'provider_end', base64: string) {
    try {
      await fetch(`${API_BASE}/photos/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: jobId,
          photo_type: type,
          file_data: base64,
          file_name: `${type}_${Date.now()}.jpg`,
          mime_type: 'image/jpeg',
        }),
      });
    } catch {}
  }

  async function handleStartJob() {
    if (!activeJob || !userIdRef.current) return;

    const canUseCamera = await requestCameraPermission();
    if (!canUseCamera) return;

    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (result.canceled) return;

    setStarting(true);
    if (result.assets[0].base64) {
      await uploadJobPhoto(activeJob.id, 'provider_start', result.assets[0].base64);
    }

    try {
      const res = await fetch(`${API_BASE}/service-requests/${activeJob.id}/start`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_user_id: userIdRef.current }),
      });
      if (res.ok) {
        setActiveJob((prev) => (prev ? { ...prev, status: 'in_progress' } : null));
        Alert.alert('Serviço iniciado!', 'O cliente foi notificado. Bom trabalho!');
      } else {
        const json = await res.json().catch(() => ({}));
        Alert.alert('Erro', (json as any)?.message ?? 'Não foi possível iniciar o serviço.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setStarting(false);
  }

  async function handleCompleteJob() {
    if (!activeJob || !userIdRef.current) return;

    const canUseCamera = await requestCameraPermission();
    if (!canUseCamera) return;

    Alert.alert(
      'Concluir serviço',
      'Tire uma foto como evidência da conclusão antes de confirmar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Tirar foto',
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
            if (result.canceled) return;

            setCompleting(true);
            if (result.assets[0].base64) {
              await uploadJobPhoto(activeJob.id, 'provider_end', result.assets[0].base64);
            }

            try {
              const res = await fetch(`${API_BASE}/service-requests/${activeJob.id}/complete`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider_user_id: userIdRef.current }),
              });
              setCompleting(false);
              if (res.ok) {
                setActiveJob((prev) => (prev ? { ...prev, status: 'completed', payment_status: 'pending' } : null));
                Alert.alert('Serviço concluído!', 'Parabéns! Aguarde o pagamento do cliente.');
              } else {
                Alert.alert('Erro', 'Não foi possível concluir o serviço.');
              }
            } catch {
              setCompleting(false);
              Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
            }
          },
        },
      ]
    );
  }

  async function handleConfirmPayment() {
    if (!activeJob || !userIdRef.current) return;
    setConfirmingPayment(true);
    try {
      const res = await fetch(`${API_BASE}/service-requests/${activeJob.id}/payment-confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_user_id: userIdRef.current }),
      });
      if (res.ok) {
        locationSubRef.current?.remove();
        locationSubRef.current = null;
        setActiveJob(null);
        setClientProfile(null);
        Alert.alert('Pagamento confirmado!', 'O pagamento foi recebido. Obrigado!');
      } else {
        Alert.alert('Erro', 'Não foi possível confirmar o pagamento.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setConfirmingPayment(false);
  }

  function handleOpenMaps() {
    if (!activeJob?.latitude || !activeJob?.longitude) return;
    const lat = activeJob.latitude;
    const lng = activeJob.longitude;
    const label = encodeURIComponent(clientProfile?.full_name ?? 'Cliente');
    const url =
      Platform.OS === 'ios'
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

  const isAccepted = activeJob.status === 'accepted';
  const isInProgress = activeJob.status === 'in_progress';
  const isCompleted = activeJob.status === 'completed';
  const paymentClientPaid = activeJob.payment_status === 'client_paid';

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

      <ScrollView
        style={styles.bottomSheet}
        contentContainerStyle={styles.bottomSheetContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
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
          <View style={[styles.statusChip,
            isInProgress && styles.statusChipInProgress,
            isCompleted && styles.statusChipCompleted,
          ]}>
            <Text style={[styles.statusChipText,
              isInProgress && styles.statusChipTextInProgress,
              isCompleted && styles.statusChipTextCompleted,
            ]}>
              {isAccepted ? 'A caminho' : isInProgress ? 'Em serviço' : 'Concluído'}
            </Text>
          </View>
        </View>

        {!isCompleted && (
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
        )}

        {isAccepted && (
          <View style={styles.actionHint}>
            <Ionicons name="camera-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.actionHintText}>Tire uma foto ao chegar como evidência</Text>
          </View>
        )}

        {isAccepted && (
          <TouchableOpacity
            style={[styles.startBtn, starting && styles.disabled]}
            onPress={handleStartJob}
            disabled={starting}
          >
            {starting ? (
              <ActivityIndicator color={Colors.cardWhite} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={18} color={Colors.cardWhite} />
                <Text style={styles.startBtnText}>Cheguei! Iniciar serviço</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {isInProgress && (
          <View style={styles.actionHint}>
            <Ionicons name="camera-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.actionHintText}>Tire uma foto do trabalho concluído como evidência</Text>
          </View>
        )}

        {isInProgress && (
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
                <Text style={styles.completeBtnText}>Concluir serviço</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Photos section for completed jobs */}
        {isCompleted && jobPhotos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.photosSectionLabel}>
              <Ionicons name="images-outline" size={13} color={Colors.textSecondary} />
              {'  '}Fotos do serviço
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
              {jobPhotos.map((url, i) => (
                <TouchableOpacity key={i} onPress={() => setPhotoViewer(url)} activeOpacity={0.85}>
                  <Image source={{ uri: url }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Payment section for completed jobs */}
        {isCompleted && !paymentClientPaid && (
          <View style={styles.paymentWaitingCard}>
            <Ionicons name="time-outline" size={20} color={Colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentWaitingTitle}>Aguardando pagamento</Text>
              {activeJob.quote_amount != null && (
                <Text style={styles.paymentWaitingAmount}>
                  R$ {Number(activeJob.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </Text>
              )}
              <Text style={styles.paymentWaitingHint}>Aguarde o cliente enviar o pagamento.</Text>
            </View>
          </View>
        )}

        {isCompleted && paymentClientPaid && (
          <View style={styles.paymentReceivedCard}>
            <Ionicons name="cash-outline" size={20} color={Colors.successGreen} />
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentReceivedTitle}>Pagamento enviado pelo cliente!</Text>
              {activeJob.quote_amount != null && (
                <Text style={styles.paymentReceivedAmount}>
                  R$ {Number(activeJob.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </Text>
              )}
            </View>
          </View>
        )}

        {isCompleted && paymentClientPaid && (
          <TouchableOpacity
            style={[styles.confirmPaymentBtn, confirmingPayment && styles.disabled]}
            onPress={handleConfirmPayment}
            disabled={confirmingPayment}
          >
            {confirmingPayment ? (
              <ActivityIndicator color={Colors.cardWhite} />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={Colors.cardWhite} />
                <Text style={styles.confirmPaymentBtnText}>Confirmar recebimento</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {!isCompleted && clientCoord && (
          <TouchableOpacity style={styles.mapsBtn} onPress={handleOpenMaps}>
            <Ionicons name="map-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.mapsBtnText}>Abrir rota no Maps</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={photoViewer !== null} transparent animationType="fade" onRequestClose={() => setPhotoViewer(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setPhotoViewer(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photoViewer && (
            <Image source={{ uri: photoViewer }} style={styles.viewerImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.background,
    paddingHorizontal: 32,
  },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  map: { flex: 1 },
  providerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.cardWhite,
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
    elevation: 4,
  },
  bottomSheet: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
    maxHeight: '55%',
  },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    gap: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  clientRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: Colors.cardWhite },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  clientSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  statusChip: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipInProgress: { backgroundColor: '#FFF4EE' },
  statusChipCompleted: { backgroundColor: '#ECFDF5' },
  statusChipText: { fontSize: 12, fontWeight: '600', color: '#3B82F6' },
  statusChipTextInProgress: { color: Colors.primary },
  statusChipTextCompleted: { color: Colors.successGreen },
  statsRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 12, padding: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  divider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  actionHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionHintText: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 52,
    elevation: 4,
  },
  startBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.successGreen,
    borderRadius: 12,
    height: 52,
  },
  completeBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  disabled: { opacity: 0.7 },
  mapsBtn: {
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
  mapsBtnText: { fontSize: 14, fontWeight: '700', color: Colors.darkNavy },
  // Payment styles
  paymentWaitingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  paymentWaitingTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  paymentWaitingAmount: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4 },
  paymentWaitingHint: { fontSize: 12, color: Colors.textSecondary },
  paymentReceivedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.successGreen,
  },
  paymentReceivedTitle: { fontSize: 14, fontWeight: '700', color: Colors.successGreen, marginBottom: 2 },
  paymentReceivedAmount: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  confirmPaymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.successGreen,
    borderRadius: 12,
    height: 52,
    elevation: 4,
  },
  confirmPaymentBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  photosSection: { gap: 6 },
  photosSectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  photosRow: { gap: 8, paddingRight: 4 },
  photoThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.border },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  viewerImage: { width: '100%', height: '80%' },
});
