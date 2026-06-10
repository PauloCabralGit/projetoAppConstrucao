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
import type { SavedCard, InstallmentOption, CardPaymentResult } from '@construconnect/shared';
import { Colors } from '@/constants/colors';
import {
  fetchSavedCardsMock,
  generateInstallmentsMock,
  payCardMock,
  type PayOutcome,
} from '@/lib/cardMocks';
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
  type CardFieldErrors,
} from '@/lib/cardUtils';

type CardStep = 'list' | 'new' | 'installments' | 'review' | 'result';
type CardType = 'credit' | 'debit';

interface CardPaymentSheetProps {
  visible: boolean;
  /** Valor do serviço em reais. */
  amount: number;
  /** E-mail do pagador — usado no payload da Fatia 5 (payer_email). */
  payerEmail?: string;
  onClose: () => void;
  /** Chamado quando a cobrança é aprovada e o usuário toca em "Concluir". */
  onApproved: (result: CardPaymentResult) => void;
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

export default function CardPaymentSheet({
  visible,
  amount,
  payerEmail,
  onClose,
  onApproved,
}: CardPaymentSheetProps) {
  const [step, setStep] = useState<CardStep>('list');

  // ── Cartões salvos ──────────────────────────────────────────────────────
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [savedCvv, setSavedCvv] = useState(''); // CVV exigido sempre, mesmo no cartão salvo

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
  const [selectedInstallment, setSelectedInstallment] = useState<InstallmentOption | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<CardPaymentResult | null>(null);
  const [payError, setPayError] = useState(false);

  // F4: controla o desfecho do mock de cobrança (somente em desenvolvimento).
  const [mockOutcome, setMockOutcome] = useState<PayOutcome>('approved');

  const brand = detectBrand(number);
  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? null,
    [cards, selectedCardId]
  );

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    setCardsError(false);
    try {
      // FATIA 5: GET /v1/cards com authHeaders.
      const data = await fetchSavedCardsMock('ok');
      setCards(data);
      setSelectedCardId(data.find((c) => c.isDefault)?.id ?? data[0]?.id ?? null);
    } catch {
      setCardsError(true);
    } finally {
      setCardsLoading(false);
    }
  }, []);

  // Reinicia tudo ao abrir.
  useEffect(() => {
    if (!visible) return;
    setStep('list');
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
    setSelectedInstallment(null);
    setUsingSaved(false);
    setProcessing(false);
    setResult(null);
    setPayError(false);
    setMockOutcome('approved');
    loadCards();
  }, [visible, loadCards]);

  // Débito não é salvo (regra do produto).
  useEffect(() => {
    if (cardType === 'debit') setSaveCard(false);
  }, [cardType]);

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

  async function loadInstallments() {
    setInstallmentsLoading(true);
    setStep('installments');
    try {
      // FATIA 5: GET /v1/installments (juros reais do emissor via MP).
      const opts = await generateInstallmentsMock(amount);
      setInstallments(opts);
    } finally {
      setInstallmentsLoading(false);
    }
  }

  function handleContinueFromNew() {
    if (!validateNewCard()) return;
    setUsingSaved(false);
    if (cardType === 'credit') {
      loadInstallments();
    } else {
      // Débito: à vista, sem parcelas.
      setSelectedInstallment({
        installments: 1,
        installmentAmount: amount,
        totalAmount: amount,
        labels: ['débito à vista'],
      });
      setStep('review');
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
    loadInstallments();
  }

  async function handlePay() {
    if (!selectedInstallment) return;
    setProcessing(true);
    setPayError(false);
    try {
      // FATIA 5: aqui ocorre a tokenização no device (createCardToken do Mercado Pago)
      // e em seguida o POST create-card-payment com authHeaders + idempotency_key.
      const res = await payCardMock({
        amount: selectedInstallment.totalAmount,
        installments: selectedInstallment.installments,
        outcome: mockOutcome,
      });
      setResult(res);
      setStep('result');
    } catch {
      setPayError(true);
      setStep('result');
    } finally {
      setProcessing(false);
    }
  }

  function resetToPaymentStart() {
    setResult(null);
    setPayError(false);
    setStep(cards.length > 0 ? 'list' : 'new');
  }

  const headerTitle: Record<CardStep, string> = {
    list: 'Pagar com cartão',
    new: 'Novo cartão',
    installments: 'Parcelamento',
    review: 'Revisar pagamento',
    result: 'Resultado',
  };

  const canGoBack = step !== 'list' && step !== 'result' && !processing;

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

          <View style={styles.amountStrip}>
            <Text style={styles.amountStripLabel}>Valor do serviço</Text>
            <Text style={styles.amountStripValue}>{formatBRL(amount)}</Text>
          </View>

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
                options={installments}
                selected={selectedInstallment}
                onSelect={setSelectedInstallment}
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
                mockOutcome={mockOutcome}
                onChangeMockOutcome={setMockOutcome}
              />
            )}

            {step === 'result' && (
              <StepResult
                error={payError}
                result={result}
                onConcluir={() => { if (result) onApproved(result); onClose(); }}
                onRetry={handlePay}
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
          {step === 'list' && !cardsLoading && !cardsError && (
            <Footer
              label="Continuar"
              disabled={!selectedCardId || !savedCvvValid}
              onPress={handleContinueFromSaved}
            />
          )}
          {step === 'new' && (
            <Footer label="Continuar" onPress={handleContinueFromNew} />
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
}: {
  loading: boolean;
  error: boolean;
  cards: SavedCard[];
  selectedCardId: string | null;
  onSelect: (id: string) => void;
  savedCvv: string;
  onChangeCvv: (v: string) => void;
  cvvError?: string;
  onRetry: () => void;
  onAddNew: () => void;
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
    return (
      <View style={styles.centerBox}>
        <Ionicons name="cloud-offline-outline" size={40} color={Colors.warningAmber} />
        <Text style={styles.emptyTitle}>Não foi possível carregar seus cartões</Text>
        <Text style={styles.emptyDesc}>Verifique sua conexão e tente novamente.</Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={onRetry} accessibilityRole="button">
          <Ionicons name="refresh" size={16} color={Colors.darkNavy} />
          <Text style={styles.outlineBtnText}>Tentar de novo</Text>
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
        cards.map((c) => {
          const selected = c.id === selectedCardId;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.savedCard, selected && styles.savedCardActive]}
              onPress={() => onSelect(c.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={
                `${BRAND_LABEL[(c.brand as never) ?? 'unknown'] ?? 'Cartão'} final ${c.last4}` +
                (c.isDefault ? ', cartão preferido' : '')
              }
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? Colors.primary : Colors.textSecondary}
              />
              <Ionicons name="card" size={22} color={Colors.darkNavy} />
              <View style={{ flex: 1 }}>
                <Text style={styles.savedCardBrand}>
                  {BRAND_LABEL[(c.brand as never) ?? 'unknown'] ?? 'Cartão'} ••••{c.last4}
                </Text>
                <Text style={styles.savedCardExp}>
                  Expira {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                </Text>
              </View>
              {c.isDefault && (
                <View style={styles.preferBadge}>
                  <Text style={styles.preferBadgeText}>Preferido</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })
      )}

      {/* CVV exigido sempre, inclusive em cartão salvo, antes de cobrar. */}
      {cards.length > 0 && selectedCardId && (
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

      <TouchableOpacity
        style={styles.addCardBtn}
        onPress={onAddNew}
        accessibilityRole="button"
        accessibilityLabel="Adicionar novo cartão"
      >
        <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
        <Text style={styles.addCardText}>Adicionar novo cartão</Text>
      </TouchableOpacity>
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
  loading, options, selected, onSelect,
}: {
  loading: boolean;
  options: InstallmentOption[];
  selected: InstallmentOption | null;
  onSelect: (opt: InstallmentOption) => void;
}) {
  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator color={Colors.primary} />
        <Text style={styles.emptyDesc}>Calculando opções...</Text>
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
  amount, installment, cardDescription, cardType, processing, mockOutcome, onChangeMockOutcome,
}: {
  amount: number;
  installment: InstallmentOption | null;
  cardDescription: string;
  cardType: CardType;
  processing: boolean;
  mockOutcome: PayOutcome;
  onChangeMockOutcome: (o: PayOutcome) => void;
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

      {/* F4: controle de simulação visível somente em desenvolvimento. */}
      {__DEV__ && (
        <View style={styles.devBox}>
          <Text style={styles.devLabel}>Simular resultado (F4 — apenas dev)</Text>
          <View style={styles.segmented}>
            {(['approved', 'rejected', 'error'] as const).map((o) => {
              const active = mockOutcome === o;
              return (
                <TouchableOpacity
                  key={o}
                  style={[styles.segment, active && styles.segmentActive]}
                  onPress={() => onChangeMockOutcome(o)}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {o === 'approved' ? 'Aprovar' : o === 'rejected' ? 'Recusar' : 'Falha'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function StepResult({
  error, result, onConcluir, onRetry, onTryAnotherCard, onUseOtherMethod, onShareReceipt,
}: {
  error: boolean;
  result: CardPaymentResult | null;
  onConcluir: () => void;
  onRetry: () => void;
  onTryAnotherCard: () => void;
  onUseOtherMethod: () => void;
  onShareReceipt: () => void;
}) {
  // 503 / offline
  if (error) {
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

  const approved = result?.status === 'approved';

  if (approved) {
    return (
      <View style={styles.centerBox}>
        <View style={[styles.resultIcon, { backgroundColor: '#ECFDF5' }]}>
          <Ionicons name="checkmark-circle" size={48} color={Colors.successGreen} />
        </View>
        <Text style={styles.resultTitle}>Pagamento aprovado!</Text>
        <Text style={styles.emptyDesc}>
          {formatBRL(result!.amount)} · {result!.installments}x
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onConcluir} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Concluir</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.outlineBtn} onPress={onShareReceipt} accessibilityRole="button">
          <Ionicons name="share-outline" size={16} color={Colors.darkNavy} />
          <Text style={styles.outlineBtnText}>Compartilhar recibo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Recusado
  return (
    <View style={styles.centerBox}>
      <View style={[styles.resultIcon, { backgroundColor: '#FEF2F2' }]}>
        <Ionicons name="close-circle" size={48} color={Colors.dangerRed} />
      </View>
      <Text style={styles.resultTitle}>Pagamento recusado</Text>
      <Text style={styles.emptyDesc}>
        Não conseguimos aprovar a cobrança neste cartão. Tente novamente ou use outro cartão.
      </Text>
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

  devBox: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.background,
  },
  devLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },

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
