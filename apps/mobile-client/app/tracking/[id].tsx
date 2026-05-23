import { useState, useEffect, useRef, useCallback } from 'react';
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
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { useFlags } from '@/contexts/FeatureFlagsContext';

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

const CATEGORY_LABELS: Record<string, string> = {
  alvenaria: 'Alvenaria',
  hidraulica: 'Hidráulica',
  eletrica: 'Elétrica',
  pintura: 'Pintura',
  piso: 'Piso',
  acabamento: 'Acabamento',
  acessibilidade: 'Adaptações de Acessibilidade',
};

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function TrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flags = useFlags();
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

  // Complaint state
  const [complaintModal, setComplaintModal] = useState(false);
  const [complaintReason, setComplaintReason] = useState('');
  const [complaintDesc, setComplaintDesc] = useState('');
  const [submittingComplaint, setSubmittingComplaint] = useState(false);

  // Bids state
  const [bids, setBids] = useState<any[]>([]);
  const [acceptingBidId, setAcceptingBidId] = useState<string | null>(null);
  const proximityAlertedRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    loadRequest();
    loadPhotos();
    loadBids();
    const cleanupRequest = subscribeToRequest();
    const bidsChannel = supabase
      .channel(`bids-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, (payload) => {
        if ((payload.new as any)?.request_id === id || (payload.old as any)?.request_id === id) {
          loadBids();
        }
      })
      .subscribe();
    return () => { cleanupRequest(); supabase.removeChannel(bidsChannel); };
  }, [id]);

  // Reload when screen regains focus (user navigates back to this screen)
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      fetchRequest();
      loadBids();
    }, [id])
  );

  // Poll every 5s while job is not yet finished (covers requested, accepted, in_progress)
  useEffect(() => {
    const activeStatuses = ['requested', 'accepted', 'in_progress'];
    if (!id || !request?.status || !activeStatuses.includes(request.status)) return;
    const interval = setInterval(() => {
      fetchRequest();
      loadBids();
    }, 5000);
    return () => clearInterval(interval);
  }, [id, request?.status]);

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
        const dist = calcDistance(providerLocation, { latitude: request.latitude, longitude: request.longitude });
        if (dist < 0.5 && !proximityAlertedRef.current && request.status === 'accepted') {
          proximityAlertedRef.current = true;
          Alert.alert('🚗 Profissional chegando!', 'O prestador está a menos de 500 metros de você.');
        }
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

  async function fetchRequest() {
    const { data, error } = await supabase
      .from('service_requests')
      .select(
        'id, category, description, status, provider_user_id, latitude, longitude, quote_amount, quote_notes, quote_status, counter_amount, payment_status, payment_method, client_rating'
      )
      .eq('id', id)
      .single();
    if (!error && data) setRequest(data as ServiceRequest);
  }

  async function loadRequest() {
    setLoading(true);
    await fetchRequest();
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
        { event: 'UPDATE', schema: 'public', table: 'service_requests' },
        (payload) => {
          if ((payload.new as any)?.id !== id) return;
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
      const { error, data: updated } = await supabase
        .from('service_requests')
        .update({ status: 'accepted', quote_status: 'accepted' })
        .eq('id', id)
        .eq('client_user_id', user?.id)
        .eq('quote_status', 'quoted')
        .select('id');
      if (!error && updated && updated.length > 0) {
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
      const { error } = await supabase
        .from('service_requests')
        .update({ payment_status: 'client_paid', payment_method: paymentMethod })
        .eq('id', id)
        .eq('client_user_id', user?.id)
        .eq('status', 'completed');
      if (!error) {
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
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const { error } = await supabase
                .from('service_requests')
                .update({ status: 'cancelled' })
                .eq('id', id)
                .eq('client_user_id', user?.id);
              if (error) {
                Alert.alert('Erro', 'Não foi possível cancelar o pedido.');
              } else {
                router.back();
              }
            } catch {
              Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
            }
            setCancelling(false);
          },
        },
      ]
    );
  }

  async function generateAndShareReceipt() {
    if (!request) return;
    const cat = CATEGORY_LABELS[request.category] ?? request.category;
    const val = request.quote_amount != null
      ? `R$ ${Number(request.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : 'A combinar';
    const paidVia = request.payment_method === 'cash' ? 'Dinheiro' : request.payment_method === 'card' ? 'Cartão' : 'Pix';
    const payStatus = paymentConfirmed
      ? `Confirmado via ${paidVia}`
      : paymentSent ? 'Enviado — aguardando confirmação' : 'Pendente';
    const rating = request.client_rating ? `${request.client_rating}/5` : 'Não avaliado';
    const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 40px; color: #101828; background: #fff; }
  .logo { font-size: 22px; font-weight: 800; color: #FF6B35; letter-spacing: -0.5px; }
  .logo span { color: #1E2A38; }
  .divider { border: none; border-top: 2px solid #E5E7EB; margin: 20px 0; }
  .title { font-size: 18px; font-weight: 700; color: #1E2A38; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #6B7280; margin: 0 0 24px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #F3F4F6; }
  .row:last-child { border-bottom: none; }
  .label { font-size: 13px; color: #6B7280; }
  .value { font-size: 14px; font-weight: 600; color: #101828; text-align: right; max-width: 60%; }
  .amount { font-size: 24px; font-weight: 800; color: #12B76A; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; background: #ECFDF5; color: #12B76A; }
  .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #9CA3AF; }
</style>
</head>
<body>
  <div class="logo">Constru<span>Connect</span></div>
  <hr class="divider" />
  <p class="title">Recibo de Serviço</p>
  <p class="subtitle">Emitido em ${date}</p>
  <div class="row"><span class="label">Serviço</span><span class="value">${cat}</span></div>
  <div class="row"><span class="label">Profissional</span><span class="value">${providerProfile?.full_name ?? '—'}</span></div>
  <div class="row"><span class="label">Valor</span><span class="value amount">${val}</span></div>
  <div class="row"><span class="label">Forma de pagamento</span><span class="value">${paidVia}</span></div>
  <div class="row"><span class="label">Status do pagamento</span><span class="value"><span class="badge">${payStatus}</span></span></div>
  <div class="row"><span class="label">Avaliação</span><span class="value">${rating}</span></div>
  <div class="footer">ConstruConnect — Seu parceiro de obras<br/>Este recibo é gerado automaticamente pelo aplicativo.</div>
</body>
</html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Compartilhar recibo', UTI: 'com.adobe.pdf' });
      } else {
        Alert.alert('Compartilhamento indisponível', 'Seu dispositivo não suporta o compartilhamento de arquivos.');
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o PDF do recibo.');
    }
  }

  async function loadBids() {
    const { data } = await supabase
      .from('bids')
      .select('id, amount, notes, status, created_at, provider_user_id')
      .eq('request_id', id)
      .order('amount', { ascending: true });
    setBids(data ?? []);
  }

  async function handleAcceptBid(bidId: string) {
    setAcceptingBidId(bidId);
    try {
      const { data: bid, error: bidErr } = await supabase
        .from('bids')
        .select('provider_user_id, amount')
        .eq('id', bidId)
        .eq('request_id', id)
        .single();

      if (bidErr || !bid) {
        Alert.alert('Erro', 'Orçamento não encontrado.');
        setAcceptingBidId(null);
        return;
      }

      await supabase.from('bids').update({ status: 'accepted' }).eq('id', bidId);
      await supabase.from('bids').update({ status: 'rejected' }).eq('request_id', id).neq('id', bidId);

      const { error, data: updated } = await supabase
        .from('service_requests')
        .update({
          provider_user_id: bid.provider_user_id,
          quote_amount: bid.amount,
          status: 'accepted',
          quote_status: 'accepted',
        })
        .eq('id', id)
        .select('id');

      if (error || !updated || updated.length === 0) {
        Alert.alert('Erro', 'Não foi possível aceitar o orçamento.');
      } else {
        setRequest(prev =>
          prev
            ? { ...prev, status: 'accepted' as RequestStatus, quote_status: 'accepted', quote_amount: bid.amount, provider_user_id: bid.provider_user_id }
            : null
        );
        await loadBids();
        // Notifica o prestador via API (sem bloquear o fluxo)
        fetch(`${API_BASE}/service-requests/${id}/bids/${bidId}/accept`, { method: 'PATCH' }).catch(() => {});
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet.');
    }
    setAcceptingBidId(null);
  }

  async function handleSubmitComplaint() {
    if (!complaintReason) { Alert.alert('Selecione o motivo da reclamação.'); return; }
    if (!complaintDesc.trim()) { Alert.alert('Descreva o ocorrido.'); return; }
    setSubmittingComplaint(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const res = await fetch(`${API_BASE}/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: id,
          client_user_id: user?.id,
          provider_user_id: request?.provider_user_id ?? undefined,
          reason: complaintReason,
          description: complaintDesc.trim(),
        }),
      });
      if (res.ok) {
        setComplaintModal(false);
        setComplaintReason('');
        setComplaintDesc('');
        Alert.alert(
          'Reclamação enviada',
          'Nossa equipe irá analisar em breve. Deseja continuar em contato via chat?',
          [
            { text: 'Fechar', style: 'cancel' },
            { text: 'Abrir chat', onPress: () => router.push(`/chat/${id}` as any) },
          ]
        );
      } else {
        Alert.alert('Erro', 'Não foi possível registrar a reclamação. Tente novamente.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setSubmittingComplaint(false);
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

  // ── Completed state: full-screen card, no map ─────────────────────────────
  if (isCompleted && request) {
    const paymentLabel = paymentConfirmed
      ? `Pago via ${request.payment_method === 'cash' ? 'Dinheiro' : request.payment_method === 'card' ? 'Cartão' : 'Pix'}`
      : paymentSent
      ? 'Pagamento enviado — aguardando confirmação'
      : 'Aguardando pagamento';
    const paymentColor = paymentConfirmed ? Colors.successGreen : paymentSent ? Colors.warningAmber : Colors.textSecondary;
    const paymentIcon = paymentConfirmed ? 'checkmark-circle' : paymentSent ? 'hourglass-outline' : 'cash-outline';

    return (
      <View style={styles.container}>
        <View style={[styles.completedTopBar, { paddingTop: Platform.OS === 'ios' ? 56 : 36 }]}>
          <TouchableOpacity style={styles.completedBackBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.completedTopTitle}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.successGreen} />
            <Text style={styles.completedTopTitleText}>Serviço concluído</Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.completedScrollContent} showsVerticalScrollIndicator={false}>
          {/* Provider + category card */}
          <View style={styles.completedCard}>
            <View style={styles.completedCardTop}>
              <View style={styles.completedCategoryBadge}>
                <Text style={styles.completedCategoryText}>{CATEGORY_LABELS[request.category] ?? request.category}</Text>
              </View>
              <View style={styles.completedDoneBadge}>
                <Ionicons name="checkmark-done-outline" size={12} color={Colors.successGreen} />
                <Text style={styles.completedDoneText}>Concluído</Text>
              </View>
            </View>

            <View style={styles.completedProviderRow}>
              <View style={styles.completedAvatar}>
                <Text style={styles.completedAvatarText}>
                  {providerProfile?.full_name?.charAt(0).toUpperCase() ?? '?'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.completedProviderName}>{providerProfile?.full_name ?? 'Profissional'}</Text>
                {!!providerProfile?.specialties && (
                  <Text style={styles.completedProviderSpec}>{providerProfile.specialties}</Text>
                )}
              </View>
            </View>

            {request.quote_amount != null && Number(request.quote_amount) > 0 && (
              <View style={styles.completedAmountRow}>
                <Ionicons name="cash-outline" size={20} color={Colors.successGreen} />
                <Text style={styles.completedAmountText}>
                  R$ {Number(request.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            )}

            <View style={[styles.completedPaymentChip, { borderColor: paymentColor }]}>
              <Ionicons name={paymentIcon as 'checkmark-circle'} size={14} color={paymentColor} />
              <Text style={[styles.completedPaymentText, { color: paymentColor }]}>{paymentLabel}</Text>
            </View>

            {request.client_rating != null ? (
              <View style={styles.completedRatingRow}>
                {[1, 2, 3, 4, 5].map(s => (
                  <Ionicons key={s} name={s <= request.client_rating! ? 'star' : 'star-outline'} size={16} color={Colors.warningAmber} />
                ))}
                <Text style={styles.completedRatingLabel}>Sua avaliação: {request.client_rating} estrela{request.client_rating !== 1 ? 's' : ''}</Text>
              </View>
            ) : flags.ratings ? (
              <TouchableOpacity style={styles.completedRatePrompt} onPress={() => { setSelectedRating(0); setRatingModal(true); }}>
                <Ionicons name="star-outline" size={16} color={Colors.warningAmber} />
                <Text style={styles.completedRatePromptText}>Avaliar profissional</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.textSecondary} />
              </TouchableOpacity>
            ) : null}

            {flags.chat && (
              <TouchableOpacity
                style={styles.chatBtn}
                onPress={() => router.push(`/chat/${id}` as any)}
              >
                <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
                <Text style={styles.chatBtnText}>Chat com profissional</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.shareReceiptBtn}
              onPress={generateAndShareReceipt}
            >
              <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
              <Text style={styles.shareReceiptBtnText}>Compartilhar recibo (PDF)</Text>
            </TouchableOpacity>

            {flags.formal_complaints && (
              <TouchableOpacity
                style={styles.complaintBtn}
                onPress={() => { setComplaintReason(''); setComplaintDesc(''); setComplaintModal(true); }}
              >
                <Ionicons name="warning-outline" size={16} color={Colors.dangerRed} />
                <Text style={styles.complaintBtnText}>Abrir reclamação</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Payment form (if not yet paid) */}
          {needsPayment && (
            <View style={styles.paymentCard}>
              <View style={styles.paymentCardHeader}>
                <Ionicons name="card-outline" size={18} color={Colors.darkNavy} />
                <Text style={styles.paymentCardTitle}>Realizar pagamento</Text>
              </View>
              {request.quote_amount != null && (
                <Text style={styles.paymentCardAmount}>
                  R$ {Number(request.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </Text>
              )}
              <Text style={styles.paymentMethodLabel}>Forma de pagamento</Text>
              <View style={styles.paymentMethodRow}>
                {(['pix', 'cash', 'card'] as const).filter(m =>
                  !(m === 'pix' && !flags.pix_payments) && !(m === 'cash' && !flags.cash_payments)
                ).map((m) => (
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
                  {generatingPix ? <ActivityIndicator color={Colors.cardWhite} size="small" /> : (
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
                    <Image source={{ uri: `data:image/png;base64,${pixQrCode}` }} style={styles.pixQrImage} resizeMode="contain" />
                  )}
                  <Text style={styles.pixCopiaLabel}>Pix Copia e Cola</Text>
                  <Text style={styles.pixCopiaText} numberOfLines={2}>{pixCopiaECola}</Text>
                  <TouchableOpacity style={styles.sharePixBtn} onPress={() => Share.share({ message: pixCopiaECola })}>
                    <Ionicons name="copy-outline" size={16} color={Colors.darkNavy} />
                    <Text style={styles.sharePixBtnText}>Copiar código</Text>
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
                      <Text style={styles.pixKeyLabel}>Chave Pix do prestador</Text>
                      <Text style={styles.pixKeyValue}>{providerProfile.pix_key}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[styles.sendPaymentBtn, sendingPayment && styles.btnDisabled]}
                    onPress={handleSendPayment}
                    disabled={sendingPayment}
                  >
                    {sendingPayment ? <ActivityIndicator color={Colors.cardWhite} size="small" /> : (
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

          {/* Photos by type */}
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
        </ScrollView>

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
                    <Ionicons name={star <= selectedRating ? 'star' : 'star-outline'} size={44} color={Colors.warningAmber} />
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
                {submittingRating ? <ActivityIndicator color="#fff" /> : <Text style={styles.ratingSubmitText}>Enviar avaliação</Text>}
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
            {photoViewer && <Image source={{ uri: photoViewer }} style={styles.photoViewerImage} resizeMode="contain" />}
          </View>
        </Modal>

        {/* Complaint modal */}
        <Modal visible={complaintModal} transparent animationType="slide" onRequestClose={() => setComplaintModal(false)}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalCard}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>Abrir reclamação</Text>
                <Text style={styles.modalSubtitle}>Selecione o motivo</Text>

                {['Serviço não concluído', 'Qualidade insatisfatória', 'Profissional não compareceu', 'Cobrança indevida', 'Comportamento inadequado'].map((reason) => (
                  <TouchableOpacity
                    key={reason}
                    style={[styles.complaintOption, complaintReason === reason && styles.complaintOptionActive]}
                    onPress={() => setComplaintReason(reason)}
                  >
                    <Ionicons
                      name={complaintReason === reason ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={complaintReason === reason ? Colors.dangerRed : Colors.textSecondary}
                    />
                    <Text style={[styles.complaintOptionText, complaintReason === reason && { color: Colors.dangerRed }]}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                ))}

                <TextInput
                  style={styles.complaintInput}
                  placeholder="Descreva o ocorrido em detalhes..."
                  placeholderTextColor={Colors.textSecondary}
                  value={complaintDesc}
                  onChangeText={setComplaintDesc}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  textAlignVertical="top"
                />
                <Text style={styles.complaintCharCount}>{complaintDesc.length}/500</Text>

                <View style={styles.modalButtons}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setComplaintModal(false)}>
                    <Text style={styles.modalCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.complaintSubmitBtn, (submittingComplaint || !complaintReason || !complaintDesc.trim()) && styles.btnDisabled]}
                    onPress={handleSubmitComplaint}
                    disabled={submittingComplaint || !complaintReason || !complaintDesc.trim()}
                  >
                    {submittingComplaint
                      ? <ActivityIndicator color={Colors.cardWhite} size="small" />
                      : <Text style={styles.modalConfirmText}>Enviar</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
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

      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => { fetchRequest(); loadBids(); }}
      >
        <Ionicons name="refresh-outline" size={20} color={Colors.textPrimary} />
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

        {/* Accepted bid — show agreed price while provider is on the way */}
        {request?.status === 'accepted' && request?.quote_amount != null && (
          <View style={styles.acceptedBidCard}>
            <View style={styles.acceptedBidHeader}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.successGreen} />
              <Text style={styles.acceptedBidTitle}>Orçamento aceito</Text>
            </View>
            <Text style={styles.acceptedBidAmount}>
              R$ {Number(request.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.acceptedBidNote}>O profissional está a caminho</Text>
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

        {/* Bids section — show when waiting for provider */}
        {request?.status === 'requested' && bids.length > 0 && (
          <View style={styles.bidsSection}>
            <Text style={styles.bidsSectionTitle}>
              {bids.length} orçamento{bids.length !== 1 ? 's' : ''} recebido{bids.length !== 1 ? 's' : ''}
            </Text>
            {bids.map((bid: any) => {
              const providerUser = Array.isArray(bid.app_users) ? bid.app_users[0] : bid.app_users;
              const providerProfile2 = Array.isArray(bid.provider_profiles) ? bid.provider_profiles[0] : bid.provider_profiles;
              const name = providerUser?.full_name ?? 'Profissional';
              const rating = providerProfile2?.average_rating ?? '—';
              const jobs2 = providerProfile2?.completed_jobs ?? 0;
              return (
                <View key={bid.id} style={styles.bidCard}>
                  <View style={styles.bidCardRow}>
                    <View style={styles.bidAvatar}>
                      <Text style={styles.bidAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bidProviderName}>{name}</Text>
                      <View style={styles.bidMeta}>
                        <Ionicons name="star" size={12} color={Colors.warningAmber} />
                        <Text style={styles.bidMetaText}>{rating}</Text>
                        <Text style={styles.bidMetaDot}>·</Text>
                        <Text style={styles.bidMetaText}>{jobs2} serviços</Text>
                      </View>
                    </View>
                    <Text style={styles.bidAmount}>
                      R$ {Number(bid.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  {bid.notes ? <Text style={styles.bidNotes}>{bid.notes}</Text> : null}
                  <TouchableOpacity
                    style={[styles.acceptBidBtn, acceptingBidId === bid.id && styles.btnDisabled]}
                    onPress={() => handleAcceptBid(bid.id)}
                    disabled={acceptingBidId === bid.id}
                  >
                    {acceptingBidId === bid.id
                      ? <ActivityIndicator color={Colors.cardWhite} size="small" />
                      : <Text style={styles.acceptBidBtnText}>Aceitar este orçamento</Text>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

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
              {(['pix', 'cash', 'card'] as const).filter(m =>
                !(m === 'pix' && !flags.pix_payments) && !(m === 'cash' && !flags.cash_payments)
              ).map((m) => (
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

        {/* Chat button — only once a provider is assigned */}
        {request?.provider_user_id && request?.status !== 'requested' && request?.status !== 'cancelled' && (
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push(`/chat/${id}` as any)}
          >
            <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
            <Text style={styles.chatBtnText}>Chat com profissional</Text>
          </TouchableOpacity>
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

        {/* Reabrir pedido cancelado */}
        {request?.status === 'cancelled' && (
          <TouchableOpacity
            style={styles.reopenBtn}
            onPress={() => router.navigate({ pathname: '/(tabs)/home', params: { preCategory: request.category } } as any)}
          >
            <Ionicons name="refresh-outline" size={18} color={Colors.cardWhite} />
            <Text style={styles.reopenBtnText}>Solicitar novamente</Text>
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

      {/* Complaint modal */}
      <Modal visible={complaintModal} transparent animationType="slide" onRequestClose={() => setComplaintModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Abrir reclamação</Text>
            <Text style={styles.modalSubtitle}>Selecione o motivo</Text>

            {['Serviço não concluído', 'Qualidade insatisfatória', 'Profissional não compareceu', 'Cobrança indevida', 'Comportamento inadequado'].map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[styles.complaintOption, complaintReason === reason && styles.complaintOptionActive]}
                onPress={() => setComplaintReason(reason)}
              >
                <Ionicons
                  name={complaintReason === reason ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={complaintReason === reason ? Colors.dangerRed : Colors.textSecondary}
                />
                <Text style={[styles.complaintOptionText, complaintReason === reason && { color: Colors.dangerRed }]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.complaintInput}
              placeholder="Descreva o ocorrido em detalhes..."
              placeholderTextColor={Colors.textSecondary}
              value={complaintDesc}
              onChangeText={setComplaintDesc}
              multiline
              numberOfLines={4}
              maxLength={500}
              textAlignVertical="top"
            />
            <Text style={styles.complaintCharCount}>{complaintDesc.length}/500</Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setComplaintModal(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.complaintSubmitBtn, (submittingComplaint || !complaintReason || !complaintDesc.trim()) && styles.btnDisabled]}
                onPress={handleSubmitComplaint}
                disabled={submittingComplaint || !complaintReason || !complaintDesc.trim()}
              >
                {submittingComplaint
                  ? <ActivityIndicator color={Colors.cardWhite} size="small" />
                  : <Text style={styles.modalConfirmText}>Enviar</Text>}
              </TouchableOpacity>
            </View>
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
  acceptedBidCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.successGreen,
  },
  acceptedBidHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptedBidTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  acceptedBidAmount: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  acceptedBidNote: { fontSize: 13, color: Colors.textSecondary },
  reopenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, height: 48,
  },
  reopenBtnText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
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
  refreshButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 32,
    right: 16,
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
  // Completed full-screen view
  completedTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.cardWhite,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  completedBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedTopTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  completedTopTitleText: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  completedScrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: Platform.OS === 'ios' ? 48 : 28,
  },
  completedCard: {
    backgroundColor: Colors.cardWhite,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  completedCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  completedCategoryBadge: { backgroundColor: '#FFF4EE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  completedCategoryText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  completedDoneBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  completedDoneText: { fontSize: 12, fontWeight: '600', color: Colors.successGreen },
  completedProviderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  completedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.cardWhite },
  completedProviderName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  completedProviderSpec: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  completedAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  completedAmountText: { fontSize: 24, fontWeight: '800', color: Colors.successGreen },
  completedPaymentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.cardWhite,
  },
  completedPaymentText: { fontSize: 13, fontWeight: '600' },
  completedRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedRatingLabel: { fontSize: 13, color: Colors.textSecondary, marginLeft: 4 },
  completedRatePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  completedRatePromptText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
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
  shareReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    height: 44,
    backgroundColor: '#FFF4EE',
  },
  shareReceiptBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    height: 44,
    backgroundColor: '#FFF4EE',
    marginBottom: 8,
  },
  chatBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  complaintBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.dangerRed,
    borderRadius: 12,
    height: 44,
    backgroundColor: '#FEF2F2',
  },
  complaintBtnText: { fontSize: 14, fontWeight: '600', color: Colors.dangerRed },
  complaintOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  complaintOptionActive: { borderBottomColor: '#FECACA' },
  complaintOptionText: { fontSize: 14, color: Colors.textPrimary, flex: 1 },
  complaintInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    minHeight: 90,
    marginTop: 12,
  },
  complaintCharCount: { fontSize: 11, color: Colors.textSecondary, textAlign: 'right', marginTop: 4 },
  complaintSubmitBtn: {
    flex: 2,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.dangerRed,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidsSection: {
    gap: 10,
  },
  bidsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bidCard: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bidCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bidAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bidAvatarText: { fontSize: 15, fontWeight: '700', color: Colors.cardWhite },
  bidProviderName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  bidMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  bidMetaText: { fontSize: 12, color: Colors.textSecondary },
  bidMetaDot: { fontSize: 12, color: Colors.border },
  bidAmount: { fontSize: 18, fontWeight: '800', color: Colors.successGreen },
  bidNotes: { fontSize: 13, color: Colors.textSecondary, fontStyle: 'italic' },
  acceptBidBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptBidBtnText: { fontSize: 14, fontWeight: '700', color: Colors.cardWhite },
});
