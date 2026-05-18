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
  Modal,
  TextInput,
  Image,
  ScrollView,
  Share,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

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
  latitude: number | null;
  longitude: number | null;
  quote_amount: number | null;
  quote_notes: string | null;
  quote_status: string | null;
  counter_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  client_rating: number | null;
}

interface ProviderLocation {
  latitude: number;
  longitude: number;
  heading: number;
}

interface ProviderProfile {
  full_name: string;
  specialties: string;
  pix_key: string | null;
}

interface RequestPhoto {
  url: string;
  photo_type: string;
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
  const [photos, setPhotos] = useState<RequestPhoto[]>([]);
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);
  const [ratingModal, setRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Quote negotiation state
  const [acceptingQuote, setAcceptingQuote] = useState(false);
  const [countering, setCountering] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counterInput, setCounterInput] = useState('');

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | 'card'>('pix');
  const [sendingPayment, setSendingPayment] = useState(false);
  const [generatingPix, setGeneratingPix] = useState(false);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixCopiaECola, setPixCopiaECola] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadRequest();
    loadPhotos();
    const cleanupRequest = subscribeToRequest();
    return () => { cleanupRequest(); };
  }, [id]);

  useEffect(() => {
    if (!request?.provider_user_id) return;
    loadProviderProfile(request.provider_user_id);
    const cleanupLocation = subscribeToProviderLocation(request.provider_user_id);
    return () => { cleanupLocation(); };
  }, [request?.provider_user_id]);

  useEffect(() => {
    if (providerLocation) {
      pulseMarker();
      if (request?.latitude && request?.longitude) {
        const midLat = (providerLocation.latitude + request.latitude) / 2;
        const midLng = (providerLocation.longitude + request.longitude) / 2;
        const latDelta = Math.abs(providerLocation.latitude - request.latitude) * 2 + 0.01;
        const lngDelta = Math.abs(providerLocation.longitude - request.longitude) * 2 + 0.01;
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
      .select(
        'id, category, description, status, provider_user_id, latitude, longitude, quote_amount, quote_notes, quote_status, counter_amount, payment_status, payment_method, client_rating'
      )
      .eq('id', id)
      .single();

    if (!error && data) {
      setRequest(data as ServiceRequest);
    }
    setLoading(false);
  }

  async function loadPhotos() {
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/photos`);
      if (res.ok) {
        const data = await res.json();
        setPhotos(data.photos ?? []);
      }
    } catch {}
  }

  async function loadProviderProfile(providerUserId: string) {
    const [userRes, skillsRes] = await Promise.all([
      supabase.from('app_users').select('full_name, pix_key').eq('id', providerUserId).maybeSingle(),
      supabase.from('provider_skills').select('skills(label)').eq('provider_user_id', providerUserId),
    ]);
    const specialties = ((skillsRes.data ?? []) as any[])
      .map((ps) => ps.skills?.label)
      .filter(Boolean)
      .join(', ');
    if (userRes.data) {
      setProviderProfile({
        full_name: userRes.data.full_name,
        specialties,
        pix_key: (userRes.data as any).pix_key ?? null,
      });
    }
  }

  function subscribeToRequest() {
    const channel = supabase
      .channel(`service_request_${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new as ServiceRequest;
          setRequest(updated);
          if (updated.status === 'completed' && updated.client_rating == null) {
            setSelectedRating(0);
            setRatingModal(true);
          }
          if (updated.status === 'in_progress') {
            loadPhotos();
          }
          if (updated.payment_status === 'confirmed') {
            Alert.alert('Pagamento confirmado!', 'O prestador confirmou o recebimento do pagamento.');
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  function subscribeToProviderLocation(providerUserId: string) {
    supabase
      .from('provider_locations')
      .select('latitude, longitude, heading')
      .eq('user_id', providerUserId)
      .single()
      .then(({ data }) => { if (data) setProviderLocation(data as ProviderLocation); });

    const channel = supabase
      .channel(`provider_location_${providerUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_locations', filter: `user_id=eq.${providerUserId}` },
        (payload) => { setProviderLocation(payload.new as ProviderLocation); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }

  async function handleAcceptQuote() {
    if (!request) return;
    setAcceptingQuote(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const res = await fetch(`${API_BASE}/service-requests/${id}/accept-quote`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_user_id: user?.id }),
      });
      if (res.ok) {
        setRequest(prev => prev ? { ...prev, status: 'accepted' as RequestStatus, quote_status: 'accepted' } : null);
      } else {
        Alert.alert('Erro', 'Não foi possível aceitar o orçamento. Tente novamente.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setAcceptingQuote(false);
  }

  async function handleCounter() {
    const amount = parseFloat(counterInput.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Valor inválido', 'Digite um valor válido para a contra-proposta.');
      return;
    }
    setCountering(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const res = await fetch(`${API_BASE}/service-requests/${id}/counter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_user_id: user?.id, counter_amount: amount }),
      });
      if (res.ok) {
        setRequest(prev => prev ? { ...prev, quote_status: 'negotiating', counter_amount: amount } : null);
        setShowCounterModal(false);
        setCounterInput('');
      } else {
        Alert.alert('Erro', 'Não foi possível enviar a contra-proposta.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setCountering(false);
  }

  async function handleGeneratePix() {
    setGeneratingPix(true);
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/create-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json() as any;
      if (res.ok && data.qrCode) {
        setPixCopiaECola(data.qrCode);
        setPixQrCode(data.qrCodeBase64);
      } else if (res.status === 503) {
        Alert.alert('Pagamento Pix', 'A integração com Mercado Pago ainda não foi configurada. Use outro método de pagamento ou entre em contato com o prestador.');
      } else {
        Alert.alert('Erro', data.message ?? 'Não foi possível gerar o QR Code Pix.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setGeneratingPix(false);
  }

  async function handleSendPayment() {
    if (!request) return;
    setSendingPayment(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const res = await fetch(`${API_BASE}/service-requests/${id}/payment-send`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_user_id: user?.id, payment_method: paymentMethod }),
      });
      if (res.ok) {
        setRequest(prev => prev ? { ...prev, payment_status: 'client_paid', payment_method: paymentMethod } : null);
      } else {
        Alert.alert('Erro', 'Não foi possível registrar o pagamento. Tente novamente.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setSendingPayment(false);
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
            const { data: { user } } = await supabase.auth.getUser();
            try {
              const res = await fetch(`${API_BASE}/service-requests/${id}/cancel`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_user_id: user?.id }),
              });
              setCancelling(false);
              if (res.ok) {
                router.back();
              } else {
                Alert.alert('Erro', 'Não foi possível cancelar o pedido.');
              }
            } catch {
              setCancelling(false);
              Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
            }
          },
        },
      ]
    );
  }

  async function handleSubmitRating() {
    if (selectedRating === 0) {
      Alert.alert('Selecione uma nota', 'Toque em uma estrela para avaliar.');
      return;
    }
    setSubmittingRating(true);
    const { data: { user } } = await supabase.auth.getUser();
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selectedRating, client_user_id: user?.id }),
      });
      const json = await res.json();
      if (res.ok) {
        setRequest(prev => prev ? { ...prev, client_rating: selectedRating } : null);
        setRatingModal(false);
        Alert.alert('Avaliação enviada!', `Você avaliou com ${selectedRating} estrela${selectedRating !== 1 ? 's' : ''}. Obrigado!`);
      } else {
        Alert.alert('Erro', json?.message ?? 'Não foi possível enviar a avaliação.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setSubmittingRating(false);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Carregando rastreamento...</Text>
      </View>
    );
  }

  const statusConf = request
    ? (STATUS_CONFIG[request.status] ?? STATUS_CONFIG.requested)
    : STATUS_CONFIG.requested;

  const clientCoord =
    request?.latitude && request?.longitude
      ? { latitude: request.latitude, longitude: request.longitude }
      : null;

  const providerCoord = providerLocation
    ? { latitude: providerLocation.latitude, longitude: providerLocation.longitude }
    : null;

  const markerScale = markerAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });

  const clientPhotos = photos.filter((p) => p.photo_type === 'client_request');
  const providerStartPhotos = photos.filter((p) => p.photo_type === 'provider_start');
  const providerEndPhotos = photos.filter((p) => p.photo_type === 'provider_end');

  const showQuoteCard =
    request?.quote_status === 'quoted' &&
    request?.status !== 'accepted' &&
    request?.status !== 'completed' &&
    request?.status !== 'cancelled';

  const showNegotiatingCard =
    request?.quote_status === 'negotiating' &&
    request?.status !== 'accepted' &&
    request?.status !== 'completed';

  const isCompleted = request?.status === 'completed';
  const paymentSent = request?.payment_status === 'client_paid';
  const paymentConfirmed = request?.payment_status === 'confirmed';
  const needsPayment = isCompleted && !paymentSent && !paymentConfirmed;

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
          <Marker
            coordinate={providerCoord}
            title={providerProfile?.full_name ?? 'Profissional'}
            anchor={{ x: 0.5, y: 0.5 }}
          >
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

      <ScrollView
        style={styles.bottomSheetScroll}
        contentContainerStyle={styles.bottomSheetContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.bottomSheetHandle} />

        {/* Quote card — provider sent a quote, client can accept or counter */}
        {showQuoteCard && (
          <View style={styles.quoteCard}>
            <View style={styles.quoteCardHeader}>
              <Ionicons name="pricetag-outline" size={18} color={Colors.successGreen} />
              <Text style={styles.quoteCardTitle}>Orçamento recebido</Text>
            </View>
            <Text style={styles.quoteCardAmount}>
              R$ {request!.quote_amount != null ? Number(request!.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
            </Text>
            {!!request?.quote_notes && (
              <Text style={styles.quoteCardNotes}>{request.quote_notes}</Text>
            )}
            <View style={styles.quoteCardButtons}>
              <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => setShowCounterModal(true)}
              >
                <Text style={styles.counterBtnText}>Contra-proposta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.acceptQuoteBtn, acceptingQuote && styles.btnDisabled]}
                onPress={handleAcceptQuote}
                disabled={acceptingQuote}
              >
                {acceptingQuote ? (
                  <ActivityIndicator color={Colors.cardWhite} size="small" />
                ) : (
                  <Text style={styles.acceptQuoteBtnText}>Aceitar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Negotiating — client sent counter, waiting for provider */}
        {showNegotiatingCard && (
          <View style={styles.negotiatingCard}>
            <Ionicons name="swap-horizontal-outline" size={18} color={Colors.warningAmber} />
            <Text style={styles.negotiatingText}>
              Contra-proposta enviada: R${' '}
              {request!.counter_amount != null ? Number(request!.counter_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
              {' '}· Aguardando o profissional...
            </Text>
          </View>
        )}

        {/* Provider row */}
        <View style={styles.providerRow}>
          <View style={styles.providerAvatar}>
            <Text style={styles.providerAvatarText}>
              {providerProfile ? providerProfile.full_name.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>
              {providerProfile?.full_name ??
                (request?.provider_user_id ? 'Profissional' : 'Aguardando...')}
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

        {/* Stats */}
        {!isCompleted && (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Ionicons name="time-outline" size={20} color={Colors.primary} />
              <Text style={styles.statLabel}>ETA</Text>
              <Text style={styles.statValue}>
                {providerCoord && clientCoord
                  ? (() => {
                      const km = calcDistance(providerCoord, clientCoord);
                      if (km < 0.05) return 'Chegou!';
                      return `~${Math.max(1, Math.ceil((km / 25) * 60))} min`;
                    })()
                  : '—'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="navigate-outline" size={20} color={Colors.primary} />
              <Text style={styles.statLabel}>Distância</Text>
              <Text style={styles.statValue}>
                {providerCoord && clientCoord
                  ? (() => {
                      const km = calcDistance(providerCoord, clientCoord);
                      return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(1)} km`;
                    })()
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
        )}

        {/* Status */}
        <View style={[styles.statusBadge, { backgroundColor: statusConf.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: statusConf.color }]} />
          <Text style={[styles.statusLabel, { color: statusConf.color }]}>{statusConf.label}</Text>
        </View>

        {/* Payment section */}
        {isCompleted && paymentConfirmed && (
          <View style={styles.paymentConfirmedCard}>
            <Ionicons name="checkmark-circle" size={22} color={Colors.successGreen} />
            <Text style={styles.paymentConfirmedText}>Pagamento confirmado pelo prestador</Text>
          </View>
        )}

        {/* Rating section */}
        {isCompleted && request?.client_rating == null && (
          <TouchableOpacity style={styles.ratingBannerCard} onPress={() => { setSelectedRating(0); setRatingModal(true); }}>
            <Ionicons name="star-outline" size={22} color={Colors.warningAmber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ratingBannerTitle}>Avalie o profissional</Text>
              <Text style={styles.ratingBannerDesc}>Toque para dar sua nota de 1 a 5 estrelas</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
        {isCompleted && request?.client_rating != null && (
          <View style={styles.ratingDoneCard}>
            <Ionicons name="star" size={18} color={Colors.warningAmber} />
            <Text style={styles.ratingDoneText}>Você avaliou com {request.client_rating} estrela{request.client_rating !== 1 ? 's' : ''}</Text>
          </View>
        )}

        {isCompleted && paymentSent && !paymentConfirmed && (
          <View style={styles.paymentSentCard}>
            <Ionicons name="hourglass-outline" size={18} color={Colors.warningAmber} />
            <Text style={styles.paymentSentText}>
              Pagamento enviado! Aguardando confirmação do prestador...
            </Text>
          </View>
        )}

        {needsPayment && (
          <View style={styles.paymentCard}>
            <View style={styles.paymentCardHeader}>
              <Ionicons name="card-outline" size={18} color={Colors.darkNavy} />
              <Text style={styles.paymentCardTitle}>Realizar pagamento</Text>
            </View>
            {request!.quote_amount != null && (
              <Text style={styles.paymentCardAmount}>
                R$ {Number(request!.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </Text>
            )}
            <Text style={styles.paymentMethodLabel}>Forma de pagamento</Text>
            <View style={styles.paymentMethodRow}>
              {(['pix', 'cash', 'card'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, paymentMethod === m && styles.methodChipActive]}
                  onPress={() => setPaymentMethod(m)}
                >
                  <Ionicons
                    name={m === 'pix' ? 'qr-code-outline' : m === 'cash' ? 'cash-outline' : 'card-outline'}
                    size={16}
                    color={paymentMethod === m ? Colors.cardWhite : Colors.textPrimary}
                  />
                  <Text style={[styles.methodChipText, paymentMethod === m && styles.methodChipTextActive]}>
                    {m === 'pix' ? 'Pix' : m === 'cash' ? 'Dinheiro' : 'Cartão'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {paymentMethod === 'pix' && !pixCopiaECola && (
              <TouchableOpacity
                style={[styles.generatePixBtn, generatingPix && styles.btnDisabled]}
                onPress={handleGeneratePix}
                disabled={generatingPix}
              >
                {generatingPix ? (
                  <ActivityIndicator color={Colors.cardWhite} size="small" />
                ) : (
                  <>
                    <Ionicons name="qr-code-outline" size={18} color={Colors.cardWhite} />
                    <Text style={styles.generatePixBtnText}>Gerar QR Code Pix</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {paymentMethod === 'pix' && pixCopiaECola && (
              <View style={styles.pixQrSection}>
                {!!pixQrCode && (
                  <Image
                    source={{ uri: `data:image/png;base64,${pixQrCode}` }}
                    style={styles.pixQrImage}
                    resizeMode="contain"
                  />
                )}
                <Text style={styles.pixCopiaLabel}>Pix Copia e Cola</Text>
                <Text style={styles.pixCopiaText} numberOfLines={2}>{pixCopiaECola}</Text>
                <TouchableOpacity
                  style={styles.sharePixBtn}
                  onPress={() => Share.share({ message: pixCopiaECola })}
                >
                  <Ionicons name="copy-outline" size={16} color={Colors.darkNavy} />
                  <Text style={styles.sharePixBtnText}>Compartilhar / Copiar código</Text>
                </TouchableOpacity>
                <View style={styles.pixAwaitingRow}>
                  <ActivityIndicator size="small" color={Colors.warningAmber} />
                  <Text style={styles.pixAwaitingText}>Aguardando confirmação do banco...</Text>
                </View>
              </View>
            )}

            {paymentMethod !== 'pix' && (
              <>
                {paymentMethod === 'cash' && providerProfile?.pix_key && (
                  <View style={styles.pixKeyBox}>
                    <Text style={styles.pixKeyLabel}>Chave Pix do prestador (para referência)</Text>
                    <Text style={styles.pixKeyValue}>{providerProfile.pix_key}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.sendPaymentBtn, sendingPayment && styles.btnDisabled]}
                  onPress={handleSendPayment}
                  disabled={sendingPayment}
                >
                  {sendingPayment ? (
                    <ActivityIndicator color={Colors.cardWhite} size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={Colors.cardWhite} />
                      <Text style={styles.sendPaymentBtnText}>Confirmar pagamento enviado</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Evidence photos */}
        {clientPhotos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.photosSectionLabel}>Fotos do pedido</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
              {clientPhotos.map((p, i) => (
                <TouchableOpacity key={i} onPress={() => setPhotoViewer(p.url)} activeOpacity={0.85}>
                  <Image source={{ uri: p.url }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {providerStartPhotos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.photosSectionLabel}>Fotos do início do serviço</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
              {providerStartPhotos.map((p, i) => (
                <TouchableOpacity key={i} onPress={() => setPhotoViewer(p.url)} activeOpacity={0.85}>
                  <Image source={{ uri: p.url }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {providerEndPhotos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.photosSectionLabel}>Fotos da conclusão</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photosRow}>
              {providerEndPhotos.map((p, i) => (
                <TouchableOpacity key={i} onPress={() => setPhotoViewer(p.url)} activeOpacity={0.85}>
                  <Image source={{ uri: p.url }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Cancel button */}
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
      </ScrollView>

      {/* Counter proposal modal */}
      <Modal visible={showCounterModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sua contra-proposta</Text>
            <Text style={styles.modalSubtitle}>
              Orçamento do profissional: R${' '}
              {request?.quote_amount != null ? Number(request.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
            </Text>
            <View style={styles.modalInputRow}>
              <Text style={styles.modalCurrency}>R$</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="0,00"
                placeholderTextColor={Colors.textSecondary}
                value={counterInput}
                onChangeText={setCounterInput}
                keyboardType="numeric"
                autoFocus
              />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setShowCounterModal(false); setCounterInput(''); }}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, (countering || !counterInput) && styles.btnDisabled]}
                onPress={handleCounter}
                disabled={countering || !counterInput}
              >
                {countering ? (
                  <ActivityIndicator color={Colors.cardWhite} size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>Enviar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rating modal */}
      <Modal visible={ratingModal} transparent animationType="slide" onRequestClose={() => setRatingModal(false)}>
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingSheet}>
            <View style={styles.ratingSheetHandle} />
            <Text style={styles.ratingTitle}>Como foi o serviço?</Text>
            <Text style={styles.ratingSubtitle}>
              {providerProfile?.full_name ? `Avalie ${providerProfile.full_name}` : 'Dê sua nota para o profissional'}
            </Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setSelectedRating(star)} hitSlop={8}>
                  <Ionicons
                    name={star <= selectedRating ? 'star' : 'star-outline'}
                    size={44}
                    color={Colors.warningAmber}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {selectedRating > 0 && (
              <Text style={styles.ratingHint}>
                {selectedRating === 5 ? 'Excelente!' : selectedRating === 4 ? 'Muito bom!' : selectedRating === 3 ? 'Regular' : selectedRating === 2 ? 'Ruim' : 'Péssimo'}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.ratingSubmitBtn, (submittingRating || selectedRating === 0) && { opacity: 0.5 }]}
              onPress={handleSubmitRating}
              disabled={submittingRating || selectedRating === 0}
            >
              {submittingRating
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.ratingSubmitText}>Enviar avaliação</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setRatingModal(false)} style={{ marginTop: 8 }}>
              <Text style={styles.ratingSkipText}>Avaliar depois</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Photo viewer */}
      <Modal visible={photoViewer !== null} transparent animationType="fade" onRequestClose={() => setPhotoViewer(null)}>
        <View style={styles.photoViewerOverlay}>
          <TouchableOpacity style={styles.photoViewerClose} onPress={() => setPhotoViewer(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photoViewer && (
            <Image
              source={{ uri: photoViewer }}
              style={styles.photoViewerImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

function calcDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.background,
  },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  map: { flex: 1 },
  clientMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.cardWhite,
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
  bottomSheetScroll: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
    maxHeight: '60%',
  },
  bottomSheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    gap: 14,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  quoteCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1.5,
    borderColor: Colors.successGreen,
  },
  quoteCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quoteCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  quoteCardAmount: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  quoteCardNotes: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  quoteCardButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  counterBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.cardWhite,
  },
  counterBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  acceptQuoteBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: Colors.successGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptQuoteBtnText: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
  negotiatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.warningAmber,
  },
  negotiatingText: { fontSize: 13, color: Colors.textPrimary, flex: 1, lineHeight: 18 },
  providerRow: { flexDirection: 'row', alignItems: 'center' },
  providerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  providerAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.cardWhite },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  providerSpecialty: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ratingText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    padding: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 14, fontWeight: '700' },
  // Payment styles
  paymentCard: {
    backgroundColor: Colors.background,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderColor: Colors.darkNavy,
  },
  paymentCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentCardTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  paymentCardAmount: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  paymentMethodLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  paymentMethodRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardWhite,
  },
  methodChipActive: { backgroundColor: Colors.darkNavy, borderColor: Colors.darkNavy },
  methodChipText: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  methodChipTextActive: { color: Colors.cardWhite },
  pixKeyBox: {
    backgroundColor: '#EFF3F8',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  pixKeyLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pixKeyValue: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  pixKeyMissing: { fontSize: 13, color: Colors.textSecondary, fontStyle: 'italic' },
  generatePixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.darkNavy,
    elevation: 3,
  },
  generatePixBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  pixQrSection: { alignItems: 'center', gap: 10 },
  pixQrImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: Colors.border,
  },
  pixCopiaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    alignSelf: 'flex-start',
  },
  pixCopiaText: {
    fontSize: 11,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    width: '100%',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  sharePixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.darkNavy,
    backgroundColor: Colors.cardWhite,
    width: '100%',
  },
  sharePixBtnText: { fontSize: 14, fontWeight: '700', color: Colors.darkNavy },
  pixAwaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pixAwaitingText: { fontSize: 13, color: Colors.textSecondary },
  sendPaymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.successGreen,
    elevation: 3,
  },
  sendPaymentBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  paymentSentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.warningAmber,
  },
  paymentSentText: { fontSize: 13, color: Colors.textPrimary, flex: 1, lineHeight: 18 },
  paymentConfirmedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.successGreen,
  },
  paymentConfirmedText: { fontSize: 14, fontWeight: '600', color: Colors.successGreen, flex: 1 },
  // Rating
  ratingBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  ratingBannerTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  ratingBannerDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  ratingDoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  ratingDoneText: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  ratingOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  ratingSheet: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  ratingSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 20 },
  ratingTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6, textAlign: 'center' },
  ratingSubtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 24, textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  ratingHint: { fontSize: 16, fontWeight: '600', color: Colors.warningAmber, marginBottom: 24 },
  ratingSubmitBtn: {
    backgroundColor: Colors.darkNavy,
    borderRadius: 12,
    height: 52,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  ratingSubmitText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  ratingSkipText: { fontSize: 14, color: Colors.textSecondary, padding: 8 },
  // Photos
  photosSection: { gap: 8 },
  photosSectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  photosRow: { gap: 8, paddingRight: 4 },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: Colors.border,
  },
  photoViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoViewerClose: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  photoViewerImage: {
    width: '100%',
    height: '80%',
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
  cancelButtonDisabled: { opacity: 0.7 },
  cancelButtonText: { fontSize: 15, fontWeight: '700', color: Colors.dangerRed },
  btnDisabled: { opacity: 0.5 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { fontSize: 13, color: Colors.textSecondary },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 56,
    backgroundColor: '#FFF4EE',
  },
  modalCurrency: { fontSize: 20, fontWeight: '700', color: Colors.primary, marginRight: 4 },
  modalInput: { flex: 1, fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  modalConfirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
});
