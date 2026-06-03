import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

interface RatingModalProps {
  visible: boolean;
  serviceId: string;
  providerName: string;
  onClose: () => void;
  onSubmit: (rating: { score: number; comment?: string }) => Promise<void>;
}

export default function RatingModal({
  visible,
  serviceId,
  providerName,
  onClose,
  onSubmit,
}: RatingModalProps) {
  const [selectedScore, setSelectedScore] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (selectedScore === 0) {
      setError('Selecione uma avaliação');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit({ score: selectedScore, comment: comment.trim() || undefined });
      setSuccess(true);
      setTimeout(() => {
        resetAndClose();
      }, 1500);
    } catch (err) {
      const errorMsg = (err as Error).message || 'Erro ao enviar avaliação';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const resetAndClose = () => {
    onClose();
    setSelectedScore(0);
    setComment('');
    setSuccess(false);
    setError(null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={resetAndClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContent, { backgroundColor: Colors.cardWhite }]}>
          {!success ? (
            <>
              <View style={styles.header}>
                <Text style={[styles.headerTitle, { color: Colors.textPrimary }]}>
                  Avaliar {providerName}
                </Text>
                <Text style={[styles.headerSubtitle, { color: Colors.textSecondary }]}>
                  Como foi o serviço?
                </Text>
              </View>

              {error && (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle" size={16} color={Colors.dangerRed} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Star Rating */}
              <View style={styles.starsContainer}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => {
                      setSelectedScore(star);
                      setError(null);
                    }}
                    style={styles.starTouchArea}
                    accessibilityRole="radio"
                    accessibilityLabel={`${star} estrelas`}
                    accessibilityState={{ selected: star === selectedScore }}
                  >
                    <Text style={styles.starEmoji}>
                      {star <= selectedScore ? '⭐' : '☆'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {selectedScore > 0 && (
                <View style={styles.selectedScoreLabel}>
                  <Text style={[styles.selectedScoreText, { color: Colors.primary }]}>
                    {selectedScore} {selectedScore === 1 ? 'estrela' : 'estrelas'} selecionadas
                  </Text>
                </View>
              )}

              {/* Comment Input */}
              <View style={styles.commentSection}>
                <Text style={[styles.commentLabel, { color: Colors.textSecondary }]}>
                  Deixe um comentário (opcional)
                </Text>
                <TextInput
                  placeholder="Compartilhe sua experiência..."
                  placeholderTextColor={Colors.textSecondary}
                  value={comment}
                  onChangeText={setComment}
                  maxLength={200}
                  multiline
                  numberOfLines={4}
                  style={[
                    styles.commentInput,
                    {
                      borderColor: Colors.border,
                      color: Colors.textPrimary,
                      backgroundColor: Colors.background,
                    },
                  ]}
                  textAlignVertical="top"
                  editable={!loading}
                />
                <Text style={[styles.charCount, { color: Colors.textSecondary }]}>
                  {comment.length}/200
                </Text>
              </View>

              {/* Buttons */}
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  onPress={resetAndClose}
                  disabled={loading}
                  style={[
                    styles.cancelButton,
                    { borderColor: Colors.border },
                    loading && { opacity: 0.5 },
                  ]}
                >
                  <Text style={[styles.cancelButtonText, { color: Colors.textSecondary }]}>
                    Talvez Depois
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={selectedScore === 0 || loading}
                  style={[
                    styles.submitButton,
                    selectedScore === 0 && styles.submitButtonDisabled,
                    {
                      backgroundColor:
                        selectedScore === 0 ? Colors.border : Colors.primary,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Enviar avaliação"
                  accessibilityState={{ disabled: selectedScore === 0 || loading }}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.cardWhite} size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={18} color={Colors.cardWhite} />
                      <Text style={styles.submitButtonText}>Enviar</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.successContainer}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={48} color={Colors.primary} />
              </View>
              <Text style={[styles.successTitle, { color: Colors.textPrimary }]}>
                Avaliação enviada!
              </Text>
              <Text style={[styles.successMessage, { color: Colors.textSecondary }]}>
                Obrigado por avaliar {providerName}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 32 : 24,
  },
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dangerRed,
    fontWeight: '500',
  },
  starsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 12,
  },
  starTouchArea: {
    padding: 12,
  },
  starEmoji: {
    fontSize: 44,
  },
  selectedScoreLabel: {
    alignItems: 'center',
    marginBottom: 20,
  },
  selectedScoreText: {
    fontSize: 13,
    fontWeight: '600',
  },
  commentSection: {
    marginBottom: 20,
  },
  commentLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 4,
    minHeight: 80,
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginBottom: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.cardWhite,
  },
  successContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F0F9FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  successMessage: {
    fontSize: 14,
    fontWeight: '400',
  },
});
