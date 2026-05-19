import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

const WHATSAPP_NUMBER = '5511999999999';
const SUPPORT_EMAIL = 'suporte@construconnect.app';

const FAQ_ITEMS = [
  {
    q: 'Como recebo chamados de clientes?',
    a: 'Quando você está com o status "Online" no seu perfil, novos pedidos na sua cidade aparecem automaticamente na aba "Chamados". Você também recebe uma notificação push.',
  },
  {
    q: 'Como aceitar um chamado?',
    a: 'Na aba "Chamados", toque no pedido desejado e depois em "Aceitar chamado". O cliente será notificado e você deve se deslocar ao local do serviço.',
  },
  {
    q: 'Como enviar um orçamento?',
    a: 'Dentro do chamado, toque em "Enviar orçamento", informe o valor e uma observação se desejar. O cliente pode aceitar, rejeitar ou fazer uma contraproposta.',
  },
  {
    q: 'O que é o sistema de lances (bids)?',
    a: 'Alguns clientes habilitam múltiplos orçamentos. Vários prestadores podem enviar propostas e o cliente escolhe o melhor. Você recebe uma notificação quando seu orçamento é aceito.',
  },
  {
    q: 'Como registrar fotos do serviço?',
    a: 'Na tela do serviço ativo, você pode registrar fotos "antes" (ao chegar) e "depois" (ao concluir). Essas fotos ficam vinculadas ao pedido e são visíveis ao cliente.',
  },
  {
    q: 'Como funciona a avaliação?',
    a: 'Após a conclusão, o cliente avalia o serviço de 1 a 5 estrelas. Sua média geral aparece no perfil público. Avaliação abaixo de 4,6 pode resultar em suspensão temporária.',
  },
  {
    q: 'Como receber pagamento?',
    a: 'Cadastre sua chave Pix no perfil. O cliente pode pagar via Pix diretamente pelo app. Confirme o recebimento na tela do pedido concluído.',
  },
  {
    q: 'O que é o relatório mensal?',
    a: 'Na aba "Ganhos", você pode gerar um PDF com todos os serviços concluídos no mês, incluindo valores e datas. Ideal para controle financeiro e declaração de renda.',
  },
  {
    q: 'Como adicionar certificações ao perfil?',
    a: 'Na aba "Perfil", na seção "Certificações e Documentos", toque no botão "+" para enviar uma foto do documento e informar o nome da certificação (ex: NR-35, CREA).',
  },
  {
    q: 'Posso ficar offline temporariamente?',
    a: 'Sim. No seu perfil, use o switch de disponibilidade para alternar entre Online e Offline. Você não receberá novos chamados enquanto estiver offline.',
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      style={styles.faqItem}
      onPress={() => setOpen((v) => !v)}
      activeOpacity={0.7}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
      </View>
      {open && <Text style={styles.faqAnswer}>{answer}</Text>}
    </TouchableOpacity>
  );
}

export default function FAQScreen() {
  function openWhatsApp() {
    const url = Platform.OS === 'ios'
      ? `https://wa.me/${WHATSAPP_NUMBER}`
      : `whatsapp://send?phone=${WHATSAPP_NUMBER}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}`)
    );
  }

  function openEmail() {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Suporte%20ConstruConnect%20Prestador`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="help-circle-outline" size={28} color={Colors.darkNavy} />
        <Text style={styles.headerTitle}>FAQ e Suporte</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Perguntas frequentes</Text>

        <View style={styles.faqList}>
          {FAQ_ITEMS.map((item, i) => (
            <FAQItem key={i} question={item.q} answer={item.a} />
          ))}
        </View>

        <Text style={styles.sectionTitle}>Falar com o suporte</Text>

        <TouchableOpacity style={styles.contactBtn} onPress={openWhatsApp}>
          <View style={[styles.contactIcon, { backgroundColor: '#25D366' }]}>
            <Ionicons name="logo-whatsapp" size={22} color="#fff" />
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactTitle}>WhatsApp</Text>
            <Text style={styles.contactDesc}>Resposta em até 30 minutos</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.contactBtn} onPress={openEmail}>
          <View style={[styles.contactIcon, { backgroundColor: Colors.darkNavy }]}>
            <Ionicons name="mail-outline" size={22} color="#fff" />
          </View>
          <View style={styles.contactInfo}>
            <Text style={styles.contactTitle}>E-mail</Text>
            <Text style={styles.contactDesc}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.versionBox}>
          <Text style={styles.versionText}>ConstruConnect v1.0 — Prestador</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.darkNavy,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.cardWhite },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 4,
  },
  faqList: {
    backgroundColor: Colors.cardWhite, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    overflow: 'hidden',
  },
  faqItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  faqQuestion: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, flex: 1, lineHeight: 20 },
  faqAnswer: { fontSize: 13, color: Colors.textSecondary, marginTop: 10, lineHeight: 20 },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.cardWhite, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  contactIcon: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  contactInfo: { flex: 1 },
  contactTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  contactDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  versionBox: { alignItems: 'center', marginTop: 16 },
  versionText: { fontSize: 12, color: Colors.textSecondary },
});
