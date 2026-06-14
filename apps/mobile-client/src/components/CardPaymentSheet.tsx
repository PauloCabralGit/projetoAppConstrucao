import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { SavedCard, InstallmentOption, CardPaymentResult } from '@construconnect/shared';
import { Colors } from '@/constants/colors';
import {
  AuthError,
  CardTokenError,
  fetchSavedCards,
  deleteSavedCard,
  setDefaultCard,
  fetchInstallments,
  getMpPublicKey,
  getPayerEmail,
  tokenizeNewCard,
  tokenizeSavedCard,
  createCardPayment,
  pollCardPaymentStatus,
  randomUUID,
  addCard,
} from '@/lib/api';
import {
  detectBrand,
  BRAND_LABEL,
  formatCardNumber,
  formatExpiry,
  formatCpf,
  formatBRL,
  luhnValid,
  expiryValid,
  cvvValid,
  cpfValid,
  nameValid,
  onlyDigits,
  brandCvvLength,
  statusDetailMessage,
  type CardFieldErrors,
} from '@/lib/cardUtils';
import { getMpDeviceId } from '@/lib/mpDevice';

type CardStep = 'list' | 'new' | 'installments' | 'review' | 'threeds' | 'result';
type CardType = 'credit' | 'debit';

interface CardPaymentSheetProps {
  visible: boolean;
  /** ID do service_request — usado em /installments e /create-card-payment. Ignorado no modo add_card. */
  requestId?: string;
  /** Valor do serviço em reais. Ignorado no modo add_card. */
  amount?: number;
  /** E-mail do pagador (payer_email). Se ausente, é obtido da sessão Supabase. */
  payerEmail?: string;
  onClose: () => void;
  /** Chamado quando a cobrança é aprovada e o usuário toca em "Concluir". */
  onApproved?: (result: CardPaymentResult) => void;
  /** Chamado quando a cobrança fica EM PROCESSAMENTO (in_process/pending). */
  onProcessing?: (result: CardPaymentResult) => void;
  /**
   * 'add_card' — abre direto no formulário de novo cartão e salva sem cobrar.
   * Chama onCardAdded() após sucesso.
   */
  mode?: 'add_card';
  onCardAdded?: () => void;
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

/** Tipo de falha de cobrança que não é "recusa de cartão". */
type PayErrorKind = 'unavailable' | 'token' | null;
/** Estado de erro ao carregar a lista de cartões. */
type CardsError = 'network' | 'auth' | null;

// HTML que auto-submete o creq ao ACS (página de desafio 3DS do emissor) na WebView.
function build3dsHtml(url: string, creq: string): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body onload="document.forms[0].submit()" style="margin:0;padding:0">
<form method="POST" action="${url}">
  <input type="hidden" name="creq" value="${creq}" />
</form>
</body></html>`;
}

export default function CardPaymentSheet({
  visible,
  requestId = '',
  amount = 0,
  payerEmail,
  onClose,
  onApproved,
  onProcessing,
  mode,
  onCardAdded,
}: CardPaymentSheetProps) {
  const isAddCardMode = mode === 'add_card';
  const [step, setStep] = useState<CardStep>(isAddCardMode ? 'new' : 'list');

  // ── Cartões salvos ──────────────────────────────────────────────────────
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState<CardsError>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [savedCvv, setSavedCvv] = useState(''); // CVV exigido sempre, mesmo no cartão salvo
  const [manageMode, setManageMode] = useState(false);
  const [cardActionId, setCardActionId] = useState<string | null>(null);

  // ── Novo cartão ─────────────────────────────────────────────────────────
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [holder, setHolder] = useState('');
  const [cpf, setCpf] = useState('');
  const [cardType, setCardType] = useState<CardType>('credit');
  const [saveCard, setSaveCard] = useState(true); // marcado por padrão (só crédito salva)
  const [errors, setErrors] = useState<CardFieldErrors>({});

  // ── Parcelas / revisão / processamento ──────────────────────────────────
  const [installments, setInstallments] = useState<InstallmentOption[]>([]);
  const [installmentsLoading, setInstallmentsLoading] = useState(false);
  const [installmentsError, setInstallmentsError] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<InstallmentOption | null>(null);
  // payment_method_id / issuer_id resolvidos pelo /installments — usados na cobrança.
  const [paymentMethodId, setPaymentMethodId] = useState<string>('');
  const [issuerId, setIssuerId] = useState<string>('');
  const [usingSaved, setUsingSaved] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<CardPaymentResult | null>(null);
  // Desfechos não-aprovados: recusa de cartão (rejectedDetail) ou falha de infra/token.
  const [rejectedDetail, setRejectedDetail] = useState<string | null>(null);
  const [payErrorKind, setPayErrorKind] = useState<PayErrorKind>(null);
  // Desafio 3DS (autenticação do emissor) — URL + creq + id do pagamento.
  const [threeDs, setThreeDs] = useState<{ url: string; creq: string; mpPaymentId: string } | null>(null);

  const brand = detectBrand(number);
  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? null,
    [cards, selectedCardId]
  );

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    setCardsError(null);
    try {
      const data = await fetchSavedCards();
      setCards(data);
      setSelectedCardId((prev) => {
        // Mantém a seleção atual se o cartão ainda existir; senão usa o preferido.
        if (prev && data.some((c) => c.id === prev)) return prev;
        return data.find((c) => c.isDefault)?.id ?? data[0]?.id ?? null;
      });
    } catch (e) {
      setCardsError(e instanceof AuthError ? 'auth' : 'network');
    } finally {
      setCardsLoading(false);
    }
  }, []);

  // Reinicia tudo ao abrir.
  useEffect(() => {
    if (!visible) return;
    setStep(isAddCardMode ? 'new' : 'list');
    setSavedCvv('');
    setNumber('');
    setExpiry('');
    setCvv('');
    setHolder('');
    setCpf('');
    setCardType('credit');
    setSaveCard(true);
    setErrors({});
    setInstallments([]);
    setInstallmentsError(false);
    setSelectedInstallment(null);
    setPaymentMethodId('');
    setIssuerId('');
    setUsingSaved(false);
    setProcessing(false);
    setResult(null);
    setRejectedDetail(null);
    setPayErrorKind(null);
    setThreeDs(null);
    setManageMode(false);
    setCardActionId(null);
    loadCards();
  }, [visible, loadCards]);

  // Débito não é salvo (regra do produto).
  useEffect(() => {
    if (cardType === 'debit') setSaveCard(false);
  }, [cardType]);

  // Polling do status durante o desafio 3DS. Enquanto a WebView de autenticação
  // está aberta, consultamos o backend; quando o pagamento resolve (aprovado/
  // recusado), encerramos o desafio e mostramos o resultado.
  useEffect(() => {
    if (step !== 'threeds' || !threeDs) return;
    let alive = true;
    const interval = setInterval(async () => {
      const r = await pollCardPaymentStatus(requestId, threeDs.mpPaymentId);
      if (!alive || !r) return;
      if (r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled') {
        clearInterval(interval);
        if (r.status === 'approved') {
          setResult({
            status: 'approved', statusDetail: r.statusDetail, mpPaymentId: threeDs.mpPaymentId,
            amount, platformFee: 0, mpFee: 0, providerAmount: 0,
            installments: selectedInstallment?.installments ?? 1,
          });
        } else {
          setResult(null);
          setRejectedDetail(r.statusDetail || 'cc_rejected_other_reason');
        }
        setThreeDs(null);
        setStep('result');
      }
    }, 3500);
    // Timeout de segurança: 4 min → trata como "em processamento".
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (alive && step === 'threeds') {
        setResult({
          status: 'in_process', statusDetail: 'pending_challenge', mpPaymentId: threeDs.mpPaymentId,
          amount, platformFee: 0, mpFee: 0, providerAmount: 0,
          installments: selectedInstallment?.installments ?? 1,
        });
        setThreeDs(null);
        setStep('result');
      }
    }, 240000);
    return () => { alive = false; clearInterval(interval); clearTimeout(timeout); };
  }, [step, threeDs, requestId, amount, selectedInstallment]);

  function validateNewCard(): boolean {
    const next: CardFieldErrors = {};
    if (!luhnValid(number)) next.number = 'Número de cartão inválido';
    if (!expiryValid(expiry)) next.expiry = 'Validade inválida';
    if (!cvvValid(cvv, brand)) next.cvv = `CVV deve ter ${brandCvvLength(brand)} dígitos`;
    if (!nameValid(holder)) next.name = 'Informe o nome como está no cartão';
    if (!cpfValid(cpf)) next.cpf = 'CPF inválido';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // Busca parcelas reais (juros do emissor via MP). `saved`=true usa a bandeira
  // do cartão salvo (payment_method_id); senão usa o BIN (6 primeiros do PAN).
  const loadInstallments = useCallback(
    async (saved: boolean, debit: boolean) => {
      setStep('installments');
      setInstallmentsLoading(true);
      setInstallmentsError(false);
      try {
        const query = saved
          ? { paymentMethodId: selectedCard?.brand ?? undefined }
          : { bin: onlyDigits(number).slice(0, 6) };
        const resp = await fetchInstallments(requestId, query);
        const opts = resp.payerCosts ?? [];
        setInstallments(opts);
        setPaymentMethodId(resp.paymentMethodId);
        setIssuerId(resp.issuerId);
        // Pré-seleciona a 1ª opção (1x sem juros, por convenção do MP).
        setSelectedInstallment(opts[0] ?? null);
        // Débito é sempre à vista → pula a seleção de parcelas.
        if (debit) setStep('review');
      } catch {
        setInstallmentsError(true);
      } finally {
        setInstallmentsLoading(false);
      }
    },
    [requestId, number, selectedCard]
  );

  function handleContinueFromNew() {
    if (!validateNewCard()) return;
    if (isAddCardMode) {
      handleSaveCardOnly();
      return;
    }
    setUsingSaved(false);
    loadInstallments(false, cardType === 'debit');
  }

  async function handleSaveCardOnly() {
    setProcessing(true);
    setPayErrorKind(null);
    try {
      const pk = await getMpPublicKey();
      const [mm, yy] = expiry.split('/');
      const token = await tokenizeNewCard(pk, {
        number: onlyDigits(number),
        securityCode: onlyDigits(cvv),
        expMonth: Number(mm),
        expYear: Number(`20${yy}`),
        name: holder.trim().toUpperCase(),
        cpf: onlyDigits(cpf),
      });
      await addCard(token, true);
      await loadCards();
      setStep('result');
      // Sinaliza sucesso para o pai.
      setResult({ status: 'card_saved', statusDetail: 'ok', mpPaymentId: '', amount: 0, platformFee: 0, mpFee: 0, providerAmount: 0, installments: 1 } as any);
    } catch (e) {
      if (e instanceof CardTokenError) {
        setRejectedDetail('card_token_invalid');
      } else {
        setPayErrorKind('unavailable');
      }
      setStep('result');
    } finally {
      setProcessing(false);
    }
  }

  const savedCvvValid = onlyDigits(savedCvv).length === 3;

  function handleContinueFromSaved() {
    if (!savedCvvValid) {
      setErrors({ cvv: 'Informe o CVV do cartão (3 dígitos)' });
      return;
    }
    setErrors({});
    setUsingSaved(true);
    // Cartões salvos são de crédito (só crédito é salvo) → parcelas.
    loadInstallments(true, false);
  }

  async function handlePay() {
    if (!selectedInstallment) return;
    setProcessing(true);
    setRejectedDetail(null);
    setPayErrorKind(null);
    try {
      const pk = await getMpPublicKey();

      // Tokenização no device (PCI). Re-tokeniza a cada tentativa porque o token
      // do MP é de uso único — isso cobre também o caso de token expirado.
      let token: string;
      if (usingSaved) {
        if (!selectedCard) throw new Error('no_card');
        token = await tokenizeSavedCard(pk, selectedCard.id, onlyDigits(savedCvv));
      } else {
        const [mm, yy] = expiry.split('/');
        token = await tokenizeNewCard(pk, {
          number: onlyDigits(number),
          securityCode: onlyDigits(cvv),
          expMonth: Number(mm),
          expYear: Number(`20${yy}`),
          name: holder.trim().toUpperCase(),
          cpf: onlyDigits(cpf),
        });
      }

      const email = payerEmail || (await getPayerEmail());
      // Enriquecimento do pagador (só cartão novo, onde temos nome+CPF) — melhora a
      // aprovação no antifraude do MP. Cartão salvo já tem os dados no customer.
      const nameParts = holder.trim().split(/\s+/).filter(Boolean);
      const outcome = await createCardPayment(requestId, {
        token,
        installments: selectedInstallment.installments,
        payment_method_id: paymentMethodId || (usingSaved ? selectedCard?.brand ?? '' : ''),
        issuer_id: issuerId || undefined,
        payer_email: email,
        ...(usingSaved ? {} : {
          payer_first_name: nameParts[0] || undefined,
          payer_last_name: nameParts.slice(1).join(' ') || undefined,
          payer_cpf: onlyDigits(cpf) || undefined,
        }),
        device_id: getMpDeviceId() ?? undefined,
        // save_card só no crédito de cartão novo (débito nunca salva).
        save_card: !usingSaved && cardType === 'credit' && saveCard,
        idempotency_key: randomUUID(), // um por tentativa
      });

      if (outcome.kind === 'challenge') {
        // Desafio 3DS: abre a WebView de autenticação do emissor; o status final
        // é resolvido pelo polling (efeito do passo 'threeds').
        setThreeDs({ url: outcome.externalResourceUrl, creq: outcome.creq, mpPaymentId: outcome.mpPaymentId });
        setStep('threeds');
        return;
      }
      if (outcome.kind === 'approved' || outcome.kind === 'processing') {
        // 'processing' = in_process/pending: a tela de resultado mostra "em
        // processamento" (o status vem no result) e o Concluir avisa o tracking.
        setResult(outcome.result);
      } else if (outcome.kind === 'rejected') {
        setResult(outcome.result);
        setRejectedDetail(outcome.statusDetail);
      } else if (outcome.kind === 'token_expired') {
        setPayErrorKind('token');
      } else {
        setPayErrorKind('unavailable');
      }
      setStep('result');
    } catch (e) {
      // Falha na tokenização (dados de cartão) ou na obtenção da public key.
      if (e instanceof CardTokenError) {
        setResult(null);
        setRejectedDetail('card_token_invalid');
      } else {
        setPayErrorKind('unavailable');
      }
      setStep('result');
    } finally {
      setProcessing(false);
    }
  }

  function resetToPaymentStart() {
    setResult(null);
    setRejectedDetail(null);
    setPayErrorKind(null);
    setSavedCvv(''); // força reinserção do CVV ao trocar de cartão
    setStep(cards.length > 0 ? 'list' : 'new');
  }

  // ── Gerenciar cartões (remover / preferido) ─────────────────────────────────
  async function handleSetDefault(cardId: string) {
    setCardActionId(cardId);
    try {
      await setDefaultCard(cardId);
      await loadCards();
    } catch {
      // Mantém a lista atual; o erro é silencioso (ação reversível).
    } finally {
      setCardActionId(null);
    }
  }

  async function handleRemoveCard(cardId: string) {
    setCardActionId(cardId);
    try {
      await deleteSavedCard(cardId);
      if (selectedCardId === cardId) {
        setSelectedCardId(null);
        setSavedCvv('');
      }
      await loadCards();
    } catch {
      // Erro silencioso; a lista permanece como está.
    } finally {
      setCardActionId(null);
    }
  }

  const headerTitle: Record<CardStep, string> = {
    list: isAddCardMode ? 'Meus cartões' : 'Pagar com cartão',
    new: isAddCardMode ? 'Adicionar cartão' : 'Novo cartão',
    installments: 'Parcelamento',
    review: 'Revisar pagamento',
    threeds: 'Autenticação',
    result: isAddCardMode ? 'Cartão salvo' : 'Resultado',
  };

  const canGoBack = step !== 'list' && step !== 'result' && step !== 'threeds' && !processing;

  function handleBack() {
    setErrors({});
    if (step === 'new') setStep('list');
    else if (step === 'installments') setStep(usingSaved ? 'list' : 'new');
    else if (step === 'review') setStep(cardType === 'debit' && !usingSaved ? 'new' : 'installments');
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={processing ? undefined : onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {/* Cabeçalho */}
          <View style={styles.header}>
            {canGoBack ? (
              <TouchableOpacity
                onPress={handleBack}
                hitSlop={HIT}
                style={styles.headerBtn}
                accessibilityRole="button"
                accessibilityLabel="Voltar"
              >
                <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.headerBtn} />
            )}
            <Text style={styles.headerTitle} accessibilityRole="header">
              {headerTitle[step]}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={HIT}
              style={styles.headerBtn}
              disabled={processing}
              accessibilityRole="button"
              accessibilityLabel="Fechar pagamento"
            >
              <Ionicons name="close" size={24} color={processing ? Colors.border : Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {!isAddCardMode && (
            <View style={styles.amountStrip}>
              <Text style={styles.amountStripLabel}>Valor do serviço</Text>
              <Text style={styles.amountStripValue}>{formatBRL(amount)}</Text>
            </View>
          )}

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {step === 'list' && (
              <StepList
                loading={cardsLoading}
                error={cardsError}
                cards={cards}
                selectedCardId={selectedCardId}
                onSelect={setSelectedCardId}
                savedCvv={savedCvv}
                onChangeCvv={(v) => setSavedCvv(onlyDigits(v).slice(0, 4))}
                cvvError={errors.cvv}
                onRetry={loadCards}
                onAddNew={() => { setErrors({}); setStep('new'); }}
                manageMode={manageMode}
                onToggleManage={() => setManageMode((m) => !m)}
                onSetDefault={handleSetDefault}
                onRemove={handleRemoveCard}
                cardActionId={cardActionId}
              />
            )}

            {step === 'new' && (
              <StepNewCard
                number={number}
                expiry={expiry}
                cvv={cvv}
                holder={holder}
                cpf={cpf}
                cardType={cardType}
                saveCard={saveCard}
                errors={errors}
                brandLabel={BRAND_LABEL[brand]}
                onChangeNumber={(v) => setNumber(formatCardNumber(v))}
                onChangeExpiry={(v) => setExpiry(formatExpiry(v))}
                onChangeCvv={(v) => setCvv(onlyDigits(v).slice(0, brandCvvLength(brand)))}
                onChangeHolder={setHolder}
                onChangeCpf={(v) => setCpf(formatCpf(v))}
                onChangeType={setCardType}
                onToggleSave={() => setSaveCard((s) => !s)}
              />
            )}

            {step === 'installments' && (
              <StepInstallments
                loading={installmentsLoading}
                error={installmentsError}
                options={installments}
                selected={selectedInstallment}
                onSelect={setSelectedInstallment}
                onRetry={() => loadInstallments(usingSaved, !usingSaved && cardType === 'debit')}
              />
            )}

            {step === 'review' && (
              <StepReview
                amount={amount}
                installment={selectedInstallment}
                cardDescription={
                  usingSaved && selectedCard
                    ? `${BRAND_LABEL[(selectedCard.brand as never) ?? 'unknown'] ?? 'Cartão'} ••••${selectedCard.last4}`
                    : `${BRAND_LABEL[brand]} ••••${onlyDigits(number).slice(-4)}`
                }
                cardType={usingSaved ? 'credit' : cardType}
                processing={processing}
              />
            )}

            {step === 'threeds' && threeDs && (
              <View>
                <Text style={styles.threeDsTitle}>Autenticação do seu banco</Text>
                <Text style={styles.emptyDesc}>
                  Conclua a verificação na tela abaixo para finalizar o pagamento.
                </Text>
                <View style={styles.threeDsWebWrap}>
                  <WebView
                    source={{ html: build3dsHtml(threeDs.url, threeDs.creq) }}
                    originWhitelist={['*']}
                    javaScriptEnabled
                    domStorageEnabled
                    startInLoadingState
                  />
                </View>
                <View style={styles.threeDsWaiting}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.emptyDesc}>Aguardando confirmação...</Text>
                </View>
              </View>
            )}

            {step === 'result' && (
              <StepResult
                payErrorKind={payErrorKind}
                rejectedDetail={rejectedDetail}
                result={result}
                isAddCardMode={isAddCardMode}
                onConcluir={() => {
                  if (isAddCardMode) {
                    onCardAdded?.();
                    onClose();
                    return;
                  }
                  if (result) {
                    if (result.status === 'in_process' || result.status === 'pending' || result.status === 'authorized') {
                      onProcessing?.(result);
                    } else if (result.status === 'approved') {
                      onApproved?.(result);
                    }
                    // status === 'rejected' ou qualquer outro: não chama onApproved
                  }
                  onClose();
                }}
                onRetry={isAddCardMode ? handleSaveCardOnly : handlePay}
                onTryAnotherCard={resetToPaymentStart}
                onUseOtherMethod={onClose}
                onShareReceipt={() => {
                  if (!result) return;
                  Share.share({
                    message:
                      `Recibo ConstruConnect\n` +
                      `Valor: ${formatBRL(result.amount)}\n` +
                      `Parcelas: ${result.installments}x\n` +
                      `ID: ${result.mpPaymentId}`,
                  });
                }}
              />
            )}
          </ScrollView>

          {/* Rodapé com CTA por passo */}
          {step === 'list' && !cardsLoading && !cardsError && !manageMode && cards.length > 0 && (
            <Footer
              label="Continuar"
              disabled={!selectedCardId || !savedCvvValid}
              onPress={handleContinueFromSaved}
            />
          )}
          {step === 'new' && (
            <Footer
              label={isAddCardMode ? (processing ? 'Salvando...' : 'Salvar cartão') : 'Continuar'}
              disabled={isAddCardMode && processing}
              loading={isAddCardMode && processing}
              onPress={handleContinueFromNew}
            />
          )}
          {step === 'installments' && (
            <Footer
              label="Revisar"
              disabled={installmentsLoading || !selectedInstallment}
              onPress={() => setStep('review')}
            />
          )}
          {step === 'review' && (
            <Footer
              label={
                processing
                  ? 'Processando...'
                  : `Pagar ${formatBRL(selectedInstallment?.totalAmount ?? amount)}`
              }
              disabled={processing || !selectedInstallment}
              loading={processing}
              onPress={handlePay}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Passos
// ─────────────────────────────────────────────────────────────────────────────

function StepList({
  loading, error, cards, selectedCardId, onSelect,
  savedCvv, onChangeCvv, cvvError, onRetry, onAddNew,
  manageMode, onToggleManage, onSetDefault, onRemove, cardActionId,
}: {
  loading: boolean;
  error: CardsError;
  cards: SavedCard[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  savedCvv: string;
  onChangeCvv: (v: string) => void;
  cvvError?: string;
  onRetry: () => void;
  onAddNew: () => void;
  manageMode: boolean;
  onToggleManage: () => void;
  onSetDefault: (id: string) => void;
  onRemove: (id: string) => void;
  cardActionId: string | null;
}) {
  if (loading) {
    return (
      <View style={styles.centerBox} accessibilityLabel="Carregando cartões salvos">
        {[0, 1].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <View style={styles.skeletonIcon} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={[styles.skeletonLine, { width: '60%' }]} />
              <View style={[styles.skeletonLine, { width: '35%' }]} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (error) {
    const isAuth = error === 'auth';
    return (
      <View style={styles.centerBox}>
        <Ionicons
          name={isAuth ? 'lock-closed-outline' : 'cloud-offline-outline'}
          size={40}
          color={Colors.warningAmber}
        />
        <Text style={styles.emptyTitle}>
          {isAuth ? 'Sessão expirada' : 'Não foi possível carregar seus cartões'}
        </Text>
        <Text style={styles.emptyDesc}>
          {isAuth
            ? 'Faça login novamente para usar seus cartões salvos.'
            : 'Verifique sua conexão e tente novamente.'}
        </Text>
        {!isAuth && (
          <TouchableOpacity style={styles.outlineBtn} onPress={onRetry} accessibilityRole="button">
            <Ionicons name="refresh" size={16} color={Colors.darkNavy} />
            <Text style={styles.outlineBtnText}>Tentar de novo</Text>
          </TouchableOpacity>
        )}
        {/* Mesmo sem cartões salvos, o usuário pode pagar com um cartão novo. */}
        <TouchableOpacity style={styles.addCardBtn} onPress={onAddNew} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.addCardText}>Pagar com novo cartão</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {cards.length === 0 ? (
        <View style={styles.centerBox}>
          <Ionicons name="card-outline" size={40} color={Colors.textSecondary} />
          <Text style={styles.emptyTitle}>Nenhum cartão salvo</Text>
          <Text style={styles.emptyDesc}>Adicione um cartão para pagar com mais rapidez.</Text>
        </View>
      ) : (
        <>
          {/* Alterna entre seleção (pagar) e gerenciamento (preferido/remover). */}
          <View style={styles.manageHeader}>
            <Text style={styles.manageHeaderLabel}>
              {manageMode ? 'Gerenciar cartões' : 'Seus cartões'}
            </Text>
            <TouchableOpacity
              onPress={onToggleManage}
              hitSlop={HIT}
              accessibilityRole="button"
              accessibilityLabel={manageMode ? 'Concluir gerenciamento' : 'Gerenciar cartões'}
            >
              <Text style={styles.manageHeaderAction}>{manageMode ? 'Concluir' : 'Gerenciar'}</Text>
            </TouchableOpacity>
          </View>

          {cards.map((c) => {
            const selected = c.id === selectedCardId;
            const busy = cardActionId === c.id;
            const brandText = BRAND_LABEL[(c.brand as never) ?? 'unknown'] ?? 'Cartão';
            return (
              <View
                key={c.id}
                style={[styles.savedCard, !manageMode && selected && styles.savedCardActive]}
              >
                <TouchableOpacity
                  style={styles.savedCardMain}
                  onPress={manageMode ? undefined : () => onSelect(c.id)}
                  disabled={manageMode || busy}
                  accessibilityRole={manageMode ? undefined : 'radio'}
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    `${brandText} final ${c.last4}` + (c.isDefault ? ', cartão preferido' : '')
                  }
                >
                  {!manageMode && (
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? Colors.primary : Colors.textSecondary}
                    />
                  )}
                  <Ionicons name="card" size={22} color={Colors.darkNavy} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.savedCardBrand}>
                      {brandText} ••••{c.last4}
                    </Text>
                    <Text style={styles.savedCardExp}>
                      Expira {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                    </Text>
                  </View>
                  {c.isDefault && !manageMode && (
                    <View style={styles.preferBadge}>
                      <Text style={styles.preferBadgeText}>Preferido</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {manageMode && (
                  <View style={styles.manageActions}>
                    {busy ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <>
                        <TouchableOpacity
                          onPress={() => onSetDefault(c.id)}
                          disabled={c.isDefault}
                          hitSlop={HIT}
                          accessibilityRole="button"
                          accessibilityLabel={
                            c.isDefault ? 'Já é o cartão preferido' : `Tornar ${brandText} final ${c.last4} preferido`
                          }
                        >
                          <Ionicons
                            name={c.isDefault ? 'star' : 'star-outline'}
                            size={22}
                            color={c.isDefault ? Colors.warningAmber : Colors.textSecondary}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => onRemove(c.id)}
                          hitSlop={HIT}
                          accessibilityRole="button"
                          accessibilityLabel={`Remover ${brandText} final ${c.last4}`}
                        >
                          <Ionicons name="trash-outline" size={22} color={Colors.dangerRed} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      {/* CVV exigido sempre, inclusive em cartão salvo, antes de cobrar. */}
      {!manageMode && cards.length > 0 && selectedCardId && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>CVV do cartão selecionado</Text>
          <TextInput
            style={[styles.input, !!cvvError && styles.inputError]}
            value={savedCvv}
            onChangeText={onChangeCvv}
            keyboardType="number-pad"
            placeholder="123"
            placeholderTextColor={Colors.textSecondary}
            maxLength={4}
            secureTextEntry
            accessibilityLabel="Código de segurança do cartão"
          />
          {!!cvvError && <FieldError msg={cvvError} />}
        </View>
      )}

      {!manageMode && (
        <TouchableOpacity
          style={styles.addCardBtn}
          onPress={onAddNew}
          accessibilityRole="button"
          accessibilityLabel="Adicionar novo cartão"
        >
          <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.addCardText}>Adicionar novo cartão</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function StepNewCard({
  number, expiry, cvv, holder, cpf, cardType, saveCard, errors, brandLabel,
  onChangeNumber, onChangeExpiry, onChangeCvv, onChangeHolder, onChangeCpf, onChangeType, onToggleSave,
}: {
  number: string; expiry: string; cvv: string; holder: string; cpf: string;
  cardType: CardType; saveCard: boolean; errors: CardFieldErrors; brandLabel: string;
  onChangeNumber: (v: string) => void; onChangeExpiry: (v: string) => void; onChangeCvv: (v: string) => void;
  onChangeHolder: (v: string) => void; onChangeCpf: (v: string) => void;
  onChangeType: (t: CardType) => void; onToggleSave: () => void;
}) {
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Número do cartão</Text>
        <View style={styles.inputWithIcon}>
          <TextInput
            style={[styles.inputFlex, !!errors.number && styles.inputError]}
            value={number}
            onChangeText={onChangeNumber}
            keyboardType="number-pad"
            placeholder="0000 0000 0000 0000"
            placeholderTextColor={Colors.textSecondary}
            accessibilityLabel="Número do cartão"
          />
          <Text style={styles.brandTag}>{brandLabel}</Text>
        </View>
        {!!errors.number && <FieldError msg={errors.number} />}
      </View>

      <View style={styles.row}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Validade</Text>
          <TextInput
            style={[styles.input, !!errors.expiry && styles.inputError]}
            value={expiry}
            onChangeText={onChangeExpiry}
            keyboardType="number-pad"
            placeholder="MM/AA"
            placeholderTextColor={Colors.textSecondary}
            maxLength={5}
            accessibilityLabel="Validade do cartão, mês e ano"
          />
          {!!errors.expiry && <FieldError msg={errors.expiry} />}
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>CVV</Text>
          <TextInput
            style={[styles.input, !!errors.cvv && styles.inputError]}
            value={cvv}
            onChangeText={onChangeCvv}
            keyboardType="number-pad"
            placeholder="123"
            placeholderTextColor={Colors.textSecondary}
            maxLength={4}
            secureTextEntry
            accessibilityLabel="Código de segurança"
          />
          {!!errors.cvv && <FieldError msg={errors.cvv} />}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Nome impresso no cartão</Text>
        <TextInput
          style={[styles.input, !!errors.name && styles.inputError]}
          value={holder}
          onChangeText={onChangeHolder}
          autoCapitalize="characters"
          placeholder="Como está no cartão"
          placeholderTextColor={Colors.textSecondary}
          accessibilityLabel="Nome impresso no cartão"
        />
        {!!errors.name && <FieldError msg={errors.name} />}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>CPF do titular</Text>
        <TextInput
          style={[styles.input, !!errors.cpf && styles.inputError]}
          value={cpf}
          onChangeText={onChangeCpf}
          keyboardType="number-pad"
          placeholder="000.000.000-00"
          placeholderTextColor={Colors.textSecondary}
          maxLength={14}
          accessibilityLabel="CPF do titular do cartão"
        />
        {!!errors.cpf && <FieldError msg={errors.cpf} />}
      </View>

      {/* Segmented Crédito / Débito */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Tipo</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {(['credit', 'debit'] as const).map((t) => {
            const active = cardType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => onChangeType(t)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t === 'credit' ? 'Crédito' : 'Débito'}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {t === 'credit' ? 'Crédito' : 'Débito'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Salvar cartão (só crédito) */}
      <TouchableOpacity
        style={[styles.checkboxRow, cardType === 'debit' && styles.checkboxDisabled]}
        onPress={cardType === 'credit' ? onToggleSave : undefined}
        disabled={cardType === 'debit'}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saveCard, disabled: cardType === 'debit' }}
        accessibilityLabel="Salvar este cartão para as próximas compras"
      >
        <Ionicons
          name={saveCard ? 'checkbox' : 'square-outline'}
          size={22}
          color={cardType === 'debit' ? Colors.border : saveCard ? Colors.primary : Colors.textSecondary}
        />
        <Text style={styles.checkboxText}>
          Salvar este cartão
          {cardType === 'debit' && (
            <Text style={styles.checkboxHint}>  (indisponível no débito)</Text>
          )}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function StepInstallments({
  loading, error, options, selected, onSelect, onRetry,
}: {
  loading: boolean;
  error: boolean;
  options: InstallmentOption[];
  selected: InstallmentOption | null;
  onSelect: (opt: InstallmentOption) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator color={Colors.primary} />
        <Text style={styles.emptyDesc}>Calculando opções...</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centerBox}>
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.warningAmber} />
        <Text style={styles.emptyTitle}>Não foi possível calcular as parcelas</Text>
        <Text style={styles.emptyDesc}>Verifique sua conexão e tente novamente.</Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={onRetry} accessibilityRole="button">
          <Ionicons name="refresh" size={16} color={Colors.darkNavy} />
          <Text style={styles.outlineBtnText}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (options.length === 0) {
    return (
      <View style={styles.centerBox}>
        <Ionicons name="card-outline" size={40} color={Colors.textSecondary} />
        <Text style={styles.emptyTitle}>Nenhuma opção de parcelamento</Text>
        <Text style={styles.emptyDesc}>Este cartão não retornou condições de pagamento.</Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={onRetry} accessibilityRole="button">
          <Ionicons name="refresh" size={16} color={Colors.darkNavy} />
          <Text style={styles.outlineBtnText}>Tentar de novo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }} accessibilityRole="radiogroup">
      {options.map((opt) => {
        const active = selected?.installments === opt.installments;
        const noInterest = opt.installments === 1;
        return (
          <TouchableOpacity
            key={opt.installments}
            style={[styles.installmentRow, active && styles.savedCardActive]}
            onPress={() => onSelect(opt)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              `${opt.installments} vezes de ${formatBRL(opt.installmentAmount)}, ` +
              `total ${formatBRL(opt.totalAmount)}` + (noInterest ? ', sem juros' : '')
            }
          >
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? Colors.primary : Colors.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.installmentMain}>
                {opt.installments}x de {formatBRL(opt.installmentAmount)}
              </Text>
              <Text style={styles.installmentSub}>Total {formatBRL(opt.totalAmount)}</Text>
            </View>
            {noInterest && (
              <View style={styles.noInterestBadge}>
                <Text style={styles.noInterestText}>sem juros</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function StepReview({
  amount, installment, cardDescription, cardType, processing,
}: {
  amount: number;
  installment: InstallmentOption | null;
  cardDescription: string;
  cardType: CardType;
  processing: boolean;
}) {
  const total = installment?.totalAmount ?? amount;
  const juros = Math.max(0, Math.round((total - amount) * 100) / 100);

  if (processing) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.processingTitle}>Processando...</Text>
        <Text style={styles.emptyDesc}>Não feche esta tela.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Cartão</Text>
        <Text style={styles.reviewValue}>{cardDescription}</Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Forma</Text>
        <Text style={styles.reviewValue}>
          {cardType === 'debit'
            ? 'Débito à vista'
            : `Crédito · ${installment?.installments ?? 1}x de ${formatBRL(installment?.installmentAmount ?? amount)}`}
        </Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Valor do serviço</Text>
        <Text style={styles.reviewValue}>{formatBRL(amount)}</Text>
      </View>
      <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>Juros</Text>
        <Text style={styles.reviewValue}>{juros > 0 ? formatBRL(juros) : 'Sem juros'}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatBRL(total)}</Text>
      </View>

      <View style={styles.secureNote}>
        <Ionicons name="lock-closed" size={13} color={Colors.textSecondary} />
        <Text style={styles.secureNoteText}>
          Os dados do cartão são protegidos e processados pelo Mercado Pago.
        </Text>
      </View>
    </View>
  );
}

function StepResult({
  payErrorKind, rejectedDetail, result, isAddCardMode,
  onConcluir, onRetry, onTryAnotherCard, onUseOtherMethod, onShareReceipt,
}: {
  payErrorKind: PayErrorKind;
  rejectedDetail: string | null;
  result: CardPaymentResult | null;
  isAddCardMode?: boolean;
  onConcluir: () => void;
  onRetry: () => void;
  onTryAnotherCard: () => void;
  onUseOtherMethod: () => void;
  onShareReceipt: () => void;
}) {
  // Modo adicionar cartão: resultado de sucesso
  if (isAddCardMode && result && (result as any).status === 'card_saved') {
    return (
      <View style={styles.centerBox}>
        <View style={[styles.resultIcon, { backgroundColor: '#ECFDF5' }]}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.successGreen} />
        </View>
        <Text style={styles.resultTitle}>Cartão adicionado!</Text>
        <Text style={styles.emptyDesc}>Seu cartão foi salvo com sucesso.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onConcluir} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Concluir</Text>
        </TouchableOpacity>
      </View>
    );
  }
  // 503 / offline — infra indisponível.
  if (payErrorKind === 'unavailable') {
    return (
      <View style={styles.centerBox}>
        <View style={[styles.resultIcon, { backgroundColor: '#FFFBEB' }]}>
          <Ionicons name="alert-circle" size={48} color={Colors.warningAmber} />
        </View>
        <Text style={styles.resultTitle}>Não foi possível concluir agora</Text>
        <Text style={styles.emptyDesc}>
          O serviço de pagamento está indisponível ou você está sem conexão.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Tentar de novo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textBtn} onPress={onUseOtherMethod} accessibilityRole="button">
          <Text style={styles.textBtnLabel}>Usar outro método</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Token de uso único expirou entre a revisão e a cobrança.
  if (payErrorKind === 'token') {
    return (
      <View style={styles.centerBox}>
        <View style={[styles.resultIcon, { backgroundColor: '#FFFBEB' }]}>
          <Ionicons name="time-outline" size={48} color={Colors.warningAmber} />
        </View>
        <Text style={styles.resultTitle}>Sessão do cartão expirou</Text>
        <Text style={styles.emptyDesc}>
          Por segurança, o pagamento expira após alguns minutos. Toque para gerar uma nova
          autorização e tentar de novo.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Tentar de novo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.textBtn} onPress={onUseOtherMethod} accessibilityRole="button">
          <Text style={styles.textBtnLabel}>Usar outro método</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isApproved = result?.status === 'approved';
  const isProcessing =
    result?.status === 'in_process' || result?.status === 'pending' || result?.status === 'authorized';

  if ((isApproved || isProcessing) && result) {
    const pending = isProcessing;
    return (
      <View style={styles.centerBox}>
        <View style={[styles.resultIcon, { backgroundColor: pending ? '#FFFBEB' : '#ECFDF5' }]}>
          <Ionicons
            name={pending ? 'hourglass-outline' : 'checkmark-circle'}
            size={48}
            color={pending ? Colors.warningAmber : Colors.successGreen}
          />
        </View>
        <Text style={styles.resultTitle}>
          {pending ? 'Pagamento em processamento' : 'Pagamento aprovado!'}
        </Text>
        <Text style={styles.emptyDesc}>
          {formatBRL(result.amount)} · {result.installments}x
          {pending ? '\nEstá em análise. Você será notificado quando for concluído.' : ''}
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onConcluir} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Concluir</Text>
        </TouchableOpacity>
        {!pending && (
          <TouchableOpacity style={styles.outlineBtn} onPress={onShareReceipt} accessibilityRole="button">
            <Ionicons name="share-outline" size={16} color={Colors.darkNavy} />
            <Text style={styles.outlineBtnText}>Compartilhar recibo</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Recusado — mensagem amigável a partir do status_detail do MP.
  return (
    <View style={styles.centerBox}>
      <View style={[styles.resultIcon, { backgroundColor: '#FEF2F2' }]}>
        <Ionicons name="close-circle" size={48} color={Colors.dangerRed} />
      </View>
      <Text style={styles.resultTitle}>Pagamento recusado</Text>
      <Text style={styles.emptyDesc}>{statusDetailMessage(rejectedDetail)}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.primaryBtnText}>Tentar de novo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.outlineBtn} onPress={onTryAnotherCard} accessibilityRole="button">
        <Text style={styles.outlineBtnText}>Trocar cartão</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.textBtn} onPress={onUseOtherMethod} accessibilityRole="button">
        <Text style={styles.textBtnLabel}>Usar outro método</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componentes auxiliares
// ─────────────────────────────────────────────────────────────────────────────

function FieldError({ msg }: { msg: string }) {
  return (
    <View style={styles.errorRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={14} color={Colors.dangerRed} />
      <Text style={styles.errorText}>{msg}</Text>
    </View>
  );
}

function Footer({
  label, onPress, disabled, loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.footer}>
      <TouchableOpacity
        style={[styles.cta, disabled && styles.ctaDisabled]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
      >
        {loading ? (
          <ActivityIndicator color={Colors.cardWhite} />
        ) : (
          <Text style={styles.ctaText}>{label}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: Colors.cardWhite,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  amountStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
  },
  amountStripLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  amountStripValue: { fontSize: 18, fontWeight: '800', color: Colors.textPrimary },
  body: { paddingHorizontal: 20 },
  bodyContent: { paddingTop: 16, paddingBottom: 8, gap: 8 },

  centerBox: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  emptyDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  threeDsTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  threeDsWebWrap: { height: 400, marginTop: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  threeDsWaiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },

  // Skeleton
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', paddingVertical: 8 },
  skeletonIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.border },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: Colors.border },

  // Cartões salvos
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardWhite,
    minHeight: 64,
  },
  savedCardActive: { borderColor: Colors.primary, backgroundColor: '#FFF4EE' },
  savedCardBrand: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  savedCardExp: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  preferBadge: { backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  preferBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.successGreen },
  addCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    backgroundColor: '#FFF4EE',
  },
  addCardText: { fontSize: 14, fontWeight: '700', color: Colors.primary },

  // Gerenciar cartões
  manageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  manageHeaderLabel: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  manageHeaderAction: { fontSize: 14, fontWeight: '700', color: Colors.primary, minHeight: 24 },
  savedCardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  manageActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 8 },

  // Nota de segurança (revisão)
  secureNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  secureNoteText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },

  // Formulário
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.textPrimary,
    backgroundColor: Colors.cardWhite,
  },
  inputFlex: {
    flex: 1,
    height: 50,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: Colors.cardWhite,
    paddingRight: 12,
  },
  inputError: { borderColor: Colors.dangerRed },
  brandTag: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  row: { flexDirection: 'row', gap: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorText: { fontSize: 12, color: Colors.dangerRed },

  segmented: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.cardWhite,
  },
  segmentActive: { backgroundColor: Colors.darkNavy, borderColor: Colors.darkNavy },
  segmentText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  segmentTextActive: { color: Colors.cardWhite },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkboxDisabled: { opacity: 0.7 },
  checkboxText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '600' },
  checkboxHint: { fontSize: 12, color: Colors.textSecondary, fontWeight: '400' },

  // Parcelas
  installmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cardWhite,
    minHeight: 60,
  },
  installmentMain: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  installmentSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  noInterestBadge: { backgroundColor: '#ECFDF5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  noInterestText: { fontSize: 11, fontWeight: '700', color: Colors.successGreen },

  // Revisão
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewLabel: { fontSize: 14, color: Colors.textSecondary },
  reviewValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, maxWidth: '60%', textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 14,
    marginTop: 4,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  totalValue: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary },
  processingTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },

  // Resultado
  resultIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },

  primaryBtn: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: Colors.cardWhite },
  outlineBtn: {
    flexDirection: 'row',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    paddingHorizontal: 16,
  },
  outlineBtnText: { fontSize: 14, fontWeight: '700', color: Colors.darkNavy },
  textBtn: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  textBtnLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },

  // Rodapé / CTA principal — fundo darkNavy garante contraste do texto branco
  // (texto branco sobre o laranja #FF6B35 não atinge WCAG AA).
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cta: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.darkNavy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: 16, fontWeight: '800', color: Colors.cardWhite },
});
