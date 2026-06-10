import { useState, useEffect, useRef, useCallback } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { authHeaders } from '@/lib/api';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

// Jobs confirmed or dismissed by the provider this session — won't reappear on focus.
const dismissedJobIds = new Set<string>();

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
  acessibilidade: 'Adaptações de Acessibilidade',
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
  const [jobPhotos, setJobPhotos] = useState<{ url: string; photo_type: string }[]>([]);
  const [uploadingStage, setUploadingStage] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  // Reload job data every time the tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadActiveJob();
    }, [])
  );

  // Cleanup location on unmount only
  useEffect(() => {
    return () => {
      locationSubRef.current?.remove();
    };
  }, []);

  // Carrega as fotos (com a etapa) sempre que há um serviço ativo, para exibir
  // as galerias por etapa e calcular o que já foi enviado.
  const loadPhotos = useCallback(async (jobId: string) => {
    const { data } = await supabase
      .from('request_photos')
      .select('url, photo_type')
      .eq('request_id', jobId)
      .order('created_at');
    if (data) setJobPhotos(data as { url: string; photo_type: string }[]);
  }, []);

  useEffect(() => {
    if (!activeJob?.id) { setJobPhotos([]); return; }
    loadPhotos(activeJob.id);
  }, [activeJob?.id, activeJob?.status, loadPhotos]);

  // Realtime subscription for the active job
  // Usa timestamp no nome do canal para evitar conflito ao re-subscrever o mesmo job
  useEffect(() => {
    if (!activeJob?.id) return;
    const channelName = `active_job_${activeJob.id}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
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

  // Poll every 5s while job is completed and payment not yet confirmed
  useEffect(() => {
    if (!activeJob?.id || activeJob.status !== 'completed' || activeJob.payment_status === 'confirmed') return;
    const interval = setInterval(async () => {
      if (!userIdRef.current) return;
      const { data } = await supabase
        .from('service_requests')
        .select('id, category, description, status, client_user_id, latitude, longitude, payment_status, quote_amount')
        .eq('id', activeJob.id)
        .single();
      if (data) {
        if (data.payment_status === 'confirmed') {
          setActiveJob(null);
          setClientProfile(null);
        } else {
          setActiveJob(data as ActiveJob);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeJob?.id, activeJob?.status, activeJob?.payment_status]);

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
      // Show completed job only while payment is not yet confirmed
      const { data: completedData } = await supabase
        .from('service_requests')
        .select(SELECT)
        .eq('provider_user_id', user.id)
        .eq('status', 'completed')
        .neq('payment_status', 'confirmed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (completedData && completedData.payment_status !== 'confirmed' && !dismissedJobIds.has(completedData.id)) {
        setActiveJob(completedData as ActiveJob);
        loadClientProfile(completedData.client_user_id);
      } else {
        setActiveJob(null);
        setClientProfile(null);
      }
    }
    setLoading(false);
  }

  async function startLocationTracking(userId: string) {
    try {
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

      // Accuracy.Balanced evita o diálogo de "alta precisão" do Google Play
      // Services (que pode entrar em loop quando as configs não o satisfazem).
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        async (loc) => {
          try {
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
          } catch (e) {
            console.warn('[location] falha ao atualizar posição:', e);
          }
        }
      );
    } catch (e) {
      // Não trava o fluxo do serviço se a localização não estiver disponível.
      console.warn('[location] rastreamento indisponível:', e);
    }
  }

  async function loadClientProfile(clientUserId: string) {
    const { data } = await supabase
      .from('app_users')
      .select('full_name')
      .eq('id', clientUserId)
      .maybeSingle();
    if (data) setClientProfile(data as ClientProfile);
  }

  async function uploadJobPhoto(
    jobId: string,
    type: 'provider_arrival' | 'provider_start' | 'provider_end',
    base64: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/photos/upload`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          request_id: jobId,
          photo_type: type,
          file_data: base64,
          file_name: `${type}_${Date.now()}.jpg`,
          mime_type: 'image/jpeg',
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Captura e envia uma foto para uma etapa (até 5 por etapa). Recarrega a
  // galeria e, na chegada, avisa que o cliente foi notificado.
  async function captureForStage(type: 'provider_arrival' | 'provider_start' | 'provider_end') {
    if (!activeJob) return;
    const count = jobPhotos.filter((p) => p.photo_type === type).length;
    if (count >= 5) {
      Alert.alert('Limite atingido', 'Você pode enviar até 5 fotos por etapa.');
      return;
    }
    const canUseCamera = await requestCameraPermission();
    if (!canUseCamera) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (result.canceled || !result.assets[0].base64) return;
    setUploadingStage(type);
    const ok = await uploadJobPhoto(activeJob.id, type, result.assets[0].base64);
    if (ok) {
      await loadPhotos(activeJob.id);
      if (type === 'provider_arrival') {
        Alert.alert('Chegada registrada', 'O cliente foi avisado de que você chegou.');
      }
    } else {
      Alert.alert('Falha no envio', 'Não foi possível enviar a foto. Tente novamente.');
    }
    setUploadingStage(null);
  }

  async function handleStartJob() {
    if (!activeJob || !userIdRef.current) return;
    const startCount = jobPhotos.filter((p) => p.photo_type === 'provider_start').length;
    if (startCount === 0) {
      Alert.alert('Foto obrigatória', 'Adicione ao menos 1 foto de início para começar o serviço.');
      return;
    }

    setStarting(true);
    try {
      const { error } = await supabase
        .from('service_requests')
        .update({ status: 'in_progress' })
        .eq('id', activeJob.id)
        .eq('provider_user_id', userIdRef.current)
        .eq('status', 'accepted');

      if (!error) {
        setActiveJob((prev) => (prev ? { ...prev, status: 'in_progress' } : null));
        // Push notification via API (fire and forget)
        authHeaders({ 'Content-Type': 'application/json' }).then((headers) =>
          fetch(`${API_BASE}/service-requests/${activeJob.id}/start`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ provider_user_id: userIdRef.current }),
          })
        ).catch(() => {});
        Alert.alert('Serviço iniciado!', 'O cliente foi notificado. Bom trabalho!');
      } else {
        Alert.alert('Erro', 'Não foi possível iniciar o serviço.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setStarting(false);
  }

  async function handleCompleteJob() {
    if (!activeJob || !userIdRef.current) return;
    const endCount = jobPhotos.filter((p) => p.photo_type === 'provider_end').length;
    if (endCount === 0) {
      Alert.alert('Foto obrigatória', 'Adicione ao menos 1 foto do término para concluir o serviço.');
      return;
    }

    setCompleting(true);
    try {
      const { error } = await supabase
        .from('service_requests')
        .update({ status: 'completed' })
        .eq('id', activeJob.id)
        .eq('provider_user_id', userIdRef.current);

      setCompleting(false);
      if (!error) {
        setActiveJob((prev) => (prev ? { ...prev, status: 'completed' } : null));
        // Push notification via API (fire and forget)
        authHeaders({ 'Content-Type': 'application/json' }).then((headers) =>
          fetch(`${API_BASE}/service-requests/${activeJob.id}/complete`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ provider_user_id: userIdRef.current }),
          })
        ).catch(() => {});
        Alert.alert('Serviço concluído!', 'Parabéns! Aguarde o pagamento do cliente.');
      } else {
        Alert.alert('Erro', 'Não foi possível concluir o serviço.');
      }
    } catch {
      setCompleting(false);
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
  }

  function renderStageSection(
    type: 'provider_arrival' | 'provider_start' | 'provider_end',
    label: string,
    required: boolean,
  ) {
    const stagePhotos = jobPhotos.filter((p) => p.photo_type === type);
    const uploading = uploadingStage === type;
    return (
      <View style={styles.stageSection}>
        <View style={styles.stageHeader}>
          <Text style={styles.stageLabel}>
            {label}{' '}
            {required
              ? <Text style={styles.stageRequired}>* obrigatória</Text>
              : <Text style={styles.stageOptional}>(opcional)</Text>}
          </Text>
          <Text style={styles.stageCount}>{stagePhotos.length}/5</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
          {stagePhotos.map((p, i) => (
            <TouchableOpacity key={i} onPress={() => setPhotoViewer(p.url)} activeOpacity={0.85}>
              <Image source={{ uri: p.url }} style={styles.stageThumb} />
            </TouchableOpacity>
          ))}
          {stagePhotos.length < 5 && (
            <TouchableOpacity
              style={styles.addStagePhotoBtn}
              onPress={() => captureForStage(type)}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={`Adicionar foto de ${label}`}
            >
              {uploading
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Ionicons name="camera-outline" size={22} color={Colors.primary} />}
            </TouchableOpacity>
          )}
        </ScrollView>
        {required && stagePhotos.length === 0 && (
          <Text style={styles.stageHint}>Adicione ao menos 1 foto para liberar o próximo passo.</Text>
        )}
      </View>
    );
  }

  async function handleConfirmPayment() {
    if (!activeJob) return;
    setConfirmingPayment(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setConfirmingPayment(false); return; }

      const { error, data: updated } = await supabase
        .from('service_requests')
        .update({ payment_status: 'confirmed' })
        .eq('id', activeJob.id)
        .eq('provider_user_id', user.id)
        .in('payment_status', ['client_paid', 'confirmed'])
        .select('id');

      if (!error && updated && updated.length > 0) {
        locationSubRef.current?.remove();
        locationSubRef.current = null;
        dismissedJobIds.add(activeJob.id);
        setActiveJob(null);
        setClientProfile(null);
        Alert.alert('Pagamento confirmado!', 'O pagamento foi recebido. Obrigado!');
      } else {
        Alert.alert('Erro', 'Não foi possível confirmar o pagamento. Verifique se o pagamento do cliente foi registrado.');
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
  const startReady = jobPhotos.some((p) => p.photo_type === 'provider_start');
  const endReady = jobPhotos.some((p) => p.photo_type === 'provider_end');
  const paymentClientPaid = activeJob.payment_status === 'client_paid';
  const paymentConfirmed = activeJob.payment_status === 'confirmed';

  // ── Completed state: show a card instead of the map ──────────────────────
  if (isCompleted) {
    return (
      <View style={styles.completedScreen}>
        <View style={styles.completedHeader}>
          <Ionicons name="checkmark-circle" size={28} color={Colors.successGreen} />
          <Text style={styles.completedHeaderTitle}>Serviço concluído</Text>
        </View>

        <TouchableOpacity
          style={styles.completedCard}
          onPress={() => router.push(`/job/${activeJob.id}`)}
          activeOpacity={0.85}
        >
          <View style={styles.completedCardTop}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>
                {CATEGORY_LABELS[activeJob.category] ?? activeJob.category}
              </Text>
            </View>
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark-done-outline" size={13} color={Colors.successGreen} />
              <Text style={styles.doneBadgeText}>Concluído</Text>
            </View>
          </View>

          <View style={styles.completedClientRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {clientProfile?.full_name?.charAt(0).toUpperCase() ?? 'C'}
              </Text>
            </View>
            <View>
              <Text style={styles.completedClientName}>{clientProfile?.full_name ?? 'Cliente'}</Text>
              {activeJob.quote_amount != null && (
                <Text style={styles.completedAmount}>
                  R$ {Number(activeJob.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </Text>
              )}
            </View>
          </View>

          {jobPhotos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photosRow}
              style={styles.photosScroll}
            >
              {jobPhotos.map((p, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setPhotoViewer(p.url)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: p.url }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {paymentConfirmed ? (
            <View style={styles.paymentSentChip}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.successGreen} />
              <Text style={styles.paymentSentChipText}>Pagamento confirmado!</Text>
            </View>
          ) : paymentClientPaid ? (
            <View style={styles.paymentSentChip}>
              <Ionicons name="cash-outline" size={14} color={Colors.successGreen} />
              <Text style={styles.paymentSentChipText}>Pagamento enviado pelo cliente</Text>
            </View>
          ) : (
            <View style={styles.paymentPendingChip}>
              <Ionicons name="hourglass-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.paymentPendingChipText}>Aguardando pagamento do cliente</Text>
            </View>
          )}

          <View style={styles.openHistoryRow}>
            <Text style={styles.openHistoryText}>Ver detalhes do serviço</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
          </View>
        </TouchableOpacity>

        {paymentClientPaid && !paymentConfirmed && (
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

        {paymentConfirmed && (
          <TouchableOpacity
            style={styles.confirmPaymentBtn}
            onPress={() => {
              dismissedJobIds.add(activeJob.id);
              setActiveJob(null);
              router.push('/(tabs)/history');
            }}
          >
            <Ionicons name="time-outline" size={18} color={Colors.cardWhite} />
            <Text style={styles.confirmPaymentBtnText}>Ir para histórico</Text>
          </TouchableOpacity>
        )}

        {!paymentClientPaid && !paymentConfirmed && (
          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={() => {
              dismissedJobIds.add(activeJob.id);
              setActiveJob(null);
            }}
          >
            <Text style={styles.dismissBtnText}>Dispensar card</Text>
          </TouchableOpacity>
        )}

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
          <>
            {renderStageSection('provider_arrival', 'Chegada ao cliente', false)}
            {renderStageSection('provider_start', 'Início do serviço', true)}
            <TouchableOpacity
              style={[styles.startBtn, (starting || !startReady) && styles.disabled]}
              onPress={handleStartJob}
              disabled={starting || !startReady}
            >
              {starting ? (
                <ActivityIndicator color={Colors.cardWhite} />
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={18} color={Colors.cardWhite} />
                  <Text style={styles.startBtnText}>Iniciar serviço</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {isInProgress && (
          <>
            {renderStageSection('provider_end', 'Término do serviço', true)}
            <TouchableOpacity
              style={[styles.completeBtn, (completing || !endReady) && styles.disabled]}
              onPress={handleCompleteJob}
              disabled={completing || !endReady}
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
          </>
        )}

        {clientCoord && (
          <TouchableOpacity style={styles.mapsBtn} onPress={handleOpenMaps}>
            <Ionicons name="map-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.mapsBtnText}>Abrir rota no Maps</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

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
  dismissBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  dismissBtnText: { fontSize: 13, color: Colors.textSecondary, textDecorationLine: 'underline' },
  // Completed card screen
  completedScreen: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 60,
    paddingHorizontal: 20,
    gap: 16,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  completedHeaderTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  completedCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 4,
    gap: 12,
  },
  completedCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryBadge: { backgroundColor: '#FFF4EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  categoryBadgeText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  doneBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  doneBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.successGreen },
  completedClientRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  completedClientName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  completedAmount: { fontSize: 18, fontWeight: '800', color: Colors.successGreen, marginTop: 2 },
  photosScroll: { marginHorizontal: -2 },
  photosRow: { gap: 8, paddingHorizontal: 2 },
  photoThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: Colors.border },
  stageSection: { marginTop: 14 },
  stageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  stageLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  stageRequired: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  stageOptional: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  stageCount: { fontSize: 12, color: Colors.textSecondary },
  stageThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.border },
  addStagePhotoBtn: {
    width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF4EE',
  },
  stageHint: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  paymentSentChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ECFDF5', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: Colors.successGreen },
  paymentSentChipText: { fontSize: 13, fontWeight: '600', color: Colors.successGreen, flex: 1 },
  paymentPendingChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.background, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: Colors.border },
  paymentPendingChipText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  openHistoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  openHistoryText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  // Photo viewer
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  viewerImage: { width: '100%', height: '80%' },
});
