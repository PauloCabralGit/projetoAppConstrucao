function toBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function registerBiometricCredential(fullName: string) {
  if (!window.PublicKeyCredential) {
    throw new Error("Este dispositivo nao suporta biometria via passkeys.");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const created = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "ConstruConnect" },
      user: {
        id: userId,
        name: fullName.toLowerCase().replace(/\s+/g, "."),
        displayName: fullName
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
      },
      timeout: 60_000,
      attestation: "none"
    }
  });

  if (!created) {
    throw new Error("Nao foi possivel criar a credencial biometrica.");
  }

  const credential = created as PublicKeyCredential;

  return {
    credentialId: toBase64Url(credential.rawId),
    challenge: "construconnect-poc"
  };
}
