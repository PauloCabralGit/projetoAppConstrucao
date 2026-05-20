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
  Image,
  TextInput,
  Modal,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

const API_BASE = 'https://construconnect-api.orionsystem.workers.dev/v1';

interface JobDetail {
  id: string;
  category: string;
  description: string;
  status: string;
  client_user_id: string;
  latitude: number | null;
  longitude: number | null;
  city: string;
  budget_min: number | null;
  budget_max: number | null;
  scheduled_date: string | null;
  quote_amount: number | null;
  quote_notes: string | null;
  quote_status: string | null;
  counter_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  client_rating: number | null;
  created_at: string;
}

interface ClientPhoto {
  url: string;
  photo_type: string;
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
  const dist = R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  if (dist < 1) return `${(dist * 1000).toFixed(0)} m de você`;
  return `${dist.toFixed(1)} km de você`;
}

const DEFAULT_REGION: Region = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapRef = useRef<MapView>(null);
  const userIdRef = useRef<string | null>(null);

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerCoord, setProviderCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [distance, setDistance] = useState<string | null>(null);
  const [clientPhotos, setClientPhotos] = useState<ClientPhoto[]>([]);
  const [photoViewer, setPhotoViewer] = useState<string | null>(null);

  // Quote form state
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [submittingQuote, setSubmittingQuote] = useState(false);
  const [acceptingCounter, setAcceptingCounter] = useState(false);

  // Reject modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOther, setRejectOther] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      userIdRef.current = user?.id ?? null;
    });
    loadJob();
    getProviderLocation();
    loadClientPhotos();
    const cleanup = subscribeToJob();
    return cleanup;
  }, [id]);

  useEffect(() => {
    if (providerCoord && job?.latitude && job?.longitude) {
      setDistance(calcDistance(providerCoord, { latitude: job.latitude, longitude: job.longitude }));
    }
  }, [providerCoord, job]);

  function subscribeToJob() {
    const channel = supabase
      .channel(`provider_job_${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `id=eq.${id}` },
        (payload) => {
          setJob((prev) => (prev ? { ...prev, ...(payload.new as Partial<JobDetail>) } : null));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }

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
        'id, category, description, status, client_user_id, latitude, longitude, city, budget_min, budget_max, scheduled_date, quote_amount, quote_notes, quote_status, counter_amount, payment_status, payment_method, client_rating, created_at'
      )
      .eq('id', id)
      .single();

    if (!error && data) {
      const jobData = data as JobDetail;
      setJob(jobData);
      const clientCoord =
        jobData.latitude && jobData.longitude
          ? { latitude: jobData.latitude, longitude: jobData.longitude }
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

  async function loadClientPhotos() {
    try {
      const res = await fetch(`${API_BASE}/service-requests/${id}/photos`);
      if (res.ok) {
        const data = await res.json();
        setClientPhotos(data.photos ?? []);
      }
    } catch {}
  }

  async function startLocationTracking(userId: string) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
    if (!loc) return;
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

  async function handleSubmitQuote() {
    const amount = parseFloat(quoteAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Valor inválido', 'Digite um valor válido para o orçamento.');
      return;
    }
    if (!userIdRef.current) {
      Alert.alert('Erro', 'Você precisa estar logado.');
      return;
    }
    setSubmittingQuote(true);
    try {
      const { data: updated, error: quoteError } = await supabase
        .from('service_requests')
        .update({
          provider_user_id: userIdRef.current,
          quote_amount: amount,
          quote_notes: quoteNotes.trim() || null,
          quote_status: 'quoted',
        })
        .eq('id', job!.id)
        .eq('status', 'requested')
        .is('quote_status', null)
        .select('id')
        .maybeSingle();

      if (quoteError) {
        Alert.alert('Erro', quoteError.message);
      } else if (!updated) {
        Alert.alert('Indisponível', 'Este chamado já possui um orçamento ou não está mais disponível.');
      } else {
        const amtStr = `R$ ${amount.toFixed(2).replace('.', ',')}`;
        fetch(`${API_BASE}/service-requests/${job!.id}/notify-client`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '💰 Orçamento recebido!',
            body: `Um profissional enviou um orçamento de ${amtStr}. Toque para ver.`,
          }),
        }).catch(() => {});
        setJob(prev => prev ? { ...prev, quote_status: 'quoted', quote_amount: amount, quote_notes: quoteNotes.trim() } : null);
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setSubmittingQuote(false);
  }

  async function handleAcceptCounter() {
    if (!userIdRef.current) return;
    setAcceptingCounter(true);
    try {
      const res = await fetch(`${API_BASE}/service-requests/${job!.id}/accept-counter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_user_id: userIdRef.current }),
      });
      if (res.ok) {
        await startLocationTracking(userIdRef.current!);
        router.replace('/(tabs)/active');
      } else {
        Alert.alert('Erro', 'Não foi possível aceitar a contra-proposta.');
      }
    } catch {
      Alert.alert('Erro de conexão', 'Verifique sua internet e tente novamente.');
    }
    setAcceptingCounter(false);
  }

  async function handleStartTravel() {
    if (!userIdRef.current) return;
    await startLocationTracking(userIdRef.current);
    router.replace('/(tabs)/active');
  }

  async function handleConfirmReject() {
    const finalReason = rejectReason === 'Outro' ? rejectOther.trim() : rejectReason;
    if (!finalReason) {
      Alert.alert('Selecione um motivo', 'Por favor, selecione ou descreva o motivo da recusa.');
      return;
    }
    setRejecting(true);
    try {
      await fetch(`${API_BASE}/service-requests/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_user_id: userIdRef.current, reason: finalReason }),
      }).catch(() => {});
    } finally {
      setRejecting(false);
      setRejectModalOpen(false);
      router.back();
    }
  }

  async function handleShareReceipt() {
    if (!job) return;
    const categoryLabel = CATEGORY_LABELS[job.category] ?? job.category;
    const value = job.quote_amount != null
      ? `R$ ${Number(job.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : 'A combinar';
    const paymentMethod =
      job.payment_method === 'cash' ? 'Dinheiro'
      : job.payment_method === 'card' ? 'Cartão'
      : 'Pix';
    const paymentStatus = job.payment_status === 'confirmed'
      ? `Confirmado via ${paymentMethod}`
      : 'Pendente';
    const rating = job.client_rating ? `${job.client_rating} / 5` : 'Não avaliado';
    const date = new Date(job.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; background: #fff; color: #101828; }
  .header { text-align: center; border-bottom: 3px solid #1E2A38; padding-bottom: 24px; margin-bottom: 28px; }
  .logo { font-size: 26px; font-weight: 900; color: #1E2A38; letter-spacing: 1px; }
  .subtitle { font-size: 13px; color: #6B7280; margin-top: 4px; }
  .badge { display: inline-block; background: #FF6B35; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 20px; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  tr { border-bottom: 1px solid #E5E7EB; }
  td { padding: 13px 4px; font-size: 14px; }
  td:first-child { color: #6B7280; font-weight: 600; width: 40%; }
  td:last-child { color: #101828; font-weight: 700; text-align: right; }
  .value-row td:last-child { font-size: 22px; color: #12B76A; }
  .footer { text-align: center; font-size: 11px; color: #9CA3AF; margin-top: 32px; border-top: 1px solid #E5E7EB; padding-top: 16px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">ConstruConnect</div>
  <div class="subtitle">Recibo de Serviço — Prestador</div>
  <div class="badge">Concluído</div>
</div>
<table>
  <tr><td>Serviço</td><td>${categoryLabel}</td></tr>
  <tr><td>Cidade</td><td>${job.city || 'Não informado'}</td></tr>
  <tr><td>Data</td><td>${date}</td></tr>
  <tr class="value-row"><td>Valor cobrado</td><td>${value}</td></tr>
  <tr><td>Pagamento</td><td>${paymentStatus}</td></tr>
  <tr><td>Avaliação do cliente</td><td>${rating}</td></tr>
</table>
<div class="footer">ConstruConnect &bull; Seu parceiro de obras &bull; construconnect.app</div>
</body>
</html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Compartilhar recibo',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Compartilhamento indisponível', 'Não foi possível abrir o compartilhamento neste dispositivo.');
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar o recibo em PDF.');
    }
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
    job.latitude && job.longitude
      ? { latitude: job.latitude, longitude: job.longitude }
      : null;

  const categoryLabel = CATEGORY_LABELS[job.category] ?? job.category;
  const categoryIcon = CATEGORY_ICONS[job.category] ?? 'construct-outline';

  function renderActionSection() {
    if (!job) return null;

    // Quote accepted — start travel
    if (job.status === 'accepted' && job.quote_status === 'accepted') {
      return (
        <View style={{ gap: 10 }}>
          <TouchableOpacity style={styles.startTravelBtn} onPress={handleStartTravel}>
            <Ionicons name="car-outline" size={18} color={Colors.cardWhite} />
            <Text style={styles.startTravelBtnText}>INICIAR DESLOCAMENTO</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatBtn} onPress={() => router.push(`/chat/${id}` as any)}>
            <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
            <Text style={styles.chatBtnText}>Chat com cliente</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Completed job: show summary
    if (job.status === 'completed') {
      const paymentLabel =
        job.payment_status === 'confirmed'
          ? `Pago via ${job.payment_method === 'cash' ? 'Dinheiro' : job.payment_method === 'card' ? 'Cartão' : 'Pix'}`
          : job.payment_status === 'client_paid'
          ? 'Pagamento enviado — aguardando confirmação'
          : 'Aguardando pagamento';
      const paymentColor =
        job.payment_status === 'confirmed' ? Colors.successGreen
        : job.payment_status === 'client_paid' ? Colors.warningAmber
        : Colors.textSecondary;
      return (
        <View style={styles.completedSummary}>
          {job.quote_amount != null && Number(job.quote_amount) > 0 && (
            <View style={styles.summaryRow}>
              <Ionicons name="cash-outline" size={18} color={Colors.successGreen} />
              <Text style={styles.summaryValue}>
                R$ {Number(job.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          )}
          <View style={[styles.paymentChip, { borderColor: paymentColor }]}>
            <Ionicons
              name={job.payment_status === 'confirmed' ? 'checkmark-circle' : 'cash-outline'}
              size={14}
              color={paymentColor}
            />
            <Text style={[styles.paymentChipText, { color: paymentColor }]}>{paymentLabel}</Text>
          </View>
          {job.client_rating != null && (
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map(s => (
                <Ionicons
                  key={s}
                  name={s <= job.client_rating! ? 'star' : 'star-outline'}
                  size={16}
                  color={Colors.warningAmber}
                />
              ))}
              <Text style={styles.ratingLabel}>{job.client_rating}.0 — avaliação do cliente</Text>
            </View>
          )}
          <TouchableOpacity style={styles.chatBtn} onPress={() => router.push(`/chat/${id}` as any)}>
            <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
            <Text style={styles.chatBtnText}>Chat com cliente</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareReceiptBtn} onPress={handleShareReceipt}>
            <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
            <Text style={styles.shareReceiptBtnText}>Compartilhar recibo (PDF)</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Cancelled
    if (job.status === 'cancelled') {
      return (
        <View style={styles.unavailableBanner}>
          <Ionicons name="close-circle-outline" size={16} color={Colors.dangerRed} />
          <Text style={styles.unavailableBannerText}>Este chamado foi cancelado.</Text>
        </View>
      );
    }

    // Job taken by another provider (in_progress / accepted by someone else)
    if (job.status !== 'requested') {
      return (
        <View style={styles.unavailableBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={Colors.dangerRed} />
          <Text style={styles.unavailableBannerText}>Este chamado não está mais disponível.</Text>
        </View>
      );
    }

    // Counter received from client
    if (job.quote_status === 'negotiating') {
      return (
        <View style={styles.quoteSection}>
          <View style={styles.counterCard}>
            <Ionicons name="swap-horizontal-outline" size={20} color={Colors.warningAmber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.counterCardLabel}>Contra-proposta do cliente</Text>
              <Text style={styles.counterCardValue}>
                R$ {job.counter_amount != null ? Number(job.counter_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
              </Text>
            </View>
          </View>
          <View style={styles.buttonsRow}>
            <TouchableOpacity style={styles.declineButton} onPress={() => setRejectModalOpen(true)}>
              <Text style={styles.declineButtonText}>RECUSAR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptButton, acceptingCounter && styles.buttonDisabled]}
              onPress={handleAcceptCounter}
              disabled={acceptingCounter}
            >
              {acceptingCounter ? (
                <ActivityIndicator color={Colors.cardWhite} />
              ) : (
                <Text style={styles.acceptButtonText}>ACEITAR</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // Quote sent, waiting for client response
    if (job.quote_status === 'quoted') {
      return (
        <View style={styles.waitingCard}>
          <Ionicons name="hourglass-outline" size={28} color={Colors.warningAmber} />
          <Text style={styles.waitingTitle}>Orçamento enviado!</Text>
          <Text style={styles.waitingSubtitle}>
            R$ {job.quote_amount != null ? Number(job.quote_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'} · Aguardando resposta do cliente...
          </Text>
        </View>
      );
    }

    // Default: show quote form
    return (
      <View style={styles.quoteSection}>
        <Text style={styles.quoteSectionTitle}>Enviar orçamento</Text>
        <View style={styles.quoteAmountRow}>
          <Text style={styles.currencySymbol}>R$</Text>
          <TextInput
            style={styles.quoteAmountInput}
            placeholder="0,00"
            placeholderTextColor={Colors.textSecondary}
            value={quoteAmount}
            onChangeText={setQuoteAmount}
            keyboardType="numeric"
          />
        </View>
        <TextInput
          style={styles.quoteNotesInput}
          placeholder="Observações: prazo, materiais inclusos, etc..."
          placeholderTextColor={Colors.textSecondary}
          value={quoteNotes}
          onChangeText={setQuoteNotes}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
        />
        <View style={styles.buttonsRow}>
          <TouchableOpacity style={styles.declineButton} onPress={() => router.back()}>
            <Text style={styles.declineButtonText}>RECUSAR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.acceptButton,
              (submittingQuote || !quoteAmount) && styles.buttonDisabled,
            ]}
            onPress={handleSubmitQuote}
            disabled={submittingQuote || !quoteAmount}
          >
            {submittingQuote ? (
              <ActivityIndicator color={Colors.cardWhite} />
            ) : (
              <Text style={styles.acceptButtonText}>ENVIAR</Text>
            )}
          </TouchableOpacity>
        </View>
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
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.bottomSheetHandle} />

        <View style={styles.categoryRow}>
          <View style={styles.categoryIconCircle}>
            <Ionicons name={categoryIcon as 'layers-outline'} size={24} color={Colors.primary} />
          </View>
          <View style={styles.categoryInfo}>
            <Text style={styles.categoryLabel}>{categoryLabel}</Text>
            <Text style={styles.categorySubLabel}>{job.city || 'Local não informado'}</Text>
          </View>
        </View>

        <Text style={styles.descriptionText}>{job.description || 'Sem descrição adicional.'}</Text>

        {/* Photos */}
        {clientPhotos.length > 0 && (
          <View style={styles.photosSection}>
            <Text style={styles.photosSectionTitle}>
              <Ionicons name="images-outline" size={14} color={Colors.textSecondary} />
              {'  '}Fotos do serviço
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photosRow}
            >
              {clientPhotos.map((photo, i) => {
                const typeLabel =
                  photo.photo_type === 'client_request' ? 'Cliente'
                  : photo.photo_type === 'provider_start' ? 'Início'
                  : photo.photo_type === 'provider_end' ? 'Conclusão'
                  : '';
                return (
                  <TouchableOpacity key={i} onPress={() => setPhotoViewer(photo.url)} activeOpacity={0.85}>
                    <View>
                      <Image source={{ uri: photo.url }} style={styles.photoThumb} />
                      {typeLabel ? (
                        <View style={styles.photoTypeBadge}>
                          <Text style={styles.photoTypeText}>{typeLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.detailsGrid}>
          <View style={styles.detailCard}>
            <Ionicons name="calendar-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.detailLabel}>Data</Text>
            <Text style={styles.detailValue}>{formatScheduledDate(job.scheduled_date)}</Text>
          </View>
          <View style={styles.detailCard}>
            <Ionicons name="location-outline" size={18} color={Colors.darkNavy} />
            <Text style={styles.detailLabel}>Cidade</Text>
            <Text style={styles.detailValue}>{job.city || 'Não informado'}</Text>
          </View>
        </View>

        {renderActionSection()}
      </ScrollView>

      {/* Reject modal */}
      <Modal
        visible={rejectModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectModalOpen(false)}
      >
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectSheet}>
            <View style={styles.rejectHandle} />
            <Text style={styles.rejectTitle}>Recusar chamado</Text>
            <Text style={styles.rejectSubtitle}>Selecione o motivo da recusa:</Text>

            {[
              'Muito longe de mim',
              'Fora da minha especialidade',
              'Indisponível no momento',
              'Preço incompatível',
              'Outro motivo',
            ].map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[styles.rejectOption, rejectReason === reason && styles.rejectOptionActive]}
                onPress={() => { setRejectReason(reason); if (reason !== 'Outro motivo') setRejectOther(''); }}
              >
                <View style={[styles.rejectRadio, rejectReason === reason && styles.rejectRadioActive]}>
                  {rejectReason === reason && <View style={styles.rejectRadioDot} />}
                </View>
                <Text style={[styles.rejectOptionText, rejectReason === reason && styles.rejectOptionTextActive]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}

            {rejectReason === 'Outro motivo' && (
              <TextInput
                style={styles.rejectOtherInput}
                placeholder="Descreva o motivo..."
                placeholderTextColor={Colors.textSecondary}
                value={rejectOther}
                onChangeText={setRejectOther}
                multiline
                numberOfLines={2}
                textAlignVertical="top"
              />
            )}

            <View style={styles.rejectActions}>
              <TouchableOpacity style={styles.rejectCancelBtn} onPress={() => setRejectModalOpen(false)}>
                <Text style={styles.rejectCancelBtnText}>Voltar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectConfirmBtn, (!rejectReason || rejecting) && styles.buttonDisabled]}
                onPress={handleConfirmReject}
                disabled={!rejectReason || rejecting}
              >
                {rejecting
                  ? <ActivityIndicator color={Colors.cardWhite} size="small" />
                  : <Text style={styles.rejectConfirmBtnText}>Confirmar recusa</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={photoViewer !== null} transparent animationType="fade" onRequestClose={() => setPhotoViewer(null)}>
        <View style={styles.photoViewerOverlay}>
          <TouchableOpacity style={styles.photoViewerClose} onPress={() => setPhotoViewer(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photoViewer && (
            <Image source={{ uri: photoViewer }} style={styles.photoViewerImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
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
  backLink: { marginTop: 8 },
  backLinkText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  map: { height: '40%', width: '100%' },
  clientMapMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dangerRed,
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
    elevation: 4,
  },
  distancePillText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
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
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  categoryInfo: { flex: 1 },
  categoryLabel: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  categorySubLabel: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
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
  photosSection: { gap: 8 },
  photosSectionTitle: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
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
  detailsGrid: { flexDirection: 'row', gap: 12 },
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
  detailValue: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, lineHeight: 18 },
  quoteSection: { gap: 10 },
  quoteSectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  quoteAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFF4EE',
    height: 52,
  },
  currencySymbol: { fontSize: 18, fontWeight: '700', color: Colors.primary, marginRight: 4 },
  quoteAmountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    height: 52,
  },
  quoteNotesInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    minHeight: 60,
  },
  buttonsRow: { flexDirection: 'row', gap: 12 },
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
  declineButtonText: { fontSize: 15, fontWeight: '800', color: Colors.dangerRed, letterSpacing: 1 },
  acceptButton: {
    flex: 2,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.successGreen,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  acceptButtonText: { fontSize: 17, fontWeight: '800', color: Colors.cardWhite, letterSpacing: 1.5 },
  buttonDisabled: { opacity: 0.5 },
  waitingCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.warningAmber,
  },
  waitingTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  waitingSubtitle: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  counterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.warningAmber,
  },
  counterCardLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  counterCardValue: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  unavailableBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.dangerRed,
  },
  unavailableBannerText: { fontSize: 14, color: Colors.dangerRed, fontWeight: '600', flex: 1 },
  completedSummary: {
    gap: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryValue: { fontSize: 22, fontWeight: '800', color: Colors.successGreen },
  paymentChip: {
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
  paymentChipText: { fontSize: 13, fontWeight: '600' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingLabel: { fontSize: 13, color: Colors.textSecondary, marginLeft: 4 },
  photoTypeBadge: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    alignItems: 'center',
    paddingVertical: 2,
  },
  photoTypeText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  startTravelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    elevation: 6,
  },
  startTravelBtnText: { fontSize: 16, fontWeight: '800', color: Colors.cardWhite, letterSpacing: 1 },
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
  },
  chatBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  shareReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: '#FFF4EE',
  },
  shareReceiptBtnText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  // ── Reject modal ───────────────────────────────────────────────────────────
  rejectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  rejectSheet: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    gap: 10,
  },
  rejectHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 4,
  },
  rejectTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  rejectSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  rejectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  rejectOptionActive: {
    borderColor: Colors.dangerRed,
    backgroundColor: '#FEF2F2',
  },
  rejectRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectRadioActive: { borderColor: Colors.dangerRed },
  rejectRadioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.dangerRed,
  },
  rejectOptionText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500', flex: 1 },
  rejectOptionTextActive: { color: Colors.dangerRed, fontWeight: '700' },
  rejectOtherInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    minHeight: 64,
  },
  rejectActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  rejectCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  rejectCancelBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  rejectConfirmBtn: {
    flex: 2,
    height: 50,
    borderRadius: 12,
    backgroundColor: Colors.dangerRed,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  rejectConfirmBtnText: { fontSize: 15, fontWeight: '800', color: Colors.cardWhite, letterSpacing: 0.5 },
});
