const toBase64Url = (bytes: ArrayBuffer) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const generateKeyPair = async () => {
  const pair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  return {
    publicKey: toBase64Url(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
    privateKey: toBase64Url(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ),
  };
};
