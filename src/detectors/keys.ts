/**
 * Contexto por nombre de campo. `nroDocumento`, `nro_documento` y `NRO-DOCUMENTO`
 * se normalizan a `nrodocumento` antes de compararse.
 */

export function normKey(key: string | undefined): string {
  if (!key) return '';
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export const KEY = {
  card: /(cardnumber|cardno|cardnum|numerotarjeta|nrotarjeta|numtarjeta|numerodetarjeta|^tarjeta$|^pan$|ccnumber|creditcard|debitcard|^card$|primaryaccountnumber)/,
  cvv: /^(cvv2?|cvc2?|cid|csc|cav2|securitycode|cardsecuritycode|codigoseguridad|codigodeseguridad|codseguridad)$/,
  password: /(password|passwd|^pwd$|contrasena|^clave$|clavesecreta|claveweb|claveinternet|^pin$|pinblock|^otp$|otpcode|codigootp)/,
  secret: /(secret|apikey|apitoken|privatekey|clientsecret|signingkey|encryptionkey|^xapikey$)/,
  token: /(accesstoken|refreshtoken|idtoken|authtoken|sessiontoken|^token$|^jwt$|bearer|sessionid|^sid$|jsessionid|phpsessid|aspnetsessionid|connectsid)/,
  account: /(cuenta|accountnumber|accountno|nrocuenta|numerocuenta|numcuenta|^cci$|cuentainterbancaria|^iban$|bankaccount)/,
  cci: /(^cci$|cuentainterbancaria|codigointerbancario)/,
  peDni: /(^dni$|nrodni|numerodni|^documento$|nrodocumento|numerodocumento|numdocumento|nrodoc|numdoc|documentnumber|docnumber|documentid|identitydocument|^doc$)/,
  peCe: /(carnetextranjeria|carneextranjeria|carnetdeextranjeria|carnedeextranjeria)/,
  coCc: /(^cedula$|numerocedula|nrocedula|cedulaciudadania|^cc$|identificacion|nroidentificacion|numeroidentificacion|^documento$|nrodocumento|numerodocumento|documentnumber|docnumber)/,
  coNit: /^(nit|nronit|numeronit)$/,
  phone: /(telefono|celular|^phone|phonenumber|mobile|movil|^tel$|whatsapp)/,
  email: /(email|correo|mail)/,
} as const;

export function keyIs(re: RegExp, key: string | undefined): boolean {
  const k = normKey(key);
  return !!k && re.test(k);
}

/** Valores de relleno que no son datos reales: "****", "null", "[REDACTED]". */
export function isPlaceholder(v: string): boolean {
  const t = v.trim();
  return (
    t.length === 0 ||
    /^[*•x#·.\-_]+$/i.test(t) ||
    /^(null|undefined|none|nil|n\/a|redacted|\[redacted\]|<redacted>|masked|hidden|\*\*\*.*)$/i.test(t)
  );
}
