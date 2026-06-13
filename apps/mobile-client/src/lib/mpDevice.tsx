import { useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

// ─────────────────────────────────────────────────────────────────────────────
// Device fingerprint do Mercado Pago (antifraude).
//
// O script security.js do MP define a global MP_DEVICE_SESSION_ID. Em React
// Native não há JS de página, então rodamos esse script numa WebView OCULTA,
// capturamos o id e guardamos aqui. O id é enviado no header X-meli-session-id
// ao criar o pagamento — é um dos fatores que MAIS pesam na aprovação.
// ─────────────────────────────────────────────────────────────────────────────

let deviceId: string | null = null;

/** Device id capturado (ou null se ainda não pronto). */
export function getMpDeviceId(): string | null {
  return deviceId;
}

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://www.mercadopago.com/v2/security.js" view="checkout"></script>
</head><body><script>
(function poll(n){
  var id = window.MP_DEVICE_SESSION_ID;
  if (id && window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(String(id)); }
  else if (n < 60) { setTimeout(function(){ poll(n + 1); }, 250); }
})(0);
</script></body></html>`;

/**
 * Monta UMA vez (ex.: na raiz do app) para capturar o device id em background.
 * Renderiza uma WebView de 0x0 (invisível) que carrega o security.js do MP.
 */
export function MpDeviceProbe() {
  const captured = useRef(false);
  // Container ABSOLUTO 1x1 fora da tela: garante que a WebView não ocupe espaço
  // no layout (com width/height 0 direto na WebView ela quebrava a tela).
  return (
    <View
      style={{ position: 'absolute', top: -1000, left: -1000, width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
      collapsable={false}
    >
      <WebView
        source={{ html: HTML, baseUrl: 'https://www.mercadopago.com' }}
        onMessage={(e) => {
          const v = e.nativeEvent.data;
          if (v && !captured.current) {
            deviceId = v;
            captured.current = true;
          }
        }}
        style={{ width: 1, height: 1 }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
      />
    </View>
  );
}
